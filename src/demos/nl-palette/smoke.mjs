// Sends the demo's real request bodies straight to the API and prints the answers.
//   MS_API_KEY=sk-ms-... node src/demos/nl-palette/smoke.mjs
// Same shape as the in-page benchmark: one /classify-tree over the 32 phrasings with the
// command tree, then one batched call per argument slot (/rate for the ordinal slot,
// /classify for the three named ones). Plus five /yes-no calls in the body Demo.tsx really
// sends, and the pickTheme rule the model never sees.
import { strict as assert } from "node:assert";
import {
  ARG_LABELS,
  ARG_SCALES,
  BENCHMARK_CASES,
  COMMAND_BY_ID,
  COMMAND_TREE,
  DESTRUCTIVE_HINTS,
  DESTRUCTIVE_STATEMENT,
  GROUP_BY_KEY,
  paletteText,
} from "./data.ts";
import { pickTheme } from "./resolve.ts";

const KEY = process.env.MS_API_KEY;
if (!KEY) throw new Error("set MS_API_KEY");
const API = "https://api.milliseconds.ai/v1/decision-machine-1";

let calls = 0;
let tokens = 0;
async function post(route, body) {
  const t0 = performance.now();
  const res = await fetch(`${API}/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const wall = Math.round(performance.now() - t0);
  const text = await res.text();
  if (!res.ok) throw new Error(`${route} ${res.status}: ${text.slice(0, 300)}`);
  calls++;
  tokens += Number(res.headers.get("x-input-tokens") ?? 0);
  console.log(`  ${route}: ${res.headers.get("x-inference-ms")} ms model, ${wall} ms round trip, ${res.headers.get("x-input-tokens")} tokens`);
  return JSON.parse(text);
}

const pct = (p) => `${Math.round(p * 100)}%`;
const texts = BENCHMARK_CASES.map((c) => paletteText(c.query));

console.log(`\n1) /classify-tree — ${texts.length} phrasings, ${Object.keys(COMMAND_TREE).length} groups then the commands of the winner`);
const { results } = await post("classify-tree", { texts, tree: COMMAND_TREE });

let hits = 0;
let groupHits = 0;
const wanted = { font_size_delta: [], theme: [], heading_level: [], export_format: [] };
results.forEach((r, i) => {
  const c = BENCHMARK_CASES[i];
  const want = COMMAND_BY_ID.get(c.expected);
  if (GROUP_BY_KEY[r.levels[0].label] === want.group) groupHits++;
  const ok = r.label === c.expected;
  if (ok) hits++;
  if (want.arg && c.expectedArg) wanted[want.arg].push({ c, text: texts[i], fired: ok });
  const runnersUp = Object.entries(r.levels.at(-1).scores)
    .sort((a, b) => b[1] - a[1])
    .slice(1, 4)
    .map(([k, v]) => `${k} ${pct(v)}`)
    .join(", ");
  console.log(
    `${ok ? " ok " : "MISS"} "${c.query}" -> ${r.path.join(" > ")} ${pct(r.probability)}` +
      (ok ? "" : `   (wanted ${want.group.toLowerCase()} > ${c.expected}; runners-up ${runnersUp})`),
  );
});
console.log(`\ngroup accuracy: ${groupHits}/${results.length} · command accuracy@1: ${hits}/${results.length} = ${Math.round((hits / results.length) * 100)}%`);

let argHits = 0;
let argTotal = 0;
for (const [slot, items] of Object.entries(wanted)) {
  if (items.length === 0) continue;
  const steps = ARG_SCALES[slot];
  const texts2 = items.map((x) => x.text);
  console.log(`\n2) ${steps ? "/rate" : "/classify"} — argument slot ${slot}, ${items.length} text(s)`);
  const r = steps
    ? await post("rate", { texts: texts2, scale: steps.map((x) => x.description) })
    : await post("classify", { texts: texts2, labels: ARG_LABELS[slot] });
  r.results.forEach((raw, k) => {
    const res = steps ? { label: steps[raw.level].value, probability: raw.scores[raw.level] } : raw;
    const want = items[k].c.expectedArg;
    const ok = res.label === want;
    if (ok) argHits++;
    argTotal++;
    console.log(`${ok ? " ok " : "MISS"} "${items[k].c.query}" -> ${res.label} ${pct(res.probability)} (wanted ${want})`);
  });
}
console.log(`\nargument accuracy: ${argHits}/${argTotal}`);

console.log(`\n3) /yes-no — the destructive gate, one call on Enter`);
// The exact body Demo.tsx sends: yesNo() posts statements: [...] and reads results[0].
// The last two used to sit at or above the 0.5 gate and opened the dialog on safe commands.
const DESTRUCTIVE_CASES = [
  ["trash this note", true],
  ["get rid of every other tab", true],
  ["make this louder", false],
  ["undo that", false],
  ["clear the formatting on this", false],
];
for (const [q, wantConfirm] of DESTRUCTIVE_CASES) {
  const { results } = await post("yes-no", { text: paletteText(q), statements: [DESTRUCTIVE_STATEMENT], ...DESTRUCTIVE_HINTS });
  const r = results[0];
  const ok = r.probability >= 0.5 === wantConfirm;
  console.log(`${ok ? " ok " : "MISS"} "${q}" -> destructive ${r.answer} ${pct(r.probability)} (want confirm=${wantConfirm})`);
  assert.equal(r.probability >= 0.5, wantConfirm, `destructive gate on "${q}"`);
}

// The one rule that is code, not a call: an unnamed "different look" flips away from
// the current theme, a named one wins on its own scores.
const named = { dark: 0.62, light: 0.2, sepia: 0.14, high_contrast: 0.04 };
assert.equal(pickTheme(named, "dark", "give me a different look"), "light");
assert.equal(pickTheme(named, "light", "i'm bored of these colours"), "dark");
assert.equal(pickTheme(named, "light", "switch to night mode"), "dark");
assert.equal(pickTheme({ sepia: 0.7, dark: 0.2 }, "dark", "i want it to look like paper"), "sepia");
console.log("\n4) pickTheme — unnamed look flips, named theme wins: ok");

console.log(`\n${calls} calls, ${tokens} input tokens total.`);
