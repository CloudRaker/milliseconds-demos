// Seeded city, fleet and report stream, copied from the jev-dispatch experiment
// (rng.ts + city.ts + types.ts + generator.ts merged; logic unchanged).
// Seed 20260917 replays the same report stream on every load.

export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  range(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    range: (min, max) => min + next() * (max - min),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface Point {
  x: number;
  y: number;
}

export interface District {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Street grid spacing in metres; denser downtown, sparser in the outskirts. */
  blockSize: number;
  streets: string[];
  kind: "downtown" | "residential" | "industrial" | "waterfront" | "park";
}

export type UnitType = "ambulance" | "police" | "engine" | "ladder" | "utility";

export interface Depot {
  id: string;
  name: string;
  kind: "hospital" | "precinct" | "firehouse" | "yard";
  pos: Point;
}

export interface Unit {
  id: string;
  type: UnitType;
  depotId: string;
  home: Point;
  pos: Point;
  status: "idle" | "enroute" | "onscene" | "returning";
  incidentId: string | null;
  arrivedAt: number | null;
}

export interface City {
  width: number;
  height: number;
  districts: District[];
  depots: Depot[];
  river: Point[];
}

export const WORLD_W = 4000;
export const WORLD_H = 2800;

export const UNIT_SPEED: Record<UnitType, number> = {
  ambulance: 32,
  police: 34,
  engine: 26,
  ladder: 24,
  utility: 20,
};

const DISTRICT_DEFS: Omit<District, "x" | "y" | "w" | "h">[] = [
  { id: "NG", name: "Northgate", blockSize: 220, kind: "residential", streets: ["Aspen Rd", "Cedar Ln", "Elmwood Ave", "Foxglove Ct", "Heather Way", "Juniper St"] },
  { id: "MT", name: "Midtown", blockSize: 130, kind: "downtown", streets: ["Main St", "5th Ave", "7th Ave", "Union Sq", "Market St", "Grand Blvd", "Liberty Pl"] },
  { id: "IND", name: "Ironworks", blockSize: 300, kind: "industrial", streets: ["Foundry Rd", "Depot Ln", "Slag Ave", "Rail Yard Way", "Kiln St"] },
  { id: "RV", name: "Riverside", blockSize: 180, kind: "park", streets: ["Riverbank Dr", "Willow Path", "Boathouse Ln", "Meadow Ave", "Sycamore St"] },
  { id: "OT", name: "Old Town", blockSize: 110, kind: "downtown", streets: ["Birch St", "Cobble Ln", "Chapel St", "Harbor Rd", "Mill St", "Tannery Row"] },
  { id: "HB", name: "Harborfront", blockSize: 240, kind: "waterfront", streets: ["Pier 9", "Quay St", "Anchor Ave", "Ferry Rd", "Seawall Dr"] },
];

export function buildCity(): City {
  const cols = 3;
  const w = WORLD_W / cols;
  const h = WORLD_H / 2;
  const districts = DISTRICT_DEFS.map((d, i) => ({
    ...d,
    x: (i % cols) * w,
    y: Math.floor(i / cols) * h,
    w,
    h,
  }));
  const depots: Depot[] = [
    { id: "H1", name: "St. Anselm Hospital", kind: "hospital", pos: { x: 1900, y: 1200 } },
    { id: "H2", name: "Northgate Medical", kind: "hospital", pos: { x: 500, y: 500 } },
    { id: "H3", name: "Harbor Clinic", kind: "hospital", pos: { x: 3500, y: 2300 } },
    { id: "P1", name: "Precinct 1 (Midtown)", kind: "precinct", pos: { x: 2350, y: 700 } },
    { id: "P2", name: "Precinct 2 (Old Town)", kind: "precinct", pos: { x: 1500, y: 2200 } },
    { id: "P3", name: "Precinct 3 (Ironworks)", kind: "precinct", pos: { x: 3400, y: 450 } },
    { id: "F1", name: "Firehouse 1", kind: "firehouse", pos: { x: 1300, y: 900 } },
    { id: "F2", name: "Firehouse 2", kind: "firehouse", pos: { x: 2600, y: 2000 } },
    { id: "F3", name: "Firehouse 3", kind: "firehouse", pos: { x: 3000, y: 1100 } },
    { id: "F4", name: "Firehouse 4", kind: "firehouse", pos: { x: 600, y: 1800 } },
    { id: "U1", name: "Public Works Yard", kind: "yard", pos: { x: 3700, y: 1500 } },
  ];
  const river: Point[] = [
    { x: 0, y: 1500 },
    { x: 600, y: 1420 },
    { x: 1200, y: 1480 },
    { x: 1800, y: 1380 },
    { x: 2400, y: 1450 },
    { x: 3000, y: 1560 },
    { x: 3600, y: 1500 },
    { x: 4000, y: 1580 },
  ];
  return { width: WORLD_W, height: WORLD_H, districts, depots, river };
}

const FLEET: Record<Depot["kind"], Partial<Record<UnitType, number>>> = {
  hospital: { ambulance: 12 },
  precinct: { police: 12 },
  firehouse: { engine: 6, ladder: 2 },
  yard: { utility: 8 },
};

export function createFleet(city: City): Unit[] {
  const units: Unit[] = [];
  const counters: Record<UnitType, number> = { ambulance: 0, police: 0, engine: 0, ladder: 0, utility: 0 };
  const prefix: Record<UnitType, string> = { ambulance: "A", police: "P", engine: "E", ladder: "L", utility: "U" };
  for (const depot of city.depots) {
    const spec = FLEET[depot.kind];
    for (const type of Object.keys(spec) as UnitType[]) {
      for (let i = 0; i < (spec[type] ?? 0); i++) {
        counters[type]++;
        units.push({
          id: `${prefix[type]}${String(counters[type]).padStart(2, "0")}`,
          type,
          depotId: depot.id,
          home: { ...depot.pos },
          pos: { ...depot.pos },
          status: "idle",
          incidentId: null,
          arrivedAt: null,
        });
      }
    }
  }
  return units;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function districtAt(city: City, p: Point): District {
  return (
    city.districts.find((d) => p.x >= d.x && p.x < d.x + d.w && p.y >= d.y && p.y < d.y + d.h) ??
    city.districts[0]
  );
}


export const CATEGORIES = [
  "fire",
  "medical",
  "police",
  "traffic",
  "utility",
  "rescue",
  "non_emergency",
  "duplicate_update",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const PACKAGES = [
  "ambulance",
  "ambulance+fire",
  "police_1",
  "police_2+",
  "fire_engine",
  "fire_full",
  "utility_crew",
  "none",
] as const;
export type Package = (typeof PACKAGES)[number];

export const SEVERITY_LEVELS = [
  "Information only: nothing is happening that needs a response",
  "Minor: a nuisance or a small problem, no injuries and no immediate risk",
  "Moderate: possible minor injuries or property at risk, prompt response",
  "Serious: injuries likely or active danger to people, urgent response",
  "Immediate threat to life: someone may die in the next minutes without help",
] as const;
export type Severity = 0 | 1 | 2 | 3 | 4;

export const PACKAGE_UNITS: Record<Package, UnitType[]> = {
  ambulance: ["ambulance"],
  "ambulance+fire": ["ambulance", "engine"],
  police_1: ["police"],
  "police_2+": ["police", "police"],
  fire_engine: ["engine"],
  fire_full: ["engine", "engine", "ladder", "ambulance"],
  utility_crew: ["utility"],
  none: [],
};

export type Channel = "call" | "sms" | "sensor";

export interface Truth {
  category: Category;
  severity: Severity;
  units: Package;
  multipleVictims: boolean;
  hazmat: boolean;
  callerInDanger: boolean;
  /** Report id of the original incident this report is a follow-up to. */
  duplicateOf: string | null;
}

export interface Report {
  id: string;
  seq: number;
  /** Arrival time in simulation seconds. */
  t: number;
  channel: Channel;
  text: string;
  address: string;
  loc: Point;
  districtId: string;
  truth: Truth;
}

export interface OpenIncidentSummary {
  id: string;
  category: Category;
  summary: string;
  address: string;
  age_seconds: number;
  distance_m: number;
  units_dispatched: number;
}

interface Scenario {
  category: Category;
  severity: Severity;
  units: Package;
  multi?: boolean;
  hazmat?: boolean;
  callerDanger?: boolean;
  /** Districts this scenario is plausible in; empty = anywhere. */
  kinds?: District["kind"][];
  texts: string[];
  followups: string[];
  sensor?: string[];
  weight: number;
}

const SCENARIOS: Scenario[] = [
  {
    category: "fire", severity: 4, units: "fire_full", hazmat: true, multi: true, callerDanger: true, weight: 3,
    texts: [
      "There's a fire in the building at {addr}, flames coming out of the second floor windows, people still inside",
      "apartment fire {addr} smoke everywhere i'm on the 4th floor i can't get down the stairs",
      "Building on fire at {addr}. Heavy smoke. I think there are families on the upper floors.",
    ],
    followups: [
      "the fire on {street} is getting bigger, its spreading to the next building",
      "i see the smoke from {street}, is anyone coming?? big black smoke",
      "calling about the fire at {addr}, someone is waving from a window on the top floor",
    ],
    sensor: ["FIRE ALARM PANEL {addr}: multiple zones ACTIVE, sprinkler flow detected"],
  },
  {
    category: "fire", severity: 2, units: "fire_engine", weight: 3,
    texts: [
      "Dumpster on fire behind {addr}. Nobody hurt, just don't want it spreading to the fence.",
      "small fire in a trash can at {addr}, its out mostly but still smoking",
      "grill fire on a balcony at {addr}, they're throwing water on it, looks under control",
    ],
    followups: ["still smoke from the bin fire at {addr}", "hey the trash fire on {street} is still going"],
    sensor: ["SMOKE DETECTOR {addr} unit 3B: ALARM (single zone)"],
  },
  {
    category: "fire", severity: 3, units: "fire_engine", hazmat: true, weight: 2,
    texts: [
      "Strong gas smell in the hallway at {addr}, and I hear a hissing sound near the meter",
      "smells like gas really bad at {addr}, my eyes are burning, we went outside",
    ],
    followups: ["gas smell at {addr} is worse now, whole street smells", "re gas leak on {street} - neighbours evacuating"],
    sensor: ["GAS SENSOR {addr}: methane 22% LEL, rising"],
  },
  {
    category: "medical", severity: 4, units: "ambulance", weight: 4,
    texts: [
      "My husband collapsed, he's not breathing, {addr}, please hurry",
      "someone just collapsed at {addr}, unconscious, not responding, we're doing CPR",
      "man having a heart attack at {addr} he is grey and sweating and cant speak",
      "my dad cant breathe hes turning blue {addr} hurry",
    ],
    followups: ["still no ambulance at {addr}, he's still not breathing, where are you", "calling again re the man who collapsed at {addr}"],
  },
  {
    category: "medical", severity: 3, units: "ambulance", weight: 3,
    texts: [
      "Elderly woman fell down the stairs at {addr}, she's conscious but her leg is bent wrong and bleeding",
      "my roommate took a bunch of pills and is really drowsy and confused, {addr} apt 12",
      "kid had a seizure at {addr}, it stopped but she's not waking up properly",
      "guy cut his hand badly with a saw at {addr}, lots of blood, we're holding pressure",
    ],
    followups: ["the lady who fell at {addr} is in a lot of pain, how long", "update on {addr}: she's awake now but very confused"],
  },
  {
    category: "medical", severity: 1, units: "ambulance", weight: 2,
    texts: [
      "I twisted my ankle at {addr}, it's swollen, I can't really walk on it. Not urgent.",
      "my son has had a fever since yesterday and now a rash, {addr}, should someone check?",
      "nosebleed that won't stop for 20 min at {addr}, elderly man, otherwise ok",
    ],
    followups: ["re the ankle at {addr}, still waiting, no rush"],
  },
  {
    category: "police", severity: 4, units: "police_2+", multi: true, callerDanger: true, weight: 2,
    texts: [
      "there's a man with a gun in the store at {addr}, he's shouting, we're hiding in the back",
      "shots fired at {addr}, several shots, people running, I think someone is hit",
      "my ex is breaking down my door at {addr} he said he's going to kill me please please",
    ],
    followups: ["the guy with the gun at {addr} is still inside, police not here yet", "more shots on {street}, everyone is hiding"],
  },
  {
    category: "police", severity: 3, units: "police_2+", weight: 3,
    texts: [
      "big fight outside the bar at {addr}, like 8 guys, someone has a bottle",
      "Someone is breaking into the house next door at {addr}. I can see a flashlight inside. Owners are away.",
      "a man just snatched a woman's bag at {addr} and ran towards {street}, she's on the ground",
    ],
    followups: ["fight at {addr} still going, one guy is down", "the burglar at {addr} is still inside, car with no lights parked outside"],
  },
  {
    category: "police", severity: 1, units: "police_1", weight: 3,
    texts: [
      "My car was broken into overnight at {addr}. Window smashed, radio gone. Nobody around now.",
      "someone spray painted the wall of my shop at {addr} last night, want to report it",
      "there's a guy sleeping in the doorway of {addr}, he's been there for hours, not sure he's ok but he moved when I asked",
      "suspicious car has been parked outside {addr} for 2 days with someone sitting in it sometimes",
    ],
    followups: ["following up on the car break-in at {addr}, is an officer coming"],
  },
  {
    category: "traffic", severity: 4, units: "ambulance+fire", multi: true, hazmat: true, weight: 3,
    texts: [
      "Bad crash at {addr}, two cars, one is on its side and smoking, people trapped inside",
      "truck hit a bus at {addr}, lots of people hurt, there is fuel all over the road",
      "car crashed into a pole at {addr} and caught fire, driver still inside not moving",
    ],
    followups: [
      "the crash at {addr} - the car is fully on fire now",
      "im at the accident on {street}, there are at least 5 people hurt, one child",
      "re bus crash {street}, traffic completely stopped, injured people sitting on the kerb",
    ],
    sensor: ["VEHICLE TELEMATICS: severe impact detected, airbag deployed, {addr}, occupant unresponsive to callback"],
  },
  {
    category: "traffic", severity: 2, units: "police_1", weight: 3,
    texts: [
      "fender bender at {addr}, two cars, no one hurt but they are blocking the intersection and arguing",
      "car rear-ended me at {addr}, we're both fine, need a police report for insurance",
      "traffic light at {addr} is out, cars are just going through, nearly saw a crash",
    ],
    followups: ["the two cars at {addr} are still blocking the road, huge backup"],
  },
  {
    category: "traffic", severity: 3, units: "ambulance", weight: 2,
    texts: [
      "cyclist got hit by a car at {addr}, she's awake but bleeding from her head and her arm looks broken",
      "pedestrian knocked down at {addr}, older man, he's not getting up, driver stayed",
    ],
    followups: ["the cyclist at {addr} is getting dizzy, please hurry", "update on pedestrian hit at {addr}: he's conscious now"],
  },
  {
    category: "utility", severity: 3, units: "utility_crew", hazmat: true, weight: 2,
    texts: [
      "A power line came down at {addr}, it's sparking on the road and there are kids around",
      "transformer exploded at {addr}, loud bang, power out on the whole block, wire hanging low over the sidewalk",
    ],
    followups: ["the downed wire at {addr} is still live and sparking", "anyone coming for the wire on {street}? people are stepping over it"],
    sensor: ["GRID SENSOR feeder 14 ({addr}): fault current, breaker tripped, line-down signature"],
  },
  {
    category: "utility", severity: 1, units: "utility_crew", weight: 3,
    texts: [
      "water main burst at {addr}, water gushing down the street, basement of the corner shop is flooding",
      "street light out at {addr}, it's really dark on this corner",
      "manhole cover is missing at {addr}, cars are swerving around it",
      "sewage smell and water coming up from a drain at {addr}",
    ],
    followups: ["still no one at the water main on {street}, the road is a river now"],
    sensor: ["WATER PRESSURE SENSOR {addr}: pressure drop 40%, possible main break"],
  },
  {
    category: "rescue", severity: 3, units: "fire_engine", weight: 2,
    texts: [
      "elevator is stuck between floors at {addr}, 4 people inside, one is having a panic attack",
      "a kid is stuck in a storm drain at {addr}, we can hear him but can't reach him",
      "worker fell into a trench at {addr} and it partly collapsed on his legs, he's talking to us",
    ],
    followups: ["the people in the elevator at {addr} say it's getting hot in there", "update on the boy in the drain at {addr}, water is rising slowly"],
  },
  {
    category: "rescue", severity: 4, units: "ambulance+fire", callerDanger: true, weight: 1, kinds: ["waterfront", "park"],
    texts: [
      "someone fell off the pier at {addr} into the water, they're not swimming well, current is strong",
      "a car went into the river at {addr}, i can see someone inside, the car is sinking",
    ],
    followups: ["the person in the water near {addr} went under, i cant see them now", "re the car in the river at {addr}, driver is on the roof of the car now"],
  },
  {
    category: "non_emergency", severity: 0, units: "none", weight: 6,
    texts: [
      "Hi, what time does the DMV on {street} open on Saturdays?",
      "my neighbours at {addr} are playing loud music again, it's 11pm, can you tell them to stop",
      "is it legal to park on the sidewalk on {street}? my neighbour does it every day",
      "there's a raccoon in my garage at {addr}, how do I get it out",
      "I'd like to report that the pothole on {street} is still there, I called two weeks ago",
      "how do I get a copy of a police report I filed last month?",
      "the fire hydrant at {addr} is leaking a little bit",
      "test test is this the emergency line",
    ],
    followups: [],
  },
];

const FIRST_NAMES = ["Ana", "Marcus", "Priya", "Tom", "Chen", "Fatima", "Luis", "Grace"];

function degradeSms(text: string, rng: Rng): string {
  let out = text.toLowerCase().replace(/[.,']/g, "");
  const subs: [RegExp, string][] = [
    [/\bplease\b/g, "pls"],
    [/\bpeople\b/g, "ppl"],
    [/\byou\b/g, "u"],
    [/\bare\b/g, "r"],
    [/\bsomeone\b/g, "some1"],
    [/\bbecause\b/g, "bc"],
    [/\bwith\b/g, "w"],
  ];
  for (const [re, rep] of subs) if (rng.chance(0.6)) out = out.replace(re, rep);
  if (rng.chance(0.5)) {
    const words = out.split(" ");
    const i = rng.int(0, words.length - 1);
    const w = words[i];
    if (w.length > 4) words[i] = w.slice(0, 2) + w.slice(3);
    out = words.join(" ");
  }
  return out;
}

function makeAddress(rng: Rng, district: District): { address: string; street: string; loc: Point } {
  const street = rng.pick(district.streets);
  const number = rng.int(1, 48) * 10 + rng.int(0, 9);
  const margin = 80;
  const loc = {
    x: district.x + margin + rng.next() * (district.w - 2 * margin),
    y: district.y + margin + rng.next() * (district.h - 2 * margin),
  };
  return { address: `${number} ${street}, ${district.name}`, street, loc };
}

function render(template: string, address: string, street: string): string {
  return template.replace(/\{addr\}/g, address).replace(/\{street\}/g, street);
}

function pickScenario(rng: Rng, district: District): Scenario {
  const eligible = SCENARIOS.filter((s) => !s.kinds || s.kinds.includes(district.kind));
  const total = eligible.reduce((a, s) => a + s.weight, 0);
  let r = rng.next() * total;
  for (const s of eligible) {
    r -= s.weight;
    if (r <= 0) return s;
  }
  return eligible[eligible.length - 1];
}

interface Emitter {
  city: City;
  rng: Rng;
  seq: number;
  prefix: string;
}

function emitPrimary(e: Emitter, t: number, forced?: { scenario: Scenario; district: District; place: ReturnType<typeof makeAddress> }): Report {
  const district = forced?.district ?? e.rng.pick(e.city.districts);
  const scenario = forced?.scenario ?? pickScenario(e.rng, district);
  const place = forced?.place ?? makeAddress(e.rng, district);
  let channel: Channel = e.rng.chance(0.62) ? "call" : "sms";
  let text: string;
  if (scenario.sensor && e.rng.chance(0.25)) {
    channel = "sensor";
    text = render(e.rng.pick(scenario.sensor), place.address, place.street);
  } else {
    text = render(e.rng.pick(scenario.texts), place.address, place.street);
    if (channel === "sms") text = degradeSms(text, e.rng);
    else if (e.rng.chance(0.3)) text = `${e.rng.pick(FIRST_NAMES)} here. ${text}`;
  }
  e.seq++;
  return {
    id: `${e.prefix}${e.seq}`,
    seq: e.seq,
    t,
    channel,
    text,
    address: place.address,
    loc: place.loc,
    districtId: district.id,
    truth: {
      category: scenario.category,
      severity: scenario.severity,
      units: scenario.units,
      multipleVictims: !!scenario.multi,
      hazmat: !!scenario.hazmat,
      callerInDanger: !!scenario.callerDanger,
      duplicateOf: null,
    },
  };
}

function emitFollowup(e: Emitter, parent: Report, scenario: Scenario, t: number): Report {
  const street = parent.address.split(",")[0].replace(/^\d+\s/, "");
  let text = render(e.rng.pick(scenario.followups), parent.address, street);
  const channel: Channel = e.rng.chance(0.55) ? "call" : "sms";
  if (channel === "sms") text = degradeSms(text, e.rng);
  e.seq++;
  const jitter = () => e.rng.range(-60, 60);
  return {
    id: `${e.prefix}${e.seq}`,
    seq: e.seq,
    t,
    channel,
    text,
    address: parent.address,
    loc: { x: parent.loc.x + jitter(), y: parent.loc.y + jitter() },
    districtId: parent.districtId,
    truth: { ...parent.truth, duplicateOf: parent.id },
  };
}

function scenarioOf(report: Report): Scenario {
  return SCENARIOS.find((s) => s.category === report.truth.category && s.units === report.truth.units && s.severity === report.truth.severity) ?? SCENARIOS[0];
}

/**
 * Deterministic report schedule: bursts of 1-5 reports/second separated by lulls,
 * with follow-up (duplicate) reports about earlier incidents woven in.
 */
export function generateSchedule(seed: number, durationSec: number): Report[] {
  const e: Emitter = { city: buildCity(), rng: makeRng(seed), seq: 0, prefix: "R" };
  const reports: Report[] = [];
  let t = 0.5;
  while (t < durationSec) {
    const burstLen = e.rng.range(2, 5);
    const rate = e.rng.int(1, 5);
    const end = Math.min(t + burstLen, durationSec);
    while (t < end) {
      const primary = emitPrimary(e, round(t));
      reports.push(primary);
      const scenario = scenarioOf(primary);
      if (scenario.followups.length && primary.truth.severity >= 2) {
        const n = primary.truth.severity >= 4 ? e.rng.int(1, 3) : e.rng.int(0, 1);
        for (let i = 0; i < n; i++) {
          const ft = t + e.rng.range(4, 45);
          if (ft < durationSec) reports.push(emitFollowup(e, primary, scenario, round(ft)));
        }
      }
      t += 1 / rate + e.rng.range(-0.05, 0.05);
    }
    t += e.rng.range(7, 16);
  }
  reports.sort((a, b) => a.t - b.t || a.seq - b.seq);
  return reports;
}

/** Mass-casualty surge: one big event reported by many callers, plus a few distinct injuries nearby. */
export function generateSurge(seed: number, startT: number, startSeq: number, count = 40, windowSec = 10): Report[] {
  const e: Emitter = { city: buildCity(), rng: makeRng(seed ^ 0x5a7e), seq: startSeq, prefix: "S" };
  const district = e.city.districts.find((d) => d.id === "MT") ?? e.city.districts[0];
  const place = makeAddress(e.rng, district);
  const crash = SCENARIOS.find((s) => s.category === "traffic" && s.units === "ambulance+fire")!;
  const reports: Report[] = [];
  const primary = emitPrimary(e, round(startT), { scenario: crash, district, place });
  primary.text = `Bus crash at ${place.address}, a bus flipped over, there are dozens of people hurt, some not moving`;
  primary.channel = "call";
  reports.push(primary);
  const crowd = [
    "bus overturned {addr} so many injured send everything",
    "im on the bus that crashed at {addr}, my leg is trapped, people screaming",
    "there's been a terrible accident on {street}, a bus, lots of blood",
    "BUS CRASH {addr} need ambulances NOW",
    "i just saw a bus roll over at {addr}, im pulling people out, some are unconscious",
    "accident {street} bus and a truck, kids on the bus, please hurry",
    "the bus at {addr} is leaking fuel, i smell diesel everywhere",
    "hi im calling about the bus that crashed on {street}, do you know about it already",
  ];
  const nearby: Scenario[] = [
    SCENARIOS.find((s) => s.category === "medical" && s.severity === 3)!,
    SCENARIOS.find((s) => s.category === "traffic" && s.severity === 2)!,
    SCENARIOS.find((s) => s.category === "police" && s.severity === 1)!,
  ];
  for (let i = 1; i < count; i++) {
    const t = round(startT + (i / count) * windowSec + e.rng.range(0, 0.2));
    if (e.rng.chance(0.15)) {
      const near = makeAddress(e.rng, district);
      reports.push(emitPrimary(e, t, { scenario: e.rng.pick(nearby), district, place: near }));
    } else {
      const tmpl = e.rng.pick(crowd);
      const f = emitFollowup(e, primary, { ...crash, followups: [tmpl] }, t);
      f.truth = { ...f.truth, multipleVictims: true };
      reports.push(f);
    }
  }
  reports.sort((a, b) => a.t - b.t || a.seq - b.seq);
  return reports;
}

function round(t: number): number {
  return Math.round(t * 100) / 100;
}
