import type { Aircraft, Conflict } from "./types.ts";
import { ARRIVAL_TOD_NM, HORIZON_S, PLANNING_MARGIN_NM, SEPARATION_FT, SEPARATION_NM, TOWER_ALT_FT, TOWER_RADIUS_NM } from "./types.ts";
import { DESCENT_FPS, distanceNm, velocity, verticalRate } from "./kinematics.ts";
import { FIX_MAP } from "./world.ts";

export interface Track {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  alt: number;
  vz: number;
  targetAlt: number;
  /** Seconds from now until the vertical rate starts (a planned top-of-descent); 0 = already climbing/descending. */
  vzStart: number;
}

export function trackOf(ac: Aircraft): Track {
  const { vx, vy } = velocity(ac.hdg, ac.spd);
  const base: Track = { id: ac.id, x: ac.x, y: ac.y, vx, vy, alt: ac.alt, vz: verticalRate(ac.alt, ac.targetAlt), targetAlt: ac.targetAlt, vzStart: 0 };
  if (base.vz !== 0 || ac.assignedAlt !== null || ac.phase !== "arrival" || ac.vectorHdg !== null) return base;
  // Arrivals on profile will start down at the next top of descent, possibly on a later leg; predict that
  // instead of assuming level flight. Descent to a leg's altitude begins once the aircraft is past the previous
  // fix and within ARRIVAL_TOD_NM of the leg's fix.
  let along = 0;
  let px = ac.x;
  let py = ac.y;
  for (let i = ac.routeIdx; i < ac.route.length; i++) {
    const leg = ac.route[i];
    const fix = FIX_MAP.get(leg.fix);
    if (!fix) return base;
    const toFix = along + distanceNm(px, py, fix.x, fix.y);
    if (leg.alt < ac.alt) {
      const todNm = Math.max(along, toFix - ARRIVAL_TOD_NM);
      return { ...base, vz: -DESCENT_FPS, targetAlt: leg.alt, vzStart: (todNm / Math.max(ac.spd, 1)) * 3600 };
    }
    along = toFix;
    px = fix.x;
    py = fix.y;
  }
  return base;
}

function altAt(t: Track, s: number): number {
  if (t.vz === 0 || s <= t.vzStart) return t.alt;
  const a = t.alt + t.vz * (s - t.vzStart);
  return t.vz > 0 ? Math.min(a, t.targetAlt) : Math.max(a, t.targetAlt);
}

/** Linear-extrapolation conflict check for one pair. Returns null when the pair stays separated (with the planning margin) over the horizon. */
export function predictPair(a: Track, b: Track, horizon = HORIZON_S, step = 1): Conflict | null {
  const px = b.x - a.x;
  const py = b.y - a.y;
  const vx = b.vx - a.vx;
  const vy = b.vy - a.vy;
  const v2 = vx * vx + vy * vy;
  const tCpaRaw = v2 === 0 ? 0 : -(px * vx + py * vy) / v2;
  const tCpa = Math.max(0, Math.min(horizon, tCpaRaw));
  const cpaNm = Math.hypot(px + vx * tCpa, py + vy * tCpa);
  const distNow = Math.hypot(px, py);
  const limit = SEPARATION_NM + PLANNING_MARGIN_NM;
  if (cpaNm >= limit) return null;
  // Fine samples over the first seconds catch a violation that begins within one simulation tick.
  for (let s = 0; s <= horizon; s += s < 2 ? 0.5 : step) {
    const d = Math.hypot(px + vx * s, py + vy * s);
    if (d >= limit) continue;
    const dz = Math.abs(altAt(a, s) - altAt(b, s));
    if (dz < SEPARATION_FT) {
      return { a: a.id, b: b.id, tLoss: s, tCpa, cpaNm, altDiffAtCpa: Math.abs(altAt(a, tCpa) - altAt(b, tCpa)), distNow };
    }
  }
  return null;
}

/**
 * Aircraft on short final or just airborne are the tower's responsibility, not the radar controller's:
 * they are excluded from conflict prediction and separation accounting.
 */
export function inTowerAirspace(ac: Aircraft): boolean {
  return ac.alt < TOWER_ALT_FT && Math.hypot(ac.x, ac.y) < TOWER_RADIUS_NM;
}

export function predictConflicts(aircraft: readonly Aircraft[], horizon = HORIZON_S): Conflict[] {
  const radar = aircraft.filter((a) => !inTowerAirspace(a));
  const tracks = radar.map(trackOf);
  const out: Conflict[] = [];
  for (let i = 0; i < tracks.length; i++) {
    for (let j = i + 1; j < tracks.length; j++) {
      const c = predictPair(tracks[i], tracks[j], horizon);
      if (c) out.push(c);
    }
  }
  return out;
}

/** Conflicts for a single (possibly hypothetical) track against everyone else. */
export function conflictsFor(track: Track, others: readonly Aircraft[], horizon = HORIZON_S): Conflict[] {
  const out: Conflict[] = [];
  for (const o of others) {
    if (o.id === track.id || inTowerAirspace(o)) continue;
    const c = predictPair(track, trackOf(o), horizon);
    if (c) out.push(c);
  }
  return out;
}

/** True when the pair currently violates the separation standard. */
export function inViolation(a: Aircraft, b: Aircraft): boolean {
  if (inTowerAirspace(a) || inTowerAirspace(b)) return false;
  return Math.hypot(a.x - b.x, a.y - b.y) < SEPARATION_NM && Math.abs(a.alt - b.alt) < SEPARATION_FT;
}

export function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}
