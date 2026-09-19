// node src/demos/ax-pilot/stock-check.mjs — no credentials or network.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { APPS, PRESETS, RECORDED, applyAction, snapshot } from './data.ts';
import { askStep, decide, flatten, textCandidates, actionTarget, isTerminal } from './pilot.ts';
import { canonical } from '../../lib/example-contract.ts';
const entries = JSON.parse(await readFile(new URL('./stock-recordings.json', import.meta.url)));
const key = (route, body) => canonical({ route, body });
const byRequest = new Map();
for (const entry of entries) if (!byRequest.has(key(entry.route, entry.body))) byRequest.set(key(entry.route, entry.body), entry);
assert.equal(new Set(entries.map(entry => entry.scenario)).size, 10, 'all five simulation and five recorded-tree cases');
for (const entry of entries) {
  assert.equal(entry.demo, 'ax-pilot');
  assert.equal(entry.pinned, true, 'individual trace steps must never refresh independently');
  assert(Number.isFinite(entry.recorded.tokens) && entry.recorded.tokens > 0);
  assert(Number.isFinite(entry.recorded.modelMs) && entry.recorded.modelMs > 0);
  assert(Number.isFinite(Date.parse(entry.recorded.generatedAt)));
  assert(!byRequest.has(key(entry.route, { ...entry.body, text: `${entry.body.text} custom` })), 'custom input cannot match stock request');
}
const used = new Set();
let scenario;
const lookup = (route, body) => {
  const found = byRequest.get(key(route, body));
  assert(found, `unregistered request in ${scenario}`);

  used.add(found);
  return found.recorded.data;
};
const ask = {
  classify: async (text, labels) => lookup('classify', { text, labels }),
  yesNo: async (text, statements) => lookup('yes-no', { text, statements }).results.map(result => result.probability),
};
for (const preset of PRESETS) {
  scenario = `sim-${preset.app.toLowerCase().replaceAll(' ', '-')}`;
  const app = APPS[preset.app];
  let state = app.initial();
  const history = [], typedTexts = [];
  for (let step = 1; step <= 12; step++) {
    const tree = flatten(snapshot(app, state), preset.goal);
    const ctx = { goal: preset.goal, step, textCandidates: textCandidates(preset.goal), typedTexts, history };
    const { action, source } = decide(await askStep(tree, ctx, ask), tree, ctx);
    history.push({ step, action: action.kind, target: actionTarget(action), source });
    if (action.kind === 'type_text') typedTexts.push(action.text);
    state = applyAction(app, state, action);
    await new Promise(resolve => setTimeout(resolve, app.settleMs?.(state) ?? 0));
    if (preset.verify(state) || isTerminal(action)) break;
  }
  assert(preset.verify(state), `${scenario} goal is independently verified`);
}
for (const entry of RECORDED) {
  scenario = `recorded-${entry.file.toLowerCase()}`;
  await askStep(entry.tree, { goal: entry.goal, step: 1, textCandidates: textCandidates(entry.goal), typedTexts: [], history: [] }, ask);
}
assert.equal(used.size, byRequest.size, 'every unique recorded response is used by a published scenario');
console.log(`Pilot stock checks: ${used.size} real response records, all 10 scenarios, 5 independently verified goals; custom inputs unmatched.`);
