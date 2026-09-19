import type { Aircraft, Conflict, Instruction, Mode, Phase } from "./types.ts";
import { ARRIVAL_TOD_NM, SCOPE_RADIUS_NM } from "./types.ts";
import { Rng } from "./rng.ts";
import { FIX_MAP, spawn } from "./world.ts";
import { desiredHeading, distanceNm, integrate } from "./kinematics.ts";
import { conflictsFor, inViolation, pairKey, predictConflicts, trackOf } from "./conflict.ts";
import { VECTOR_HOLD_S, applyInstruction, projected } from "./validate.ts";

export interface TickerEntry {
  t: number;
  callsign: string;
  text: string;
  source: Mode | "sim";
  kind: "instruction" | "fallback" | "los" | "near" | "info";
}

export interface Scorecard {
  losses: number;
  nearMisses: number;
  avgDelayS: number;
  completed: number;
  instructions: number;
  decisions: number;
}

export interface SimOptions {
  seed: number;
  initialCount?: number;
  rushHour?: boolean;
}

const MEAN_INTERVAL_S: Record<Phase, number> = { arrival: 28, departure: 40, overflight: 30 };
const MAX_AIRCRAFT = 40;
const NEAR_MISS_NM = 1.5;
const NEAR_MISS_FT = 500;
const DEPARTURE_SPACING_NM = 5;
/** The adjacent sector never hands off traffic that will lose separation sooner than this. */
const SPAWN_CLEAR_S = 45;

export class Sim {
  t = 0;
  aircraft: Aircraft[] = [];
  conflicts: Conflict[] = [];
  ticker: TickerEntry[] = [];
  rushHour: boolean;
  losses = 0;
  nearMisses = 0;
  instructions = 0;
  decisions = 0;
  completed = 0;
  totalDelayS = 0;
  private rng: Rng;
  private nextId = 1;
  private nextSpawn: Record<Phase, number>;
  private violating = new Set<string>();
  private nearMissed = new Set<string>();

  constructor(opts: SimOptions) {
    this.rng = new Rng(opts.seed);
    this.rushHour = opts.rushHour ?? false;
    const count = opts.initialCount ?? 20;
    const phases: Phase[] = ["arrival", "arrival", "departure", "overflight"];
    for (let i = 0; i < count; i++) {
      const phase = phases[i % phases.length];
      // Start the scope populated but clean: retry placements that would already be in conflict.
      for (let attempt = 0; attempt < 12; attempt++) {
        const ac = spawn(this.nextId, phase, this.rng, 0, this.rng.range(0.05, 0.8));
        if (predictConflicts([...this.aircraft, ac], 60).length === 0) {
          this.aircraft.push(ac);
          this.nextId++;
          break;
        }
      }
    }
    this.nextSpawn = {
      arrival: this.rng.exp(this.interval("arrival")),
      departure: this.rng.exp(this.interval("departure")),
      overflight: this.rng.exp(this.interval("overflight")),
    };
    this.conflicts = predictConflicts(this.aircraft);
  }

  private interval(phase: Phase): number {
    return MEAN_INTERVAL_S[phase] / (this.rushHour ? 2 : 1);
  }

  get scorecard(): Scorecard {
    return {
      losses: this.losses,
      nearMisses: this.nearMisses,
      avgDelayS: this.completed ? this.totalDelayS / this.completed : 0,
      completed: this.completed,
      instructions: this.instructions,
      decisions: this.decisions,
    };
  }

  byId(): Map<number, Aircraft> {
    return new Map(this.aircraft.map((a) => [a.id, a]));
  }

  find(id: number): Aircraft | undefined {
    return this.aircraft.find((a) => a.id === id);
  }

  conflictsOf(id: number): Conflict[] {
    return this.conflicts.filter((c) => c.a === id || c.b === id);
  }

  /** Aircraft that need a controller decision this tick: in a predicted conflict, or vectored and now clear. */
  candidates(): Aircraft[] {
    const inConflict = new Set<number>();
    for (const c of this.conflicts) {
      inConflict.add(c.a);
      inConflict.add(c.b);
    }
    return this.aircraft.filter((a) => {
      if (inConflict.has(a.id)) return true;
      const vectored = a.vectorHdg !== null || a.assignedAlt !== null;
      return vectored && this.t - a.vectorSince >= 30;
    });
  }

  log(entry: Omit<TickerEntry, "t">): void {
    this.ticker.push({ t: this.t, ...entry });
    if (this.ticker.length > 200) this.ticker.splice(0, this.ticker.length - 200);
  }

  /** Applies an already-validated instruction. */
  apply(id: number, instruction: Instruction, source: Mode, note?: string): void {
    const i = this.aircraft.findIndex((a) => a.id === id);
    if (i < 0) return;
    const before = this.aircraft[i];
    const after = applyInstruction(before, instruction, this.t, FIX_MAP);
    this.aircraft[i] = { ...after, haloUntil: this.t + 6 };
    this.conflicts = predictConflicts(this.aircraft);
    this.decisions++;
    if (instruction !== "maintain") {
      this.instructions++;
      this.log({ callsign: before.callsign, text: describe(instruction, after) + (note ? ` ${note}` : ""), source, kind: note ? "fallback" : "instruction" });
    }
  }

  step(dt: number): void {
    this.t += dt;
    const next: Aircraft[] = [];
    for (let ac of this.aircraft) {
      // Vectors and assigned altitudes expire so an aircraft never flies off the scope on a stale heading,
      // but only once resuming own navigation leaves the aircraft conflict-free over the whole horizon.
      if ((ac.vectorHdg !== null || ac.assignedAlt !== null) && this.t - ac.vectorSince > VECTOR_HOLD_S) {
        const free = { ...ac, instructionAt: -1000 };
        const others = this.aircraft.filter((o) => o.id !== ac.id);
        const resumed = applyInstruction(free, "direct_to_next_fix", this.t, FIX_MAP);
        if (conflictsFor(trackOf(projected(free, "direct_to_next_fix", this.t, FIX_MAP)), others).length === 0 && conflictsFor(trackOf({ ...resumed, hdg: ac.hdg }), others, 15).length === 0) {
          ac = { ...resumed, instruction: "maintain" };
          this.log({ callsign: ac.callsign, text: "vector expired, resumed own navigation", source: "sim", kind: "info" });
        }
      }
      ac = this.followRoute(ac);
      ac = integrate(ac, desiredHeading(ac, FIX_MAP), dt);
      if (this.isFinished(ac)) {
        this.completed++;
        const last = FIX_MAP.get(ac.route[ac.route.length - 1].fix)!;
        const remainingS = (distanceNm(ac.x, ac.y, last.x, last.y) / Math.max(ac.spd, 1)) * 3600;
        this.totalDelayS += this.t - ac.spawnedAt + remainingS - ac.baselineTime;
        continue;
      }
      next.push(ac);
    }
    this.aircraft = next;
    this.spawnTraffic(dt);
    this.conflicts = predictConflicts(this.aircraft);
    this.detectViolations();
  }

  private followRoute(ac: Aircraft): Aircraft {
    const leg = ac.route[ac.routeIdx];
    if (!leg) return ac;
    const fix = FIX_MAP.get(leg.fix)!;
    const d = distanceNm(ac.x, ac.y, fix.x, fix.y);
    let out = ac;
    if (d < 1.2 && ac.routeIdx < ac.route.length - 1) {
      out = { ...ac, routeIdx: ac.routeIdx + 1 };
    }
    const cur = out.route[out.routeIdx];
    // Profile altitude/speed unless a controller assigned something.
    const targetAlt = out.assignedAlt ?? cur.alt;
    const targetSpd = out.assignedSpd ?? cur.spd;
    // Arrivals only start descending to the next leg's altitude once inside the top-of-descent distance.
    const fixNext = FIX_MAP.get(cur.fix)!;
    const dNext = distanceNm(out.x, out.y, fixNext.x, fixNext.y);
    const alt = out.assignedAlt === null && out.phase === "arrival" && dNext > ARRIVAL_TOD_NM && targetAlt < out.alt ? out.alt : targetAlt;
    return { ...out, targetAlt: alt, targetSpd };
  }

  private isFinished(ac: Aircraft): boolean {
    const last = ac.route[ac.route.length - 1];
    const fix = FIX_MAP.get(last.fix)!;
    const d = distanceNm(ac.x, ac.y, fix.x, fix.y);
    if (ac.phase === "arrival") return ac.routeIdx === ac.route.length - 1 && d < 1.0 && ac.alt < 3500;
    if (ac.routeIdx === ac.route.length - 1 && d < 1.5) return true;
    return distanceNm(ac.x, ac.y, 0, 0) > SCOPE_RADIUS_NM + 8;
  }

  private spawnTraffic(dt: number): void {
    for (const phase of ["arrival", "departure", "overflight"] as Phase[]) {
      this.nextSpawn[phase] -= dt;
      if (this.nextSpawn[phase] > 0) continue;
      this.nextSpawn[phase] = this.rng.exp(this.interval(phase));
      if (this.aircraft.length >= MAX_AIRCRAFT) continue;
      const ac = spawn(this.nextId++, phase, this.rng, this.t);
      // Tower spaces successive departures; the adjacent sector never hands off traffic already about to lose separation.
      const runwayBusy = phase === "departure" && this.aircraft.some((o) => o.phase === "departure" && Math.hypot(o.x, o.y) < DEPARTURE_SPACING_NM);
      if (runwayBusy || predictConflicts([...this.aircraft, ac], SPAWN_CLEAR_S).some((c) => c.a === ac.id || c.b === ac.id)) {
        this.nextSpawn[phase] = Math.min(this.nextSpawn[phase], 10);
        continue;
      }
      this.aircraft.push(ac);
    }
  }

  private detectViolations(): void {
    const now = new Set<string>();
    for (let i = 0; i < this.aircraft.length; i++) {
      for (let j = i + 1; j < this.aircraft.length; j++) {
        const a = this.aircraft[i];
        const b = this.aircraft[j];
        if (!inViolation(a, b)) continue;
        const key = pairKey(a.id, b.id);
        now.add(key);
        if (!this.violating.has(key)) {
          this.losses++;
          this.log({ callsign: a.callsign, text: `LOSS OF SEPARATION with ${b.callsign}`, source: "sim", kind: "los" });
        }
        const close = distanceNm(a.x, a.y, b.x, b.y) < NEAR_MISS_NM && Math.abs(a.alt - b.alt) < NEAR_MISS_FT;
        if (close && !this.nearMissed.has(key)) {
          this.nearMissed.add(key);
          this.nearMisses++;
          this.log({ callsign: a.callsign, text: `NEAR MISS with ${b.callsign}`, source: "sim", kind: "near" });
        }
      }
    }
    for (const key of this.nearMissed) if (!now.has(key)) this.nearMissed.delete(key);
    this.violating = now;
  }
}

export function describe(instruction: Instruction, ac: Aircraft): string {
  switch (instruction) {
    case "maintain":
      return "maintain";
    case "turn_left_20":
    case "turn_left_45":
      return `turn left heading ${String(Math.round(ac.vectorHdg ?? ac.hdg)).padStart(3, "0")}`;
    case "turn_right_20":
    case "turn_right_45":
      return `turn right heading ${String(Math.round(ac.vectorHdg ?? ac.hdg)).padStart(3, "0")}`;
    case "climb_1000":
      return `climb and maintain ${ac.targetAlt}`;
    case "descend_1000":
      return `descend and maintain ${ac.targetAlt}`;
    case "speed_minus_30":
      return `reduce speed ${ac.targetSpd} kt`;
    case "speed_plus_30":
      return `increase speed ${ac.targetSpd} kt`;
    case "direct_to_next_fix":
      return `resume own navigation, direct ${ac.route[ac.routeIdx]?.fix ?? "fix"}`;
  }
}
