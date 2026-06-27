// src-tauri/src/lib.rs
//
// This is the Rust "backend". Anything the web frontend can't do on its own
// (like reading hardware sensors) lives here and is exposed as a "command"
// that JavaScript can call via invoke(). This is the Tauri equivalent of
// Electron's ipcMain.handle().

use std::sync::Mutex;
use std::thread;
use rusqlite::{params, Connection};
use serde::Serialize;
use sysinfo::{Components, System, MINIMUM_CPU_UPDATE_INTERVAL};
use tauri::Manager; // brings app.path() and app.manage() into scope
use std::time::{SystemTime, UNIX_EPOCH};

// Shared state created once at startup and handed to Tauri. Every #[tauri::command]
// can then borrow it via a `State<'_, AppState>` parameter. The Connection is
// wrapped in a Mutex because a SQLite connection can't be used from multiple
// threads at once — the lock ensures only one caller touches it at a time.
struct AppState {
    db: Mutex<Connection>,
}

// The shape of the data we send back to the frontend.
// #[derive(Serialize)] auto-generates the code to turn this struct into JSON,
// which is what actually crosses the bridge into JavaScript. The Rust field
// names become the JSON keys (e.g. stats.cpu_usage on the JS side).
#[derive(Serialize)]
struct SystemStats {
    cpu_usage: f32,        // overall CPU load, 0.0 – 100.0
    cpu_temp: Option<f32>, // °C — Option because not all hardware exposes a sensor
    mem_used: u64,         // bytes
    mem_total: u64,        // bytes
    mem_history: Vec<MemSample>, // last 60s of samples, oldest → newest
}

// One historical memory reading, as read back from the database. Like
// SystemStats, #[derive(Serialize)] lets it cross the bridge into JS, where
// each row becomes { ts, mem_used }.
#[derive(Serialize)]
struct MemSample {
    ts: i64,       // UNIX timestamp in milliseconds
    mem_used: u64, // bytes
}

// #[tauri::command] marks this function as callable from the frontend.
#[tauri::command]
fn get_stats(state: tauri::State<'_, AppState>) -> SystemStats {
    let mut sys = System::new();

    // --- CPU usage ---
    // CPU usage is a RATE, not a snapshot. It's computed as the difference
    // between two samples taken a moment apart, so a single reading is
    // meaningless. sysinfo requires us to refresh, wait, then refresh again.
    sys.refresh_cpu_usage();                    // first sample
    thread::sleep(MINIMUM_CPU_UPDATE_INTERVAL); // wait the minimum interval (~200ms)
    sys.refresh_cpu_usage();                    // second sample → now we have a delta
    let cpu_usage = sys.global_cpu_usage();     // averaged across all cores

    // --- Memory ---
    sys.refresh_memory();
    let mem_used = sys.used_memory();   // NOTE: bytes in modern sysinfo (older versions used kB)
    let mem_total = sys.total_memory();

    // --- Temperature ---
    // Temps come from "components" (sensors). Labels vary wildly by hardware:
    // Intel typically shows "coretemp ...", AMD shows "k10temp Tctl", etc.
    // We grab the first component whose label looks CPU-ish.
    // TIP: if you get N/A, add `println!("{}", c.label());` in the closure
    // below, run `npm run tauri dev`, and read the terminal to find YOUR label.
    let components = Components::new_with_refreshed_list();
    let cpu_temp = components
        .iter()
        .find(|c| {
            let label = c.label().to_lowercase();
            label.contains("cpu")
                || label.contains("core")
                || label.contains("package")
                || label.contains("tctl")     // AMD
                || label.contains("coretemp")  // Intel (likely yours, on the 12700K)
        })
        .and_then(|c| c.temperature()); // temperature() returns Option<f32>

    let db = state.db.lock().unwrap();

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;
    
    db.execute(
        "INSERT INTO mem_samples (ts, mem_used, mem_total) VALUES (?1, ?2, ?3)",
        params![now_ms, mem_used as i64, mem_total as i64],
    ).unwrap();

    let cutoff = now_ms - 60_000; // 60 seconds ago, in milliseconds

    let mut stmt = db
        .prepare("SELECT ts, mem_used FROM mem_samples WHERE ts >= ?1 ORDER BY ts ASC")
        .unwrap();

    let mem_history = stmt
        .query_map(params![cutoff], |row| {
            Ok(MemSample {
                ts: row.get(0)?,                 // column 0 = ts
                mem_used: row.get::<_, i64>(1)? as u64, // column 1 = mem_used
            })
        })
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    // --- YOUR TASK (step 3): query the last 60 seconds ---
    // Replace this placeholder with a real query that fills mem_history with
    // every row whose ts is within the last 60_000 ms, oldest first.
    let mem_history: Vec<MemSample> = vec![];

    SystemStats { cpu_usage, cpu_temp, mem_used, mem_total, mem_history }
}

// The entry point the generated main.rs calls.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // The setup hook runs once, after Tauri is initialised but before the
        // window appears. It's the right place to open the database, because
        // here we finally have access to `app` and can ask it for a proper
        // per-app data directory to store the file in.
        .setup(|app| {
            // A per-app folder owned by the OS (e.g. ~/.local/share/<app> on Linux).
            // create_dir_all is a no-op if it already exists.
            let app_dir = app.path().app_data_dir().expect("no app data dir");
            std::fs::create_dir_all(&app_dir).expect("could not create app data dir");
            let db_path = app_dir.join("history.db");

            // Open (or create) the SQLite file.
            let conn = Connection::open(db_path).expect("could not open database");

            // Create our table if it isn't there yet. ts is a UNIX timestamp in
            // milliseconds; mem_used / mem_total are bytes, matching SystemStats.
            conn.execute(
                "CREATE TABLE IF NOT EXISTS mem_samples (
                    ts        INTEGER NOT NULL,
                    mem_used  INTEGER NOT NULL,
                    mem_total INTEGER NOT NULL
                )",
                [],
            )
            .expect("could not create mem_samples table");

            // Hand the connection to Tauri so commands can borrow it later.
            app.manage(AppState { db: Mutex::new(conn) });
            Ok(())
        })
        // Register the command so the frontend is allowed to call it.
        // This is like listing your IPC handlers in Electron's main process.
        .invoke_handler(tauri::generate_handler![get_stats])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}