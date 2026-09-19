// Offline self-check, no API key and no network: node src/demos/ax-pilot/check.mjs
// Covers the three pieces of logic that decide what the page does between calls.
import assert from "node:assert/strict";
import { APPS, PRESETS, RECORDED } from "./data.ts";
import { textCandidates, decide, THRESHOLDS } from "./pilot.ts";

// 1. The recorded JSON decodes and the ported flattener prunes it to the counts the page prints.
const expected = {
  Calculator: [105, 22, "Calculator"],
  TextEdit: [177, 15, "Untitled"],
  Safari: [293, 12, "Start Page"],
  Notes: [199, 1, "Notes"],
  SystemSettings: [273, 25, "System Settings"],
};
for (const entry of RECORDED) {
  const [rawNodes, elements, windowTitle] = expected[entry.file];
  assert.equal(entry.rawNodes, rawNodes, `${entry.file} raw nodes`);
  assert.equal(entry.tree.elements.length, elements, `${entry.file} pruned elements`);
  assert.equal(entry.tree.windowTitle, windowTitle, `${entry.file} window title`);
}
assert.equal(RECORDED.find((e) => e.file === "Notes").tree.hasModalSheet, true, "Notes welcome sheet");

// 2. Overlapping text candidates collapse: typing the sub-expression after the whole one strands the app.
assert.deepEqual(textCandidates("In Calculator compute 7*(3+4)"), ["7*(3+4)"]);
assert.deepEqual(textCandidates("In Safari open a new tab and go to milliseconds.ai"), ["milliseconds.ai"]);
assert.deepEqual(textCandidates("In Calculator compute 48*12"), ["48*12"]);

// 3. The early-done branch needs the Swift bar AND a low needs_text, or a Safari start page ends "done".
const tree = { elements: [], contextText: [], hasModalSheet: false, appName: "Safari", windowTitle: "Start Page" };
const ctx = { goal: "In Safari open a new tab and go to milliseconds.ai", step: 2, textCandidates: ["milliseconds.ai"], typedTexts: [], history: [{ step: 1, action: "press", target: "button 'New Tab'", source: "model" }] };
const ask = (goalReached, needsText) => ({ choice: undefined, confidence: 0, probabilities: [], goalReached, needsText, destructive: 0 });
assert.notEqual(decide(ask(0.79, 0.1), tree, ctx).action.kind, "done", "0.79 is below the Swift bar");
assert.notEqual(decide(ask(0.95, 0.9), tree, ctx).action.kind, "done", "still wants to type");
assert.equal(decide(ask(0.95, 0.1), tree, ctx).action.kind, "done");
assert.equal(THRESHOLDS.goalReached, 0.8, "the Swift AnswerHandler value");

// 4. The needs_text veto is spent once the candidate is typed, or "done" is unreachable for the
// rest of the run: the statement stays true of the text that is already sitting in the field.
const typedCtx = { ...ctx, typedTexts: ["milliseconds.ai"] };
assert.equal(decide(ask(0.95, 0.9), tree, typedCtx).action.kind, "done", "nothing left to type");
assert.notEqual(decide(ask(0.79, 0.1), tree, typedCtx).action.kind, "done", "the Swift bar still applies");

// 5. Completion is an app-state fact, not a model probability or text merely entered in a field.
for (const preset of PRESETS) assert.equal(Boolean(preset.verify(APPS[preset.app].initial())), false, preset.app);
const safari = APPS.Safari;
const verifySafari = PRESETS.find(p => p.app === "Safari").verify;
let state = safari.press(safari.initial(), "newtab");
state = safari.typeText(state, "milliseconds.ai");
assert.equal(verifySafari(state), false, "typing an address is not navigation");
state = safari.pressKey(state, "Return");
assert.equal(verifySafari(state), false, "loading is not a finished page");
assert.equal(verifySafari({ ...state, loadingUntil: 0 }), true, "loaded in the new tab");
state = safari.press(safari.press(safari.initial(), "newtab"), "tab0");
state = safari.pressKey(safari.typeText(state, "milliseconds.ai"), "Return");
assert.equal(verifySafari({ ...state, loadingUntil: 0 }), false, "original tab is not the new tab");
const settings = APPS["System Settings"];
assert.equal(PRESETS[4].verify(settings.press(settings.initial(), "appearance:Dark")), true);
assert.equal(PRESETS[4].verify(settings.press(settings.initial(), "pane:Appearance")), false, "opening Appearance is not selecting Dark");

console.log("ax-pilot check: ok");
