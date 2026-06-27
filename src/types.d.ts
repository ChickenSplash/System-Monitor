// Ambient type declarations for the vanilla-JS frontend. With `// @ts-check` at
// the top of main.js, the editor uses these for type-checking and autocomplete.
// Nothing here runs — it only describes shapes the code already passes around.

/** One downsampled bucket of memory readings from the SQLite mem_samples table. */
interface MemSample {
  /** UNIX timestamp, milliseconds (bucket average) */
  timestamp: number;
  /** bytes (bucket average); null for an offline gap with no data */
  mem_used: number | null;
  /** raw rows averaged into this bucket (0 when offline) */
  samples: number;
}

/** Returned by the Rust `get_stats` command — mirrors the SystemStats struct. */
interface SystemStats {
  /** overall CPU load, 0.0–100.0 */
  cpu_usage: number;
  /** °C, or null when no hardware sensor is exposed */
  cpu_temp: number | null;
  /** bytes */
  mem_used: number;
  /** bytes */
  mem_total: number;
  /** last 60s of samples, oldest → newest */
  mem_history: MemSample[];
}

// The global Tauri API, exposed by `withGlobalTauri: true` in tauri.conf.json.
interface Window {
  __TAURI__: {
    core: {
      invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
    };
  };
}

// chart.js loaded as a UMD <script> global, not imported. Typed loosely to keep
// this setup zero-dependency; chart.js ships real types if you ever want them.
declare const Chart: any;
