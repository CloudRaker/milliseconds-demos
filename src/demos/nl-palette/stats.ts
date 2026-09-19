export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

export interface LatencySummary {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
}

export function summarize(values: readonly number[]): LatencySummary {
  return {
    count: values.length,
    mean: mean(values),
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
  };
}
