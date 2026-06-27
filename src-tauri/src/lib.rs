// src-tauri/src/lib.rs
//
// This is the Rust "backend". Anything the web frontend can't do on its own
// (like reading hardware sensors) lives here and is exposed as a "command"
// that JavaScript can call via invoke(). This is the Tauri equivalent of
// Electron's ipcMain.handle().

use std::thread;
use serde::Serialize;
use sysinfo::{Components, System, MINIMUM_CPU_UPDATE_INTERVAL};

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
}

// #[tauri::command] marks this function as callable from the frontend.
#[tauri::command]
fn get_stats() -> SystemStats {
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

    SystemStats { cpu_usage, cpu_temp, mem_used, mem_total }
}

// The entry point the generated main.rs calls.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Register the command so the frontend is allowed to call it.
        // This is like listing your IPC handlers in Electron's main process.
        .invoke_handler(tauri::generate_handler![get_stats])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}