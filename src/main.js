// Frontend: polls the Rust backend via invoke("get_stats") and renders the
// result. No bundler here (Tauri serves src/ raw), so we use the global API
// rather than importing it — browsers can't resolve bare module specifiers.
// `withGlobalTauri: true` in tauri.conf.json is what exposes window.__TAURI__.
const { invoke } = window.__TAURI__.core;

// bytes → gigabytes (1024³), one decimal place.
function bytesToGB(bytes) {
  return (bytes / 1024 ** 3).toFixed(1);
}

// Created once; refresh() swaps in new data each tick. Default Chart.js styling.
const memChart = new Chart(document.getElementById("mem-chart"), {
  type: "line",
  data: {
    labels: [],
    datasets: [{ label: "Memory used (GB)", data: [] }],
  },
});

async function refresh() {
  try {
    const stats = await invoke("get_stats");

    // Map each { ts, mem_used } row onto the chart: x = clock time, y = GB,
    // with the y-axis pinned to total RAM so usage reads to scale.
    memChart.data.labels = stats.mem_history.map((s) =>
      new Date(s.ts).toLocaleTimeString()
    );
    memChart.data.datasets[0].data = stats.mem_history.map((s) =>
      Number(bytesToGB(s.mem_used))
    );
    memChart.options.scales.y.max = Number(bytesToGB(stats.mem_total));
    memChart.update();

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
const rateInput = document.getElementById("update-rate");
let timerId;

function restartTimer() {
  let ms = Number(rateInput.value);
  if (!Number.isFinite(ms) || ms < MIN_RATE) ms = MIN_RATE;
  rateInput.value = ms; // reflect the clamped value back to the user
  clearInterval(timerId);
  timerId = setInterval(refresh, ms);
}

rateInput.addEventListener("change", restartTimer);

refresh();
restartTimer();