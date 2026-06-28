// Rust backend: reads native system stats and exposes them to the JS frontend
// as Tauri commands (invoke("get_stats") on the JS side).

use std::collections::HashMap;
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
    cpu_info: CpuInfo, // static hardware details, gathered once at startup
    mem_total: u64,    // total physical RAM in bytes, fixed at runtime
}

// Serialize is what carries these structs across the bridge to JS; field names
// become the JSON keys (cpu_usage -> stats.cpu_usage).
#[derive(Serialize)]
struct SystemStats {
    cpu: CpuStats,
    memory: MemoryStats,
    history: Vec<HistorySample>, // bucketed time-series, oldest → newest
}

#[derive(Serialize)]
struct MemoryStats {
    used: u64,  // bytes
    total: u64, // bytes
}

// All CPU readings live under one namespace so the JS side sees stats.cpu.*
// instead of a flat sprawl of cpu_* keys.
#[derive(Serialize)]
struct CpuStats {
    usage: f32,            // overall load, 0.0 – 100.0
    temp: Option<f32>,     // °C — None when no hardware sensor is exposed
    cores: Vec<CoreStats>, // per-core, ordered cpu0, cpu1, …
    load_avg: LoadAverage, // run-queue load (Linux/macOS; zeros on Windows)
    info: CpuInfo,         // static hardware details
}

#[derive(Serialize)]
struct CoreStats {
    name: String,   // "cpu0", "cpu1", …
    usage: f32,     // per-core load, 0.0 – 100.0
    frequency: u64, // current clock in MHz
}

#[derive(Serialize)]
struct LoadAverage {
    one: f64,
    five: f64,
    fifteen: f64,
}

#[derive(Serialize, Clone)]
struct CpuInfo {
    brand: String,                 // e.g. "AMD Ryzen 7 5800X"
    vendor_id: String,             // e.g. "AuthenticAMD"
    physical_cores: Option<usize>, // None when sysinfo can't determine it
    logical_cores: usize,          // thread count (SMT-inflated)
}

// One downsampled time bucket. Every metric is Option: None means either an
// offline gap (no rows in the bucket) or, for cpu_temp, no sensor on this host.
#[derive(Serialize)]
struct HistorySample {
    timestamp: i64,         // UNIX ms — bucket average, or midpoint for a gap
    cpu_usage: Option<f32>, // % (bucket average)
    cpu_temp: Option<f32>,  // °C (bucket average)
    mem_used: Option<u64>,  // bytes (bucket average)
    samples: u64,           // raw rows averaged into this bucket (0 when offline)
}

// `(async)` runs this on Tauri's thread pool, not the main/UI thread — the
// thread::sleep below would otherwise freeze the WebView every poll.
#[tauri::command(async)]
fn get_stats(minutes: u64, state: tauri::State<'_, AppState>) -> SystemStats {
    let minutes = minutes.max(1); // never let 0 produce an empty window
    let mut sys = System::new();

    // CPU usage is a rate, not a snapshot: it's the delta between two samples
    // taken a moment apart, so sysinfo needs refresh, wait, refresh. We refresh
    // *all* CPU data (not just usage) so per-core frequency comes along too.
    sys.refresh_cpu_all();
    thread::sleep(MINIMUM_CPU_UPDATE_INTERVAL); // ~200ms
    sys.refresh_cpu_all();

    let cpu_usage = sys.global_cpu_usage();
    let cores: Vec<CoreStats> = sys
        .cpus()
        .iter()
        .map(|c| CoreStats {
            name: c.name().to_string(),
            usage: c.cpu_usage(),
            frequency: c.frequency(),
        })
        .collect();

    let load = System::load_average();
    let load_avg = LoadAverage {
        one: load.one,
        five: load.five,
        fifteen: load.fifteen,
    };

    sys.refresh_memory();
    let mem_used = sys.used_memory(); // bytes in modern sysinfo (older versions used kB)
    let mem_total = state.mem_total;

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
        "INSERT INTO samples (timestamp, cpu_usage, cpu_temp, mem_used) VALUES (?1, ?2, ?3, ?4)",
        params![now_ms, cpu_usage as f64, cpu_temp.map(|t| t as f64), mem_used as i64],
    ).unwrap();

    let window_ms = minutes as i64 * 60_000;
    let cutoff = now_ms - window_ms; // last `minutes` minutes

    // Downsample to at most MAX_POINTS evenly-spaced buckets. Without this, a
    // wide window over densely-recorded data returns thousands of rows, and
    // re-rendering them all every poll makes the chart lag. We slice the window
    // into time buckets and average each, so the point count stays bounded no
    // matter how large the window or how dense the data.
    const MAX_POINTS: i64 = 60;
    let bucket_ms = (window_ms / MAX_POINTS).max(1);

    let mut stmt = db
        .prepare(
            "SELECT timestamp / ?2,
                    CAST(AVG(timestamp) AS INTEGER),
                    AVG(cpu_usage),
                    AVG(cpu_temp),
                    CAST(AVG(mem_used) AS INTEGER),
                    COUNT(*)
             FROM samples
             WHERE timestamp >= ?1
             GROUP BY timestamp / ?2",
        )
        .unwrap();

    // bucket index -> (avg timestamp, avg cpu_usage, avg cpu_temp, avg mem_used, row count)
    let buckets: HashMap<i64, (i64, Option<f64>, Option<f64>, Option<i64>, i64)> = stmt
        .query_map(params![cutoff, bucket_ms], |row| {
            Ok((
                row.get(0)?,
                (row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?),
            ))
        })
        .unwrap()
        .collect::<Result<HashMap<_, _>, _>>()
        .unwrap();

    // Walk every bucket across the window, not just the populated ones, so a
    // window wider than the recorded data still fills all the columns. Empty
    // buckets become "offline" gaps (mem_used = None) instead of being dropped.
    // Exactly MAX_POINTS buckets ending at the current one. Flooring cutoff and
    // now independently over an inclusive range would span MAX_POINTS + 1 indices.
    let newest = now_ms / bucket_ms;
    let history: Vec<HistorySample> = (newest - MAX_POINTS + 1..=newest)
        .map(|bucket| match buckets.get(&bucket) {
            Some(&(timestamp, cpu, temp, mem, count)) => HistorySample {
                timestamp,
                cpu_usage: cpu.map(|v| v as f32),
                cpu_temp: temp.map(|v| v as f32),
                mem_used: mem.map(|v| v as u64),
                samples: count as u64,
            },
            None => HistorySample {
                timestamp: bucket * bucket_ms + bucket_ms / 2, // bucket midpoint
                cpu_usage: None,
                cpu_temp: None,
                mem_used: None,
                samples: 0,
            },
        })
        .collect();

    SystemStats {
        cpu: CpuStats {
            usage: cpu_usage,
            temp: cpu_temp,
            cores,
            load_avg,
            info: state.cpu_info.clone(),
        },
        memory: MemoryStats {
            used: mem_used,
            total: mem_total,
        },
        history,
    }
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

            // Local history is disposable, so just drop the old shape rather
            // than migrating. One wide row per poll; metric columns are nullable
            // (cpu_temp is NULL when no sensor; future metrics added the same way).
            conn.execute("DROP TABLE IF EXISTS mem_samples", []).ok();
            conn.execute(
                "CREATE TABLE IF NOT EXISTS samples (
                    timestamp INTEGER NOT NULL,
                    cpu_usage REAL,
                    cpu_temp  REAL,
                    mem_used  INTEGER
                )",
                [],
            )
            .expect("could not create samples table");

            // All reads filter/group by timestamp, so index it.
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_samples_ts ON samples(timestamp)",
                [],
            )
            .expect("could not create samples index");

            // Static CPU details never change at runtime, so gather them once
            // here rather than on every get_stats poll. Brand/vendor are
            // identical across cores, so read them off the first one.
            let mut sys = System::new();
            sys.refresh_cpu_all();
            let first = sys.cpus().first();
            let cpu_info = CpuInfo {
                brand: first.map(|c| c.brand().to_string()).unwrap_or_default(),
                vendor_id: first.map(|c| c.vendor_id().to_string()).unwrap_or_default(),
                physical_cores: System::physical_core_count(),
                logical_cores: sys.cpus().len(),
            };

            sys.refresh_memory();
            let mem_total = sys.total_memory();

            app.manage(AppState { db: Mutex::new(conn), cpu_info, mem_total });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_stats])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}