// Sends the demo's real request bodies to the live API and prints the answers.
//   MS_API_KEY=sk-... node src/demos/agent-assist/smoke.mjs
// Three rounds (after message 1, 3 and 5 of every chat), each one batch of five calls
// covering all eight chats, exactly like the browser batcher does.

import {
  SCRIPTS,
  MACRO_LABELS,
  INTENT_LABELS,
  CHURN_SCALE,
  FRUSTRATION_SCALE,
  SIGNALS,
  STATEMENTS,
  toSignals,
  transcript,
  lastCustomerText,
  AUTO_FILL_CONFIDENCE,
  CLOSING,
  CLOSING_YES,
  YES,
} from "./data.ts";

const KEY = process.env.MS_API_KEY;
if (!KEY) throw new Error("set MS_API_KEY");
const API = "https://api.milliseconds.ai/v1/decision-machine-1";
let calls = 0;
const infer = [];
const wall = [];
let tokens = 0;

async function post(route, body) {
  const t0 = Date.now();
  const res = await fetch(`${API}/${route}`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${route} ${res.status}: ${text.slice(0, 300)}`);
  calls++;
  infer.push(Number(res.headers.get("x-inference-ms") ?? 0));
  wall.push(Date.now() - t0);
  tokens += Number(res.headers.get("x-input-tokens") ?? 0);
  return JSON.parse(text);
}

const p50 = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const pct = (p) => `${Math.round(p * 100)}%`;

for (const depth of [1, 3, 5]) {
  const chats = SCRIPTS.map((s) => {
    const messages = s.messages.slice(0, depth).map((m) => ({ role: "customer", text: m.text }));
    // one agent reply in the middle, like the auto-send does
    if (depth >= 3) messages.splice(1, 0, { role: "agent", text: "Thanks — let me take a look at that right away." });
    return { script: s, messages };
  });
  const transcripts = chats.map((c) => transcript(c.messages, c.script.customer));
  const latest = chats.map((c) => lastCustomerText(c.messages));

  const [macro, intent, churn, frustration, flags] = await Promise.all([
    post("classify", { texts: transcripts, labels: MACRO_LABELS }),
    post("classify", { texts: transcripts, labels: INTENT_LABELS }),
    post("rate", { texts: transcripts, scale: CHURN_SCALE }),
    post("rate", { texts: latest, scale: FRUSTRATION_SCALE }),
    post("yes-no", { texts: transcripts, statements: STATEMENTS }),
  ]);

  console.log(`\n=== after customer message ${depth} of 5 — one batch of 5 calls for all 8 chats ===`);
  chats.forEach((c, i) => {
    const m = macro.results[i];
    const probabilities = flags.results[i].results.map((r) => r.probability);
    const closing = probabilities[CLOSING];
    const gate =
      m.label === "none" || closing >= CLOSING_YES ? "none" : m.confidence >= AUTO_FILL_CONFIDENCE ? "AUTO" : "options";
    const signals = toSignals(probabilities);
    const fired = SIGNALS.filter((f) => signals[f.key] >= YES).map((f) => f.key);
    console.log(
      [
        c.script.id.padEnd(3),
        c.script.label.padEnd(18),
        `intent=${intent.results[i].label.padEnd(20)} ${pct(intent.results[i].confidence)}`,
        `churn=${churn.results[i].score.toFixed(2)}`,
        `frust=${frustration.results[i].score.toFixed(2)}`,
        `macro=${m.label.padEnd(28)} ${pct(m.confidence)} ${gate.padEnd(7)}`,
        `close=${pct(closing)}`,
        `flags=[${fired.join(",")}]`,
      ].join("  "),
    );
    console.log(`     latest: ${latest[i].slice(0, 90)}`);
  });
}

console.log(
  `\n${calls} calls · model p50 ${p50(infer)} ms · round trip p50 ${p50(wall)} ms · ${tokens} input tokens`,
);
