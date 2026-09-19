export const INSTRUCTIONS = [
  "maintain",
  "turn_left_20",
  "turn_right_20",
  "turn_left_45",
  "turn_right_45",
  "climb_1000",
  "descend_1000",
  "speed_minus_30",
  "speed_plus_30",
  "direct_to_next_fix",
] as const;

export type Instruction = (typeof INSTRUCTIONS)[number];

export type Phase = "arrival" | "departure" | "overflight";

export type Mode = "rules" | "api" | "slow";

export interface Fix {
  name: string;
  x: number;
  y: number;
}

export interface RouteLeg {
  fix: string;
  alt: number;
  spd: number;
}

export interface Aircraft {
  id: number;
  callsign: string;
  phase: Phase;
  x: number;
  y: number;
  alt: number;
  hdg: number;
  spd: number;
  targetAlt: number;
  targetSpd: number;
  /** Heading assigned by a vector instruction; null = follow the route. */
  vectorHdg: number | null;
  /** Altitude assigned by climb/descend; null = follow the route profile. */
  assignedAlt: number | null;
  /** Speed assigned by a speed instruction; null = follow the route profile. */
  assignedSpd: number | null;
  vectorSince: number;
  route: RouteLeg[];
  routeIdx: number;
  instruction: Instruction;
  instructionAt: number;
  spawnedAt: number;
  baselineTime: number;
  haloUntil: number;
  urgency: number;
  handoff: number;
}

export interface Conflict {
  a: number;
  b: number;
  /** Seconds until the pair first violates 3 NM / 1000 ft. */
  tLoss: number;
  tCpa: number;
  cpaNm: number;
  altDiffAtCpa: number;
  distNow: number;
}

export interface Decision {
  id: number;
  instruction: Instruction;
  requested: Instruction;
  probabilities: Partial<Record<Instruction, number>>;
  urgency: number;
  handoff: number;
  source: Mode;
  latencyMs: number;
  fellBack: boolean;
}

export const SEPARATION_NM = 3;
export const SEPARATION_FT = 1000;
/** Controllers plan for more than the bare minimum: a pair is a predicted conflict inside this lateral buffer. */
export const PLANNING_MARGIN_NM = 0.5;
export const HORIZON_S = 120;
export const INSTRUCTION_COOLDOWN_S = 20;
export const MSA_FT = 3000;
export const APPROACH_FLOOR_FT = 1500;
export const CEILING_FT = 18000;
export const SCOPE_RADIUS_NM = 50;
export const TOWER_RADIUS_NM = 6;
/** Arrivals hold cruise until this far from the fix that carries the lower altitude. */
export const ARRIVAL_TOD_NM = 25;
export const TOWER_ALT_FT = 3000;
/** Arrivals inside this distance on the final leg are established and take no radar instructions. */
export const FINAL_LOCK_NM = 10;
