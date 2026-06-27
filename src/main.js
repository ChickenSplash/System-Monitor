// src/main.js
//
// Runs inside the WebView. It can't read hardware directly — instead it asks
// the Rust backend by calling invoke("get_stats"), which runs our
// #[tauri::command] function and returns the SystemStats struct as JSON.

// This project has no bundler (Tauri serves the raw files in src/), so we
// can't use `import { invoke } from "@tauri-apps/api/core"` — browsers can't
// resolve bare module specifiers. Instead we use the global API, available
// because `withGlobalTauri: true` is set in tauri.conf.json.
const { invoke } = window.__TAURI__.core;

// bytes → gigabytes (1024³), one decimal place.
function bytesToGB(bytes) {
  return (bytes / 1024 ** 3).toFixed(1);
}

async function refresh() {
  try {
    // The round-trip to Rust. The returned object's keys match the
    // SystemStats struct fields (serde turned them into JSON).
    const stats = await invoke("get_stats");

    // CPU usage
    const cpu = stats.cpu_usage.toFixed(1);
    document.getElementById("cpu-usage").textContent = cpu;
    document.getElementById("cpu-bar").style.width = `${cpu}%`;

    // CPU temp — null when the OS/hardware exposes no sensor
    document.getElementById("cpu-temp").textContent =
      stats.cpu_temp !== null ? stats.cpu_temp.toFixed(0) : "N/A";

    // Memory
    document.getElementById("mem-used").textContent = bytesToGB(stats.mem_used);
    document.getElementById("mem-total").textContent = bytesToGB(stats.mem_total);
    document.getElementById("mem-bar").style.width =
      `${(stats.mem_used / stats.mem_total) * 100}%`;
  } catch (err) {
    console.error("Failed to fetch stats:", err);
  }
}

// Poll once on load, then every second. (The Rust command itself blocks ~200ms
// to measure the CPU delta, so a 1s interval gives smooth, accurate readings.)
refresh();
setInterval(refresh, 500);