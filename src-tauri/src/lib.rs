// Rust backend: reads native system stats and exposes them to the JS frontend
// as Tauri commands (invoke("get_stats") on the JS side).

use std::sync::Mutex;
use std::thread;
use rusqlite::{params, Connection};
use serde::Serialize;
use sysinfo::{Components, System, MINIMUM_CPU_UPDATE_INTERVAL};
use tauri::Manager;
use std::time::{SystemTime, UNIX_EPOCH};

// A SQLite connection isn't thread-safe, so the Mutex serialises access across
// concurrent command invocations.
struct AppState {
    db: Mutex<Connection>,
}

// Serialize is what carries these structs across the bridge to JS; field names
// become the JSON keys (cpu_usage -> stats.cpu_usage).
#[derive(Serialize)]
struct SystemStats {
    cpu_usage: f32,        // overall CPU load, 0.0 – 100.0
    cpu_temp: Option<f32>, // °C — None when no hardware sensor is exposed
    mem_used: u64,         // bytes
    mem_total: u64,        // bytes
    mem_history: Vec<MemSample>, // last 60s of samples, oldest → newest
}

#[derive(Serialize)]
struct MemSample {
    ts: i64,       // UNIX timestamp in milliseconds
    mem_used: u64, // bytes
}

// `(async)` runs this on Tauri's thread pool, not the main/UI thread — the
// thread::sleep below would otherwise freeze the WebView every poll.
#[tauri::command(async)]
fn get_stats(minutes: u64, state: tauri::State<'_, AppState>) -> SystemStats {
    let minutes = minutes.max(1); // never let 0 produce an empty window
    let mut sys = System::new();

    // CPU usage is a rate, not a snapshot: it's the delta between two samples
    // taken a moment apart, so sysinfo needs refresh, wait, refresh.
    sys.refresh_cpu_usage();
    thread::sleep(MINIMUM_CPU_UPDATE_INTERVAL); // ~200ms
    sys.refresh_cpu_usage();
    let cpu_usage = sys.global_cpu_usage();

    sys.refresh_memory();
    let mem_used = sys.used_memory(); // bytes in modern sysinfo (older versions used kB)
    let mem_total = sys.total_memory();

    // Sensor labels vary by hardware (Intel "coretemp", AMD "k10temp Tctl", …),
    // so match the first component whose label looks CPU-ish. If this returns
    // None, log each c.label() here to find the one your machine exposes.
    let components = Components::new_with_refreshed_list();
    let cpu_temp = components
        .iter()
        .find(|c| {
            let label = c.label().to_lowercase();
            label.contains("cpu")
                || label.contains("core")
                || label.contains("package")
                || label.contains("tctl")     // AMD
                || label.contains("coretemp") // Intel
        })
        .and_then(|c| c.temperature());

    let db = state.db.lock().unwrap();

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    
    db.execute(
        "INSERT INTO mem_samples (ts, mem_used, mem_total) VALUES (?1, ?2, ?3)",
        params![now_ms, mem_used as i64, mem_total as i64],
    ).unwrap();

    let cutoff = now_ms - (minutes as i64 * 60_000); // last `minutes` minutes

    let mut stmt = db
        .prepare("SELECT ts, mem_used FROM mem_samples WHERE ts >= ?1 ORDER BY ts ASC")
        .unwrap();

    let mem_history = stmt
        .query_map(params![cutoff], |row| {
            Ok(MemSample {
                ts: row.get(0)?,
                mem_used: row.get::<_, i64>(1)? as u64,
            })
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    SystemStats { cpu_usage, cpu_temp, mem_used, mem_total, mem_history }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // setup runs once at startup, where `app` is available to resolve the
        // OS per-app data dir and open the database before any command runs.
        .setup(|app| {
            let app_dir = app.path().app_data_dir().expect("no app data dir");
            std::fs::create_dir_all(&app_dir).expect("could not create app data dir");
            let db_path = app_dir.join("history.db");

            let conn = Connection::open(db_path).expect("could not open database");

            conn.execute(
                "CREATE TABLE IF NOT EXISTS mem_samples (
                    ts        INTEGER NOT NULL,
                    mem_used  INTEGER NOT NULL,
                    mem_total INTEGER NOT NULL
                )",
                [],
            )
            .expect("could not create mem_samples table");

            app.manage(AppState { db: Mutex::new(conn) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_stats])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}