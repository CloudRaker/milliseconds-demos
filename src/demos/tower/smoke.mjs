// Sends the demo's real request bodies to the live API and prints the answers.
//   MS_API_KEY=sk-... node src/demos/tower/smoke.mjs [seed] [warmupSeconds]
// Node 24 strips the types in the imported .ts sim files on the fly.
import { Sim } from "./engine.ts";
import { FIX_MAP } from "./world.ts";
import { HANDOFF, HANDOFF_THRESHOLD, LABELS, URGENCY_SCALE, candidateState, expand, flatten, topInstruction } from "./ask.ts";
import { ruleCandidates, urgencyFor } from "./rules.ts";
import { validateInstruction } from "./validate.ts";

const API = "https://api.milliseconds.ai/v1/decision-machine-1";
const KEY = process.env.MS_API_KEY;
if (!KEY) throw new Error("set MS_API_KEY");

const seed = Number(process.argv[2] ?? 7);
const warmup = Number(process.argv[3] ?? 90);

// The same seeded world the page shows, stepped until a crop of conflicts exists.
const sim = new Sim({ seed });
for (let i = 0; i < warmup / 0.5; i++) sim.step(0.5);

const byId = sim.byId();
// Exactly what the page asks about: aircraft in a predicted conflict, plus any vectored aircraft that is now
// clear and needs sending home. A quiet aircraft on its own route is never a candidate, so it is not sent.
const candidates = sim.candidates().slice(0, 12);
if (candidates.length === 0) throw new Error("no candidates at this seed/warmup; try another warmup");
const states = candidates.map((ac) => candidateState(ac, sim.conflicts, byId, sim.t, FIX_MAP));
const texts = states.map(flatten);

console.log(`seed ${seed}, T+${sim.t.toFixed(0)}s, ${sim.aircraft.length} aircraft, ${sim.conflicts.length} predicted conflicts`);
console.log(`asking about ${texts.length} aircraft, ${Math.round(texts.join("").length / texts.length)} chars per text\n`);
console.log("--- one text, exactly as sent ----------------------------------");
console.log(texts[0]);
console.log("----------------------------------------------------------------\n");

// The demo key's 200 req/min is shared, so back off on 429 the way src/lib/dm1.ts does in the browser.
async function call(route, body, attempt = 0) {
  const t0 = performance.now();
  const res = await fetch(`${API}/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const wall = Math.round(performance.now() - t0);
  const json = await res.json();
  if (res.status === 429 && attempt < 4) {
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    return call(route, body, attempt + 1);
  }
  if (!res.ok) throw new Error(`${route} ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  return { json, wall, inference: res.headers.get("x-inference-ms"), tokens: res.headers.get("x-input-tokens") };
}

const [cls, rate, yn] = await Promise.all([
  call("classify", { texts, labels: LABELS }),
  call("rate", { texts, scale: URGENCY_SCALE }),
  call("yes-no", { texts, ...HANDOFF }),
]);

for (const [name, r] of [
  ["classify", cls],
  ["rate", rate],
  ["yes-no", yn],
])
  console.log(`${name.padEnd(9)} ${String(r.wall).padStart(5)} ms round trip · ${String(r.inference).padStart(5)} ms model · ${r.tokens} input tokens`);
console.log();

const pad = (s, n) => String(s).padEnd(n);
console.log(
  pad("callsign", 10) +
    pad("geometry", 32) +
    pad("rel alt", 26) +
    pad("t loss", 8) +
    pad("kind", 9) +
    pad("conf", 6) +
    pad("urg", 9) +
    pad("H", 6) +
    pad("instruction", 19) +
    pad("flown", 19) +
    "rule policy",
);
let urgencyHits = 0;
let handoffHits = 0;
let kindSpread = new Set();
states.forEach((s, i) => {
  const ac = candidates[i];
  const c = cls.json.results[i];
  const level = rate.json.results[i].level;
  const h = yn.json.results[i].probability;
  const worst = sim.conflictsOf(ac.id).sort((x, y) => x.tLoss - y.tLoss)[0];
  const probs = expand(c.scores, level, ac, worst, byId);
  const wanted = topInstruction(probs);
  const others = sim.aircraft.filter((o) => o.id !== ac.id);
  // What the sim would actually fly: the highest-ranked instruction that passes the validator.
  const flown =
    Object.entries(probs)
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k)
      .find((k) => validateInstruction(ac, k, others, sim.t, FIX_MAP).ok) ?? "maintain";
  const rule = ruleCandidates(ac, sim.conflicts, byId).find((x) => validateInstruction(ac, x, others, sim.t, FIX_MAP).ok) ?? "-";
  kindSpread.add(c.label);
  if (Math.abs(level - urgencyFor(worst ? worst.tLoss : null)) <= 1) urgencyHits++;
  if (h >= HANDOFF_THRESHOLD === (s.intruders.length === 0)) handoffHits++;
  console.log(
    pad(s.callsign, 10) +
      pad(s.intruders[0]?.geometry ?? "clear", 32) +
      pad(s.intruders[0]?.relative_altitude ?? "-", 26) +
      pad(worst ? `${Math.round(worst.tLoss)}s` : "-", 8) +
      pad(c.label, 9) +
      pad(c.confidence.toFixed(2), 6) +
      pad(`${level} (${urgencyFor(worst ? worst.tLoss : null)})`, 9) +
      pad(h.toFixed(2), 6) +
      pad(wanted ?? "-", 19) +
      pad(flown, 19) +
      rule,
  );
});

console.log(`\nurgency within one level of the code baseline: ${urgencyHits}/${states.length}`);
console.log(`handoff on the right side of ${HANDOFF_THRESHOLD}: ${handoffHits}/${states.length}`);
console.log(`distinct kinds chosen: ${[...kindSpread].join(", ")}`);
console.log("\nfull label scores, first three aircraft:");
states.slice(0, 3).forEach((s, i) => {
  const scores = Object.entries(cls.json.results[i].scores).sort((a, b) => b[1] - a[1]);
  console.log(`  ${pad(s.callsign, 9)}${scores.map(([k, v]) => `${k} ${v.toFixed(3)}`).join("   ")}`);
});
