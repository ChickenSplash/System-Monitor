// @ts-check
// A reusable line chart over the HistorySample[] time-series. main.js creates one
// instance per metric (memory, CPU, …); they differ only in the few knobs passed
// to createMetricChart, so the chart, custom tooltip, and theming live here once.
// Chart is a UMD global from chart.umd.js (loaded before this module).
import { friendlyAgo, clockLabel, X_AXIS_LABELS } from "./util.js";

// Every created chart, so applyChartTheme() can recolor them all in one call.
/** @type {any[]} */
const charts = [];

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

/**
 * @typedef {object} MetricChartConfig
 * @property {string} canvasId  canvas element id
 * @property {string} label     dataset legend label
 * @property {(sample: HistorySample) => number | null} toValue  y value to plot; null = gap
 * @property {(stats: SystemStats) => number} yMax               y-axis upper bound, set each tick
 * @property {(sample: HistorySample) => string} format          tooltip value line for a populated bucket
 */

/** @param {MetricChartConfig} config */
export function createMetricChart({ canvasId, label, toValue, yMax, format }) {
  // Samples currently plotted, kept so the tooltip can read raw values and full
  // timestamps (the dataset itself only holds the plotted number).
  /** @type {HistorySample[]} */
  let plotted = [];
  // Current history window, so the tooltip applies the same seconds-dropping rule
  // as the x-axis labels (it fires on hover, not per tick).
  let windowMinutes = 1;

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

      // samples === 0 marks an offline bucket — no data recorded in that slot.
      const body =
        sample.samples === 0
          ? `<div class="tt-value">Offline</div>`
          : `<div class="tt-value">${format(sample)}</div>` +
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

  const chart = new Chart(document.getElementById(canvasId), {
    type: "line",
    data: { labels: [], datasets: [{ label, data: [] }] },
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
        y: { min: 0 }, // always scale from 0; max is set per tick via yMax()
      },
    },
  });
  charts.push(chart);

  return {
    /**
     * Feed a fresh stats reading into this chart. x = two lines (24h clock over
     * "x ago"); y comes from toValue, scaled to yMax.
     * @param {SystemStats} stats
     * @param {number} minutes current history window
     */
    update(stats, minutes) {
      plotted = stats.history; // keep raw samples for the tooltip
      windowMinutes = minutes; // drives clockLabel's seconds-dropping rule
      const now = Date.now();
      chart.data.labels = stats.history.map((sample) => [
        clockLabel(sample.timestamp, minutes),
        friendlyAgo(now - sample.timestamp),
      ]);
      // null entries render as gaps in the line (offline buckets, absent sensors).
      chart.data.datasets[0].data = stats.history.map(toValue);
      chart.options.scales.y.max = yMax(stats);
      chart.update();
    },
  };
}

// Recolor every chart from the current CSS theme. The canvas can't read CSS vars,
// so we copy --text/--accent/--border off the root onto each Chart.js config.
// Call once at startup and again after every theme switch.
export function applyChartTheme() {
  const css = getComputedStyle(document.documentElement);
  const text = css.getPropertyValue("--text").trim();
  const accent = css.getPropertyValue("--accent").trim();
  const border = css.getPropertyValue("--border").trim();

  Chart.defaults.color = text; // ticks + legend labels
  for (const chart of charts) {
    const ds = chart.data.datasets[0];
    ds.borderColor = accent;
    ds.pointBackgroundColor = accent;
    for (const axis of [chart.options.scales.x, chart.options.scales.y]) {
      (axis.grid ||= {}).color = border;
    }
    chart.update();
  }
}
