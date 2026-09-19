// Refresh the bounded, real API recordings deliberately: MS_API_KEY=... node src/demos/ax-pilot/capture.mjs
// Review changes and run stock-check.mjs before publishing; never refresh one trace step in isolation.
import { writeFile } from 'node:fs/promises';
import { APPS, PRESETS, RECORDED, snapshot, applyAction } from './data.ts';
import { askStep, decide, flatten, textCandidates, actionTarget, isTerminal } from './pilot.ts';
const key = process.env.MS_API_KEY;
if (!key) throw new Error('Set MS_API_KEY');
const entries = [];
const outcomes = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let queue = Promise.resolve();
let calls = 0;
let scenario;
const post = (route, body) => {
  const next = queue.then(async () => {
    if (++calls > 120) throw new Error('Capture call limit');
    const response = await fetch(`https://api.milliseconds.ai/v1/decision-machine-1/${route}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${route} HTTP ${response.status}`);
    const data = await response.json();
    const tokens = Number(response.headers.get('x-input-tokens'));
    const modelMs = Number(response.headers.get('x-inference-ms'));
    if (!Number.isFinite(tokens) || tokens <= 0 || !Number.isFinite(modelMs) || modelMs <= 0) throw new Error('Missing recorded metrics');
    entries.push({ demo: 'ax-pilot', scenario, route, body, pinned: true, recorded: { data, tokens, modelMs, generatedAt: new Date().toISOString() } });
    return data;
  });
  queue = next.then(() => sleep(850), () => sleep(850));
  return next;
};
const ask = {
  classify: (text, labels) => post('classify', { text, labels }),
  yesNo: async (text, statements) => (await post('yes-no', { text, statements })).results.map(result => result.probability),
};
for (const preset of PRESETS) {
  scenario = `sim-${preset.app.toLowerCase().replaceAll(' ', '-')}`;
  const app = APPS[preset.app];
  let state = app.initial();
  const history = [], typedTexts = [];
  let verified = false;
  for (let step = 1; step <= 12; step++) {
    const tree = flatten(snapshot(app, state), preset.goal);
    const ctx = { goal: preset.goal, step, textCandidates: textCandidates(preset.goal), typedTexts, history };
    const decision = decide(await askStep(tree, ctx, ask), tree, ctx);
    const { action, source } = decision;
    history.push({ step, action: action.kind, target: actionTarget(action), source });
    if (action.kind === 'type_text') typedTexts.push(action.text);
    state = applyAction(app, state, action);
    await sleep(app.settleMs?.(state) ?? 0);
    verified = Boolean(preset.verify(state));
    if (verified || isTerminal(action)) break;
  }
  outcomes.push({ scenario, verified, steps: history });
  console.log(scenario, verified ? 'verified' : 'not verified', history.length, 'steps');
}
for (const entry of RECORDED) {
  scenario = `recorded-${entry.file.toLowerCase()}`;
  const ctx = { goal: entry.goal, step: 1, textCandidates: textCandidates(entry.goal), typedTexts: [], history: [] };
  await askStep(entry.tree, ctx, ask);
}
await writeFile(new URL('./stock-recordings.json', import.meta.url), `${JSON.stringify(entries, null, 2)}\n`);
await writeFile(new URL('./stock-outcomes.json', import.meta.url), `${JSON.stringify(outcomes, null, 2)}\n`);
console.log(`${calls} real API responses captured across 10 scenarios`);
