// One page-session ledger, shared by every demo and available before React hydrates.
export const USD_PER_MILLION_INPUT_TOKENS = 0.04;

export type DemoSource = "cache" | "sponsored-live" | "personal-live" | "example-unknown";

export interface Telemetry {
  pending: number;
  attempts: number;
  retries: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  tokens: number;
  unknownUsage: number;
  personalTokens: number;
  personalUnknownUsage: number;
  sponsoredTokens: number;
  sponsoredUnknownUsage: number;
  personalAttempts: number;
  sponsoredAttempts: number;
  exampleUnknownAttempts: number;
  cachedResponses: number;
  cachedTokens: number;
  cachedUnknownUsage: number;
  cachedModelMs: number;
  cachedModelSamples: number;
  cachedGeneratedAt: string | null;
  modelMs: number;
  modelSamples: number;
  elapsed: number[];
  liveElapsed: number[];
}

export const EMPTY_TELEMETRY: Telemetry = {
  pending: 0, attempts: 0, retries: 0, succeeded: 0, failed: 0, cancelled: 0,
  tokens: 0, unknownUsage: 0, modelMs: 0, modelSamples: 0, elapsed: [], liveElapsed: [],
  personalTokens: 0, personalUnknownUsage: 0, sponsoredTokens: 0, sponsoredUnknownUsage: 0, personalAttempts: 0,
  sponsoredAttempts: 0, exampleUnknownAttempts: 0, cachedResponses: 0, cachedTokens: 0,
  cachedUnknownUsage: 0, cachedModelMs: 0, cachedModelSamples: 0, cachedGeneratedAt: null,
};
let snapshot = EMPTY_TELEMETRY;
const listeners = new Set<() => void>();
export const getTelemetry = () => snapshot;
export const getServerTelemetry = () => EMPTY_TELEMETRY;
export function subscribeTelemetry(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function update(change: Partial<Telemetry>) {
  snapshot = { ...snapshot, ...change };
  for (const listener of listeners) listener();
}

/** Missing or malformed response headers are unknown, never a measured zero. */
export function metricHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function requestStarted() { update({ pending: snapshot.pending + 1 }); }
export function attemptStarted(retry: boolean) {
  update({ attempts: snapshot.attempts + 1, retries: snapshot.retries + Number(retry) });
}
/** Cache headers describe the original run, never new model usage. */
export function attemptFinished(tokens: number | null, source: DemoSource = "personal-live", generatedAt?: string | null) {
  if (source === "cache") {
    const timestamp = generatedAt && Number.isFinite(Date.parse(generatedAt)) ? new Date(generatedAt).toISOString() : null;
    update({
      cachedResponses: snapshot.cachedResponses + 1,
      cachedTokens: snapshot.cachedTokens + (tokens ?? 0),
      cachedUnknownUsage: snapshot.cachedUnknownUsage + Number(tokens === null),
      cachedGeneratedAt: timestamp && (!snapshot.cachedGeneratedAt || timestamp > snapshot.cachedGeneratedAt) ? timestamp : snapshot.cachedGeneratedAt,
    });
    return;
  }
  update({
    tokens: snapshot.tokens + (source === "example-unknown" ? 0 : tokens ?? 0),
    unknownUsage: snapshot.unknownUsage + Number(source === "example-unknown" || tokens === null),
    ...(source === "personal-live" ? {
      personalAttempts: snapshot.personalAttempts + 1,
      personalTokens: snapshot.personalTokens + (tokens ?? 0),
      personalUnknownUsage: snapshot.personalUnknownUsage + Number(tokens === null),
    } : source === "sponsored-live" ? {
      sponsoredAttempts: snapshot.sponsoredAttempts + 1,
      sponsoredTokens: snapshot.sponsoredTokens + (tokens ?? 0),
      sponsoredUnknownUsage: snapshot.sponsoredUnknownUsage + Number(tokens === null),
    } : { exampleUnknownAttempts: snapshot.exampleUnknownAttempts + 1 }),
  });
}
export function requestFinished(outcome: "succeeded" | "failed" | "cancelled", elapsedMs: number, modelMs: number | null = null, source: DemoSource = "personal-live") {
  update({
    pending: snapshot.pending - 1,
    [outcome]: snapshot[outcome] + 1,
    ...(outcome === "succeeded" ? {
      elapsed: [...snapshot.elapsed, elapsedMs],
      ...((source === 'personal-live' || source === 'sponsored-live') ? { liveElapsed: [...snapshot.liveElapsed, elapsedMs] } : {}),
      ...(source === "cache" ? {
        cachedModelMs: snapshot.cachedModelMs + (modelMs ?? 0),
        cachedModelSamples: snapshot.cachedModelSamples + Number(modelMs !== null),
      } : {
        modelMs: snapshot.modelMs + (source === "example-unknown" ? 0 : modelMs ?? 0),
        modelSamples: snapshot.modelSamples + Number(source !== "example-unknown" && modelMs !== null),
      }),
    } : {}),
  });
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export const estimatedUSD = (tokens: number) => tokens * USD_PER_MILLION_INPUT_TOKENS / 1_000_000;
export function formatUSD(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.000001) return "<$0.000001";
  return `$${value.toFixed(value < 1 ? 6 : 2)}`;
}
