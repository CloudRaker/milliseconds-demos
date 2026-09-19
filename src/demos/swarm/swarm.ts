// The loop: fixed-step physics, and one batched /yes-no call per judgment per tick.
// Ported from jev-swarm src/swarm.ts and src/metrics.ts. Every agent's scene goes in one
// `texts` array, so the whole swarm costs two requests per tick, not two per agent.
import { Dm1Error, dm1, type YesNoResult } from "../../lib/dm1";
import {
  JUDGMENTS,
  NO_JUDGMENTS,
  SEED,
  applyDecision,
  applyJudgments,
  buildPerception,
  createWorld,
  heuristicDecision,
  refineHeading,
  sceneText,
  step,
  type Agent,
  type Judgments,
  type World,
  type WorldOptions,
} from "./data";

import { stockWorld, stockRequests } from "./stock";

export interface Settings extends WorldOptions {
  stock: boolean;
  /** ms between decision rounds */
  tickMs: number;
  /** extra delay on every answer, to show what a slow model costs an agent */
  slowMs: number;
  /** fall back to code after this long without a fresh answer */
  fallbackAfterMs: number;
}

export const MAX_TEXTS = 32;
export const RUN_LIMIT_MS = 60_000;
/** milliseconds.ai bills input tokens at $0.04 per million; output tokens are free. */
export const USD_PER_INPUT_TOKEN = 0.04 / 1_000_000;

export const DEFAULT_SETTINGS: Settings = {
  seed: SEED,
  stock: true,
  agentCount: 24,
  policy: "dm1",
  human: true,
  tickMs: 1000,
  slowMs: 0,
  fallbackAfterMs: 4000,
};

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

export class Metrics {
  calls = 0;
  errors = 0;
  rateLimited = 0;
  inFlight = 0;
  decisions = 0;
  stale = 0;
  fallbacks = 0;
  tokens = 0;
  inference: number[] = [];
  wall: number[] = [];
  private decisionTimes: number[] = [];
  private tokenTimes: Array<{ at: number; tokens: number }> = [];

  response(inferenceMs: number, wallMs: number, tokens: number): void {
    this.inference.push(inferenceMs);
    this.wall.push(wallMs);
    if (this.inference.length > 200) this.inference.shift();
    if (this.wall.length > 200) this.wall.shift();
    this.tokens += tokens;
    this.tokenTimes.push({ at: performance.now(), tokens });
  }
  decision(now: number): void {
    this.decisions++;
    this.decisionTimes.push(now);
  }
  /** Decisions applied in the trailing window, per second. */
  perSecond(now: number, windowMs = 5000): number {
    while (this.decisionTimes.length && this.decisionTimes[0] < now - windowMs) this.decisionTimes.shift();
    return (this.decisionTimes.length * 1000) / windowMs;
  }
  /** Input tokens billed in the same trailing window, extrapolated to a minute. */
  tokensPerMin(now: number, windowMs = 5000): number {
    while (this.tokenTimes.length && this.tokenTimes[0].at < now - windowMs) this.tokenTimes.shift();
    let sum = 0;
    for (const t of this.tokenTimes) sum += t.tokens;
    return (sum * 60_000) / windowMs;
  }
  /** Input tokens behind one applied decision. */
  get tokensPerDecision(): number {
    return this.decisions ? this.tokens / this.decisions : 0;
  }
}

const FIXED_DT = 1 / 60;

export class Swarm {
  world: World;
  settings: Settings;
  metrics = new Metrics();
  paused = false;
  running = false;
  error: string | null = null;
  /** the last scene text sent and the answer that came back, for the wire panel */
  sample: { id: string; text: string; key: string; probability: number } | null = null;
  judgments = new Map<string, Judgments>();
  runUntil = 0;
  private round = 0;
  private stockScene = 0;
  private stockLoading = false;
  private nextStockAt = 0;
  private lastTick = 0;
  private lastFrame: number | null = null;
  private accumulator = 0;
  private backoffUntil = 0;
  /** one in-flight slot per judgment: a tick skips a question whose last call is still out */
  private busy = new Set<string>();
  /** aborts every call this run put on the wire, so Stop actually stops */
  private abort: AbortController | null = null;

  constructor(settings: Partial<Settings> = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.world = createWorld(this.settings);
  }

  reset(patch: Partial<Settings> = {}): void {
    this.settings = { ...this.settings, ...patch };
    this.world = createWorld(this.settings);
    this.metrics = new Metrics();
    this.judgments.clear();
    this.running = false;
    this.error = null;
    this.sample = null;
    this.accumulator = 0;
    this.lastFrame = null;
    this.backoffUntil = 0;
    this.cancel();
  }

  /** Drop everything still on the wire and free the per-judgment slots. */
  private cancel(): void {
    this.abort?.abort();
    this.abort = null;
    this.busy.clear();
    this.metrics.inFlight = 0;
    for (const a of this.world.agents) a.inFlight = 0;
  }

  /** Runs are bounded: one visitor cannot hold your key for longer than a minute. */
  start(now: number): void {
    this.cancel();
    this.abort = new AbortController();
    this.running = true;
    this.paused = false;
    this.runUntil = now + RUN_LIMIT_MS;
    this.lastTick = 0;
    this.stockScene = 0;
    this.nextStockAt = 0;
  }
  stop(): void {
    this.running = false;
    this.cancel();
  }
  secondsLeft(now: number): number {
    return this.running ? Math.max(0, Math.ceil((this.runUntil - now) / 1000)) : 0;
  }
  get sceneNumber(): number { return (Math.max(1, this.stockScene) - 1) % 6 + 1; }
  get human(): Agent | undefined {
    return this.world.agents.find((a) => a.controller === "human");
  }
  judgmentsOf(id: string): Judgments {
    return this.judgments.get(id) ?? NO_JUDGMENTS;
  }

  /** One animation frame: physics at a fixed step, then the decision round if one is due. */
  frame(now: number): void {
    if (this.lastFrame === null) this.lastFrame = now;
    const elapsed = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    // the run limit is wall-clock, so it applies while paused too
    if (this.running && now >= this.runUntil) this.stop();
    if (this.paused || this.stockLoading || (this.settings.stock && !this.running && this.metrics.calls > 0)) return;
    this.accumulator += elapsed;
    while (this.accumulator >= FIXED_DT) {
      for (const a of this.world.agents) if (a.alive && a.controller !== "human") refineHeading(this.world, a);
      step(this.world, FIXED_DT);
      this.accumulator -= FIXED_DT;
    }
    if (now - this.lastTick < this.settings.tickMs) return;
    this.lastTick = now;
    // before Run, and after the run limit, the whole arena plays on the code policy
    if (!this.running) return this.idleTick(now);
    if (this.settings.stock) {
      if (now >= this.nextStockAt) void this.runStockScene(now);
    } else this.tick(now);
  }

  /** Each free scene gets real model decisions, then plays their consequences for five seconds. */
  private async runStockScene(now: number): Promise<void> {
    this.stockLoading = true;
    const scene = this.stockScene++;
    const requests = stockRequests(this.settings.agentCount, scene);
    this.world = stockWorld(this.settings.agentCount, scene);
    this.judgments.clear();
    this.accumulator = 0;
    const world = this.world;
    const batch = world.agents.filter(agent => agent.controller === "dm1");
    try {
      for (const [index, judgment] of JUDGMENTS.entries()) {
        if (!this.running || world !== this.world) return;
        await this.ask(judgment, batch, now, requests[index].texts);
      }
    } finally {
      this.stockLoading = false;
      this.nextStockAt = performance.now() + 5000;
    }
  }

  /** No requests: every agent takes the code decision, so the arena is alive on load. */
  private idleTick(now: number): void {
    for (const a of this.world.agents) {
      if (!a.alive || a.controller === "human") continue;
      a.seq++;
      applyDecision(a, { ...heuristicDecision(this.world, a), seq: a.seq }, now);
    }
  }

  private tick(now: number): void {
    const due: Agent[] = [];
    for (const a of this.world.agents) {
      if (!a.alive || a.controller === "human") continue;
      if (a.controller === "heuristic") {
        a.seq++;
        applyDecision(a, { ...heuristicDecision(this.world, a), seq: a.seq }, now);
        this.metrics.decision(now);
        continue;
      }
      // a respawned agent starts blank: the previous life's probabilities are not its own
      if (a.decision.source === "none") this.judgments.delete(a.id);
      // never stall: an agent with no fresh answer keeps playing on the code policy
      if (a.decision.source === "none" || now - a.decision.at > this.settings.fallbackAfterMs) {
        if (a.decision.source === "dm1") this.metrics.fallbacks++;
        applyDecision(a, { ...heuristicDecision(this.world, a), seq: a.decision.seq }, now);
      }
      due.push(a);
    }
    if (!due.length || now < this.backoffUntil) return;
    const batch = due.slice(0, MAX_TEXTS);
    // one call always asks about the threat; the second alternates opportunity and boost
    const second = this.round++ % 2 === 0 ? JUDGMENTS[1] : JUDGMENTS[2];
    void this.ask(JUDGMENTS[0], batch, now);
    void this.ask(second, second.key === "boost" ? batch.filter((a) => a.boostCooldown <= 0 && a.boostLeft <= 0) : batch, now);
  }

  /** An aborted call never reached the model, so it does not belong in the call count. */
  private uncount(): void {
    this.metrics.calls = Math.max(0, this.metrics.calls - 1);
  }

  private async ask(j: (typeof JUDGMENTS)[number], batch: Agent[], now: number, stockTexts?: string[]): Promise<void> {
    // One call per judgment at a time. At a 500 ms tick this self-throttles to whatever the
    // API returns instead of piling a backlog onto the page-wide 3 calls/s queue.
    if (!batch.length || this.busy.has(j.key)) return;
    const signal = this.abort?.signal;
    if (!signal || signal.aborted) return;
    this.busy.add(j.key);
    const world = this.world;
    const texts = stockTexts ?? batch.map((a) => sceneText(buildPerception(world, a), { style: j.style }));
    const seqs = new Map<string, number>();
    for (const a of batch) {
      a.seq++;
      a.inFlight++;
      a.lastRequestAt = now;
      seqs.set(a.id, a.seq);
    }
    this.metrics.calls++;
    this.metrics.inFlight++;
    try {
      const res = await dm1<{ results: YesNoResult[] }>(
        "yes-no",
        { texts, statement: j.statement, when_true: j.when_true, when_false: j.when_false },
        signal,
      );
      if (this.settings.slowMs > 0) await new Promise((r) => setTimeout(r, this.settings.slowMs));
      if (world !== this.world || signal.aborted) return this.uncount(); // reset or stopped while the call was out
      const at = performance.now();
      this.metrics.response(res.meta.inferenceMs, res.meta.wallMs, res.meta.tokens);
      this.error = null;
      batch.forEach((a, i) => {
        const r = res.data.results?.[i];
        if (!r) return;
        const prev = this.judgments.get(a.id) ?? NO_JUDGMENTS;
        const next: Judgments = { ...prev, [j.key]: r.probability, at };
        const applied = applyJudgments(this.world, a, seqs.get(a.id) ?? 0, next, at);
        // the panel shows what the agent is acting on, so a dropped answer never lands there
        if (applied.applied) {
          this.judgments.set(a.id, next);
          this.metrics.decision(at);
        } else if (applied.reason === "stale") this.metrics.stale++;
      });
      this.sample = { id: batch[0].id, text: texts[0], key: j.key, probability: res.data.results?.[0]?.probability ?? 0 };
    } catch (err) {
      if (world !== this.world || signal.aborted) return this.uncount(); // Stop aborted it; not an error
      this.metrics.errors++;
      const rateLimited = err instanceof Dm1Error && err.status === 429;
      if (rateLimited) this.metrics.rateLimited++;
      this.error = rateLimited
        ? "Shared rate limit reached. The agents keep playing on the code policy until it clears."
        : err instanceof Error
          ? err.message
          : "Request failed.";
      this.backoffUntil = performance.now() + (rateLimited ? 4000 : 2000);
    } finally {
      this.busy.delete(j.key);
      this.metrics.inFlight = Math.max(0, this.metrics.inFlight - 1);
      for (const a of batch) a.inFlight = Math.max(0, a.inFlight - 1);
    }
  }
}
