// @ts-check
// Frontend: polls the Rust backend via invoke("get_stats") and renders the
// result. No bundler here (Tauri serves src/ raw), so we use the global API
// rather than importing it — browsers can't resolve bare module specifiers.
// `withGlobalTauri: true` in tauri.conf.json is what exposes window.__TAURI__.
const { invoke } = window.__TAURI__.core;

// bytes → gigabytes (1024³), one decimal place.
/** @param {number} bytes */
function bytesToGB(bytes) {
  return (bytes / 1024 ** 3).toFixed(1);
}

// Elapsed time as a short "x ago" string for the chart's x-axis.
/** @param {number} ms milliseconds elapsed */
function agoLabel(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

// The samples currently plotted, kept so the tooltip can read the full
// timestamp and raw byte value (the chart itself only stores GB to 1dp).
/** @type {MemSample[]} */
let plotted = [];

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
    const date = new Date(sample.ts);
    const dateStr = date.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }); // e.g. "Saturday 27 June 2026"
    const timeStr = date.toLocaleTimeString("en-GB", { hour12: false });
    const gb = (sample.mem_used / 1024 ** 3).toFixed(2);

    el.innerHTML =
      `<div class="tt-date">${dateStr}</div>` +
      `<div class="tt-time">${timeStr}</div>` +
      `<div class="tt-mem">Memory Used: ${gb} GB</div>` +
      `<div class="tt-samples">Samples: ${sample.samples}</div>`;
  }

  // Position relative to the canvas (its parent card is position: relative).
  el.style.opacity = "1";
  el.style.left = chart.canvas.offsetLeft + tooltip.caretX + "px";
  el.style.top = chart.canvas.offsetTop + tooltip.caretY + "px";
}

// Created once; refresh() swaps in new data each tick. Default Chart.js styling.
const memChart = new Chart(document.getElementById("mem-chart"), {
  type: "line",
  data: {
    labels: [],
    datasets: [{ label: "Memory used (GB)", data: [] }],
  },
  options: {
    interaction: { mode: "index", intersect: false }, // hover anywhere on the x
    plugins: {
      tooltip: { enabled: false, external: externalTooltip }, // use our DOM one
    },
    scales: {
      x: {
        ticks: {
          autoSkip: true,
          maxTicksLimit: 8, // thin the labels so the axis isn't cramped
          maxRotation: 0, // keep them horizontal
        },
      },
    },
  },
});

// Feed a fresh stats reading into the memory chart: y = GB (pinned to total RAM
// so usage reads to scale), x = two lines, 24h clock time over "x ago".
/** @param {SystemStats} stats */
function updateChart(stats) {
  plotted = stats.mem_history; // keep raw samples for the tooltip
  const now = Date.now();
  memChart.data.labels = stats.mem_history.map((s) => [
    new Date(s.ts).toLocaleTimeString([], { hour12: false }),
    agoLabel(now - s.ts),
  ]);
  memChart.data.datasets[0].data = stats.mem_history.map((s) =>
    Number(bytesToGB(s.mem_used))
  );
  memChart.options.scales.y.max = Number(bytesToGB(stats.mem_total));
  memChart.update();
}

async function refresh() {
  try {
    const minutes = Math.max(1, Math.floor(Number(historyInput.value)) || 1);
    const stats = /** @type {SystemStats} */ (
      await invoke("get_stats", { minutes })
    );

    updateChart(stats);

    const cpu = stats.cpu_usage.toFixed(1);
    document.getElementById("cpu-usage").textContent = cpu;
    document.getElementById("cpu-bar").style.width = `${cpu}%`;

    // null when the hardware exposes no temperature sensor
    document.getElementById("cpu-temp").textContent =
      stats.cpu_temp !== null ? stats.cpu_temp.toFixed(0) : "N/A";

    document.getElementById("mem-used").textContent = bytesToGB(stats.mem_used);
    document.getElementById("mem-total").textContent = bytesToGB(stats.mem_total);
    document.getElementById("mem-bar").style.width =
      `${(stats.mem_used / stats.mem_total) * 100}%`;
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

refresh();
restartTimer();