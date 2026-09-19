// The whole log-sentinel pipeline, in the browser. Ported from the Jev experiment's Node server:
// server/grouper.ts, server/regex.ts, server/generator.ts, server/incidents.ts, server/metrics.ts and
// server/pipeline.ts are kept as-is; server/jev.ts becomes `judge()`, which sends one batch of up to
// 32 prefixed lines to /yes-no, /rate and /classify through src/lib/dm1.ts.

import { Dm1Error, type RateResult, type ClassifyResult, type YesNoResult } from "../../lib/dm1";
import {
  ACTIONABLE,
  ACTIONABLE_THRESHOLD,
  CATEGORIES,
  CATEGORY_LABELS,
  SECURITY,
  SECURITY_THRESHOLD,
  SEVERITIES,
  SEVERITY_SCALE,
  STORM,
  TEMPLATES,
  STOCK_TEXTS,
  stockLogLines,
  Rng,
  forModel,
  regexPages,
  type Category,
  type Level,
  type LogEvent,
  type Service,
  type Severity,
  type Template,
  type Truth,
} from "./data";

import { stockBatch, stockPlan } from "../../lib/stock-batch";

// ---------------------------------------------------------------- types the pipeline adds
export interface Judgment {
  id: number;
  actionable: boolean;
  actionableP: number;
  severity: Severity;
  severityScore: number;
  category: Category;
  categoryConfidence: number;
  security: boolean;
  /** Round trip of the batch that carried this event, ms. */
  latencyMs: number;
  /** Emission to verdict, ms. */
  ageMs: number;
  batchSize: number;
}

export interface Incident {
  key: string;
  service: Service;
  category: Category;
  severity: Severity;
  firstSeen: number;
  lastSeen: number;
  count: number;
  security: boolean;
  sample: string;
  eventIds: number[];
}

export interface Accuracy {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
}

export interface Disagreement {
  id: number;
  service: Service;
  line: string;
  kind: "regex_fp" | "regex_fn" | "dm_fp" | "dm_fn";
}

export interface Row {
  event: LogEvent;
  judgment?: Judgment;
}

export interface Metrics {
  eventsPerSec: number;
  judgmentsPerSec: number;
  inFlight: number;
  backlog: number;
  calls: number;
  tokens: number;
  inferenceP50: number;
  wallP50: number;
  ageP50: number;
  ageP95: number;
  totalEvents: number;
  totalJudged: number;
  errors: number;
  elapsedMs: number;
  regexPaged: number;
  dmActionable: number;
  truthActionable: number;
  regex: Accuracy;
  dm: Accuracy;
}

export interface Snapshot {
  running: boolean;
  rate: number;
  rows: Row[];
  incidents: Incident[];
  disagreements: Disagreement[];
  storm: { phase: string; at: number }[];
  metrics: Metrics;
  error: string | null;
  notice: string | null;
  mock: boolean;
}

// ---------------------------------------------------------------- grouper (server/grouper.ts)
const CONTINUATION = /^(\s+|Caused by:|\.\.\. \d+ more|Traceback \(most recent call last\)|[A-Za-z_$][\w$.]*(Exception|Error)(: |$))/;

export function isContinuation(line: string): boolean {
  return CONTINUATION.test(line);
}

interface Meta {
  service: Service;
  level: Level;
  truth: Truth;
  storm: boolean;
}

class LineGrouper {
  private pending: { text: string; lines: number; meta: Meta } | null = null;

  feed(text: string, meta: Meta) {
    if (this.pending && isContinuation(text)) {
      this.pending.text += "\n" + text;
      this.pending.lines += 1;
      return null;
    }
    const out = this.pending;
    this.pending = { text, lines: 1, meta };
    return out;
  }

  flush() {
    const out = this.pending;
    this.pending = null;
    return out;
  }
}

// ---------------------------------------------------------------- generator (server/generator.ts)
const TOTAL_WEIGHT = TEMPLATES.reduce((a, t) => a + t.weight, 0);

export function pickTemplate(rng: Rng): Template {
  let x = rng.next() * TOTAL_WEIGHT;
  for (const t of TEMPLATES) {
    x -= t.weight;
    if (x < 0) return t;
  }
  return TEMPLATES[TEMPLATES.length - 1];
}

export class Generator {
  private rng: Rng;
  private grouper = new LineGrouper();
  private nextId = 1;
  private stormQueue: { at: number; template: Template }[] = [];

  constructor(seed = 20260917) {
    this.rng = new Rng(seed);
  }

  injectStorm(now = Date.now()): void {
    for (const s of STORM) this.stormQueue.push({ at: now + s.atMs, template: s.template });
    this.stormQueue.sort((a, b) => a.at - b.at);
  }

  get stormPending(): number {
    return this.stormQueue.length;
  }

  tick(now = Date.now()): LogEvent[] {
    let template: Template;
    let storm = false;
    if (this.stormQueue.length && this.stormQueue[0].at <= now) {
      template = this.stormQueue.shift()!.template;
      storm = true;
    } else {
      template = pickTemplate(this.rng);
    }
    const meta: Meta = { service: template.service, level: template.level, truth: template.truth, storm };
    const out: LogEvent[] = [];
    for (const text of stockLogLines(template)) {
      const done = this.grouper.feed(text, meta);
      if (done) out.push(this.toEvent(done.text, done.lines, done.meta, now));
    }
    return out;
  }

  flush(now = Date.now()): LogEvent[] {
    const done = this.grouper.flush();
    return done ? [this.toEvent(done.text, done.lines, done.meta, now)] : [];
  }

  private toEvent(line: string, lines: number, meta: Meta, now: number): LogEvent {
    return { id: this.nextId++, ts: now, service: meta.service, level: meta.level, line, lines, truth: meta.truth, regexPaged: regexPages(line), storm: meta.storm };
  }
}

// ---------------------------------------------------------------- incidents (server/incidents.ts)
export class IncidentTracker {
  private incidents = new Map<string, Incident>();
  private windowMs = 60_000;
  private maxIncidents = 40;

  add(event: LogEvent, j: Judgment): Incident | null {
    if (!j.actionable) return null;
    const key = `${event.service}:${j.category}`;
    const existing = this.incidents.get(key);
    if (existing && event.ts - existing.lastSeen <= this.windowMs) {
      existing.lastSeen = event.ts;
      existing.count += 1;
      existing.eventIds.push(event.id);
      if (existing.eventIds.length > 50) existing.eventIds.shift();
      if (SEVERITIES.indexOf(j.severity) > SEVERITIES.indexOf(existing.severity)) {
        existing.severity = j.severity;
        existing.sample = event.line.split("\n")[0];
      }
      existing.security ||= j.security;
      return existing;
    }
    if (existing) this.incidents.delete(key);
    const inc: Incident = {
      key: `${key}:${event.id}`,
      service: event.service,
      category: j.category,
      severity: j.severity,
      firstSeen: event.ts,
      lastSeen: event.ts,
      count: 1,
      security: j.security,
      sample: event.line.split("\n")[0],
      eventIds: [event.id],
    };
    this.incidents.set(key, inc);
    return inc;
  }

  list(now = Date.now()): Incident[] {
    return [...this.incidents.values()]
      .filter((i) => now - i.lastSeen <= this.windowMs * 3)
      .sort((a, b) => SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity) || b.lastSeen - a.lastSeen)
      .slice(0, this.maxIncidents);
  }
}

// ---------------------------------------------------------------- metrics (server/metrics.ts)
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export class LatencyWindow {
  private samples: number[] = [];
  private size = 400;
  push(ms: number): void {
    this.samples.push(ms);
    if (this.samples.length > this.size) this.samples.shift();
  }
  p(q: number): number {
    return percentile([...this.samples].sort((a, b) => a - b), q);
  }
}

export class RateMeter {
  private stamps: number[] = [];
  private windowMs = 5000;
  mark(now = Date.now()): void {
    this.stamps.push(now);
    this.prune(now);
  }
  perSecond(now = Date.now()): number {
    this.prune(now);
    return (this.stamps.length * 1000) / this.windowMs;
  }
  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    let i = 0;
    while (i < this.stamps.length && this.stamps[i] < cutoff) i++;
    if (i) this.stamps.splice(0, i);
  }
}

export class Confusion {
  tp = 0;
  fp = 0;
  fn = 0;
  tn = 0;
  record(predicted: boolean, truth: boolean): void {
    if (predicted && truth) this.tp++;
    else if (predicted && !truth) this.fp++;
    else if (!predicted && truth) this.fn++;
    else this.tn++;
  }
  snapshot(): Accuracy {
    const precision = this.tp + this.fp ? this.tp / (this.tp + this.fp) : 0;
    const recall = this.tp + this.fn ? this.tp / (this.tp + this.fn) : 0;
    return { tp: this.tp, fp: this.fp, fn: this.fn, tn: this.tn, precision, recall };
  }
}

export interface Verdict {
  actionable: boolean;
  actionableP: number;
  severity: Severity;
  severityScore: number;
  category: Category;
  categoryConfidence: number;
  security: boolean;
}

export interface JudgeResult {
  verdicts: Verdict[];
  calls: number;
  tokens: number;
  inferenceMs: number;
  wallMs: number;
}

/**
 * One batch, four calls, in parallel: /yes-no (actionable), /rate (severity), /classify (category)
 * and a second /yes-no (security). Security is asked, not derived from the category: the category is
 * gated on the actionable verdict, and every security line scores under that gate on its own, so a
 * derived flag was never true. A security line is also actionable by definition.
 */
export async function judge(events: { service: string; line: string }[], signal?: AbortSignal): Promise<JudgeResult> {
  const texts = events.map(forModel);
  const t0 = performance.now();
  const [act, sev, cat, sec] = await Promise.all([
    stockBatch<{ results: YesNoResult[] }>("yes-no", { texts, statement: ACTIONABLE.statement, when_true: ACTIONABLE.when_true, when_false: ACTIONABLE.when_false }, STOCK_TEXTS, signal),
    stockBatch<{ results: RateResult[] }>("rate", { texts, scale: SEVERITY_SCALE }, STOCK_TEXTS, signal),
    stockBatch<{ results: ClassifyResult[] }>("classify", { texts, labels: CATEGORY_LABELS }, STOCK_TEXTS, signal),
    stockBatch<{ results: YesNoResult[] }>("yes-no", { texts, statement: SECURITY.statement, when_true: SECURITY.when_true, when_false: SECURITY.when_false }, STOCK_TEXTS, signal),
  ]);
  const wallMs = Math.round(performance.now() - t0);
  const verdicts = events.map((_, i) => {
    const a = act.data.results[i];
    const s = sev.data.results[i];
    const c = cat.data.results[i] as ClassifyResult | undefined;
    // The root cause and the severity only mean something once the line is worth looking at: the
    // rating of a healthy request drifts upward and its root cause is a guess. So the yes/no answer
    // gates both, exactly as the incident tracker gates grouping on `actionable`.
    const security = (sec.data.results[i]?.probability ?? 0) >= SECURITY_THRESHOLD;
    const actionableP = a?.probability ?? 0;
    const actionable = actionableP >= ACTIONABLE_THRESHOLD || security;
    const label = c?.label ?? "";
    const category: Category = actionable && (CATEGORIES as readonly string[]).includes(label) ? (label as Category) : "noise";
    return {
      actionable,
      actionableP,
      severity: actionable ? SEVERITIES[Math.max(0, Math.min(4, s?.level ?? 0))] : "noise",
      severityScore: actionable ? (s?.score ?? 0) * 4 : 0,
      category,
      categoryConfidence: c?.probability ?? 0,
      security,
    };
  });
  return {
    verdicts,
    calls: 4 * stockPlan(texts, STOCK_TEXTS).length,
    tokens: act.meta.tokens + sev.meta.tokens + cat.meta.tokens + sec.meta.tokens,
    inferenceMs: Math.round((act.meta.inferenceMs + sev.meta.inferenceMs + cat.meta.inferenceMs + sec.meta.inferenceMs) / 4),
    wallMs,
  };
}

/** MOCK=1 replays the fixture labels so the page still works if your key is rotated. */
async function mockJudge(events: LogEvent[]): Promise<JudgeResult> {
  await new Promise((r) => setTimeout(r, 180 + Math.random() * 120));
  return {
    verdicts: events.map((e) => ({
      actionable: e.truth.actionable,
      actionableP: e.truth.actionable ? 0.92 : 0.06,
      severity: e.truth.severity,
      severityScore: SEVERITIES.indexOf(e.truth.severity),
      category: e.truth.category,
      categoryConfidence: 0.9,
      security: e.truth.security,
    })),
    calls: 0,
    tokens: 0,
    inferenceMs: 0,
    wallMs: 200,
  };
}

// ---------------------------------------------------------------- pipeline (server/pipeline.ts)
export const FIREHOSE_LIMIT = 400;
export const BATCH_MAX = 32;
export const RATE_MIN = 4;
export const RATE_MAX = 20;
export const RATE_DEFAULT = 12;
/** One visitor may not hold your key for longer than this, or produce more events than that. */
export const MAX_RUN_MS = 60_000;
export const MAX_EVENTS = 1400;
const LINGER_MS = 600;
// Three batches in flight, not two: dm1.ts caps the page at 2 requests a second whatever happens
// here, and with a batch taking 3-5 s two in flight only issued about 1.2 of those 2 requests.
const MAX_INFLIGHT = 3;
const TICK_MS = 100;
const SEED_EVENTS = 60;

function summary(line: string): string {
  const head = line.split("\n")[0];
  const m = /"msg":"([^"]+)"/.exec(head);
  return (m ? m[1] : head).slice(0, 70);
}

export class Engine {
  private gen = new Generator();
  private incidents = new IncidentTracker();
  private wall = new LatencyWindow();
  private inference = new LatencyWindow();
  private age = new LatencyWindow();
  private inRate = new RateMeter();
  private outRate = new RateMeter();
  private regexAcc = new Confusion();
  private dmAcc = new Confusion();

  private rows: Row[] = [];
  private disagreements: Disagreement[] = [];
  private stormLog: { phase: string; at: number }[] = [];
  private pending: LogEvent[] = [];
  private inFlight = 0;
  private credit = 0;
  private lastTick = 0;
  private startedAt = 0;
  private runMs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private throttledUntil = 0;
  private backoffMs = 0;

  private totalEvents = 0;
  private totalJudged = 0;
  private calls = 0;
  private tokens = 0;
  private errors = 0;
  private regexPaged = 0;
  private dmActionable = 0;
  private truthActionable = 0;

  private running = false;
  private rate = RATE_DEFAULT;
  private error: string | null = null;
  private notice: string | null = null;
  private storm: { startedAt: number; firstDm: number | null; firstRegex: number | null } | null = null;

  private listeners = new Set<() => void>();
  private snap: Snapshot;

  readonly mock: boolean;

  constructor(mock = false) {
    this.mock = mock;
    // Seed the firehose so the page shows a real stream, with the regex baseline already scored,
    // before anyone presses Run.
    const now = Date.now();
    while (this.totalEvents < SEED_EVENTS) for (const e of this.gen.tick(now - (SEED_EVENTS - this.totalEvents) * 80)) this.ingest(e, false);
    this.snap = this.build();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): Snapshot => this.snap;

  private publish(): void {
    this.snap = this.build();
    for (const l of this.listeners) l();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.error = null;
    this.notice = null;
    // Leftovers from a stopped run would land in the first batch with an age of tens of seconds.
    this.pending.length = 0;
    this.runMs = 0;
    this.startedAt = Date.now();
    this.lastTick = this.startedAt;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.publish();
  }

  stop(reason?: string): void {
    if (!this.running) return;
    this.running = false;
    this.runMs = Date.now() - this.startedAt;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const e of this.gen.flush()) this.ingest(e, false);
    this.notice = reason ?? null;
    this.publish();
  }

  setRate(rate: number): void {
    this.rate = Math.max(RATE_MIN, Math.min(RATE_MAX, Math.round(rate)));
    this.publish();
  }

  triggerStorm(): void {
    if (!this.running) this.start();
    const now = Date.now();
    this.gen.injectStorm(now);
    this.storm = { startedAt: now, firstDm: null, firstRegex: null };
    this.stormLog = [{ phase: "Storm injected: a payments provider degrades, starting with INFO-level anomalies", at: now }];
    this.publish();
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    this.listeners.clear();
  }

  // ---------------------------------------------------------------- loop
  private tick(): void {
    const now = Date.now();
    const dt = now - this.lastTick;
    this.lastTick = now;
    if (now - this.startedAt >= MAX_RUN_MS) return this.stop(`Stopped after ${MAX_RUN_MS / 1000} s. The demo key is shared, so every run is capped. Press Run to go again.`);
    if (this.totalEvents >= MAX_EVENTS) return this.stop(`Stopped at ${MAX_EVENTS} events. The demo key is shared, so every run is capped.`);
    if (now >= this.throttledUntil) {
      this.credit += (this.rate * dt) / 1000;
      if (this.gen.stormPending && this.credit < 1) this.credit = 1;
      let n = Math.floor(this.credit);
      this.credit -= n;
      while (n-- > 0) for (const e of this.gen.tick(now)) this.ingest(e);
      // A whole template is fed to the grouper within one tick, so a finished event never waits.
      for (const e of this.gen.flush(now)) this.ingest(e);
    }
    this.pump(now);
    this.publish();
  }

  private ingest(e: LogEvent, live = true): void {
    this.totalEvents++;
    this.inRate.mark(e.ts);
    if (e.truth.actionable) this.truthActionable++;
    // Both confusion matrices are scored in accept(), over exactly the events that got a verdict,
    // so the two sides of the scoreboard are measured on the same lines. Only the storm timestamp
    // belongs here, because it is the emission time.
    if (e.storm && e.regexPaged && this.storm && this.storm.firstRegex === null) {
      this.storm.firstRegex = e.ts;
      this.stormLog.push({ phase: `Regex rules first paged at +${((e.ts - this.storm.startedAt) / 1000).toFixed(1)} s: ${summary(e.line)}`, at: e.ts });
      this.stormVerdict();
    }
    if (this.rows.length >= FIREHOSE_LIMIT) this.rows.shift();
    this.rows.push({ event: e });
    if (live) this.pending.push(e);
  }

  /** Fill batches as wide as the 3 req/s budget allows: a batch leaves when it is full, or after the
   *  linger, and only when a slot is free. The backlog is therefore the pending list itself. */
  private pump(now: number): void {
    while (this.inFlight < MAX_INFLIGHT && this.pending.length && now >= this.throttledUntil) {
      const ready = this.pending.length >= BATCH_MAX || now - this.pending[0].ts >= LINGER_MS;
      if (!ready) return;
      this.inFlight++;
      void this.run(this.pending.splice(0, BATCH_MAX));
    }
  }

  private async run(batch: LogEvent[]): Promise<void> {
    try {
      const res = this.mock ? await mockJudge(batch) : await judge(batch);
      this.backoffMs = 0;
      this.error = null;
      this.calls += res.calls;
      this.tokens += res.tokens;
      this.wall.push(res.wallMs);
      if (res.inferenceMs) this.inference.push(res.inferenceMs);
      const now = Date.now();
      batch.forEach((e, i) => this.accept(e, res.verdicts[i], res.wallMs, batch.length, now));
    } catch (err) {
      this.errors++;
      this.backoffMs = this.backoffMs ? Math.min(this.backoffMs * 2, 16_000) : 1000;
      this.throttledUntil = Date.now() + this.backoffMs;
      const rateLimited = err instanceof Dm1Error && err.status === 429;
      this.error = rateLimited
        ? `Rate limited on the API key. Pausing the stream for ${this.backoffMs / 1000} s.`
        : `${err instanceof Error ? err.message : String(err)} — pausing the stream for ${this.backoffMs / 1000} s.`;
      // Drop the batch rather than requeue it: the backlog stays honest and the budget is not spent twice.
    } finally {
      this.inFlight--;
      this.publish();
    }
  }

  private accept(e: LogEvent, v: Verdict, latencyMs: number, batchSize: number, now: number): void {
    const j: Judgment = {
      id: e.id,
      actionable: v.actionable,
      actionableP: v.actionableP,
      severity: v.severity,
      severityScore: v.severityScore,
      category: v.category,
      categoryConfidence: v.categoryConfidence,
      security: v.security,
      latencyMs,
      ageMs: now - e.ts,
      batchSize,
    };
    this.totalJudged++;
    this.outRate.mark(now);
    this.age.push(j.ageMs);
    if (j.actionable) this.dmActionable++;
    this.dmAcc.record(j.actionable, e.truth.actionable);
    if (j.actionable !== e.truth.actionable) this.note(e, j.actionable ? "dm_fp" : "dm_fn");
    if (e.regexPaged) this.regexPaged++;
    this.regexAcc.record(e.regexPaged, e.truth.actionable);
    if (e.regexPaged !== e.truth.actionable) this.note(e, e.regexPaged ? "regex_fp" : "regex_fn");
    this.incidents.add(e, j);
    if (e.storm && j.actionable && this.storm && this.storm.firstDm === null) {
      this.storm.firstDm = now;
      this.stormLog.push({ phase: `decision-machine-1 flagged the storm at +${((now - this.storm.startedAt) / 1000).toFixed(1)} s: ${summary(e.line)}`, at: now });
      this.stormVerdict();
    }
    const idx = findRow(this.rows, e.id);
    if (idx >= 0) this.rows[idx] = { ...this.rows[idx], judgment: j };
  }

  private stormVerdict(): void {
    const s = this.storm;
    if (!s || s.firstDm === null || s.firstRegex === null) return;
    const lead = (s.firstRegex - s.firstDm) / 1000;
    this.stormLog.push({
      phase: lead >= 0 ? `Verdict: decision-machine-1 was ${lead.toFixed(1)} s ahead of the regex rules on this incident` : `Verdict: the regex rules paged ${(-lead).toFixed(1)} s first on this incident`,
      at: Date.now(),
    });
  }

  private note(e: LogEvent, kind: Disagreement["kind"]): void {
    this.disagreements.unshift({ id: e.id, service: e.service, line: e.line.split("\n")[0], kind });
    if (this.disagreements.length > 60) this.disagreements.pop();
  }

  private build(): Snapshot {
    const now = Date.now();
    return {
      running: this.running,
      rate: this.rate,
      rows: this.rows.slice(),
      incidents: this.incidents.list(now),
      disagreements: this.disagreements.slice(),
      storm: this.stormLog.slice(-6),
      error: this.error,
      notice: this.notice,
      mock: this.mock,
      metrics: {
        eventsPerSec: this.inRate.perSecond(now),
        judgmentsPerSec: this.outRate.perSecond(now),
        inFlight: this.inFlight,
        backlog: this.pending.length,
        calls: this.calls,
        tokens: this.tokens,
        inferenceP50: this.inference.p(50),
        wallP50: this.wall.p(50),
        ageP50: this.age.p(50),
        ageP95: this.age.p(95),
        totalEvents: this.totalEvents,
        totalJudged: this.totalJudged,
        errors: this.errors,
        elapsedMs: this.running ? now - this.startedAt : this.runMs,
        regexPaged: this.regexPaged,
        dmActionable: this.dmActionable,
        truthActionable: this.truthActionable,
        regex: this.regexAcc.snapshot(),
        dm: this.dmAcc.snapshot(),
      },
    };
  }
}

/** Rows are appended in id order, so binary search (src/lib/store.ts). */
export function findRow(rows: Row[], id: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = rows[mid].event.id;
    if (v === id) return mid;
    if (v < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
