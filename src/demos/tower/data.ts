// Seed data for the demo. The sector itself is generated from the mulberry32 PRNG in rng.ts, so a seed
// reproduces a run exactly; these are the seeds worth showing, plus the numbers the original Jev experiment
// measured so the page can compare a live run against them.

export const DEFAULT_SEED = 7;

/** Seeds that open on a busy but survivable sector. Seed 7 is the one the original measured. */
export const SEEDS = [
  { seed: 7, note: "mixed traffic" },
  { seed: 13, note: "two crossing arrival streams early" },
  { seed: 21, note: "head-on overflights at 11,000 ft" },
  { seed: 42, note: "departures into the arrival flow" },
] as const;

export interface MeasuredRun {
  mode: "rules" | "jev" | "slow";
  speed: 1 | 4;
  rush: boolean;
  losses: number;
  decisions: number;
  requests: number;
  p50: number;
  p95: number;
  tokensPerDecision: number;
}

/**
 * The original experiment's measured runs, 300 s of sim time each at seed 7, from
 * jev-tower/measure/results/*.json. Latency is against Jev, not decision-machine-1; the live panel on this
 * page is the current number.
 */
export const MEASURED: MeasuredRun[] = [
  { mode: "rules", speed: 1, rush: false, losses: 0, decisions: 165, requests: 0, p50: 0.01, p95: 0.43, tokensPerDecision: 0 },
  { mode: "rules", speed: 4, rush: false, losses: 0, decisions: 165, requests: 0, p50: 0.01, p95: 0.47, tokensPerDecision: 0 },
  { mode: "rules", speed: 4, rush: true, losses: 0, decisions: 213, requests: 0, p50: 0.03, p95: 0.53, tokensPerDecision: 0 },
  { mode: "jev", speed: 1, rush: false, losses: 0, decisions: 545, requests: 246, p50: 121, p95: 332, tokensPerDecision: 1107 },
  { mode: "jev", speed: 4, rush: false, losses: 0, decisions: 194, requests: 123, p50: 107, p95: 305, tokensPerDecision: 1254 },
  { mode: "jev", speed: 4, rush: true, losses: 0, decisions: 218, requests: 142, p50: 98, p95: 240, tokensPerDecision: 1248 },
  { mode: "slow", speed: 1, rush: false, losses: 0, decisions: 92, requests: 93, p50: 2597, p95: 2769, tokensPerDecision: 1268 },
  { mode: "slow", speed: 4, rush: false, losses: 1, decisions: 26, requests: 28, p50: 2616, p95: 2758, tokensPerDecision: 1388 },
  { mode: "slow", speed: 4, rush: true, losses: 0, decisions: 27, requests: 28, p50: 2604, p95: 2669, tokensPerDecision: 1375 },
];

export const MODE_LABEL = {
  rules: "Rules",
  api: "API",
  slow: "Slow LLM",
} as const;

export const MODE_BLURB = {
  rules: "No network. A deterministic geometric policy picks the manoeuvre.",
  api: "Three batched calls per cycle to decision-machine-1, every aircraft in one request.",
  slow: "The same three calls, one aircraft at a time, plus 2.5 s to imitate a chat LLM.",
} as const;

/** Wall-clock cap on one run. The demo key is shared, so a loop cannot be left running. */
export const RUN_LIMIT_MS = 60_000;
