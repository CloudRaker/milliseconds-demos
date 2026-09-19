// Dispatch simulation, ported from the experiment's src/sim.ts. Dispatch, merge, unit
// movement, closing and KPI logic are unchanged; the per-report decider became a batch
// decider (one batch of up to BATCH_SIZE reports, four API calls) and the run is 60 s
// instead of 180 s so one visitor cannot drain the shared quota.

import {
  PACKAGE_UNITS,
  UNIT_SPEED,
  buildCity,
  createFleet,
  distance,
  generateSchedule,
  generateSurge,
  type Category,
  type City,
  type OpenIncidentSummary,
  type Point,
  type Report,
  type Severity,
  type Unit,
  type UnitType,
} from "./data.ts";
import { median, percentile, ratePerSecond } from "./kpi.ts";
import {
  BATCH_SIZE,
  MULTI_VICTIM_GATE,
  heuristicDecision,
  nearestOpen,
  simulatedDecision,
  type Decision,
  type TriageBatch,
  type TriageItem,
} from "./triage.ts";

export type Mode = "manual" | "slow" | "live";

export const MODE_LABEL: Record<Mode, string> = { manual: "Manual queue", slow: "Slow LLM", live: "Model decisions" };
export const MANUAL_SECONDS = 12;
export const SLOW_LLM_SECONDS = 3;
/** Batching adds up to a couple of seconds of wait, so the stale cut-off is higher than the experiment's 2.5 s. */
export const LIVE_TIMEOUT_SECONDS = 12;
/** Bounded run: 60 simulated seconds, then the sim stops itself. */
export const RUN_SECONDS = 60;
/** Wait this long for more reports before sending a part-full batch. */
export const BATCH_INTERVAL_SECONDS = 3;
export const DEFAULT_SEED = 20260917;
export const CRITICAL_SEVERITY: Severity = 3;
export const CRITICAL_WAIT_SECONDS = 60;

export interface Incident {
  id: string;
  category: Category;
  severity: Severity;
  loc: Point;
  address: string;
  districtId: string;
  summary: string;
  openedAt: number;
  firstReportT: number;
  reportIds: string[];
  mergedCount: number;
  decision: Decision;
  required: UnitType[];
  unitIds: string[];
  status: "awaiting_units" | "dispatched" | "on_scene" | "closed";
  dispatchedAt: number | null;
  firstArrivalAt: number | null;
  closedAt: number | null;
}

export interface FeedItem {
  report: Report;
  status: "queued" | "deciding" | "done";
  startedAt: number | null;
  decidedAt: number | null;
  decision: Decision | null;
  latencyMs: number | null;
  outcome: "new" | "merged" | "none" | null;
  incidentId: string | null;
  timedOut: boolean;
}

export type LogKind = "arrive" | "decide" | "merge" | "dispatch" | "on_scene" | "close" | "fallback" | "surge" | "info" | "error";

export interface LogEntry {
  t: number;
  kind: LogKind;
  text: string;
}

export interface ApiKpis {
  calls: number;
  batches: number;
  inferenceP50: number;
  wallP50: number;
  wallP95: number;
  tokens: number;
  decisionsPerSec: number;
  inflight: number;
  fallbacks: number;
  stale: number;
  errors: number;
}

export interface Kpis {
  time: number;
  medianTriageS: number;
  medianDispatchS: number;
  criticalWaiting: number;
  queued: number;
  unitsIdle: number;
  unitsTotal: number;
  merged: number;
  incidentsOpen: number;
  incidentsClosed: number;
  reportsArrived: number;
  reportsDecided: number;
  api: ApiKpis;
}

export type BatchDecider = (items: TriageItem[]) => Promise<TriageBatch>;

interface PendingBatch {
  items: TriageItem[];
  result: TriageBatch | null;
  error: string | null;
}

export class Sim {
  readonly mode: Mode;
  readonly seed: number;
  readonly city: City;
  readonly units: Unit[];
  readonly decider: BatchDecider | null;
  time = 0;
  schedule: Report[];
  private nextIdx = 0;
  /** Reports that have arrived and are not yet decided, in arrival order. */
  queue: Report[] = [];
  feed: FeedItem[] = [];
  private feedById = new Map<string, FeedItem>();
  incidents: Incident[] = [];
  private incidentById = new Map<string, Incident>();
  log: LogEntry[] = [];
  inferenceMs: number[] = [];
  wallMs: number[] = [];
  private decisionTimes: number[] = [];
  tokens = 0;
  calls = 0;
  batches = 0;
  inflight = 0;
  fallbacks = 0;
  stale = 0;
  errors = 0;
  merged = 0;
  lastError: string | null = null;
  private incidentSeq = 0;
  private surgeSeq = 0;
  private busyUntil: number | null = null;
  private lastBatchAt = -Infinity;
  private processing: Report | null = null;
  private pending: PendingBatch[] = [];
  finalKpis: Kpis | null = null;

  constructor(mode: Mode, seed = DEFAULT_SEED, decider: BatchDecider | null = null, durationSec = RUN_SECONDS) {
    this.mode = mode;
    this.seed = seed;
    this.decider = decider;
    this.city = buildCity();
    this.units = createFleet(this.city);
    this.schedule = generateSchedule(seed, durationSec);
    this.pushLog("info", `${MODE_LABEL[mode]} run, seed ${seed}, ${this.schedule.length} reports over ${durationSec}s`);
  }

  get openIncidents(): Incident[] {
    return this.incidents.filter((i) => i.status !== "closed");
  }

  incident(id: string): Incident | undefined {
    return this.incidentById.get(id);
  }

  /** Inject a mass-casualty surge starting now. */
  surge(count = 40, windowSec = 10): void {
    const reports = generateSurge(this.seed, this.time + 0.2, 10_000 + this.surgeSeq++ * 1000, count, windowSec);
    this.schedule = [...this.schedule, ...reports].sort((a, b) => a.t - b.t || a.seq - b.seq);
    this.nextIdx = this.schedule.findIndex((r) => r.t > this.time);
    if (this.nextIdx < 0) this.nextIdx = this.schedule.length;
    this.pushLog("surge", `MASS-CASUALTY SURGE: ${count} reports incoming over ${windowSec}s`);
  }

  step(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    this.admitArrivals();
    this.drainPending();
    if (this.mode === "live") this.runLive();
    else this.runSequential(this.mode === "manual" ? MANUAL_SECONDS : SLOW_LLM_SECONDS);
    this.dispatchAwaiting();
    this.moveUnits(dt);
    this.closeIncidents();
    if (this.finalKpis === null && this.time >= RUN_SECONDS) {
      this.finalKpis = this.kpis();
      this.pushLog(
        "info",
        `${RUN_SECONDS}s mark: median dispatch ${this.finalKpis.medianDispatchS.toFixed(1)}s, ${this.finalKpis.queued} still queued, ${this.finalKpis.merged} merged`,
      );
    }
  }

  private admitArrivals(): void {
    while (this.nextIdx < this.schedule.length && this.schedule[this.nextIdx].t <= this.time) {
      const report = this.schedule[this.nextIdx++];
      const item: FeedItem = {
        report,
        status: "queued",
        startedAt: null,
        decidedAt: null,
        decision: null,
        latencyMs: null,
        outcome: null,
        incidentId: null,
        timedOut: false,
      };
      this.feed.push(item);
      this.feedById.set(report.id, item);
      this.queue.push(report);
    }
  }

  private runSequential(secondsPerReport: number): void {
    if (this.processing && this.busyUntil !== null && this.time >= this.busyUntil) {
      const report = this.processing;
      this.processing = null;
      this.busyUntil = null;
      this.apply(report, simulatedDecision(report, (orig) => this.openIncidentForReport(orig)), secondsPerReport * 1000);
    }
    if (!this.processing && this.queue.length) {
      const report = this.queue[0];
      const item = this.feedById.get(report.id)!;
      item.status = "deciding";
      item.startedAt = this.time;
      this.processing = report;
      this.busyUntil = this.time + secondsPerReport;
    }
  }

  /** One batch in flight at a time: up to BATCH_SIZE queued reports, four calls, then the next batch. */
  private runLive(): void {
    for (const report of [...this.queue]) {
      const item = this.feedById.get(report.id)!;
      if (item.status === "deciding" && item.startedAt !== null && this.time - item.startedAt >= LIVE_TIMEOUT_SECONDS) {
        item.timedOut = true;
        this.fallbacks++;
        this.pushLog("fallback", `${report.id}: answer late (> ${LIVE_TIMEOUT_SECONDS}s), heuristic triage applied`);
        this.apply(report, heuristicDecision(report, this.nearbyFor(report)), null);
      }
    }
    if (this.inflight > 0) return;
    const ready = this.queue.filter((r) => this.feedById.get(r.id)!.status === "queued").slice(0, BATCH_SIZE);
    if (!ready.length) return;
    // Let a part-full batch wait a moment: 16 reports in one call beat 16 calls of one.
    if (ready.length < BATCH_SIZE && this.time - this.lastBatchAt < BATCH_INTERVAL_SECONDS) return;
    this.lastBatchAt = this.time;
    const items: TriageItem[] = ready.map((report) => {
      const item = this.feedById.get(report.id)!;
      item.status = "deciding";
      item.startedAt = this.time;
      return { report, nearby: this.nearbyFor(report) };
    });
    if (!this.decider) {
      for (const it of items) {
        this.fallbacks++;
        this.apply(it.report, heuristicDecision(it.report, it.nearby), 0);
      }
      return;
    }
    this.inflight = 1;
    this.batches++;
    this.decider(items).then(
      (result) => this.pending.push({ items, result, error: null }),
      (err: unknown) => this.pending.push({ items, result: null, error: err instanceof Error ? err.message : String(err) }),
    );
  }

  private drainPending(): void {
    const batch = this.pending;
    this.pending = [];
    for (const { items, result, error } of batch) {
      this.inflight = 0;
      if (!result) {
        this.errors++;
        this.lastError = error ?? "request failed";
        this.pushLog("error", `batch of ${items.length} failed (${this.lastError}), heuristic triage applied`);
        for (const it of items) {
          const item = this.feedById.get(it.report.id)!;
          if (item.status === "done") continue;
          this.fallbacks++;
          this.apply(it.report, heuristicDecision(it.report, this.nearbyFor(it.report)), null);
        }
        continue;
      }
      this.calls += result.calls.length;
      for (const call of result.calls) {
        this.tokens += call.tokens;
        this.inferenceMs.push(call.inferenceMs);
        this.wallMs.push(call.wallMs);
      }
      const latency = Math.max(...result.calls.map((c) => c.wallMs));
      items.forEach((it, i) => {
        const item = this.feedById.get(it.report.id)!;
        if (item.status === "done") {
          this.stale++;
          return;
        }
        const decision = result.decisions[i];
        if (!decision) {
          this.fallbacks++;
          this.apply(it.report, heuristicDecision(it.report, it.nearby), latency);
          return;
        }
        // Re-resolve the merge target: incidents may have closed while the batch was in flight.
        if (decision.mergeInto && this.incidentById.get(decision.mergeInto)?.status === "closed") decision.mergeInto = null;
        this.apply(it.report, decision, latency);
      });
    }
  }

  nearbyFor(report: Report): OpenIncidentSummary[] {
    return nearestOpen(report, this.openIncidents).map((i) => ({
      id: i.id,
      category: i.category,
      summary: i.summary.slice(0, 140),
      address: i.address,
      age_seconds: Math.round(this.time - i.openedAt),
      distance_m: distance(i.loc, report.loc),
      units_dispatched: i.unitIds.length,
    }));
  }

  private openIncidentForReport(reportId: string): string | null {
    const inc = this.incidents.find((i) => i.status !== "closed" && i.reportIds.includes(reportId));
    return inc ? inc.id : null;
  }

  private apply(report: Report, decision: Decision, latencyMs: number | null): void {
    const item = this.feedById.get(report.id)!;
    item.status = "done";
    item.decision = decision;
    item.decidedAt = this.time;
    item.latencyMs = latencyMs;
    this.queue = this.queue.filter((r) => r.id !== report.id);
    this.decisionTimes.push(this.time);

    const target = decision.mergeInto ? this.incidentById.get(decision.mergeInto) : undefined;
    if (target && target.status !== "closed") {
      this.mergeIntoIncident(target, report, decision, item);
      return;
    }
    if (decision.units === "none" || decision.category === "non_emergency") {
      item.outcome = "none";
      this.pushLog("decide", `${report.id}: ${decision.category}, no units (${decision.source})`);
      return;
    }
    const category = decision.category === "duplicate_update" ? heuristicDecision(report, []).category : decision.category;
    const inc: Incident = {
      id: `INC-${String(++this.incidentSeq).padStart(3, "0")}`,
      category,
      severity: decision.severity,
      loc: report.loc,
      address: report.address,
      districtId: report.districtId,
      summary: report.text,
      openedAt: this.time,
      firstReportT: report.t,
      reportIds: [report.id],
      mergedCount: 0,
      decision,
      required: [...PACKAGE_UNITS[decision.units]],
      unitIds: [],
      status: "awaiting_units",
      dispatchedAt: null,
      firstArrivalAt: null,
      closedAt: null,
    };
    this.incidents.push(inc);
    this.incidentById.set(inc.id, inc);
    item.outcome = "new";
    item.incidentId = inc.id;
    this.pushLog(
      "decide",
      `${report.id} → ${inc.id}: ${category} sev ${decision.severity}, ${decision.units} (${decision.source === "live" ? "model" : decision.source}${latencyMs !== null && decision.source === "live" ? ` · ${Math.round(latencyMs)} ms delivery` : ""})`,
    );
    this.tryDispatch(inc);
  }

  private mergeIntoIncident(inc: Incident, report: Report, decision: Decision, item: FeedItem): void {
    inc.reportIds.push(report.id);
    inc.mergedCount++;
    this.merged++;
    item.outcome = "merged";
    item.incidentId = inc.id;
    let note = "";
    // A follow-up carries no emergency words of its own ("anyone coming for the wire?"), so
    // /rate reads it as information only. It belongs to this incident, so it inherits the
    // incident's severity rather than showing a 0 next to it in the feed.
    if (decision.severity < inc.severity) decision.severity = inc.severity;
    if (decision.severity > inc.severity && decision.source !== "fallback") {
      inc.severity = decision.severity;
      note += `, severity → ${decision.severity}`;
    }
    const hasAmbulance = inc.required.includes("ambulance") || inc.unitIds.some((id) => this.unitById(id)?.type === "ambulance");
    if (decision.multipleVictims >= MULTI_VICTIM_GATE && !hasAmbulance && inc.category !== "non_emergency") {
      inc.required.push("ambulance");
      note += ", +ambulance (multiple victims)";
      if (inc.status === "on_scene") inc.status = "dispatched";
    }
    this.pushLog("merge", `${report.id} merged into ${inc.id} (p=${decision.duplicateP.toFixed(2)}${note})`);
    if (inc.required.length) this.tryDispatch(inc);
  }

  private unitById(id: string): Unit | undefined {
    return this.units.find((u) => u.id === id);
  }

  /** Assign the nearest available unit of each required type; deterministic (distance, then id). */
  private tryDispatch(inc: Incident): void {
    if (!inc.required.length) return;
    const remaining: UnitType[] = [];
    for (const type of inc.required) {
      const unit = this.units
        .filter((u) => u.type === type && (u.status === "idle" || u.status === "returning"))
        .sort((a, b) => distance(a.pos, inc.loc) - distance(b.pos, inc.loc) || a.id.localeCompare(b.id))[0];
      if (!unit) {
        remaining.push(type);
        continue;
      }
      unit.status = "enroute";
      unit.incidentId = inc.id;
      unit.arrivedAt = null;
      inc.unitIds.push(unit.id);
      if (inc.dispatchedAt === null) {
        inc.dispatchedAt = this.time;
        this.pushLog(
          "dispatch",
          `${inc.id}: ${unit.id} dispatched, ${Math.round(distance(unit.pos, inc.loc))} m out (${(this.time - inc.firstReportT).toFixed(1)}s after first report)`,
        );
      }
    }
    inc.required = remaining;
    if (inc.status === "awaiting_units" && inc.unitIds.length) inc.status = "dispatched";
  }

  private dispatchAwaiting(): void {
    const waiting = this.incidents
      .filter((i) => i.status !== "closed" && i.required.length)
      .sort((a, b) => b.severity - a.severity || a.firstReportT - b.firstReportT);
    for (const inc of waiting) this.tryDispatch(inc);
  }

  private moveUnits(dt: number): void {
    for (const u of this.units) {
      if (u.status === "idle" || u.status === "onscene") continue;
      const target = u.status === "enroute" ? this.incidentById.get(u.incidentId ?? "")?.loc : u.home;
      if (!target) {
        u.status = "returning";
        continue;
      }
      const d = distance(u.pos, target);
      const travel = UNIT_SPEED[u.type] * dt;
      if (d <= travel) {
        u.pos = { ...target };
        if (u.status === "enroute") {
          u.status = "onscene";
          u.arrivedAt = this.time;
          const inc = this.incidentById.get(u.incidentId!)!;
          if (inc.firstArrivalAt === null) {
            inc.firstArrivalAt = this.time;
            this.pushLog("on_scene", `${inc.id}: ${u.id} on scene after ${(this.time - inc.firstReportT).toFixed(0)}s`);
          }
          if (inc.status === "dispatched" && inc.required.length === 0) inc.status = "on_scene";
        } else {
          u.status = "idle";
        }
      } else {
        u.pos = { x: u.pos.x + ((target.x - u.pos.x) / d) * travel, y: u.pos.y + ((target.y - u.pos.y) / d) * travel };
      }
    }
  }

  private closeIncidents(): void {
    for (const inc of this.incidents) {
      if (inc.status === "closed" || inc.required.length || !inc.unitIds.length) continue;
      const units = inc.unitIds.map((id) => this.unitById(id)!);
      if (!units.every((u) => u.status === "onscene")) continue;
      const lastArrival = Math.max(...units.map((u) => u.arrivedAt ?? this.time));
      if (this.time - lastArrival < onSceneSeconds(inc.severity)) continue;
      inc.status = "closed";
      inc.closedAt = this.time;
      for (const u of units) {
        u.status = "returning";
        u.incidentId = null;
        u.arrivedAt = null;
      }
      this.pushLog("close", `${inc.id} closed, ${units.length} unit(s) returning`);
    }
  }

  kpis(): Kpis {
    const decided = this.feed.filter((f) => f.status === "done" && f.decidedAt !== null);
    const triage = decided.map((f) => f.decidedAt! - f.report.t);
    const dispatch = this.incidents.filter((i) => i.dispatchedAt !== null).map((i) => i.dispatchedAt! - i.firstReportT);
    let criticalWaiting = 0;
    for (const r of this.queue) {
      if (r.truth.severity >= CRITICAL_SEVERITY && r.truth.duplicateOf === null && this.time - r.t > CRITICAL_WAIT_SECONDS) criticalWaiting++;
    }
    for (const i of this.incidents) {
      if (i.status === "awaiting_units" && i.severity >= CRITICAL_SEVERITY && this.time - i.firstReportT > CRITICAL_WAIT_SECONDS) criticalWaiting++;
    }
    return {
      time: this.time,
      medianTriageS: median(triage),
      medianDispatchS: median(dispatch),
      criticalWaiting,
      queued: this.queue.length,
      unitsIdle: this.units.filter((u) => u.status === "idle").length,
      unitsTotal: this.units.length,
      merged: this.merged,
      incidentsOpen: this.incidents.filter((i) => i.status !== "closed").length,
      incidentsClosed: this.incidents.filter((i) => i.status === "closed").length,
      reportsArrived: this.feed.length,
      reportsDecided: decided.length,
      api: {
        calls: this.calls,
        batches: this.batches,
        inferenceP50: median(this.inferenceMs),
        wallP50: median(this.wallMs),
        wallP95: percentile(this.wallMs, 95),
        tokens: this.tokens,
        decisionsPerSec: ratePerSecond(this.decisionTimes, this.time, 10),
        inflight: this.inflight,
        fallbacks: this.fallbacks,
        stale: this.stale,
        errors: this.errors,
      },
    };
  }

  private pushLog(kind: LogKind, text: string): void {
    this.log.push({ t: this.time, kind, text });
    if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
  }
}

export function onSceneSeconds(severity: Severity): number {
  return 15 + severity * 8;
}
