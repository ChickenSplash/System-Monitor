// @ts-check
// Pure formatting helpers shared across charts. Backend sends raw numbers;
// everything here turns them into display strings. No DOM, no chart deps.

// bytes → gigabytes (1024³), one decimal place.
/** @param {number} bytes */
export function bytesToGB(bytes) {
  return (bytes / 1024 ** 3).toFixed(1);
}

// Elapsed time as a human-friendly "x ago" string, stepping up the unit at each
// boundary: seconds < 60s, minutes < 60min, hours < 24h, then days. Used for
// both the chart x-axis labels and the tooltip.
/** @param {number} ms milliseconds elapsed */
export function friendlyAgo(ms) {
  const secs = Math.round(ms / 1000);
  if (secs < 1) return "just now";
  if (secs < 60) return secs === 1 ? "1 second ago" : `${secs} seconds ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return mins === 1 ? "1 minute ago" : `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

// How many labels a time x-axis shows. Also the minute threshold past which the
// gap between labels exceeds a minute, so seconds in the time label are dropped.
export const X_AXIS_LABELS = 8;

// 24h clock label; seconds are dropped once the labels are minutes apart.
/**
 * @param {number} ms epoch milliseconds
 * @param {number} windowMinutes the current history window
 */
export function clockLabel(ms, windowMinutes) {
  /** @type {Intl.DateTimeFormatOptions} */
  const opts =
    windowMinutes > X_AXIS_LABELS
      ? { hour12: false, hour: "2-digit", minute: "2-digit" }
      : { hour12: false };
  return new Date(ms).toLocaleTimeString("en-GB", opts);
}
