// Ambient type declarations for the vanilla-JS frontend. With `// @ts-check` at
// the top of main.js, the editor uses these for type-checking and autocomplete.
// Nothing here runs — it only describes shapes the code already passes around.

/** One downsampled bucket of readings from the SQLite `samples` table. */
interface HistorySample {
  /** UNIX timestamp, ms (bucket average; midpoint for an offline gap) */
  timestamp: number;
  /** overall CPU load %, bucket average; null for an offline gap */
  cpu_usage: number | null;
  /** °C bucket average; null when no sensor, or an offline gap */
  cpu_temp: number | null;
  /** bytes (bucket average); null for an offline gap */
  mem_used: number | null;
  /** raw rows averaged into this bucket (0 when offline) */
  samples: number;
}

/** Per-core CPU reading — live only, not persisted. */
interface CoreStats {
  /** "cpu0", "cpu1", … */
  name: string;
  /** per-core load, 0.0–100.0 */
  usage: number;
  /** current clock in MHz */
  frequency: number;
}

/** Run-queue load average (Linux/macOS; zeros on Windows). */
interface LoadAverage {
  one: number;
  five: number;
  fifteen: number;
}

/** Static CPU hardware details, gathered once at startup. */
interface CpuInfo {
  brand: string;
  vendor_id: string;
  /** null when sysinfo can't determine it */
  physical_cores: number | null;
  logical_cores: number;
}

/** All CPU readings, namespaced under `stats.cpu`. */
interface CpuStats {
  /** overall load, 0.0–100.0 */
  usage: number;
  /** °C, or null when no hardware sensor is exposed */
  temp: number | null;
  cores: CoreStats[];
  load_avg: LoadAverage;
  info: CpuInfo;
}

/** Live memory readings, namespaced under `stats.memory`. */
interface MemoryStats {
  /** bytes */
  used: number;
  /** bytes */
  total: number;
}

/** Returned by the Rust `get_stats` command — mirrors the SystemStats struct. */
interface SystemStats {
  cpu: CpuStats;
  memory: MemoryStats;
  /** bucketed time-series, oldest → newest */
  history: HistorySample[];
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
