// The seven Jev questions mapped onto four decision-machine-1 calls per batch of reports.
// Every call gets the same composed text per report (DM1 has no state object), so one
// batch is: /classify category, /rate severity, /classify unit package, /yes-no four statements.
// The heuristics below come from the experiment's src/jev.ts and still own every rule: merge
// radius, confidence gate, package repair. The keyword lists differ from the original: the
// police pattern matches "breaking into", the medical one matches "hurts", "numb" and "chest
// pain", and the non-emergency phrases are read clause by clause rather than over the whole
// report, so a cancel or a question cannot silence an emergency reported beside it. See
// emergencySignal and buildDecision.

// Type-only: this module stays free of runtime imports so smoke.mjs can load it under plain node.
import type { ClassifyResult, Meta, RateResult, YesNoResult } from "../../lib/dm1.ts";
import {
  CATEGORIES,
  PACKAGE_UNITS,
  PACKAGES,
  SEVERITY_LEVELS,
  distance,
  type Category,
  type OpenIncidentSummary,
  type Package,
  type Report,
  type Severity,
  type UnitType,
} from "./data.ts";

/** Merge into an open incident only when the model is at least this sure it is the same event. */
export const DUPLICATE_THRESHOLD = 0.6;
/** Max distance between a report and an open incident for a merge to be geographically plausible. */
export const MERGE_RADIUS_M = 350;
/**
 * Below this category confidence the deterministic keyword heuristic decides the category
 * instead. Tuned on the seeded stream: at 0.45 a "still smoke from the bin fire" follow-up
 * squeaked through as police at 0.47; at 0.50 every answer the model keeps is right.
 */
export const LOW_CONFIDENCE = 0.5;
/** Probability above which the "more than one person" statement adds an ambulance to a merge. */
export const MULTI_VICTIM_GATE = 0.45;
/** Reports per batch; the API takes up to 32 texts per call. */
export const BATCH_SIZE = 16;

export const CATEGORY_LABELS: Record<string, string> = {
  fire: "Fire, smoke, explosion, or a gas leak that could ignite",
  medical: "A sick or injured person who needs paramedics and no other service",
  police: "Crime, violence, threats, weapons, burglary, or suspicious activity",
  traffic: "A vehicle collision, a person struck by a vehicle, or a road hazard caused by vehicles",
  utility: "Downed power lines, transformer fault, water main, sewage, street light or manhole problems",
  rescue: "A person trapped or in the water: elevator entrapment, trench collapse, drowning, sinking vehicle",
  non_emergency: "Not an emergency: a question, complaint, noise, animal, minor nuisance, test call, or administrative request",
};

export const PACKAGE_LABELS: Record<string, string> = {
  ambulance: "Send one ambulance: somebody is sick, hurt, or not well, and there is no fire and nobody is trapped",
  "ambulance+fire": "Send an ambulance and a fire engine: people are hurt and there is also fire, fuel, entrapment or water",
  police_1: "Send one police car: there is a report to take or a small dispute and nobody is hurt or violent",
  "police_2+": "Send two or more police cars: a crime is happening now, or there is violence, a weapon, a break-in or a crowd",
  fire_engine: "Send one fire engine: a small fire, a smell of gas, or a person to free from a lift, a machine or a vehicle, and nobody is hurt",
  fire_full: "Send engines, a ladder and an ambulance: a building is burning and people may be inside it",
  utility_crew: "Send a utility repair crew: a power line, transformer, water main, sewer, drain, street light or manhole is broken or leaking",
  none: "Send no units at all: this is a question, a complaint or a nuisance and nothing needs a response",
};

/** Low to high, five levels; /rate returns the level index directly. */
export const SEVERITY_SCALE: string[] = [...SEVERITY_LEVELS];

export const STATEMENTS = [
  "More than one person is injured, trapped, or in danger.",
  "There is a spreading fire, explosion risk, fuel or gas leak, live wire, or hazardous material.",
  "The person who sent this report is inside the hazard or in immediate physical danger.",
];

/** One hint pair shared by the three statements, so it stays generic across them. */
export const HINTS = {
  when_true: "The words of the report show this is happening now.",
  when_false: "The report describes one person, a safe caller, and no hazard.",
};

/**
 * The duplicate question is a separate call over pair texts. Listing the nearby incidents
 * inside the shared text made every judgment worse: the category collapsed to non_emergency
 * and the duplicate answer was yes for everything, including reports with nothing nearby.
 *
 * The first wording ("about the same event", hinted on place and kind) answered yes for any
 * two emergencies on the same block: 11/18 on the seeded pairs, and every miss a false merge.
 * Naming the people and calling the alternative a separate emergency scores 16/18 raw.
 */
export const DUPLICATE_STATEMENT = "The new report is another call about the very same incident that is already open.";
export const DUPLICATE_HINTS = {
  when_true: "The same people and the same emergency, reported again or updated.",
  when_false: "A separate emergency, even at the same address or on the same block.",
};

/** Unit types that fit each category. A package holding none of them contradicts the category. */
const CATEGORY_UNITS: Record<Category, UnitType[]> = {
  fire: ["engine", "ladder"],
  medical: ["ambulance"],
  police: ["police"],
  traffic: ["ambulance", "engine", "police"],
  utility: ["utility"],
  rescue: ["engine", "ladder"],
  non_emergency: [],
  duplicate_update: [],
};

const CHANNEL_NAME = { call: "911 call transcript", sms: "text message", sensor: "automated sensor alert" } as const;

/** One text per report, composed once and reused by the category, severity, package and statement calls. */
export function composeText(report: Report): string {
  return `Channel: ${CHANNEL_NAME[report.channel]}. Address: ${report.address}.\nReport: "${report.text}"`;
}

/** One text per (open incident, new report) pair for the duplicate call. */
export function composePair(incident: OpenIncidentSummary, report: Report): string {
  return (
    `Original report at ${incident.address}: "${incident.summary}"\n` +
    `New report from ${report.address}: "${report.text}"`
  );
}

/** The nearest open incident close enough to be the same event, or null. */
export function mergeCandidate(nearby: OpenIncidentSummary[]): OpenIncidentSummary | null {
  return nearby.find((n) => n.distance_m <= MERGE_RADIUS_M) ?? null;
}

export type DecisionSource = "live" | "fallback" | "simulated";

export interface Decision {
  category: Category;
  severity: Severity;
  severityScore: number;
  multipleVictims: number;
  hazmat: number;
  callerInDanger: number;
  units: Package;
  duplicateP: number;
  /** False when no open incident was near enough to ask the duplicate question about. */
  dupAsked: boolean;
  /** Id of the open incident to merge into, or null for a new incident. */
  mergeInto: string | null;
  categoryProbs: Record<string, number>;
  unitsProbs: Record<string, number>;
  severityProbs: Record<string, number>;
  categoryConfidence: number;
  lowConfidence: boolean;
  source: DecisionSource;
}

export function clampSeverity(score: number): Severity {
  return Math.max(0, Math.min(4, Math.round(score))) as Severity;
}

/** Turn one report's answers into a Decision, applying the same gates as the experiment. */
export function buildDecision(
  report: Report,
  nearby: OpenIncidentSummary[],
  cat: ClassifyResult,
  sev: RateResult,
  pack: ClassifyResult,
  nouls: YesNoResult[],
  dupP: number,
): Decision {
  const heuristic = heuristicDecision(report, nearby);
  const categoryConfidence = cat.confidence ?? 0;
  const modelCategory: Category | null = (CATEGORIES as readonly string[]).includes(cat.label) ? (cat.label as Category) : null;
  let category: Category = modelCategory ?? heuristic.category;
  let lowConfidence = modelCategory === null || categoryConfidence < LOW_CONFIDENCE;
  if (lowConfidence) category = heuristic.category;
  // The model reads calm, past-tense and "update on ..." follow-ups as questions, so a confident
  // non_emergency still drops real calls. Only an emergency keyword the report actually contains
  // overrules it: the keyword heuristic's bare "police" default is not evidence of an emergency,
  // and treating it as such rolled a car for a sensor self-test.
  // A confident non_emergency that also picks the "none" package is not a misread follow-up, it
  // is the model saying nothing needs to roll. A sensor self-test contains "pressure sensor",
  // so the keyword list calls it utility; that must not send a crew.
  // A retraction is a second reason for the model to answer non_emergency, not a misread: the
  // caller is cancelling. "false alarm, the smoke was burnt toast, no fire, cancel the engine"
  // still carries the word "smoke", and rescuing it would roll an engine for burnt toast.
  const signal = emergencySignal(report.text);
  const retracted = RETRACTION.test(report.text);
  const abstains = categoryConfidence >= LOW_CONFIDENCE && pack.label === "none";
  if (category === "non_emergency" && signal !== null && !abstains && !retracted) {
    category = signal;
    lowConfidence = true;
  }
  const candidate = mergeCandidate(nearby);
  // Neither the model nor the keywords have positive evidence here - a bare "update on 141
  // juniper st: shes awake now but very confused" - but the duplicate call ties the report to an
  // open incident. A follow-up is about the emergency it follows, so it takes that category.
  if (candidate && dupP >= DUPLICATE_THRESHOLD && (category === "non_emergency" || (lowConfidence && signal === null))) {
    category = candidate.category;
    lowConfidence = true;
  }
  // The reverse. A cancel or an administrative question settles the report only when no clause
  // beside it still reports an emergency: "how do i file a report about this afterwards" must
  // not cancel "my father collapsed and is not breathing", and "raccoon in my bin. also my
  // chest hurts and my left arm is numb" is a medical call, not a nuisance.
  if (category !== "non_emergency" && signal === null && (retracted || NONEMERGENCY.test(report.text))) {
    category = "non_emergency";
    lowConfidence = true;
  }

  let pkg: Package = (PACKAGES as readonly string[]).includes(pack.label) ? (pack.label as Package) : heuristic.units;
  if (category === "non_emergency") pkg = "none";

  // Merge only into an incident of the same kind: the pair judgment alone merges a seizure
  // into a burst water main when the two happen to be on the same block.
  const mergeInto = dupP >= DUPLICATE_THRESHOLD && candidate?.category === category ? candidate.id : null;
  // "none" for an active category is the model abstaining; the keyword package takes over.
  if (pkg === "none" && category !== "non_emergency" && mergeInto === null) pkg = heuristic.units;
  // A package that flatly contradicts the settled category (medical -> fire engine) would roll
  // the wrong vehicle type. The keyword package is right in exactly these cases.
  const fits = CATEGORY_UNITS[category];
  if (pkg !== "none" && fits.length > 0 && !PACKAGE_UNITS[pkg].some((u) => fits.includes(u))) pkg = heuristic.units;

  // The model's top level swings on benign text: the same "man asleep in a doorway" sentence
  // scores 0 as an SMS and 4 as a call. Never claim an immediate threat to life for a report
  // that carries no severity keyword at all. severityProbs still holds what the model said.
  const modelSeverity = clampSeverity(sev.level);
  const severity = modelSeverity >= 4 && heuristic.severity <= 1 ? clampSeverity(heuristic.severity + 1) : modelSeverity;

  // The API sometimes answers the trailing rows of a /yes-no batch with an exact 1.0 on every
  // statement at once. Real answers on this stream top out near 0.55 and never agree to three
  // decimals, so a row like that carries no signal and would roll a fire engine for a fall.
  const degenerate = nouls.length > 1 && nouls.every((r) => r.probability === 1);
  const noul = (i: number) => (degenerate ? 0 : (nouls[i]?.probability ?? 0));

  const severityProbs: Record<string, number> = {};
  sev.scores?.forEach((p, i) => (severityProbs[String(i)] = p));

  return {
    category,
    severity,
    severityScore: sev.score,
    multipleVictims: noul(0),
    hazmat: noul(1),
    callerInDanger: noul(2),
    units: pkg,
    duplicateP: dupP,
    dupAsked: candidate !== null,
    mergeInto,
    categoryProbs: cat.scores ?? {},
    unitsProbs: pack.scores ?? {},
    severityProbs,
    categoryConfidence,
    lowConfidence,
    source: "live",
  };
}

export interface TriageItem {
  report: Report;
  nearby: OpenIncidentSummary[];
}
export interface TriageBatch {
  decisions: Decision[];
  calls: Meta[];
}

/* ------------------------------------------------------------------ */
/* Deterministic fallback, copied from the experiment's src/jev.ts.     */
/* ------------------------------------------------------------------ */

const KEYWORDS: [Category, RegExp][] = [
  ["fire", /\b(fire|flames?|smoke|smoking|burning|explod|gas smell|smell(s)? (like|of) gas|alarm panel|smoke detector|gas sensor)\b/i],
  ["rescue", /\b(trapped|stuck|elevator|drain|trench|sinking|drown|in the (water|river|canal|pond|lake|creek)|off the pier)\b/i],
  ["traffic", /\b(crash(ed|es|ing)?|collision|accident|rear.?ended|fender|hit by a car|knocked down|airbag|telematics|traffic light|bus (crash|flipped|overturned))\b/i],
  // "hurt" was written without the plural, so "my chest hurts" matched nothing; "numb",
  // "chest pain", "stroke", "overdose" and "choking" were missing outright.
  ["medical", /\b(not breathing|collapsed|unconscious|cpr|heart attack|stroke|overdose|choking|seizure|bleeding|blood|pills|fell|fever|ankle|nosebleed|cant breathe|can't breathe|turning blue|chest pain|hurts?|injured|numb)\b/i],
  // "break(ing)? in" alone never matched "breaking into": the \b after "in" fails on the "t".
  ["police", /\b(gun|shots?|shooting|fight|break(ing)? in(to)?|burglar|snatched|robbed|stabb(ed|ing)|kill|threat|spray paint|broken into|suspicious)\b/i],
  ["utility", /\b(power line|wire|transformer|water main|sewage|manhole|street ?light|pressure sensor|grid sensor|hydrant)\b/i],
];

const SEVERE = /\b(not breathing|unconscious|not moving|gun|shots|kill|trapped|people (still )?inside|dozens|blue|sinking|went under|spreading|fully on fire|heart attack|collapsed)\b/i;
const MODERATE = /\b(bleeding|broken|hurt|injured|smoke|sparking|live|stuck|fight|burglar|pain|seizure|confused)\b/i;
const MULTI = /\b(people|families|several|lots of|many|dozens|\d+ (people|guys|men|kids)|everyone|passengers|kids on the bus|children|both)\b/i;
const HAZ = /\b(spreading|gas|fuel|diesel|explod|sparking|live wire|hazard|chemical|smoke)\b/i;
const DANGER = /\b(i can'?t (get|breathe)|my leg is trapped|we'?re hiding|hiding|going to kill me|breaking down my door|i'?m on the (bus|4th floor)|my eyes are burning)\b/i;
// Two separate lists, ordered by how much evidence each one carries.
// A retraction cancels an emergency outright, so it wins over any keyword in the same text.
const RETRACTION = /\b(false alarm|disregard|cancel the (engine|ambulance|police|units?|call))\b/i;
// An administrative phrase is weak evidence: "how do I file a report about this afterwards" sits
// happily inside "my father collapsed and is not breathing". It only decides when the report
// carries no emergency keyword at all. "how do i" is also narrowed to the administrative forms,
// so a caller asking "how do I stop the bleeding" is still an emergency.
const NONEMERGENCY =
  /\b(what time|how do i (get|report|file|renew|pay)|is it legal|raccoon|pothole|loud music|test test|self.?test|no action required|copy of a|leaking a little|opening hours)\b/i;

/** The emergency keyword the report actually contains, or null when none of them match. */
export function keywordEmergency(text: string): Category | null {
  for (const [cat, re] of KEYWORDS) if (re.test(text)) return cat;
  return null;
}

/** Sentence and clause boundaries. "and" is deliberately not one: it joins symptoms, not topics. */
const CLAUSE_SPLIT = /[.;!?]+|\bbut\b|\balso\b|,/i;

/**
 * The emergency the report actually reports, read clause by clause, skipping the clauses that
 * retract or that ask an administrative question. A cancel or a question can only settle the
 * report when no other clause is left carrying an emergency, so "cancel the ambulance for 70
 * slag ave, but my neighbour is having a heart attack at 72" is still a medical call.
 *
 * ponytail: clause split, not a parse. A retraction that restates the emergency it cancels
 * ("false alarm, the smoke was burnt toast") still reads as a signal here; the model's own
 * non_emergency answer settles that case, see buildDecision. Parse the negation if that ceiling
 * ever matters.
 */
export function emergencySignal(text: string): Category | null {
  for (const clause of text.split(CLAUSE_SPLIT)) {
    if (!clause.trim() || RETRACTION.test(clause) || NONEMERGENCY.test(clause)) continue;
    const keyword = keywordEmergency(clause);
    if (keyword !== null) return keyword;
  }
  return null;
}

export function heuristicCategory(text: string): Category {
  const signal = emergencySignal(text);
  if (signal !== null) return signal;
  return RETRACTION.test(text) || NONEMERGENCY.test(text) ? "non_emergency" : "police";
}

export function heuristicSeverity(text: string, category: Category): Severity {
  if (category === "non_emergency") return 0;
  if (SEVERE.test(text)) return category === "utility" ? 3 : 4;
  if (MODERATE.test(text)) return 3;
  return category === "medical" ? 2 : 1;
}

export function heuristicPackage(category: Category, severity: Severity, multi: boolean): Package {
  switch (category) {
    case "fire":
      return severity >= 4 ? "fire_full" : "fire_engine";
    case "medical":
      return "ambulance";
    case "police":
      return severity >= 3 || multi ? "police_2+" : "police_1";
    case "traffic":
      return severity >= 4 ? "ambulance+fire" : severity >= 3 ? "ambulance" : "police_1";
    case "utility":
      return "utility_crew";
    case "rescue":
      return severity >= 4 ? "ambulance+fire" : "fire_engine";
    default:
      return "none";
  }
}

/** Deterministic keyword triage, used when a batch fails, times out or comes back unconfident. */
export function heuristicDecision(report: Report, nearby: OpenIncidentSummary[]): Decision {
  const text = report.text;
  const category = heuristicCategory(text);
  const severity = heuristicSeverity(text, category);
  const multi = MULTI.test(text);
  const nearest = nearby[0];
  const sameKind =
    nearest &&
    nearest.distance_m <= 150 &&
    nearest.age_seconds < 900 &&
    (nearest.category === category || /still|again|update|re |following up|calling about|anyone coming|how long/i.test(text));
  const mergeInto = sameKind && category !== "non_emergency" ? nearest.id : null;
  const oneHot = (k: string) => ({ [k]: 1 });
  return {
    category,
    severity,
    severityScore: severity,
    multipleVictims: multi ? 0.8 : 0.2,
    hazmat: HAZ.test(text) ? 0.8 : 0.1,
    callerInDanger: DANGER.test(text) ? 0.8 : 0.1,
    units: heuristicPackage(category, severity, multi),
    duplicateP: mergeInto ? 0.8 : 0.1,
    dupAsked: false,
    mergeInto,
    categoryProbs: oneHot(category),
    unitsProbs: oneHot(heuristicPackage(category, severity, multi)),
    severityProbs: oneHot(String(severity)),
    categoryConfidence: 0,
    lowConfidence: true,
    source: "fallback",
  };
}

/** A perfectly accurate but slow decider: the Manual and Slow LLM modes read the generator truth. */
export function simulatedDecision(report: Report, mergeTargetFor: (originalReportId: string) => string | null): Decision {
  const t = report.truth;
  const mergeInto = t.duplicateOf ? mergeTargetFor(t.duplicateOf) : null;
  const oneHot = (k: string) => ({ [k]: 1 });
  return {
    category: mergeInto ? "duplicate_update" : t.category,
    severity: t.severity,
    severityScore: t.severity,
    multipleVictims: t.multipleVictims ? 1 : 0,
    hazmat: t.hazmat ? 1 : 0,
    callerInDanger: t.callerInDanger ? 1 : 0,
    units: t.units,
    duplicateP: mergeInto ? 1 : 0,
    dupAsked: false,
    mergeInto,
    categoryProbs: oneHot(mergeInto ? "duplicate_update" : t.category),
    unitsProbs: oneHot(t.units),
    severityProbs: oneHot(String(t.severity)),
    categoryConfidence: 1,
    lowConfidence: false,
    source: "simulated",
  };
}

export function nearestOpen<T extends { id: string; loc: { x: number; y: number } }>(report: Report, incidents: T[], n = 5): T[] {
  return [...incidents].sort((a, b) => distance(a.loc, report.loc) - distance(b.loc, report.loc) || a.id.localeCompare(b.id)).slice(0, n);
}
