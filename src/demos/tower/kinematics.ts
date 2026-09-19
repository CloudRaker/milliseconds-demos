import type { Aircraft, Fix } from "./types.ts";

export const TURN_RATE_DPS = 3;
export const CLIMB_FPS = 30; // 1800 fpm
export const DESCENT_FPS = 25; // 1500 fpm
export const ACCEL_KTPS = 1.5;

export function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Signed shortest turn from `from` to `to`, in (-180, 180]. */
export function turnDelta(from: number, to: number): number {
  let d = norm360(to) - norm360(from);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function bearingTo(x: number, y: number, tx: number, ty: number): number {
  return norm360((Math.atan2(tx - x, ty - y) * 180) / Math.PI);
}

export function distanceNm(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/** Velocity in NM/s along x (east) and y (north). */
export function velocity(hdg: number, spdKt: number): { vx: number; vy: number } {
  const r = (hdg * Math.PI) / 180;
  const s = spdKt / 3600;
  return { vx: Math.sin(r) * s, vy: Math.cos(r) * s };
}

export function verticalRate(alt: number, targetAlt: number): number {
  if (Math.abs(targetAlt - alt) < 1) return 0;
  return targetAlt > alt ? CLIMB_FPS : -DESCENT_FPS;
}

function approach(value: number, target: number, maxStep: number): number {
  const d = target - value;
  if (Math.abs(d) <= maxStep) return target;
  return value + Math.sign(d) * maxStep;
}

/** Advances one aircraft by dt seconds toward its target heading/speed/altitude. Pure; returns a new object. */
export function integrate(ac: Aircraft, targetHdg: number, dt: number): Aircraft {
  const delta = turnDelta(ac.hdg, targetHdg);
  const hdg = norm360(ac.hdg + Math.sign(delta) * Math.min(Math.abs(delta), TURN_RATE_DPS * dt));
  const spd = approach(ac.spd, ac.targetSpd, ACCEL_KTPS * dt);
  const rate = verticalRate(ac.alt, ac.targetAlt);
  const alt = approach(ac.alt, ac.targetAlt, Math.abs(rate) * dt);
  const { vx, vy } = velocity(hdg, (ac.spd + spd) / 2);
  return { ...ac, hdg, spd, alt, x: ac.x + vx * dt, y: ac.y + vy * dt };
}

/** Heading the aircraft should fly: the assigned vector, or the bearing to its next fix. */
export function desiredHeading(ac: Aircraft, fixes: Map<string, Fix>): number {
  if (ac.vectorHdg !== null) return ac.vectorHdg;
  const leg = ac.route[ac.routeIdx];
  if (!leg) return ac.hdg;
  const fix = fixes.get(leg.fix);
  if (!fix) return ac.hdg;
  return bearingTo(ac.x, ac.y, fix.x, fix.y);
}
