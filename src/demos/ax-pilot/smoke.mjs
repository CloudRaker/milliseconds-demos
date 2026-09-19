// Sends the demo's real request bodies to the production API and prints what came back.
//   MS_API_KEY=sk-... node src/demos/ax-pilot/smoke.mjs [preset|recorded]
//   MS_API_KEY=sk-... node src/demos/ax-pilot/smoke.mjs custom "In TextEdit type Good morning"
// Part 1 runs the full pilot loop against each of the five simulated apps.
// Part 2 asks for one decision on each of the five recorded macOS trees.
// `custom` runs one typed-in goal, the visitor path that has no per-preset check behind it.

import { askStep, decide, actionTarget, flatten, textCandidates, summary } from "./pilot.ts";
import { APPS, PRESETS, RECORDED, snapshot, applyAction } from "./data.ts";

const KEY = process.env.MS_API_KEY;
if (!KEY) throw new Error("set MS_API_KEY");
const BASE = "https://api.milliseconds.ai/v1/decision-machine-1";
const only = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = { calls: 0, inference: [], wall: [], tokens: 0 };

// One serial queue at 2 calls/s, the same budget the page queue in src/lib/dm1.ts enforces.
let queue = Promise.resolve();
function post(route, body) {
  const run = queue.then(() => send(route, body, 0));
  queue = run.then(() => sleep(500), () => sleep(500));
  return run;
}
async function send(route, body, attempt) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (res.status === 429 && attempt < 3) {
    await sleep(1000 * (attempt + 1));
    return send(route, body, attempt + 1);
  }
  if (!res.ok) throw new Error(`${route} ${res.status}: ${text.slice(0, 300)}`);
  stats.calls++;
  stats.inference.push(Number(res.headers.get("x-inference-ms") ?? 0));
  stats.wall.push(Date.now() - t0);
  stats.tokens += Number(res.headers.get("x-input-tokens") ?? 0);
  return JSON.parse(text);
}

const ask = {
  classify: async (text, labels) => {
    const d = await post("classify", { text, labels });
    return { label: d.label, probability: d.probability, scores: d.scores ?? {} };
  },
  yesNo: async (text, statements) => {
    const d = await post("yes-no", { text, statements });
    return d.results.map((r) => r.probability);
  },
};

const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;
const top = (probabilities, n = 3) =>
  probabilities.slice(0, n).map(([l, p]) => `${l.slice(0, 44)} ${pct(p)}`).join(" | ");

async function runPreset(preset) {
  const app = APPS[preset.app];
  let state = app.initial();
  const candidates = textCandidates(preset.goal);
  const history = [];
  const typedTexts = [];
  console.log(`\n### ${preset.goal}`);
  console.log(`    candidates: ${candidates.join(", ") || "none"} — expect ${preset.expect}`);
  for (let step = 1; step <= 12; step++) {
    const tree = flatten(snapshot(app, state), preset.goal);
    const ctx = { goal: preset.goal, step, textCandidates: candidates, typedTexts, history };
    const answers = await askStep(tree, ctx, ask);
    const decision = decide(answers, tree, ctx);
    const { action } = decision;
    console.log(
      `  ${String(step).padStart(2)}. chose ${answers.choice} ${pct(answers.confidence)}` +
        ` | reached ${pct(answers.goalReached)} text ${pct(answers.needsText)} destructive ${pct(answers.destructive)}` +
        ` -> ${action.kind} ${actionTarget(action) ?? ""} [${decision.source}]`,
    );
    if (decision.source === "fallback" || action.kind === "stuck") console.log(`      runners-up: ${top(answers.probabilities)}`);
    history.push({ step, action: action.kind, target: actionTarget(action), source: decision.source });
    if (action.kind === "type_text") typedTexts.push(action.text);
    state = applyAction(app, state, action);
    const settle = app.settleMs?.(state) ?? 0;
    if (settle) await sleep(settle);
    if (preset.verify(state)) {
      console.log(`  => Goal completed after ${step} steps. Verified in the simulated app: ${preset.expect}.`);
      return true;
    }
    if (action.kind === "done" || action.kind === "stuck" || action.kind === "blocked") {
      console.log(`  => ${decision.source} returned ${action.kind} after ${step} steps. Completion not verified.`);
      return false;
    }
  }
  console.log(`  => step cap reached. verify(state) = ${preset.verify(state)}`);
  return preset.verify(state);
}

async function judgeRecorded(entry) {
  const ctx = {
    goal: entry.goal,
    step: 1,
    textCandidates: textCandidates(entry.goal),
    typedTexts: [],
    history: [],
  };
  const answers = await askStep(entry.tree, ctx, ask);
  const decision = decide(answers, entry.tree, ctx);
  const chosen = entry.tree.elements.find((e) => e.id === answers.choice);
  console.log(`\n### ${entry.file} (${entry.tree.elements.length} elements) — ${entry.goal}`);
  console.log(`  chose ${answers.choice}${chosen ? ` = ${summary(chosen)}` : ""} ${pct(answers.confidence)}`);
  console.log(`  reached ${pct(answers.goalReached)} | text ${pct(answers.needsText)} | destructive ${pct(answers.destructive)}`);
  console.log(`  top: ${top(answers.probabilities, 4)}`);
  console.log(`  action: ${decision.action.kind} ${actionTarget(decision.action) ?? ""} [${decision.source}]`);
}

const results = [];
if (only === "custom") {
  const goal = process.argv[3];
  if (!goal) throw new Error('usage: smoke.mjs custom "<goal>"');
  const app = Object.keys(APPS).find((n) => goal.toLowerCase().includes(n.toLowerCase()));
  if (!app) throw new Error(`the goal must name one of: ${Object.keys(APPS).join(", ")}`);
  console.log("== custom goal, no code check behind it ==");
  // verify() never fires, so only the model (or the step cap) can end this run.
  await runPreset({ goal, app, expect: "nothing — a custom goal has no code check", verify: () => false });
} else if (only !== "recorded") {
  console.log("== simulated apps, full loop ==");
  for (const preset of PRESETS) results.push([preset.app, await runPreset(preset)]);
}
if (only !== "preset" && only !== "custom") {
  console.log("\n== recorded macOS trees, one decision each ==");
  for (const entry of RECORDED) await judgeRecorded(entry);
}
const p50 = (xs) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * 0.5) - 1)];
console.log(
  `\n${stats.calls} calls | model p50 ${p50(stats.inference)} ms | round trip p50 ${p50(stats.wall)} ms | ${stats.tokens} input tokens`,
);
if (results.length) console.log(`goals verified: ${results.filter(([, ok]) => ok).length}/${results.length} — ${results.map(([a, ok]) => `${a} ${ok ? "ok" : "FAILED"}`).join(", ")}`);
