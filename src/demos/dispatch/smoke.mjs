// Sends the demo's real request bodies to the live API and prints the answers next to the
// generator's ground truth. Node 24 strips the types from the imported .ts files.
//
//   MS_API_KEY=sk-... node src/demos/dispatch/smoke.mjs [count]

import { distance, generateSchedule } from "./data.ts";
import {
  CATEGORY_LABELS,
  DUPLICATE_HINTS,
  DUPLICATE_STATEMENT,
  DUPLICATE_THRESHOLD,
  HINTS,
  PACKAGE_LABELS,
  SEVERITY_SCALE,
  STATEMENTS,
  buildDecision,
  composePair,
  composeText,
  emergencySignal,
  mergeCandidate,
  nearestOpen,
} from "./triage.ts";

// Offline check of the clause scan both non_emergency rules read, so a broken scan fails here
// rather than by silently holding an ambulance in the console.
for (const [text, want] of [
  ["how do I get a copy of a police report I filed last month?", null],
  ["scheduled self test of pressure sensor node 4, no action required", null],
  ["false alarm, cancel the engine, everything is fine", null],
  ["disregard my last address, the fire is at 45 kiln st not 54, flames out the window", "fire"],
  ["cancel the ambulance for 70 slag ave he is walking now, but my other neighbour is having a heart attack at 72", "medical"],
  ["raccoon in my bin. also my chest hurts and my left arm is numb", "medical"],
  ["what time do you open. also there is a man face down in the river", "rescue"],
  ["my father collapsed and is not breathing, how do i file a report about this afterwards", "medical"],
]) {
  const got = emergencySignal(text);
  if (got !== want) throw new Error(`emergencySignal("${text.slice(0, 40)}...") = ${got}, expected ${want}`);
}
console.log("clause scan ok: 8 mixed reports");

const API = "https://api.milliseconds.ai/v1/decision-machine-1";
const KEY = process.env.MS_API_KEY;
if (!KEY) throw new Error("Set MS_API_KEY");
// The API takes at most 32 texts per call, and the page streams 51 reports in a 60 s run.
const COUNT = Math.min(32, Number(process.argv[2] ?? 32));

async function call(route, body) {
  const t0 = performance.now();
  const res = await fetch(`${API}/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${route} ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return {
    json,
    inference: Number(res.headers.get("x-inference-ms") ?? 0),
    tokens: Number(res.headers.get("x-input-tokens") ?? 0),
    wall: Math.round(performance.now() - t0),
  };
}

// Replay the seeded stream the way the console does: earlier reports become open incidents,
// so the duplicate pair call has something to match against.
const reports = generateSchedule(20260917, 60).slice(0, COUNT);
const open = [];
const items = [];
for (const report of reports) {
  const nearby = nearestOpen(report, open).map((i) => ({
    id: i.id,
    category: i.category,
    summary: i.summary.slice(0, 140),
    address: i.address,
    age_seconds: Math.round(report.t - i.openedAt),
    distance_m: distance(i.loc, report.loc),
    units_dispatched: 1,
  }));
  items.push({ report, nearby });
  if (!report.truth.duplicateOf && report.truth.category !== "non_emergency") {
    open.push({
      id: `INC-${String(open.length + 1).padStart(3, "0")}`,
      category: report.truth.category,
      severity: report.truth.severity,
      summary: report.text,
      address: report.address,
      loc: report.loc,
      openedAt: report.t,
      reportId: report.id,
    });
  }
}

const texts = items.map((i) => composeText(i.report));
const pairs = [];
items.forEach((item, index) => {
  const candidate = mergeCandidate(item.nearby);
  if (candidate) pairs.push({ index, candidate, text: composePair(candidate, item.report) });
});

const [cat, sev, pack, nouls, dup] = await Promise.all([
  call("classify", { texts, labels: CATEGORY_LABELS }),
  call("rate", { texts, scale: SEVERITY_SCALE }),
  call("classify", { texts, labels: PACKAGE_LABELS }),
  call("yes-no", { texts, statements: STATEMENTS, ...HINTS }),
  pairs.length ? call("yes-no", { texts: pairs.map((p) => p.text), statements: [DUPLICATE_STATEMENT], ...DUPLICATE_HINTS }) : null,
]);

const dupP = new Array(items.length).fill(0);
const dupTarget = new Array(items.length).fill(null);
pairs.forEach((pair, i) => {
  dupP[pair.index] = dup.json.results[i].results[0].probability;
  dupTarget[pair.index] = pair.candidate;
});
// The incident a follow-up should merge into, by the report it follows up on.
const incidentOf = new Map(open.map((i) => [i.reportId, i.id]));
// Severity of each open incident, so a merged report inherits it the way the console does.
const severityOf = new Map(open.map((i) => [i.id, i.severity]));

const mark = (ok) => (ok ? "ok  " : "MISS");
let catOk = 0;
let sevExact = 0;
let sevNear = 0;
let pkgOk = 0;
let pkgCases = 0;
let pkgMerged = 0;
let dupOk = 0;
let dupCases = 0;
let gated = 0;

console.log(`\n${items.length} reports, ${pairs.length ? 5 : 4} calls, seed 20260917`);
console.log("Answers below are what the console dispatches: the model's labels after the confidence gate,");
console.log("the package repair and the same-kind merge rule.\n");
for (let i = 0; i < items.length; i++) {
  const { report, nearby } = items[i];
  const t = report.truth;
  const raw = cat.json.results[i];
  const d = buildDecision(report, nearby, raw, sev.json.results[i], pack.json.results[i], nouls.json.results[i].results, dupP[i]);
  const isDup = !!t.duplicateOf;
  const wantMerge = isDup && incidentOf.get(t.duplicateOf) !== undefined;
  const merged = d.mergeInto !== null;
  // The console never lowers an incident's severity on a merge, and the merged report shows the
  // incident's level, so a follow-up that /rate reads as "information only" inherits it here too.
  if (merged) d.severity = Math.max(d.severity, severityOf.get(d.mergeInto) ?? 0);
  const catHit = d.category === t.category;
  // A report that merges into an open incident rolls no new units on purpose, so it is not
  // scored against the package the generator gave the original call.
  const pkgHit = merged ? null : d.units === t.units;
  catOk += catHit ? 1 : 0;
  sevExact += d.severity === t.severity ? 1 : 0;
  sevNear += Math.abs(d.severity - t.severity) <= 1 ? 1 : 0;
  if (pkgHit === null) pkgMerged++;
  else {
    pkgCases++;
    pkgOk += pkgHit ? 1 : 0;
  }
  gated += d.lowConfidence ? 1 : 0;
  if (dupTarget[i] || wantMerge) {
    dupCases++;
    dupOk += merged === wantMerge ? 1 : 0;
  }
  console.log(
    `${report.id.padEnd(4)} ${report.channel.padEnd(6)} truth ${t.category.padEnd(14)} sev ${t.severity} ${String(t.units).padEnd(14)}` +
      ` | ${mark(catHit)} ${d.category.padEnd(14)} (${raw.label} ${raw.confidence.toFixed(2)}${d.lowConfidence ? " → keywords" : ""})` +
      ` ${mark(d.severity === t.severity)} sev ${d.severity}` +
      ` ${pkgHit === null ? "----" : mark(pkgHit)} ${d.units.padEnd(14)}` +
      ` ${dupTarget[i] ? `${mark(merged === wantMerge)} dup ${dupP[i].toFixed(2)} vs ${dupTarget[i].id} (${dupTarget[i].category})` : "     no candidate nearby"}` +
      `${isDup ? " [follow-up]" : ""}`,
  );
  console.log(`      "${report.text.slice(0, 118)}"`);
  console.log(
    `      victims ${d.multipleVictims.toFixed(2)} · hazmat ${d.hazmat.toFixed(2)} · caller in danger ${d.callerInDanger.toFixed(2)}` +
      (merged ? ` · merge → ${d.mergeInto}` : ""),
  );
}

const n = items.length;
const calls = [cat, sev, pack, nouls, ...(dup ? [dup] : [])];
const tokens = calls.reduce((a, c) => a + c.tokens, 0);
console.log(
  `\ncategory ${catOk}/${n} (${gated} routed to the keyword heuristic) · severity exact ${sevExact}/${n}, within 1 level ${sevNear}/${n} · ` +
    `package ${pkgOk}/${pkgCases} (${pkgMerged} merged reports roll no new units) · duplicate ${dupOk}/${dupCases} of the reports with a candidate nearby`,
);
console.log(
  `${calls.length} calls · model time ${calls.map((c) => c.inference).join("/")} ms · round trip ${calls.map((c) => c.wall).join("/")} ms · ` +
    `${tokens} input tokens (${Math.round(tokens / n)} per report)`,
);
