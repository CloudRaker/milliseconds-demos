// What the controller asks decision-machine-1 about one aircraft.
//
// The Jev original sent one JSON state plus three free-text questions per aircraft (a0_instruction,
// a0_urgency, a0_handoff) in one request. decision-machine-1 has no instructions field, so the same three
// judgements become three batched routes over one flattened sentence per aircraft:
//
//   choice (10 instructions) -> POST /classify { texts, labels }    which KIND of resolution
//   score  (4 levels)        -> POST /rate     { texts, scale }     how urgent
//   noul   (ready to go)     -> POST /yes-no   { texts, statement } clear for handoff
//
// Two things the Jev question asked for are arithmetic, not judgement, and the classifier is measurably
// bad at both when they are folded into ten labels: which side to turn, and whether to climb or descend.
// `expand()` below derives those from the same geometry rules.ts already uses, and /rate picks the size of
// the turn. What stays with the model is the call a controller actually makes: turn, level off, slow down,
// leave it, or send it home. Tuned against the rule policy over 32 real sim states (see eval.mjs history):
// 5 well-separated labels score 15/32 exact with the right kind always inside the top three, where ten
// action labels scored 4/32 and collapsed onto one answer.
//
// Two wording rules came out of that tuning and are worth keeping:
//   - Label descriptions must echo the words the text actually uses. Abstract restatements lose.
//   - They must be about the same length, and must not describe a situation by negating it. A longer
//     description wins on length alone, and "no conflict is listed" attracts texts that list a conflict.
import type { Aircraft, Conflict, Fix, Instruction } from "./types.ts";
import { INSTRUCTIONS } from "./types.ts";
import { geometry, mustYield } from "./rules.ts";
import { distanceNm } from "./kinematics.ts";
import { altitudeFloor } from "./world.ts";
import { validateInstruction, type Rejection } from "./validate.ts";

export const KINDS = ["none", "vector", "level", "spacing", "resume"] as const;
export type Kind = (typeof KINDS)[number];

/** /classify labels: the kind of resolution, described in the words the texts use. */
export const LABELS: Record<Kind, string> = {
  none: "The traffic has priority and is already turning, climbing or descending away.",
  vector: "The traffic crosses from the left or from the right, or it is head-on.",
  level: "The traffic is co-altitude and level with this aircraft, or just above or below it.",
  spacing: "The traffic is same direction, intruder ahead, in trail on the same track.",
  resume: "This aircraft is off route on an old vector and needs its own navigation.",
};

/** /rate scale, low urgency to high. Level 0..3 colours the halo and sizes the turn. */
export const URGENCY_SCALE = [
  "Separation holds for the next 120 seconds, or nothing is converging at all",
  "Separation is lost in 75 to 120 seconds, so it is worth watching but not acting",
  "Separation is lost in 30 to 75 seconds, so a clearance has to go out now",
  "Separation is lost in under 30 seconds, and the aircraft are already too close",
];

/** /yes-no statement plus hints, shared by every text in the batch. */
export const HANDOFF = {
  statement: "This aircraft is clear of all traffic and ready for the next controller.",
  when_true: "The text says nothing is converging with this aircraft for 120 seconds.",
  when_false: "The text gives the seconds at which separation with traffic is lost.",
};

/**
 * H goes on the data block above this probability, not above 0.5. On the tuning set every clear aircraft
 * came back at 0.99 and every aircraft in conflict at 0.79 or less, so this is the gap, not a fudge.
 */
export const HANDOFF_THRESHOLD = 0.9;

/**
 * Instruction slugs written as plain English. The slug strings are label names, so printing them raw inside
 * the text pulls /classify toward that label by wording alone; the first smoke run answered `maintain` for
 * every aircraft because "maintain" appeared in the text twice.
 */
const CLEARANCE: Record<Instruction, string> = {
  maintain: "flying its own route with no vector",
  turn_left_20: "on a 20 degree left vector",
  turn_right_20: "on a 20 degree right vector",
  turn_left_45: "on a 45 degree left vector",
  turn_right_45: "on a 45 degree right vector",
  climb_1000: "climbing 1000 ft",
  descend_1000: "descending 1000 ft",
  speed_minus_30: "slowed by 30 kt",
  speed_plus_30: "sped up by 30 kt",
  direct_to_next_fix: "back on its own navigation",
};

function words(n: number, unit: string): string {
  return `${Math.round(n)} ${unit}`;
}

function relativeAltitude(ac: Aircraft, o: Aircraft): string {
  const d = o.alt - ac.alt;
  const trend = o.targetAlt > o.alt + 50 ? " and climbing" : o.targetAlt < o.alt - 50 ? " and descending" : " and level";
  if (Math.abs(d) < 300) return `co-altitude${trend}`;
  return `${words(Math.abs(d), "ft")} ${d > 0 ? "above" : "below"}${trend}`;
}

function clock(bearingRel: number): string {
  const b = Math.abs(bearingRel);
  const side = bearingRel < 0 ? "left" : "right";
  if (b < 15) return "dead ahead";
  if (b < 70) return `ahead-${side}`;
  if (b < 110) return `off the ${side} wing`;
  if (b < 165) return `behind-${side}`;
  return "directly behind";
}

function describeGeometry(ac: Aircraft, o: Aircraft): string {
  const g = geometry(ac, o);
  if (g.headOn) return "head-on, converging";
  if (g.sameDirection) return g.ahead ? "same direction, intruder ahead (in-trail)" : "same direction, intruder behind";
  return `crossing from the ${g.bearingRel < 0 ? "left" : "right"}`;
}

export interface Intruder {
  callsign: string;
  phase: string;
  position: string;
  relative_altitude: string;
  geometry: string;
  closest_approach: string;
  separation_lost_in_s: number;
  their_current_instruction: string;
  they_have_priority: boolean;
}

export interface CandidateState {
  callsign: string;
  phase: string;
  altitude_ft: number;
  vertical: string;
  heading_deg: number;
  speed_kt: number;
  destination: string;
  current_instruction: string;
  altitude_floor_ft: number;
  intruders: Intruder[];
  unavailable_instructions: string[];
  situation: string;
}

/** Builds the per-aircraft state the original sent as JSON. Unchanged from the Jev experiment. */
export function candidateState(
  ac: Aircraft,
  conflicts: Conflict[],
  byId: Map<number, Aircraft>,
  now: number,
  fixes: Map<string, Fix>,
): CandidateState {
  const others = [...byId.values()].filter((o) => o.id !== ac.id);
  const mine = conflicts.filter((c) => c.a === ac.id || c.b === ac.id).sort((x, y) => x.tLoss - y.tLoss);
  const intruders: Intruder[] = mine.map((c) => {
    const o = byId.get(c.a === ac.id ? c.b : c.a)!;
    const g = geometry(ac, o);
    return {
      callsign: o.callsign,
      phase: o.phase,
      position: `${clock(g.bearingRel)}, ${c.distNow.toFixed(1)} NM`,
      relative_altitude: relativeAltitude(ac, o),
      geometry: describeGeometry(ac, o),
      closest_approach: `${c.cpaNm.toFixed(1)} NM in ${Math.round(c.tCpa)} s`,
      separation_lost_in_s: Math.round(c.tLoss),
      their_current_instruction: CLEARANCE[o.instruction],
      they_have_priority: mustYield(ac, o),
    };
  });
  const unavailable: string[] = [];
  for (const i of INSTRUCTIONS) {
    const v = validateInstruction(ac, i, others, now, fixes);
    if (!v.ok && v.reason !== "cooldown") unavailable.push(`${i} (${reasonText(v.reason)})`);
  }
  const leg = ac.route[ac.routeIdx];
  const fix = leg ? fixes.get(leg.fix) : undefined;
  const dest = leg && fix ? `${leg.fix}, ${words(distanceNm(ac.x, ac.y, fix.x, fix.y), "NM")} away` : "none";
  const vectored = ac.vectorHdg !== null || ac.assignedAlt !== null;
  const since = Math.round(now - ac.instructionAt);
  const situation =
    intruders.length === 0 && vectored
      ? `Vectored off route ${Math.round(now - ac.vectorSince)} s ago for traffic; now clear of all traffic and needs a clearance to resume navigation.`
      : intruders.length === 0
        ? "No predicted conflict in the next 120 s."
        : `${intruders.length} predicted conflict(s) in the next 120 s; the most urgent loses separation in ${Math.round(mine[0].tLoss)} s.`;
  return {
    callsign: ac.callsign,
    phase: ac.phase,
    altitude_ft: Math.round(ac.alt),
    vertical:
      ac.targetAlt > ac.alt + 50 ? `climbing to ${ac.targetAlt}` : ac.targetAlt < ac.alt - 50 ? `descending to ${ac.targetAlt}` : "level",
    heading_deg: Math.round(ac.hdg),
    speed_kt: Math.round(ac.spd),
    destination: dest,
    current_instruction: since > 900 || ac.instruction === "maintain" ? "" : ` It is ${CLEARANCE[ac.instruction]} since ${since} s ago.`,
    altitude_floor_ft: altitudeFloor(ac),
    intruders,
    unavailable_instructions: unavailable,
    situation,
  };
}

/**
 * One short paragraph per aircraft: the `texts` entry every route in the batch shares. Kept tight on purpose.
 * A long status report dilutes the two phrases the choice actually turns on — which side the traffic crosses
 * from, and whether it is level — and the model then answers from length alone (see smoke.mjs history).
 * The seconds to a loss of separation lead, because /rate reads the same string and the level turns on them.
 */
export function flatten(s: CandidateState): string {
  const own = ` This ${s.phase} is at ${s.altitude_ft} ft ${s.vertical}, cleared no lower than ${s.altitude_floor_ft} ft, heading ${String(s.heading_deg).padStart(3, "0")} at ${s.speed_kt} kt.${s.current_instruction}`;
  if (s.intruders.length === 0) return `Quiet: nothing is converging with this aircraft for the next 120 seconds.${own} ${s.situation}`;
  const lead = `Separation lost in ${s.intruders[0].separation_lost_in_s} seconds.`;
  const traffic = s.intruders.map(
    (i) =>
      ` Traffic ${i.geometry}, ${i.relative_altitude}, ${i.position}, closest approach ${i.closest_approach}; it ${i.they_have_priority ? "has priority and is " + i.their_current_instruction : "must give way"}.`,
  );
  return `${lead}${traffic.join("")}${own}`;
}

export function reasonText(r: Rejection | undefined): string {
  switch (r) {
    case "below_floor":
      return "would go below the altitude floor";
    case "above_ceiling":
      return "above the sector ceiling";
    case "too_slow":
      return "below minimum speed";
    case "too_fast":
      return "above maximum speed";
    case "creates_conflict":
      return "would turn or climb into other traffic";
    case "worsens_conflict":
      return "would bring the predicted loss of separation closer";
    case "already_on_route":
      return "already on route";
    case "established_on_final":
      return "established on final approach";
    case "no_gain":
      return "would not push the loss of separation out";
    default:
      return "not available";
  }
}

export interface ParsedAnswer {
  /** Ranked over all ten instructions, so validate.ts can walk down when the first pick is illegal. */
  probabilities: Partial<Record<Instruction, number>>;
  kind: Kind | null;
  choice: Instruction | null;
  confidence: number;
  urgency: number;
  handoff: number;
}

/**
 * Turns the five kind scores into a ranking over the ten instructions. The model says which kind; the size
 * of a turn comes from the /rate level, and the side of a turn and the direction of a level change come from
 * the same geometry the rule policy uses — those two are arithmetic, and folding them into the label set
 * measurably wrecked the classification.
 */
export function expand(
  scores: Partial<Record<Kind, number>>,
  urgency: number,
  ac: Aircraft,
  worst: Conflict | undefined,
  byId: Map<number, Aircraft>,
): Partial<Record<Instruction, number>> {
  const other = worst ? byId.get(worst.a === ac.id ? worst.b : worst.a) : undefined;
  const g = other ? geometry(ac, other) : undefined;
  const yields = other ? mustYield(ac, other) : false;
  const goDown = other ? (yields ? other.alt >= ac.alt : other.alt > ac.alt) : false;
  const right = g ? g.headOn || g.bearingRel < 0 : true;
  const hard = urgency >= 2;
  const inTrail = g ? g.sameDirection && g.ahead : true;

  // With nothing to separate from, a manoeuvre kind has no meaning: the only real answers are to leave the
  // aircraft alone or to take it off an old vector. The classifier does drift onto `level` for a quiet text.
  const s = (k: Kind) => (!other && k !== "none" && k !== "resume" ? 0 : (scores[k] ?? 0));
  const put = (out: Partial<Record<Instruction, number>>, i: Instruction, v: number) => {
    out[i] = Math.max(out[i] ?? 0, v);
  };
  const out: Partial<Record<Instruction, number>> = {};
  put(out, "maintain", s("none"));
  put(out, "direct_to_next_fix", s("resume"));
  put(out, goDown ? "descend_1000" : "climb_1000", s("level"));
  put(out, goDown ? "climb_1000" : "descend_1000", s("level") * 0.4);
  put(out, inTrail ? "speed_minus_30" : "speed_plus_30", s("spacing"));
  put(out, inTrail ? "speed_plus_30" : "speed_minus_30", s("spacing") * 0.3);
  const near = right ? "turn_right" : "turn_left";
  const away = right ? "turn_left" : "turn_right";
  put(out, `${near}_${hard ? 45 : 20}` as Instruction, s("vector"));
  put(out, `${near}_${hard ? 20 : 45}` as Instruction, s("vector") * 0.5);
  put(out, `${away}_${hard ? 45 : 20}` as Instruction, s("vector") * 0.2);
  put(out, `${away}_${hard ? 20 : 45}` as Instruction, s("vector") * 0.1);
  return out;
}

/** The top-ranked instruction, or null when nothing scored. */
export function topInstruction(p: Partial<Record<Instruction, number>>): Instruction | null {
  let best: Instruction | null = null;
  for (const i of INSTRUCTIONS) if ((p[i] ?? 0) > (best ? (p[best] ?? 0) : 0)) best = i;
  return best;
}

/** Rolling latency samples with percentiles. */
export class LatencyStats {
  private samples: number[] = [];
  private window: number;
  last = 0;
  count = 0;

  constructor(window = 200) {
    this.window = window;
  }

  push(ms: number): void {
    this.last = ms;
    this.count++;
    this.samples.push(ms);
    if (this.samples.length > this.window) this.samples.shift();
  }

  percentile(p: number): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
  }

  get p50(): number {
    return this.percentile(50);
  }

  get p95(): number {
    return this.percentile(95);
  }
}

/**
 * An answer is stale when a newer request for the same aircraft has already been consumed, or when the
 * simulation has moved on further than `maxAgeS` since the request was built.
 */
export function isStale(
  answerSeq: number,
  lastAppliedSeq: number | undefined,
  requestSimTime: number,
  nowSimTime: number,
  maxAgeS = 15,
): boolean {
  if (lastAppliedSeq !== undefined && answerSeq <= lastAppliedSeq) return true;
  return nowSimTime - requestSimTime > maxAgeS;
}
