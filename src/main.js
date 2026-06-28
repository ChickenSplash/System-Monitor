// @ts-check
// Frontend entry point: polls the Rust backend via invoke("get_stats"), feeds
// the metric charts, and updates the DOM stat readouts. Formatting lives in
// util.js; charts live in metric-chart.js. No bundler here (Tauri serves src/
// raw), so we use the global Tauri API rather than importing it — browsers
// can't resolve bare module specifiers. Local ES modules import fine by path.
import { bytesToGB } from "./util.js";
import { createMetricChart, applyChartTheme } from "./metric-chart.js";

const { invoke } = window.__TAURI__.core;

// One chart per metric; the shared machinery lives in metric-chart.js. Each only
// differs in how it pulls its value, its y-axis ceiling, and its tooltip line.
const memoryChart = createMetricChart({
  canvasId: "mem-chart",
  label: "Memory used (GB)",
  toValue: (sample) =>
    sample.mem_used === null ? null : Number(bytesToGB(sample.mem_used)),
  yMax: (stats) => Number(bytesToGB(stats.memory.total)),
  format: (sample) =>
    `Memory Used: ${((sample.mem_used ?? 0) / 1024 ** 3).toFixed(2)} GB`,
});

const cpuChart = createMetricChart({
  canvasId: "cpu-chart",
  label: "CPU usage (%)",
  toValue: (sample) => sample.cpu_usage, // already a percentage; null = gap
  yMax: () => 100,
  format: (sample) => `CPU: ${(sample.cpu_usage ?? 0).toFixed(1)}%`,
});

async function refresh() {
  try {
    const minutes = Math.max(1, Math.floor(Number(historyInput.value)) || 1);
    const stats = /** @type {SystemStats} */ (
      await invoke("get_stats", { minutes })
    );

    console.log(stats);

    memoryChart.update(stats, minutes);
    cpuChart.update(stats, minutes);

    const cpu = stats.cpu.usage.toFixed(1);
    document.getElementById("cpu-usage").textContent = cpu;
    document.getElementById("cpu-bar").style.width = `${cpu}%`;

    // null when the hardware exposes no temperature sensor
    document.getElementById("cpu-temp").textContent =
      stats.cpu.temp !== null ? stats.cpu.temp.toFixed(0) : "N/A";

    document.getElementById("mem-used").textContent = bytesToGB(stats.memory.used);
    document.getElementById("mem-total").textContent = bytesToGB(stats.memory.total);
    document.getElementById("mem-bar").style.width =
      `${(stats.memory.used / stats.memory.total) * 100}%`;
  } catch (err) {
    console.error("Failed to fetch stats:", err);
  }
}

// Poll rate is driven live by the "Update Rate" input. The backend blocks
// ~200ms per call measuring the CPU delta, so 200 is the floor.
const MIN_RATE = 200;
const rateInput = /** @type {HTMLInputElement} */ (
  document.getElementById("update-rate")
);
let timerId = 0;

// How many minutes of history to chart. Read on every refresh(), so changes
// take effect on the next poll; the listener just refreshes immediately.
const historyInput = /** @type {HTMLInputElement} */ (
  document.getElementById("history-minutes")
);
historyInput.addEventListener("change", refresh);

function restartTimer() {
  let ms = Number(rateInput.value);
  if (!Number.isFinite(ms) || ms < MIN_RATE) ms = MIN_RATE;
  rateInput.value = String(ms); // reflect the clamped value back to the user
  clearInterval(timerId);
  timerId = setInterval(refresh, ms);
}

rateInput.addEventListener("change", restartTimer);

// Theme: a saved choice of auto/dark/light, persisted in localStorage. "auto"
// drops the attribute so the OS preference (via the CSS media query) wins; the
// other two pin data-theme. Chart colors live on the canvas, so recolor after.
const themeSelect = /** @type {HTMLSelectElement} */ (
  document.getElementById("theme-select")
);
/** @param {string} choice "auto" | "dark" | "light" */
function applyTheme(choice) {
  if (choice === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  applyChartTheme();
}
const savedTheme = localStorage.getItem("theme") || "auto";
themeSelect.value = savedTheme;
themeSelect.addEventListener("change", () => {
  localStorage.setItem("theme", themeSelect.value);
  applyTheme(themeSelect.value);
});
applyTheme(savedTheme);

refresh();
restartTimer();
