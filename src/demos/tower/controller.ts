// Ported from the Jev experiment's controller.ts. Everything except send() is unchanged: the same
// cooldowns, the same rule fallback, the same staleness test. send() now fires three batched
// decision-machine-1 calls instead of one Jev request.
import type { Aircraft, Instruction, Mode } from "./types.ts";
import { INSTRUCTION_COOLDOWN_S } from "./types.ts";
import type { Sim } from "./engine.ts";
import { FIX_MAP } from "./world.ts";
import { ruleCandidates, urgencyFor } from "./rules.ts";
import { resolves, selectValidInstruction, validateInstruction } from "./validate.ts";
import {
  HANDOFF,
  HANDOFF_THRESHOLD,
  LABELS,
  LatencyStats,
  URGENCY_SCALE,
  candidateState,
  expand,
  flatten,
  isStale,
  topInstruction,
  type CandidateState,
  type Kind,
  type ParsedAnswer,
} from "./ask.ts";
import { Dm1Error, classifyMany, dm1, rateMany, type YesNoResult } from "../../lib/dm1.ts";

export interface Telemetry {
  /** End to end per decision cycle, including the Slow mode delay. */
  decision: LatencyStats;
  /** Browser round trip per HTTP call. */
  wall: LatencyStats;
  /** Model processing time per HTTP call, from x-inference-ms. */
  inference: LatencyStats;
  /** Ask cycles started. Each one is three calls. */
  requests: number;
  calls: number;
  inFlight: number;
  stale: number;
  errors: number;
  lastError: string | null;
  rateLimited: boolean;
  inputTokens: number;
  decisionTimes: number[];
}

export function newTelemetry(): Telemetry {
  return {
    decision: new LatencyStats(),
    wall: new LatencyStats(),
    inference: new LatencyStats(),
    requests: 0,
    calls: 0,
    inFlight: 0,
    stale: 0,
    errors: 0,
    lastError: null,
    rateLimited: false,
    inputTokens: 0,
    decisionTimes: [],
  };
}

export function decisionsPerSecond(t: Telemetry, nowMs: number, windowMs = 10_000): number {
  const cutoff = nowMs - windowMs;
  while (t.decisionTimes.length && t.decisionTimes[0] < cutoff) t.decisionTimes.shift();
  return t.decisionTimes.length / (windowMs / 1000);
}

export const SLOW_LLM_DELAY_MS = 2500;
const ASK_INTERVAL_MS = 1000;
const RULES_REEVAL_S = 5;
/** dm1.ts already paces the page at 3 calls/s; this only stops cycles piling up behind that queue. */
const MAX_IN_FLIGHT = 2;
const MIN_CONFIDENCE = 0.15;
/** Within this many seconds of a predicted loss, an instruction must measurably push the loss out. */
const URGENT_S = 60;
const BACKOFF_MS = 5000;
/** One batched call takes at most 32 texts. */
const MAX_BATCH = 32;

interface Pending {
  seq: number;
  simTime: number;
  ids: number[];
}

export interface ControllerOptions {
  now?: () => number;
  slowDelayMs?: number;
}

/**
 * Drives one control policy against the sim. `tick` runs once per sim tick; answers arrive asynchronously
 * and are applied on arrival unless they have gone stale.
 */
export class Controller {
  readonly mode: Mode;
  readonly telemetry: Telemetry;
  private readonly sim: Sim;
  private seq = 0;
  private lastApplied = new Map<number, number>();
  private lastAsked = new Map<number, number>();
  private lastRuled = new Map<number, number>();
  private backoffUntil = 0;
  private disposed = false;
  private abort = new AbortController();
  private readonly now: () => number;
  private readonly slowDelayMs: number;

  constructor(mode: Mode, sim: Sim, telemetry: Telemetry, opts: ControllerOptions = {}) {
    this.mode = mode;
    this.sim = sim;
    this.telemetry = telemetry;
    this.now = opts.now ?? (() => performance.now());
    this.slowDelayMs = opts.slowDelayMs ?? SLOW_LLM_DELAY_MS;
  }

  async stockDecision(): Promise<void> {
    const aircraft = this.sim.candidates().slice(0, MAX_BATCH);
    if (aircraft.length) await this.send(aircraft, 0);
  }

  dispose(): void {
    this.disposed = true;
    this.abort.abort();
  }

  tick(): void {
    if (this.disposed) return;
    if (this.mode === "rules") this.tickRules();
    else if (this.mode === "api") this.tickApi();
    else this.tickSlow();
  }

  private eligibleSoon(ac: Aircraft): boolean {
    return this.sim.t - ac.instructionAt >= INSTRUCTION_COOLDOWN_S - 2;
  }

  private tickRules(): void {
    const t0 = this.now();
    for (const ac of this.sim.candidates()) {
      const others = this.sim.aircraft.filter((o) => o.id !== ac.id);
      const mine = this.sim.conflictsOf(ac.id);
      const tLoss = mine.length ? Math.min(...mine.map((c) => c.tLoss)) : null;
      this.setJudgement(ac.id, urgencyFor(tLoss), tLoss === null && ac.vectorHdg === null ? 1 : 0);
      if (this.sim.t - ac.instructionAt < INSTRUCTION_COOLDOWN_S) continue;
      if (this.sim.t - (this.lastRuled.get(ac.id) ?? -Infinity) < RULES_REEVAL_S) continue;
      const pick = this.pickRule(ac, others);
      if (pick) {
        this.lastRuled.set(ac.id, this.sim.t);
        this.sim.apply(ac.id, pick, "rules");
        this.telemetry.decisionTimes.push(this.now());
      }
    }
    this.telemetry.decision.push(this.now() - t0);
  }

  private tickApi(): void {
    const nowMs = this.now();
    if (this.telemetry.inFlight >= MAX_IN_FLIGHT || nowMs < this.backoffUntil) return;
    const ask = this.sim
      .candidates()
      .filter((ac) => nowMs - (this.lastAsked.get(ac.id) ?? -Infinity) >= ASK_INTERVAL_MS && this.eligibleSoon(ac))
      .slice(0, MAX_BATCH);
    if (ask.length === 0) return;
    void this.send(ask, 0);
  }

  private tickSlow(): void {
    const nowMs = this.now();
    if (this.telemetry.inFlight > 0 || nowMs < this.backoffUntil) return;
    // A chat-style LLM agent handles one aircraft per call, most urgent first.
    const byUrgency = this.sim
      .candidates()
      .filter((ac) => this.eligibleSoon(ac))
      .map((ac) => {
        const mine = this.sim.conflictsOf(ac.id);
        return { ac, tLoss: mine.length ? Math.min(...mine.map((c) => c.tLoss)) : Infinity };
      })
      .sort((a, b) => a.tLoss - b.tLoss);
    if (byUrgency.length === 0) return;
    void this.send([byUrgency[0].ac], this.slowDelayMs);
  }

  private async send(aircraft: Aircraft[], extraDelayMs: number): Promise<void> {
    const byId = this.sim.byId();
    const states: CandidateState[] = aircraft.map((ac) => candidateState(ac, this.sim.conflicts, byId, this.sim.t, FIX_MAP));
    const texts = states.map(flatten);
    const pending: Pending = { seq: ++this.seq, simTime: this.sim.t, ids: aircraft.map((a) => a.id) };
    const started = this.now();
    for (const id of pending.ids) this.lastAsked.set(id, started);
    this.telemetry.inFlight++;
    this.telemetry.requests++;
    const signal = this.abort.signal;
    try {
      // Three batched calls, one per judgement, over the same texts. dm1.ts paces them page-wide.
      const [cls, rate, handoff] = await Promise.all([
        classifyMany(texts, LABELS, signal),
        rateMany(texts, URGENCY_SCALE, signal),
        dm1<{ results: YesNoResult[] }>("yes-no", { texts, ...HANDOFF }, signal),
      ]);
      if (this.disposed) return;
      for (const m of [cls.meta, rate.meta, handoff.meta]) {
        this.telemetry.calls++;
        this.telemetry.wall.push(m.wallMs);
        this.telemetry.inference.push(m.inferenceMs);
        this.telemetry.inputTokens += m.tokens;
      }
      this.telemetry.rateLimited = false;
      if (extraDelayMs > 0) await new Promise((r) => setTimeout(r, extraDelayMs));
      if (this.disposed) return;
      this.telemetry.decision.push(this.now() - started);
      pending.ids.forEach((id, i) => {
        const ac = this.sim.find(id);
        const worst = this.sim.conflictsOf(id).sort((x, y) => x.tLoss - y.tLoss)[0];
        const urgency = rate.results[i]?.level ?? 0;
        const probabilities = ac ? expand(cls.results[i]?.scores as Partial<Record<Kind, number>>, urgency, ac, worst, this.sim.byId()) : {};
        const answer: ParsedAnswer = {
          probabilities,
          kind: (cls.results[i]?.label as Kind) ?? null,
          choice: topInstruction(probabilities),
          confidence: cls.results[i]?.confidence ?? 0,
          urgency,
          handoff: handoff.data.results[i]?.probability ?? 0,
        };
        this.consume(pending, id, answer);
      });
    } catch (err) {
      if (this.disposed) return;
      this.telemetry.errors++;
      this.telemetry.lastError = err instanceof Dm1Error ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err);
      if (err instanceof Dm1Error && err.status === 429) {
        this.telemetry.rateLimited = true;
        this.backoffUntil = this.now() + BACKOFF_MS;
      }
      // Deterministic fallback so the sector never goes unattended.
      for (const id of pending.ids) this.fallbackToRules(id);
    } finally {
      this.telemetry.inFlight = Math.max(0, this.telemetry.inFlight - 1);
    }
  }

  private consume(pending: Pending, id: number, answer: ParsedAnswer): void {
    if (isStale(pending.seq, this.lastApplied.get(id), pending.simTime, this.sim.t)) {
      this.telemetry.stale++;
      return;
    }
    const ac = this.sim.find(id);
    if (!ac) return;
    this.lastApplied.set(id, pending.seq);
    this.setJudgement(id, answer.urgency, answer.handoff >= HANDOFF_THRESHOLD ? 1 : 0);
    if (this.sim.t - ac.instructionAt < INSTRUCTION_COOLDOWN_S) return;
    if (answer.choice === null || answer.confidence < MIN_CONFIDENCE) {
      this.fallbackToRules(id);
      return;
    }
    const others = this.sim.aircraft.filter((o) => o.id !== id);
    const worst = this.sim.conflictsOf(id).sort((x, y) => x.tLoss - y.tLoss)[0];
    const urgentWith = worst && worst.tLoss < URGENT_S ? (worst.a === id ? worst.b : worst.a) : null;
    const sel = selectValidInstruction(answer.probabilities, (i) => {
      const v = validateInstruction(ac, i, others, this.sim.t, FIX_MAP);
      if (!v.ok || urgentWith === null) return v;
      return resolves(ac, i, urgentWith, others, this.sim.t, FIX_MAP) ? v : { ok: false, reason: "no_gain" as const };
    });
    const note =
      sel.fellBack && answer.choice !== sel.instruction
        ? `(model said ${answer.kind ?? "?"} → ${answer.choice}: ${sel.rejected[answer.choice] ?? "invalid"})`
        : undefined;
    this.sim.apply(id, sel.instruction, this.mode, note);
    this.telemetry.decisionTimes.push(this.now());
  }

  /** First valid rule candidate that actually resolves the worst conflict; null when nothing helps. */
  private pickRule(ac: Aircraft, others: Aircraft[]): Instruction | null {
    const ranked = ruleCandidates(ac, this.sim.conflicts, this.sim.byId());
    const valid = ranked.filter((i) => validateInstruction(ac, i, others, this.sim.t, FIX_MAP).ok);
    if (valid.length === 0) return null;
    const worst = this.sim.conflictsOf(ac.id).sort((x, y) => x.tLoss - y.tLoss)[0];
    if (!worst) return valid[0];
    const otherId = worst.a === ac.id ? worst.b : worst.a;
    return valid.find((i) => i !== "maintain" && resolves(ac, i, otherId, others, this.sim.t, FIX_MAP)) ?? null;
  }

  private fallbackToRules(id: number): void {
    const ac = this.sim.find(id);
    if (!ac || this.sim.t - ac.instructionAt < INSTRUCTION_COOLDOWN_S) return;
    const others = this.sim.aircraft.filter((o) => o.id !== id);
    const pick = this.pickRule(ac, others);
    if (!pick) return;
    this.sim.apply(id, pick, "rules", pick === "maintain" ? undefined : "(rule fallback)");
    this.telemetry.decisionTimes.push(this.now());
  }

  private setJudgement(id: number, urgency: number, handoff: number): void {
    const i = this.sim.aircraft.findIndex((a) => a.id === id);
    if (i >= 0) this.sim.aircraft[i] = { ...this.sim.aircraft[i], urgency, handoff };
  }
}
