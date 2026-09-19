import type { Aircraft, Fix, Phase, RouteLeg } from "./types.ts";
import { APPROACH_FLOOR_FT, MSA_FT } from "./types.ts";
import type { Rng } from "./rng.ts";
import { bearingTo, distanceNm } from "./kinematics.ts";

const ring = (name: string, bearingDeg: number, r = 46): Fix => ({
  name,
  x: Math.sin((bearingDeg * Math.PI) / 180) * r,
  y: Math.cos((bearingDeg * Math.PI) / 180) * r,
});

/** Runway 27: aircraft land heading 270, so final approach lies east of the field. */
export const FIXES: Fix[] = [
  ring("BAYLO", 0),
  ring("KEMPT", 60),
  ring("RUDOX", 120),
  ring("SIMBA", 180),
  ring("TULOK", 240),
  ring("WEXLA", 300),
  { name: "NORIF", x: 14, y: 9 },
  { name: "SOUIF", x: 14, y: -9 },
  { name: "FINAL", x: 9, y: 0 },
  { name: "RW27", x: 0, y: 0 },
  { name: "DEPNW", x: -9, y: 7 },
  { name: "DEPSW", x: -9, y: -7 },
];

export const FIX_MAP = new Map(FIXES.map((f) => [f.name, f]));
export const RING_FIXES = FIXES.slice(0, 6);

const AIRLINES = ["DAL", "UAL", "AAL", "SWA", "JBU", "ASA", "FDX", "UPS", "NKS", "FFT", "SKW", "RPA"];

export function callsign(rng: Rng): string {
  return `${rng.pick(AIRLINES)}${rng.int(10, 999)}`;
}

export function routeFor(phase: Phase, rng: Rng): RouteLeg[] {
  if (phase === "arrival") {
    const entry = rng.pick(RING_FIXES.filter((f) => f.name !== "TULOK" && f.name !== "WEXLA"));
    const iaf = entry.y >= 0 ? "NORIF" : "SOUIF";
    const cruise = rng.int(10, 13) * 1000;
    return [
      { fix: entry.name, alt: cruise, spd: 280 },
      { fix: iaf, alt: 7000, spd: 250 },
      { fix: "FINAL", alt: 4000, spd: 210 },
      { fix: "RW27", alt: 2000, spd: 170 },
    ];
  }
  if (phase === "departure") {
    const exit = rng.pick(RING_FIXES);
    const turn = exit.y >= 0 ? "DEPNW" : "DEPSW";
    const cruise = rng.int(8, 13) * 1000;
    return [
      { fix: turn, alt: 6000, spd: 250 },
      { fix: exit.name, alt: cruise, spd: 300 },
    ];
  }
  const from = rng.pick(RING_FIXES);
  const candidates = RING_FIXES.filter((f) => distanceNm(f.x, f.y, from.x, from.y) > 60);
  const to = rng.pick(candidates);
  const alt = rng.int(8, 13) * 1000;
  return [
    { fix: from.name, alt, spd: 320 },
    { fix: to.name, alt, spd: 320 },
  ];
}

function legLength(route: RouteLeg[], i: number, start: { x: number; y: number }, startIdx = 0): number {
  const a = i === startIdx ? start : FIX_MAP.get(route[i - 1].fix)!;
  const b = FIX_MAP.get(route[i].fix)!;
  return distanceNm(a.x, a.y, b.x, b.y);
}

/** Time to fly the remaining route at each leg's profile speed, with no vectors. */
export function baselineSeconds(route: RouteLeg[], fromIdx: number, start: { x: number; y: number }): number {
  let t = 0;
  for (let i = fromIdx; i < route.length; i++) {
    t += (legLength(route, i, start, fromIdx) / route[i].spd) * 3600;
  }
  return t;
}

export function spawnPoint(phase: Phase, route: RouteLeg[]): { x: number; y: number } {
  if (phase === "departure") return { x: -1, y: 0 };
  const f = FIX_MAP.get(route[0].fix)!;
  return { x: f.x, y: f.y };
}

/**
 * Creates an aircraft at `progress` (0..1) along its route so the scope is populated at t=0.
 * progress 0 = at the spawn point.
 */
export function spawn(id: number, phase: Phase, rng: Rng, now: number, progress = 0): Aircraft {
  const route = routeFor(phase, rng);
  const start = spawnPoint(phase, route);
  const lens = route.map((_, i) => legLength(route, i, start));
  const total = lens.reduce((a, b) => a + b, 0);
  let remaining = Math.min(progress, 0.85) * total;
  let idx = 0;
  let px = start.x;
  let py = start.y;
  let prevAlt = phase === "departure" ? 1500 : route[0].alt;
  let prevSpd = phase === "departure" ? 190 : route[0].spd;
  let alt = prevAlt;
  let spd = prevSpd;
  while (idx < route.length) {
    const leg = route[idx];
    const f = FIX_MAP.get(leg.fix)!;
    if (remaining <= lens[idx]) {
      const frac = lens[idx] === 0 ? 0 : remaining / lens[idx];
      px = px + (f.x - px) * frac;
      py = py + (f.y - py) * frac;
      alt = prevAlt + (leg.alt - prevAlt) * frac;
      spd = prevSpd + (leg.spd - prevSpd) * frac;
      break;
    }
    remaining -= lens[idx];
    px = f.x;
    py = f.y;
    prevAlt = leg.alt;
    prevSpd = leg.spd;
    idx++;
  }
  // Arrivals and overflights start on their first fix, so their first leg to fly is the second one.
  if (phase !== "departure" && idx === 0) idx = 1;
  const target = FIX_MAP.get(route[Math.min(idx, route.length - 1)].fix)!;
  const hdg = phase === "departure" && idx === 0 ? 270 : bearingTo(px, py, target.x, target.y);
  const leg = route[Math.min(idx, route.length - 1)];
  return {
    id,
    callsign: callsign(rng),
    phase,
    x: px,
    y: py,
    alt: Math.round(alt / 100) * 100,
    hdg,
    spd: Math.round(spd),
    targetAlt: leg.alt,
    targetSpd: leg.spd,
    vectorHdg: null,
    assignedAlt: null,
    assignedSpd: null,
    vectorSince: 0,
    route,
    routeIdx: idx,
    instruction: "maintain",
    instructionAt: -1000,
    spawnedAt: now,
    baselineTime: baselineSeconds(route, idx, { x: px, y: py }),
    haloUntil: 0,
    urgency: 0,
    handoff: 0,
  };
}

/** Lowest altitude an aircraft may be cleared to at its position. */
export function altitudeFloor(ac: Aircraft): number {
  const nearField = distanceNm(ac.x, ac.y, 0, 0) < 12;
  if (ac.phase === "arrival" && nearField) return APPROACH_FLOOR_FT;
  if (ac.phase === "departure" && nearField) return APPROACH_FLOOR_FT;
  return MSA_FT;
}

export function speedLimits(ac: Aircraft): { min: number; max: number } {
  if (ac.phase === "arrival") return { min: 160, max: 300 };
  if (ac.phase === "departure") return { min: 180, max: 320 };
  return { min: 250, max: 350 };
}
