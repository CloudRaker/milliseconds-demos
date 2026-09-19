import type { Aircraft, Conflict, Instruction, Phase } from "./types.ts";
import { bearingTo, turnDelta } from "./kinematics.ts";

const PRIORITY: Record<Phase, number> = { arrival: 3, departure: 2, overflight: 1 };

/** True when `ac` must give way to `other` in a conflict. Arrivals have priority; ties go to the lower id. */
export function mustYield(ac: Aircraft, other: Aircraft): boolean {
  const pa = PRIORITY[ac.phase];
  const pb = PRIORITY[other.phase];
  if (pa !== pb) return pa < pb;
  return ac.id > other.id;
}

/** Relative geometry words used by both the rule-based autopilot and the Jev state builder. */
export function geometry(ac: Aircraft, other: Aircraft): { bearingRel: number; sameDirection: boolean; ahead: boolean; headOn: boolean } {
  const brg = bearingTo(ac.x, ac.y, other.x, other.y);
  const bearingRel = turnDelta(ac.hdg, brg);
  const hdgDiff = Math.abs(turnDelta(ac.hdg, other.hdg));
  return { bearingRel, sameDirection: hdgDiff < 45, ahead: Math.abs(bearingRel) < 45, headOn: hdgDiff > 135 };
}

/**
 * Deterministic geometric avoidance. Ordered candidate list; the caller validates each and applies the first
 * that passes. Vertical first when the intruder is level with us and we have room, otherwise turn away from the
 * intruder, otherwise slow down when in trail.
 */
export function ruleCandidates(ac: Aircraft, conflicts: Conflict[], byId: Map<number, Aircraft>): Instruction[] {
  const mine = conflicts.filter((c) => c.a === ac.id || c.b === ac.id).sort((x, y) => x.tLoss - y.tLoss);
  if (mine.length === 0) {
    return ac.vectorHdg !== null || ac.assignedAlt !== null ? ["direct_to_next_fix", "maintain"] : ["maintain"];
  }
  const worst = mine[0];
  const other = byId.get(worst.a === ac.id ? worst.b : worst.a);
  if (!other) return ["maintain"];
  const yields = mustYield(ac, other);
  if (!yields && worst.tLoss >= 60) return ["maintain"];
  const g = geometry(ac, other);
  const out: Instruction[] = [];
  const urgentTurn = worst.tLoss < 45;
  // Co-altitude: the yielding aircraft goes down, the priority aircraft (acting only when urgent) goes up.
  const goDown = yields ? other.alt >= ac.alt : other.alt > ac.alt;
  if (g.sameDirection && g.ahead) {
    out.push("speed_minus_30");
    out.push(goDown ? "descend_1000" : "climb_1000");
  } else {
    out.push(goDown ? "descend_1000" : "climb_1000");
    out.push(goDown ? "climb_1000" : "descend_1000");
  }
  // Turn away from the intruder; head-on pass to the right.
  const turnRight = g.headOn || g.bearingRel < 0;
  if (urgentTurn) {
    out.push(turnRight ? "turn_right_45" : "turn_left_45", turnRight ? "turn_right_20" : "turn_left_20");
  } else {
    out.push(turnRight ? "turn_right_20" : "turn_left_20", turnRight ? "turn_right_45" : "turn_left_45");
  }
  out.push(turnRight ? "turn_left_45" : "turn_right_45", "speed_minus_30", "maintain");
  return [...new Set(out)];
}

/** Code-side urgency (0..3) used for display, mirroring the levels of the Jev Score question. */
export function urgencyFor(tLoss: number | null): number {
  if (tLoss === null) return 0;
  if (tLoss < 30) return 3;
  if (tLoss < 75) return 2;
  return 1;
}
