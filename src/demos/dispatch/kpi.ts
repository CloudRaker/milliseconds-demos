export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(values: readonly number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Count of timestamps within the trailing window ending at `now`, divided by the window length. */
export function ratePerSecond(times: readonly number[], now: number, windowSec: number): number {
  const from = now - windowSec;
  let n = 0;
  for (let i = times.length - 1; i >= 0 && times[i] > from; i--) n++;
  return n / windowSec;
}

export function fmtSeconds(s: number): string {
  if (!Number.isFinite(s)) return "–";
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 90) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  return `${m}m${String(Math.round(s - m * 60)).padStart(2, "0")}`;
}

export function fmtMs(ms: number): string {
  return ms > 0 ? `${Math.round(ms)}` : "–";
}

