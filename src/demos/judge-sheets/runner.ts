/**
 * Turns the judgments a recalc asks for into decision-machine-1 calls.
 *
 * Jev fanned every question for one row into one request (300 rows = 300
 * requests). decision-machine-1 goes the other way: one request carries one
 * question and up to 32 texts, so a 300-row column is 10 calls. Specs are
 * grouped by question (route + statement/labels/scale), sliced into chunks of
 * 32 and posted through src/lib/dm1.ts, which paces the whole page at 2 calls
 * a second and retries 429s.
 *
 * The queue never runs by itself: `start()` is a button, `stop()` is a button,
 * and a run ends on its own at MAX_CALLS or MAX_RUN_MS, whichever comes first,
 * so one visitor cannot drain the shared quota.
 */
import { chunk, classify, classifyMany, dm1, rateMany, Dm1Error, type ClassifyResult, type Meta, type RateResult, type YesNoResult } from "../../lib/dm1.ts";
import { jevKey, type JevSpec } from "./engine/jev.ts";
import type { JevValue, Value } from "./engine/values.ts";
import { bodyFor, exactSchema, INTENT_LABELS, intentText, pickSchema, questionKey, type Intent } from "./predict.ts";

/** One /classify call: which of the 14 prediction schemas does this header ask for? */
export async function classifyHeader(header: string, samples: string[], signal?: AbortSignal): Promise<Intent> {
  const exact = exactSchema(header);
  if (exact) return { header, schema: exact, fallback: false, exact: true, confidence: 1, scores: {}, ms: 0, inferenceMs: 0 };
  const t0 = performance.now();
  const { result, meta } = await classify(intentText(header, samples), INTENT_LABELS, signal);
  const { schema, fallback } = pickSchema(result.label, result.probability, header);
  return {
    header,
    schema,
    fallback,
    exact: false,
    confidence: result.probability,
    scores: result.scores,
    ms: Math.round(performance.now() - t0),
    inferenceMs: meta.inferenceMs,
  };
}

/** Marketing baseline: one generative prompt per cell, kept labelled as an assumption. */
export const LLM_BASELINE_S_PER_CELL = 4;
export const MAX_CALLS = 14;
export const MAX_RUN_MS = 60_000;
export const CHUNK = 32;

export type Chunk = { specs: JevSpec[]; texts: string[] };

export type Stats = {
  running: boolean;
  startedAt: number;
  elapsedMs: number;
  /** Cells this run has to fetch, and how many came back. */
  cells: number;
  cellsDone: number;
  calls: number;
  callsDone: number;
  errors: number;
  cacheHits: number;
  inference: number[];
  wall: number[];
  tokens: number;
  /** Why the run ended, when it ended by itself. */
  stoppedBy: "" | "budget" | "time" | "user" | "done";
};

export const emptyStats = (): Stats => ({
  running: false,
  startedAt: 0,
  elapsedMs: 0,
  cells: 0,
  cellsDone: 0,
  calls: 0,
  callsDone: 0,
  errors: 0,
  cacheHits: 0,
  inference: [],
  wall: [],
  tokens: 0,
  stoppedBy: "",
});

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

export function answerToValue(spec: JevSpec, a: YesNoResult | ClassifyResult | RateResult): Value {
  if (spec.kind === "judge") {
    const p = (a as YesNoResult).probability;
    return { jev: "judge", value: p, confidence: Math.abs(p - 0.5) * 2 } satisfies JevValue;
  }
  if (spec.kind === "pick") {
    const r = a as ClassifyResult;
    return { jev: "pick", value: r.label, confidence: r.confidence, probabilities: r.scores, levels: spec.options } satisfies JevValue;
  }
  const r = a as RateResult;
  // /rate returns `score` as the expected level (0 … levels-1), which is exactly the
  // 0–4 number the summary formulas (AVERAGE, COUNTIF "<1.5") are written against.
  return { jev: "rate", value: r.score, confidence: r.confidence, levels: spec.options } satisfies JevValue;
}

/** One request per question, at most 32 texts each. */
export function planChunks(specs: JevSpec[]): Chunk[] {
  const groups = new Map<string, JevSpec[]>();
  for (const s of specs) {
    const k = questionKey(s);
    const list = groups.get(k);
    if (list) list.push(s);
    else groups.set(k, [s]);
  }
  const out: Chunk[] = [];
  for (const list of groups.values()) {
    for (const part of chunk(list, CHUNK)) out.push({ specs: part, texts: part.map((s) => s.text) });
  }
  return out;
}

type Resolve = (key: string, value: Value) => void;

export class Runner {
  stats: Stats = emptyStats();
  /** Totals across every run on this page, for the metrics strip. */
  totals = { calls: 0, inference: [] as number[], wall: [] as number[], tokens: 0, cells: 0 };
  lastError: string | null = null;
  queue: Chunk[] = [];
  private queued = new Set<string>();
  private active = 0;
  private stopping = false;

  constructor(
    private resolve: Resolve,
    private onChange: () => void,
  ) {}

  get pendingCells(): number {
    return this.queue.reduce((n, c) => n + c.specs.length, 0);
  }

  /** Add the judgments a recalc asked for. Nothing leaves the browser until start().
   *  `first` puts them ahead of the queue: the column the visitor just asked for
   *  should not wait behind the seeded one it shares the 14-call budget with. */
  enqueue(specs: JevSpec[], cacheHits = 0, first = false): void {
    this.stats.cacheHits += cacheHits;
    const fresh = specs.filter((s) => !this.queued.has(jevKey(s)));
    for (const s of fresh) this.queued.add(jevKey(s));
    if (fresh.length) {
      const planned = planChunks(fresh);
      if (first) this.queue.unshift(...planned);
      else this.queue.push(...planned);
    }
    this.onChange();
  }

  /** Drop the queued judgments for these keys only, leaving the rest of the queue
   *  alone (used when one column is undone). */
  drop(keys: Set<string>): void {
    if (keys.size === 0) return;
    for (const k of keys) this.queued.delete(k);
    this.queue = this.queue
      .map((c) => {
        const specs = c.specs.filter((s) => !keys.has(jevKey(s)));
        return { specs, texts: specs.map((s) => s.text) };
      })
      .filter((c) => c.specs.length > 0);
    this.onChange();
  }

  start(): void {
    if (this.stats.running || this.queue.length === 0) return;
    this.stopping = false;
    this.lastError = null;
    this.stats = { ...emptyStats(), running: true, startedAt: performance.now(), cells: this.pendingCells, calls: this.queue.length };
    this.pump();
    this.onChange();
  }

  stop(): void {
    this.stopping = true;
    this.stats.stoppedBy = "user";
    if (this.active === 0) this.finish("user");
    this.onChange();
  }

  /** Count a call made outside the queue (the header chip) in the page metrics. */
  record(meta: Meta): void {
    this.totals.calls++;
    this.totals.inference.push(meta.inferenceMs);
    this.totals.wall.push(meta.wallMs);
    this.totals.tokens += meta.tokens;
    this.onChange();
  }

  private budgetHit(): "" | "budget" | "time" {
    if (this.stats.callsDone + this.active >= MAX_CALLS) return "budget";
    if (performance.now() - this.stats.startedAt > MAX_RUN_MS) return "time";
    return "";
  }

  private pump(): void {
    while (this.active < 3 && this.queue.length && !this.stopping) {
      const reason = this.budgetHit();
      if (reason) {
        this.stopping = true;
        this.stats.stoppedBy = reason;
        break;
      }
      const c = this.queue.shift()!;
      this.active++;
      void this.send(c).finally(() => {
        this.active--;
        if (this.stopping || this.queue.length === 0) {
          if (this.active === 0) this.finish(this.stats.stoppedBy || "done");
        } else this.pump();
        this.onChange();
      });
    }
    if (this.active === 0 && (this.stopping || this.queue.length === 0)) this.finish(this.stats.stoppedBy || "done");
  }

  private finish(reason: Stats["stoppedBy"]): void {
    if (!this.stats.running) return;
    this.stats.running = false;
    this.stats.stoppedBy = reason;
    this.stats.elapsedMs = performance.now() - this.stats.startedAt;
  }

  private async send(c: Chunk): Promise<void> {
    const spec = c.specs[0];
    const { route, body } = bodyFor(spec);
    try {
      let results: (YesNoResult | ClassifyResult | RateResult)[];
      let meta: Meta;
      if (route === "yes-no") {
        const r = await dm1<{ results: YesNoResult[] }>("yes-no", { texts: c.texts, ...body });
        results = r.data.results;
        meta = r.meta;
      } else if (route === "classify") {
        const r = await classifyMany(c.texts, body.labels as string[] | Record<string, string>);
        results = r.results;
        meta = r.meta;
      } else {
        const r = await rateMany(c.texts, body.scale as string[]);
        results = r.results;
        meta = r.meta;
      }
      this.stats.callsDone++;
      this.stats.inference.push(meta.inferenceMs);
      this.stats.wall.push(meta.wallMs);
      this.stats.tokens += meta.tokens;
      this.totals.calls++;
      this.totals.inference.push(meta.inferenceMs);
      this.totals.wall.push(meta.wallMs);
      this.totals.tokens += meta.tokens;
      c.specs.forEach((s, i) => {
        this.queued.delete(jevKey(s));
        const a = results[i];
        this.stats.cellsDone++;
        this.totals.cells++;
        this.resolve(jevKey(s), a ? answerToValue(s, a) : { error: "#API!", message: "no answer for this row" });
      });
    } catch (e) {
      const msg = e instanceof Dm1Error ? `${e.code}: ${e.message}` : (e as Error).message;
      this.lastError = msg;
      this.stats.errors++;
      this.stats.callsDone++;
      for (const s of c.specs) {
        this.queued.delete(jevKey(s));
        this.stats.cellsDone++;
        this.resolve(jevKey(s), { error: "#API!", message: msg });
      }
    }
  }
}
