// Deterministic arena: seeded RNG, physics, eating and respawns, plus the perception
// text every agent sends to the API. Ported from jev-swarm src/world.ts, perception.ts
// and the heuristic half of decide.ts; the seed-7 world below is the demo's fixture.

export const SEED = 7;
export const ARENA_W = 1600;
export const ARENA_H = 1000;
export const PELLET_COUNT = 140;
export const SPAWN_SIZE = 16;
export const MAX_SIZE = 64;
export const PELLET_MASS = 2.2;
export const EAT_RATIO = 1.15;
export const BOOST_DURATION = 1.5;
export const BOOST_COOLDOWN = 8;
export const BOOST_MULT = 1.9;
export const RESPAWN_DELAY = 2;
export const ENERGY_DRAIN = 0.02;
export const ENERGY_BOOST_DRAIN = 0.25;
export const SHRINK_RATE = 0.9;
export const SIZE_DECAY = 0.04;

export const DIRECTIONS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export type Move = Direction | "hold";

export const DIR_VEC: Record<Direction, { x: number; y: number }> = {
  N: { x: 0, y: -1 },
  NE: { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
  E: { x: 1, y: 0 },
  SE: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
  S: { x: 0, y: 1 },
  SW: { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
  W: { x: -1, y: 0 },
  NW: { x: -Math.SQRT1_2, y: -Math.SQRT1_2 },
};

export const PERSONALITIES = ["aggressive", "cautious", "greedy", "trickster"] as const;
export type Personality = (typeof PERSONALITIES)[number];
export type Controller = "dm1" | "heuristic" | "human";

export interface Decision {
  move: Move;
  boost: boolean;
  target: string | null;
  seq: number;
  source: "dm1" | "heuristic" | "human" | "none";
  confidence: number;
  at: number;
}

export interface Agent {
  id: string;
  personality: Personality;
  controller: Controller;
  x: number;
  y: number;
  size: number;
  energy: number;
  heading: Move;
  boostLeft: number;
  boostCooldown: number;
  alive: boolean;
  respawnIn: number;
  decision: Decision;
  seq: number;
  inFlight: number;
  lastRequestAt: number;
  kills: number;
  deaths: number;
  pellets: number;
  aliveTime: number;
  /** human control: steer to a point instead of a compass move */
  steerTo: { x: number; y: number } | null;
}

export interface Pellet {
  id: string;
  x: number;
  y: number;
}
export interface Stats {
  kills: number;
  deaths: number;
  pellets: number;
  aliveTime: number;
}
export type StatKey = Personality | "heuristic" | "human";

export type WorldEvent =
  | { kind: "eat"; eater: string; eaten: string; x: number; y: number; at: number }
  | { kind: "respawn"; id: string; x: number; y: number; at: number };

export interface World {
  seed: number;
  rng: () => number;
  time: number;
  agents: Agent[];
  pellets: Pellet[];
  stats: Record<StatKey, Stats>;
  nextPelletId: number;
  events: WorldEvent[];
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const NO_DECISION: Decision = { move: "hold", boost: false, target: null, seq: 0, source: "none", confidence: 0, at: 0 };

export function statKey(a: Agent): StatKey {
  if (a.controller === "human") return "human";
  if (a.controller === "heuristic") return "heuristic";
  return a.personality;
}
const emptyStats = (): Stats => ({ kills: 0, deaths: 0, pellets: 0, aliveTime: 0 });

export function createAgent(rng: () => number, index: number, controller: Controller, personality: Personality): Agent {
  return {
    id: controller === "human" ? "you" : `a${index.toString().padStart(2, "0")}`,
    personality,
    controller,
    x: 60 + rng() * (ARENA_W - 120),
    y: 60 + rng() * (ARENA_H - 120),
    size: SPAWN_SIZE + rng() * 10,
    energy: 0.7,
    heading: DIRECTIONS[Math.floor(rng() * 8)],
    boostLeft: 0,
    boostCooldown: 0,
    alive: true,
    respawnIn: 0,
    decision: NO_DECISION,
    seq: 0,
    inFlight: 0,
    lastRequestAt: -Infinity,
    kills: 0,
    deaths: 0,
    pellets: 0,
    aliveTime: 0,
    steerTo: null,
  };
}

export interface WorldOptions {
  seed: number;
  agentCount: number;
  /** "dm1" = every bot asks the API, "heuristic" = every bot runs code, "mixed" = alternate */
  policy: "dm1" | "heuristic" | "mixed";
  human: boolean;
}

export function createWorld(opts: WorldOptions): World {
  const rng = mulberry32(opts.seed);
  const agents: Agent[] = [];
  for (let i = 0; i < opts.agentCount; i++) {
    const controller: Controller =
      opts.policy === "dm1" ? "dm1" : opts.policy === "heuristic" ? "heuristic" : i % 2 === 0 ? "dm1" : "heuristic";
    const personality = PERSONALITIES[(opts.policy === "mixed" ? Math.floor(i / 2) : i) % PERSONALITIES.length];
    agents.push(createAgent(rng, i, controller, personality));
  }
  if (opts.human) {
    const h = createAgent(rng, 99, "human", "aggressive");
    h.x = ARENA_W / 2;
    h.y = ARENA_H / 2;
    h.size = SPAWN_SIZE + 6;
    agents.push(h);
  }
  const world: World = {
    seed: opts.seed,
    rng,
    time: 0,
    agents,
    pellets: [],
    stats: {
      aggressive: emptyStats(),
      cautious: emptyStats(),
      greedy: emptyStats(),
      trickster: emptyStats(),
      heuristic: emptyStats(),
      human: emptyStats(),
    },
    nextPelletId: 0,
    events: [],
  };
  for (let i = 0; i < PELLET_COUNT; i++) world.pellets.push(spawnPellet(world));
  return world;
}

export function spawnPellet(world: World): Pellet {
  const id = `p${world.nextPelletId++}`;
  return { id, x: 20 + world.rng() * (ARENA_W - 40), y: 20 + world.rng() * (ARENA_H - 40) };
}

/** Speed in px/s: bigger agents are slower. */
export function speedFor(size: number, boosting: boolean): number {
  const base = 260 * Math.pow(SPAWN_SIZE / size, 0.45);
  return boosting ? base * BOOST_MULT : base;
}
export const distance = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);
export const canEat = (eater: Agent, prey: Agent) => eater.size > prey.size * EAT_RATIO;

export function respawn(world: World, a: Agent): void {
  a.alive = true;
  a.respawnIn = 0;
  a.size = SPAWN_SIZE + world.rng() * 6;
  a.energy = 0.7;
  a.boostLeft = 0;
  a.boostCooldown = 0;
  a.heading = DIRECTIONS[Math.floor(world.rng() * 8)];
  a.decision = { ...NO_DECISION, seq: a.decision.seq };
  let best = { x: ARENA_W / 2, y: ARENA_H / 2, score: -Infinity };
  for (let i = 0; i < 12; i++) {
    const x = 60 + world.rng() * (ARENA_W - 120);
    const y = 60 + world.rng() * (ARENA_H - 120);
    let nearest = Infinity;
    for (const o of world.agents) {
      if (o === a || !o.alive) continue;
      nearest = Math.min(nearest, distance(x, y, o.x, o.y));
    }
    if (nearest > best.score) best = { x, y, score: nearest };
  }
  a.x = best.x;
  a.y = best.y;
  world.events.push({ kind: "respawn", id: a.id, x: a.x, y: a.y, at: world.time });
}

/** Advance the world by dt seconds. Pure physics; decisions are applied elsewhere. */
export function step(world: World, dt: number): void {
  world.time += dt;
  const { agents, pellets } = world;
  for (const a of agents) {
    if (!a.alive) {
      a.respawnIn -= dt;
      if (a.respawnIn <= 0) respawn(world, a);
      continue;
    }
    a.aliveTime += dt;
    world.stats[statKey(a)].aliveTime += dt;
    if (a.decision.boost && a.boostCooldown <= 0 && a.boostLeft <= 0 && a.energy > 0.15) {
      a.boostLeft = BOOST_DURATION;
      a.boostCooldown = BOOST_COOLDOWN;
      a.decision = { ...a.decision, boost: false };
    }
    const boosting = a.boostLeft > 0;
    a.boostLeft = Math.max(0, a.boostLeft - dt);
    a.boostCooldown = Math.max(0, a.boostCooldown - dt);
    a.energy = Math.max(0, a.energy - dt * (boosting ? ENERGY_BOOST_DRAIN : ENERGY_DRAIN));
    if (a.energy <= 0) a.size = Math.max(SPAWN_SIZE * 0.6, a.size - SHRINK_RATE * dt);
    if (a.size > SPAWN_SIZE) a.size -= (a.size - SPAWN_SIZE) * SIZE_DECAY * dt;

    const speed = speedFor(a.size, boosting);
    let vx = 0;
    let vy = 0;
    if (a.steerTo) {
      const dx = a.steerTo.x - a.x;
      const dy = a.steerTo.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d > 4) {
        const k = Math.min(1, d / 80);
        vx = (dx / d) * speed * k;
        vy = (dy / d) * speed * k;
      }
    } else if (a.heading !== "hold") {
      vx = DIR_VEC[a.heading].x * speed;
      vy = DIR_VEC[a.heading].y * speed;
    }
    a.x = Math.min(ARENA_W - a.size, Math.max(a.size, a.x + vx * dt));
    a.y = Math.min(ARENA_H - a.size, Math.max(a.size, a.y + vy * dt));
  }

  for (let i = 0; i < pellets.length; i++) {
    const p = pellets[i];
    for (const a of agents) {
      if (!a.alive) continue;
      if (distance(a.x, a.y, p.x, p.y) < a.size) {
        a.size = Math.min(MAX_SIZE, a.size + PELLET_MASS * (SPAWN_SIZE / a.size) * 1.4);
        a.energy = Math.min(1, a.energy + 0.12);
        a.pellets++;
        world.stats[statKey(a)].pellets++;
        pellets[i] = spawnPellet(world);
        break;
      }
    }
  }

  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < agents.length; j++) {
      const b = agents[j];
      if (!b.alive) continue;
      if (distance(a.x, a.y, b.x, b.y) > Math.max(a.size, b.size) * 0.9) continue;
      if (canEat(a, b)) eat(world, a, b);
      else if (canEat(b, a)) eat(world, b, a);
    }
  }
}

function eat(world: World, eater: Agent, prey: Agent): void {
  eater.size = Math.min(MAX_SIZE, Math.sqrt(eater.size * eater.size + prey.size * prey.size * 0.7));
  eater.energy = Math.min(1, eater.energy + 0.4);
  eater.kills++;
  prey.deaths++;
  world.stats[statKey(eater)].kills++;
  world.stats[statKey(prey)].deaths++;
  prey.alive = false;
  prey.respawnIn = RESPAWN_DELAY;
  prey.steerTo = null;
  world.events.push({ kind: "eat", eater: eater.id, eaten: prey.id, x: prey.x, y: prey.y, at: world.time });
  if (world.events.length > 60) world.events.splice(0, world.events.length - 60);
}

export function directionOf(dx: number, dy: number): Direction {
  const idx = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  const order: Direction[] = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
  return order[((idx % 8) + 8) % 8];
}
export const opposite = (d: Direction): Direction => DIRECTIONS[(DIRECTIONS.indexOf(d) + 4) % 8];
function angularSteps(a: Direction, b: Direction): number {
  const diff = Math.abs(DIRECTIONS.indexOf(a) - DIRECTIONS.indexOf(b));
  return Math.min(diff, 8 - diff);
}

/* ---------- perception: what one agent sees, as the text we send ---------- */

export const PERSONALITY_RULES: Record<Personality, string> = {
  aggressive: "hunts smaller agents relentlessly, accepts risk, spends boost to close on prey",
  cautious: "keeps far from anything bigger, prefers pellets in open space, spends boost only to escape",
  greedy: "maximizes pellet intake, tolerates moderate risk, goes for the closest pellets",
  trickster: "changes direction often, skirts close past bigger agents to pull them away, prefers unexpected moves",
};
export const RULES =
  "bigger agents eat smaller agents on contact (fatal); pellets add size; walls stop movement; boost = 1.5s speed burst, 8s cooldown, drains energy";

export type Relation = "bigger" | "smaller" | "similar";
export interface SeenAgent {
  id: string;
  rel: Relation;
  size: number;
  dist: number;
  dir: Direction;
  moving: string;
}
export interface SeenPellet {
  id: string;
  dist: number;
  dir: Direction;
}
export interface Perception {
  you: { id: string; personality: Personality; size: number; energy: string; boost: string; heading: string };
  nearby_agents: SeenAgent[];
  nearby_pellets: SeenPellet[];
  wall_dist: Record<"N" | "S" | "E" | "W", number>;
}

export const NEAREST_AGENTS = 6;
export const NEAREST_PELLETS = 5;

export function relationOf(me: Agent, other: Agent): Relation {
  if (canEat(other, me)) return "bigger";
  if (canEat(me, other)) return "smaller";
  return "similar";
}

export function buildPerception(world: World, me: Agent): Perception {
  const seen: SeenAgent[] = [];
  for (const o of world.agents) {
    if (o === me || !o.alive) continue;
    const dir = directionOf(o.x - me.x, o.y - me.y);
    let moving: string = o.heading === "hold" ? "still" : o.heading;
    if (o.steerTo) moving = directionOf(o.steerTo.x - o.x, o.steerTo.y - o.y);
    const approaching = moving !== "still" && moving === directionOf(me.x - o.x, me.y - o.y);
    seen.push({
      id: o.id,
      rel: relationOf(me, o),
      size: Math.round(o.size),
      dist: Math.round(distance(me.x, me.y, o.x, o.y)),
      dir,
      moving: approaching ? `${moving} (toward you)` : moving,
    });
  }
  seen.sort((a, b) => a.dist - b.dist);
  const pellets = world.pellets
    .map((p) => ({ id: p.id, dist: Math.round(distance(me.x, me.y, p.x, p.y)), dir: directionOf(p.x - me.x, p.y - me.y) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, NEAREST_PELLETS);
  return {
    you: {
      id: me.id,
      personality: me.personality,
      size: Math.round(me.size),
      energy: `${Math.round(me.energy * 100)}%`,
      boost: me.boostLeft > 0 ? "active" : me.boostCooldown > 0 ? `cooling down (${me.boostCooldown.toFixed(1)}s)` : "ready",
      heading: me.heading,
    },
    nearby_agents: seen.slice(0, NEAREST_AGENTS),
    nearby_pellets: pellets,
    wall_dist: { N: Math.round(me.y), S: Math.round(ARENA_H - me.y), E: Math.round(ARENA_W - me.x), W: Math.round(me.x) },
  };
}

/**
 * The scene as short English sentences. decision-machine-1 scores meaning, not tables:
 * a compass-and-pixels dump reads as noise to it, so code turns the measurements into
 * clauses and the model judges those. Every clause states what IS there, in the same
 * words the statements below use.
 */
export function sceneText(p: Perception, opts: { style?: boolean } = {}): string {
  const big = p.nearby_agents.find((a) => a.rel === "bigger");
  const prey = p.nearby_agents.find((a) => a.rel === "smaller");
  const food = p.nearby_pellets[0];
  const out: string[] = [];
  out.push(
    !big || big.dist >= FAR
      ? "You are the biggest thing in sight."
      : `${
          big.dist < CLOSE
            ? `A bigger agent is almost on you, to your ${big.dir}`
            : big.dist < MID
              ? `A bigger agent is closing on you from the ${big.dir}`
              : `A bigger agent prowls in the distance, to your ${big.dir}`
        }${big.moving.includes("toward") ? ", on your heading" : ""}.`,
  );
  out.push(
    !prey || prey.dist >= FAR
      ? "You see nothing small enough to swallow."
      : prey.dist < CLOSE
        ? `A smaller agent is within one lunge, to your ${prey.dir}.`
        : prey.dist < MID
          ? `A smaller agent is a short chase away, to your ${prey.dir}.`
          : `A smaller agent wanders far off, to your ${prey.dir}.`,
  );
  out.push(
    food
      ? `Food sits ${food.dist < CLOSE ? "at your mouth" : food.dist < MID ? "a few strides off" : "across the field"}, to your ${food.dir}.`
      : "No food is in sight.",
  );
  out.push(`Your boost is ${p.you.boost === "ready" ? "charged" : "spent"}.`);
  // Measured: the style line swamps every one of the three questions. Chase went to 0.95
  // with no prey in sight for an aggressive agent, and run went to 0.66 for a trickster
  // with nothing near but a distant prowler. No judgment gets the sentence; it stays in
  // the panel as the agent's colour, and the model judges the geometry it was told about.
  if (opts.style !== false) out.push(`Your style: ${PERSONALITY_RULES[p.you.personality]}.`);
  return out.join(" ");
}

/** Distance bands, in arena pixels, that the clauses above stand for. */
export const CLOSE = 90;
export const MID = 200;
export const FAR = 400;

/* ---------- the three judgments, as the request bodies we send ---------- */

export interface Judgment {
  key: "flee" | "chase" | "boost";
  statement: string;
  when_true: string;
  when_false: string;
  /** include the personality sentence in the scene sent for this judgment */
  style: boolean;
  /** what the original Jev experiment asked for, for the notes on the page */
  from: string;
}

export const JUDGMENTS: Judgment[] = [
  {
    key: "flee",
    statement: "This agent should break off and run.",
    when_true: "a bigger agent is closing on this one or almost on it",
    when_false: "this one is the biggest thing in sight, or the bigger agent only prowls in the distance",
    style: false,
    from: "move: which of nine directions, given what lies each way",
  },
  {
    key: "chase",
    statement: "A smaller agent is close enough to run down right now.",
    when_true: "the text puts a smaller agent within one lunge or a short chase away",
    when_false: "the text says nothing small enough to swallow is in sight, or the smaller agent wanders far off",
    style: false,
    from: "target: which listed entity to pursue now",
  },
  {
    key: "boost",
    statement: "Spending the speed burst on this scene is worth it.",
    when_true: "a bigger agent is almost on this one, or a smaller agent is within one lunge",
    when_false: "the other agents prowl in the distance or wander far off, or none is in sight",
    style: false,
    from: "boost: spend the burst now, yes or no",
  },
];

/**
 * Probability at which each judgment turns into an action, measured on the seed world
 * and on the probe scenes in smoke.mjs. Run tracks the distance band: 0.93 for a predator
 * at 40px, 0.83 at 120px, 0.60-0.61 for one that only prowls at 250px, 0.51 with no
 * threat at all, and the same answer for all four temperaments. 0.7 is the gap between
 * the two groups. Chase: 0.98 with prey within one lunge, 0.99 a short chase away, 0.29
 * far off, 0.47 with none in sight. Boost splits 0.88 at contact range against 0.23-0.28
 * on a quiet field.
 */
export const FLEE_THRESHOLD = 0.7;
export const CHASE_THRESHOLD = 0.6;
export const BOOST_THRESHOLD = 0.7;

/** The newest probability for each judgment, per agent. */
export interface Judgments {
  flee: number;
  chase: number;
  boost: number;
  /** ms timestamp of the newest applied answer */
  at: number;
}
export const NO_JUDGMENTS: Judgments = { flee: 0, chase: 0, boost: 0, at: 0 };

/* ---------- decisions made in code ---------- */


/** Pick a direction that is not pointed straight at a wall. */
export function avoidWalls(agent: Agent, d: Direction, arenaW = ARENA_W, arenaH = ARENA_H): Direction {
  const margin = agent.size + 40;
  const blocked = (dir: Direction) =>
    (dir.includes("N") && agent.y < margin) ||
    (dir.includes("S") && agent.y > arenaH - margin) ||
    (dir.includes("E") && agent.x > arenaW - margin) ||
    (dir.includes("W") && agent.x < margin);
  if (!blocked(d)) return d;
  const i = DIRECTIONS.indexOf(d);
  for (const off of [1, -1, 2, -2, 3, -3, 4]) {
    const c = DIRECTIONS[(i + off + 8) % 8];
    if (!blocked(c)) return c;
  }
  return d;
}

/** Greedy baseline: flee the nearest bigger agent, else chase prey, else the nearest pellet. */
export function heuristicDecision(world: World, me: Agent): Omit<Decision, "at"> {
  const { threat, threatD, prey, preyD, food } = neighbours(world, me);
  let move: Direction;
  let target: string | null = null;
  let boost = false;
  if (threat && threatD < 180) {
    move = opposite(directionOf(threat.x - me.x, threat.y - me.y));
    boost = threatD < 100;
  } else if (prey && preyD < 220) {
    move = directionOf(prey.x - me.x, prey.y - me.y);
    target = prey.id;
    boost = preyD < 120;
  } else if (food) {
    move = directionOf(food.x - me.x, food.y - me.y);
    target = food.id;
  } else {
    move = me.heading === "hold" ? "N" : (me.heading as Direction);
  }
  return { move: avoidWalls(me, move), boost, target, seq: me.seq, source: "heuristic", confidence: 1 };
}

export function applyDecision(agent: Agent, d: Omit<Decision, "at">, now: number): void {
  agent.decision = { ...d, at: now };
  agent.heading = d.move;
}

export interface ApplyResult {
  applied: boolean;
  reason: "ok" | "stale" | "dead";
}

/** The nearest bigger agent, the nearest smaller agent and the nearest pellet, with distances. */
export function neighbours(world: World, me: Agent) {
  let threat: Agent | null = null;
  let threatD = Infinity;
  let prey: Agent | null = null;
  let preyD = Infinity;
  for (const o of world.agents) {
    if (o === me || !o.alive) continue;
    const d = distance(me.x, me.y, o.x, o.y);
    if (canEat(o, me) && d < threatD) {
      threat = o;
      threatD = d;
    } else if (canEat(me, o) && d < preyD) {
      prey = o;
      preyD = d;
    }
  }
  let food: Pellet | null = null;
  let foodD = Infinity;
  for (const p of world.pellets) {
    const d = distance(me.x, me.y, p.x, p.y);
    if (d < foodD) {
      foodD = d;
      food = p;
    }
  }
  return { threat, threatD, prey, preyD, food, foodD };
}

/**
 * Turn the three probabilities into one decision. The model judges, the code does the
 * geometry: run from the threat, or run down the prey, or go and eat.
 */
export function composeDecision(world: World, me: Agent, j: Judgments): Omit<Decision, "at"> {
  const { threat, threatD, prey, preyD, food } = neighbours(world, me);
  // The scene text only names a threat or prey inside FAR; outside it the agent was told
  // "you are the biggest thing in sight" / "nothing small enough to swallow". Acting on
  // an agent the text never mentioned would make the panel contradict the wire.
  // Running is gated at MID, not FAR: the run statement is true for "closing on you" and
  // "almost on you" only, so a threat in the 200-400px prowler band is scenery, not a
  // reason to turn and run away from prey that is within one lunge.
  const seenThreat = threat && threatD < MID ? threat : null;
  const seenPrey = prey && preyD < FAR ? prey : null;
  let move: Direction;
  let target: string | null = null;
  let confidence: number;
  if (seenThreat && j.flee >= FLEE_THRESHOLD) {
    move = opposite(directionOf(seenThreat.x - me.x, seenThreat.y - me.y));
    confidence = j.flee;
  } else if (seenPrey && j.chase >= CHASE_THRESHOLD) {
    move = directionOf(seenPrey.x - me.x, seenPrey.y - me.y);
    target = seenPrey.id;
    confidence = j.chase;
  } else if (food) {
    move = directionOf(food.x - me.x, food.y - me.y);
    target = food.id;
    confidence = 1 - Math.max(j.flee, j.chase);
  } else {
    move = me.heading === "hold" ? "N" : (me.heading as Direction);
    confidence = 0;
  }
  // The boost question is only asked about what is at contact range, so only spend it there.
  const boostWorth = (seenThreat !== null && threatD < CLOSE) || (seenPrey !== null && preyD < CLOSE);
  return { move: avoidWalls(me, move), boost: boostWorth && j.boost >= BOOST_THRESHOLD, target, seq: me.seq, source: "dm1", confidence };
}

/** Apply fresh judgments. Answers older than the agent's newest decision are dropped. */
export function applyJudgments(world: World, agent: Agent, seq: number, j: Judgments, now: number): ApplyResult {
  if (seq < agent.decision.seq) return { applied: false, reason: "stale" };
  if (!agent.alive) return { applied: false, reason: "dead" };
  applyDecision(agent, { ...composeDecision(world, agent, j), seq }, now);
  return { applied: true, reason: "ok" };
}

/** Between decisions, keep the heading on the chosen target while it roughly agrees. */
export function refineHeading(world: World, me: Agent): void {
  const { target, move } = me.decision;
  if (!target || move === "hold") return;
  let tx: number;
  let ty: number;
  const a = world.agents.find((o) => o.id === target);
  if (a) {
    if (!a.alive || !canEat(me, a)) return;
    tx = a.x;
    ty = a.y;
  } else {
    const p = world.pellets.find((o) => o.id === target);
    if (!p) return;
    tx = p.x;
    ty = p.y;
  }
  const toTarget = directionOf(tx - me.x, ty - me.y);
  if (angularSteps(toTarget, move) <= 1) me.heading = toTarget;
}
