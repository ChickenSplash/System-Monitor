// @ts-check
// The memory-usage line chart: builds the Chart.js instance, renders its custom
// DOM tooltip, and exposes updateChart() for main.js to feed fresh stats into.
// Chart is a UMD global from chart.umd.js (loaded before this module).
import { bytesToGB, friendlyAgo, clockLabel, X_AXIS_LABELS } from "./util.js";

// The samples currently plotted, kept so the tooltip can read the full
// timestamp and raw byte value (the chart itself only stores GB to 1dp).
/** @type {MemSample[]} */
let plotted = [];

// The current history window, kept so the tooltip applies the same
// seconds-dropping rule as the x-axis labels (it fires on hover, not per tick).
let windowMinutes = 1;

// Reuse one <div> per chart for the HTML tooltip, creating it on first hover.
/** @param {any} chart */
function getOrCreateTooltip(chart) {
  let el = chart.canvas.parentNode.querySelector(".chart-tooltip");
  if (!el) {
    el = document.createElement("div");
    el.className = "chart-tooltip";
    chart.canvas.parentNode.appendChild(el);
  }
  return el;
}

// Chart.js external tooltip: render our own DOM element instead of the built-in
// canvas tooltip, so it can be styled with the app's CSS theme.
/** @param {{ chart: any, tooltip: any }} context */
function externalTooltip({ chart, tooltip }) {
  const el = getOrCreateTooltip(chart);

  if (tooltip.opacity === 0) {
    el.style.opacity = "0";
    return;
  }

  const point = tooltip.dataPoints && tooltip.dataPoints[0];
  if (point) {
    const sample = plotted[point.dataIndex];
    const date = new Date(sample.timestamp);
    const dateStr = date.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }); // e.g. "Saturday 27 June 2026"
    const timeStr = clockLabel(sample.timestamp, windowMinutes);

    // Offline buckets (no data recorded in that slot) carry mem_used === null.
    const body =
      sample.mem_used === null
        ? `<div class="tt-mem">Offline</div>`
        : `<div class="tt-mem">Memory Used: ${(sample.mem_used / 1024 ** 3).toFixed(2)} GB</div>` +
          `<div class="tt-samples">Averaged from ${sample.samples} ${sample.samples === 1 ? "sample" : "samples"}</div>`;

    el.innerHTML =
      `<div class="tt-date">${dateStr}</div>` +
      `<div class="tt-time">${timeStr}</div>` +
      `<div class="tt-ago">${friendlyAgo(Date.now() - sample.timestamp)}</div>` +
      body;
  }

  // Position relative to the canvas (its parent card is position: relative).
  el.style.opacity = "1";
  el.style.left = chart.canvas.offsetLeft + tooltip.caretX + "px";
  el.style.top = chart.canvas.offsetTop + tooltip.caretY + "px";
}

// Created once; updateChart() swaps in new data each tick. Default Chart.js styling.
const memChart = new Chart(document.getElementById("mem-chart"), {
  type: "line",
  data: {
    labels: [],
    datasets: [{ label: "Memory used (GB)", data: [] }],
  },
  options: {
    animation: false, // no transitions; the chart re-renders on every poll
    interaction: { mode: "index", intersect: false }, // hover anywhere on the x
    plugins: {
      tooltip: { enabled: false, external: externalTooltip }, // use our DOM one
    },
    scales: {
      x: {
        ticks: {
          autoSkip: true,
          maxTicksLimit: X_AXIS_LABELS, // thin the labels so the axis isn't cramped
          maxRotation: 0, // keep them horizontal
        },
      },
      y: { min: 0 }, // always scale from 0; max is set to total RAM each tick
    },
  },
});

// Recolor the chart from the current CSS theme. The canvas can't read CSS vars,
// so we copy --text/--accent/--border off the root element onto the Chart.js
// config. Call once at startup and again after every theme switch.
export function applyChartTheme() {
  const css = getComputedStyle(document.documentElement);
  const text = css.getPropertyValue("--text").trim();
  const accent = css.getPropertyValue("--accent").trim();
  const border = css.getPropertyValue("--border").trim();

  Chart.defaults.color = text; // ticks + legend labels
  const ds = memChart.data.datasets[0];
  ds.borderColor = accent;
  ds.pointBackgroundColor = accent;
  for (const axis of [memChart.options.scales.x, memChart.options.scales.y]) {
    (axis.grid ||= {}).color = border;
  }
  memChart.update();
}

// Feed a fresh stats reading into the memory chart: y = GB (pinned to total RAM
// so usage reads to scale), x = two lines, 24h clock time over "x ago".
/**
 * @param {SystemStats} stats
 * @param {number} minutes the current history window
 */
export function updateChart(stats, minutes) {
  plotted = stats.mem_history; // keep raw samples for the tooltip
  windowMinutes = minutes; // drives clockLabel's seconds-dropping rule
  const now = Date.now();
  memChart.data.labels = stats.mem_history.map((s) => [
    clockLabel(s.timestamp, minutes),
    friendlyAgo(now - s.timestamp),
  ]);
  // null for offline buckets — Chart.js renders these as a gap in the line.
  memChart.data.datasets[0].data = stats.mem_history.map((s) =>
    s.mem_used === null ? null : Number(bytesToGB(s.mem_used))
  );
  memChart.options.scales.y.max = Number(bytesToGB(stats.mem_total));
  memChart.update();
}
