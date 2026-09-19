// Smoke test: runs the pure-logic self-check, then sends the demo's real request bodies to the
// live API and prints the answers, so the labels, statements and hints can be tuned offline.
//   MS_API_KEY=sk-... node src/demos/voice-turn/smoke.mjs
// Node 24 strips the TypeScript types on import, so this shares the demo's own modules.

import assert from "node:assert";
import { contactsIn, durationsIn, isReady, roomsIn, selfCheck, verdict, DEFAULT_POLICY } from "./engine.ts";
import { BARGE_IN, bargeInText, INTENT_LABELS, SCRIPT, SLOT_LABELS, SLOT_FOR_INTENT } from "./data.ts";

const API = "https://api.milliseconds.ai/v1/decision-machine-1";
const KEY = process.env.MS_API_KEY;

selfCheck((ok, msg) => assert(ok, msg));
console.log("self-check: policy, merge, extractor and reply assertions all pass\n");
if (!KEY) {
  console.error("MS_API_KEY not set: skipping the live calls.");
  process.exit(0);
}

let calls = 0;
const inference = [];
let tokens = 0;
async function post(route, body) {
  for (let attempt = 0; ; attempt++) {
    const t0 = Date.now();
    const res = await fetch(`${API}/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`${route} ${res.status}: ${JSON.stringify(data)}`);
    calls++;
    inference.push(Number(res.headers.get("x-inference-ms") ?? 0));
    tokens += Number(res.headers.get("x-input-tokens") ?? 0);
    return { data, wallMs: Date.now() - t0, inferenceMs: Number(res.headers.get("x-inference-ms") ?? 0) };
  }
}

const p = DEFAULT_POLICY;

// 1. The listening call, over the partials the browser actually sends: every other word, then the
// whole utterance. What matters is the verdict at the end of each utterance (answer now) and at the
// scripted 1.3 s hesitation after "send a message to" (keep listening).
console.log("/classify over the intent labels, one call per coalesced partial");
let wrong = 0;
for (const u of SCRIPT) {
  if (u.bargeIn) continue;
  const words = u.words.map((w) => w.text);
  const prefixes = [];
  for (let i = 2; i <= words.length; i += 2) prefixes.push(words.slice(0, i).join(" "));
  const full = words.join(" ");
  if (prefixes.at(-1) !== full) prefixes.push(full);
  for (const text of prefixes) {
    const { data, wallMs, inferenceMs } = await post("classify", { text, labels: INTENT_LABELS });
    const ready = isReady(data.label, text);
    const sample = { seq: 1, time: 0, intent: data.label, probability: data.probability, ready };
    // The real pause: 70 ms between words, ~400 ms once the speaker stops, and the scripted
    // 1.3 s hesitation in utterance 7. Only the end of an utterance should answer.
    const isEnd = text === full;
    const isHesitation = text === "send a message to";
    const pause = isEnd ? 400 : isHesitation ? 1300 : 70;
    const got = verdict(p, sample, pause, true);
    const ok = isEnd ? got === "judge" : got === null;
    if (!ok) wrong++;
    console.log(
      `  ${ok ? "ok  " : "MISS"} ${data.label.padEnd(13)} p=${data.probability.toFixed(2)} ready=${ready ? "y" : "n"} pause=${pause}ms -> ${got ?? "keep listening"} ${inferenceMs}ms/${wallMs}ms  "${text}"`,
    );
  }
}
console.log(`  ${wrong} partial(s) judged the wrong way\n`);

// 2. The speaking call: barge-in.
console.log("/yes-no while the assistant speaks");
const saying = "Turning the living room lights on.";
for (const [heard, want] of [
  ["stop stop", true],
  ["stop", true],
  ["no wait", true],
  ["ok thanks", false],
  ["uh", false],
  ["turning the living room lights on", false],
]) {
  const { data, inferenceMs } = await post("yes-no", {
    text: bargeInText(saying, heard),
    statements: [BARGE_IN.statement],
    when_true: BARGE_IN.when_true,
    when_false: BARGE_IN.when_false,
  });
  const prob = data.results[0].probability;
  const ok = prob >= p.bargeInThreshold === want ? "ok  " : "MISS";
  console.log(`  ${ok} p=${prob.toFixed(2)} ${inferenceMs}ms  "${heard}"`);
}

// 3. The fire-time call: pick the slot out of the regex candidates.
console.log("\n/classify over the regex candidates plus none, at fire time");
const EXTRACT = { timer_duration: durationsIn, room: roomsIn, contact: contactsIn };
for (const [text, intent, want] of [
  ["set a timer for ten minutes", "set_timer", "ten minutes"],
  ["set a timer for forty five minutes", "set_timer", "forty five minutes"],
  ["turn off the lights in the kitchen", "lights", "kitchen"],
  ["turn on the living room lights", "lights", "living room"],
  ["text mom I'll be late", "send_message", "mom"],
  ["send a message to Sarah saying I'm on my way", "send_message", "sarah"],
]) {
  const kind = SLOT_FOR_INTENT[intent];
  const candidates = EXTRACT[kind](text);
  const labels = { none: SLOT_LABELS[kind].none };
  for (const c of candidates) labels[c] = SLOT_LABELS[kind].hit;
  const { data, inferenceMs } = await post("classify", { text, labels });
  const ok = data.label === want ? "ok  " : `MISS(want ${want})`;
  console.log(`  ${ok} ${kind}=${data.label} ${inferenceMs}ms  candidates=[${candidates}]  "${text}"`);
}

const sorted = inference.sort((a, b) => a - b);
console.log(
  `\n${calls} calls · ${tokens} input tokens · model time p50 ${sorted[Math.floor(sorted.length / 2)]} ms · max ${sorted.at(-1)} ms`,
);
