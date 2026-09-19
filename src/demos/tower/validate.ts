import type { Aircraft, Fix, Instruction } from "./types.ts";
import { CEILING_FT, FINAL_LOCK_NM, HORIZON_S, INSTRUCTIONS, INSTRUCTION_COOLDOWN_S } from "./types.ts";
import { conflictsFor, pairKey, trackOf } from "./conflict.ts";
import { desiredHeading, norm360 } from "./kinematics.ts";
import { altitudeFloor, speedLimits } from "./world.ts";

export type Rejection =
  | "cooldown"
  | "below_floor"
  | "above_ceiling"
  | "too_slow"
  | "too_fast"
  | "creates_conflict"
  | "worsens_conflict"
  | "already_on_route"
  | "no_route"
  | "established_on_final"
  | "no_gain";

export interface Validation {
  ok: boolean;
  reason?: Rejection;
}

export const VECTOR_HOLD_S = 120;
/** An instruction may not bring an existing predicted loss of separation closer by more than this. */
const WORSEN_TOLERANCE_S = 5;

export function establishedOnFinal(ac: Aircraft): boolean {
  return ac.phase === "arrival" && ac.routeIdx === ac.route.length - 1 && Math.hypot(ac.x, ac.y) < FINAL_LOCK_NM;
}

/** Applies an instruction to an aircraft, returning the new state. Pure; assumes the instruction was validated. */
export function applyInstruction(ac: Aircraft, instruction: Instruction, now: number, fixes: Map<string, Fix>): Aircraft {
  const base = desiredHeading(ac, fixes);
  const next = { ...ac, instruction, instructionAt: now };
  const vector = (delta: number) => ({ ...next, vectorHdg: norm360(base + delta), vectorSince: now });
  switch (instruction) {
    case "maintain":
      return { ...ac, instruction };
    case "turn_left_20":
      return vector(-20);
    case "turn_right_20":
      return vector(20);
    case "turn_left_45":
      return vector(-45);
    case "turn_right_45":
      return vector(45);
    case "climb_1000": {
      const alt = Math.round(ac.alt / 1000) * 1000 + 1000;
      return { ...next, assignedAlt: alt, targetAlt: alt, vectorSince: now };
    }
    case "descend_1000": {
      const alt = Math.round(ac.alt / 1000) * 1000 - 1000;
      return { ...next, assignedAlt: alt, targetAlt: alt, vectorSince: now };
    }
    case "speed_minus_30":
      return { ...next, assignedSpd: ac.targetSpd - 30, targetSpd: ac.targetSpd - 30 };
    case "speed_plus_30":
      return { ...next, assignedSpd: ac.targetSpd + 30, targetSpd: ac.targetSpd + 30 };
    case "direct_to_next_fix": {
      const leg = ac.route[ac.routeIdx];
      return {
        ...next,
        vectorHdg: null,
        assignedAlt: null,
        assignedSpd: null,
        targetAlt: leg ? leg.alt : ac.targetAlt,
        targetSpd: leg ? leg.spd : ac.targetSpd,
      };
    }
  }
}

/**
 * Checks one instruction against hard constraints. `others` is all other traffic.
 * "maintain" is always valid. Anything else must respect the per-aircraft cooldown, the altitude
 * floor/ceiling, speed limits, must not create a conflict with an aircraft that is not already in conflict, and must
 * not bring an existing predicted loss materially closer.
 */
export function validateInstruction(
  ac: Aircraft,
  instruction: Instruction,
  others: readonly Aircraft[],
  now: number,
  fixes: Map<string, Fix>,
): Validation {
  if (instruction === "maintain") return { ok: true };
  if (now - ac.instructionAt < INSTRUCTION_COOLDOWN_S) return { ok: false, reason: "cooldown" };
  if (establishedOnFinal(ac) && !instruction.startsWith("speed") && instruction !== "direct_to_next_fix") {
    // Only a breakout (climb or turn) is allowed on final, and only when the approach is in conflict.
    if (instruction === "descend_1000" || conflictsFor(trackOf(ac), others).length === 0) return { ok: false, reason: "established_on_final" };
  }
  const limits = speedLimits(ac);
  switch (instruction) {
    case "descend_1000":
      if (Math.round(ac.alt / 1000) * 1000 - 1000 < altitudeFloor(ac)) return { ok: false, reason: "below_floor" };
      break;
    case "climb_1000":
      if (Math.round(ac.alt / 1000) * 1000 + 1000 > CEILING_FT) return { ok: false, reason: "above_ceiling" };
      break;
    case "speed_minus_30":
      if (ac.targetSpd - 30 < limits.min) return { ok: false, reason: "too_slow" };
      break;
    case "speed_plus_30":
      if (ac.targetSpd + 30 > limits.max) return { ok: false, reason: "too_fast" };
      break;
    case "direct_to_next_fix":
      if (!ac.route[ac.routeIdx]) return { ok: false, reason: "no_route" };
      if (ac.vectorHdg === null && ac.assignedAlt === null) return { ok: false, reason: "already_on_route" };
      break;
  }
  const before = new Map(conflictsFor(trackOf(ac), others).map((c) => [pairKey(c.a, c.b), c.tLoss]));
  for (const [p, horizon] of projections(ac, instruction, now, fixes)) {
    for (const c of conflictsFor(trackOf(p), others, horizon)) {
      const was = before.get(pairKey(c.a, c.b));
      if (was === undefined) return { ok: false, reason: "creates_conflict" };
      if (c.tLoss < was - WORSEN_TOLERANCE_S) return { ok: false, reason: "worsens_conflict" };
    }
  }
  return { ok: true };
}

/** Projects the aircraft as if the instruction were already established (on the new heading/speed, trending to the new altitude). */
export function projected(ac: Aircraft, instruction: Instruction, now: number, fixes: Map<string, Fix>): Aircraft {
  const after = applyInstruction(ac, instruction, now, fixes);
  const hdg = after.vectorHdg ?? (instruction === "direct_to_next_fix" ? desiredHeading(after, fixes) : ac.hdg);
  return { ...after, hdg, spd: after.targetSpd };
}

/** Seconds over which the transitional projection (turn or speed change not yet effective) is checked. */
const TRANSITION_S = 15;

/**
 * The established projection over the full horizon, plus the transitional one over the next few seconds: still on
 * the current heading and speed while the turn or speed change gets going, but already trending to the new altitude.
 * A vertical change that only stays clear once the turn is complete must not pass validation.
 */
function projections(ac: Aircraft, instruction: Instruction, now: number, fixes: Map<string, Fix>): [Aircraft, number][] {
  const established = projected(ac, instruction, now, fixes);
  return [
    [established, HORIZON_S],
    [{ ...established, hdg: ac.hdg, spd: ac.spd }, TRANSITION_S],
  ];
}

/** True when the instruction removes the conflict with `otherId`, or pushes its loss of separation at least `gainS` further out. */
export function resolves(ac: Aircraft, instruction: Instruction, otherId: number, others: readonly Aircraft[], now: number, fixes: Map<string, Fix>, gainS = 20): boolean {
  const before = conflictsFor(trackOf(ac), others).find((c) => c.a === otherId || c.b === otherId);
  if (!before) return true;
  const after = projections(ac, instruction, now, fixes)
    .flatMap(([p, horizon]) => conflictsFor(trackOf(p), others, horizon))
    .filter((c) => c.a === otherId || c.b === otherId)
    .sort((x, y) => x.tLoss - y.tLoss)[0];
  return !after || after.tLoss >= before.tLoss + gainS;
}

export interface Selection {
  instruction: Instruction;
  fellBack: boolean;
  rejected: Partial<Record<Instruction, Rejection>>;
}

/**
 * Picks the highest-probability instruction that validates. If nothing but "maintain" validates, returns
 * "maintain". `probabilities` may be partial; missing options count as 0.
 */
export function selectValidInstruction(
  probabilities: Partial<Record<Instruction, number>>,
  validate: (i: Instruction) => { ok: boolean; reason?: Rejection },
): Selection {
  const ranked = [...INSTRUCTIONS].sort((a, b) => (probabilities[b] ?? 0) - (probabilities[a] ?? 0));
  const rejected: Partial<Record<Instruction, Rejection>> = {};
  for (let i = 0; i < ranked.length; i++) {
    const v = validate(ranked[i]);
    if (v.ok) return { instruction: ranked[i], fellBack: i > 0, rejected };
    if (v.reason) rejected[ranked[i]] = v.reason;
  }
  return { instruction: "maintain", fellBack: true, rejected };
}
