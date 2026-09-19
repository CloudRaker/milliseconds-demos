// Sends the demo's real request bodies to the live API for the six seed drafts and prints
// every judgment next to the verdict the code policy derives from it.
//   MS_API_KEY=sk-... node src/demos/send-guard/smoke.mjs
// Node >= 22 strips the types out of ./data.ts on import, so the prompts have one copy.
import {
  CHANNELS, CORE_STATEMENTS, LEGAL_LEVELS, LEGAL_SCALE, SCENARIOS, THRESHOLDS, TONE_LEVELS,
  TUNING_DRAFTS, VERDICT_LABELS, decide, findSpans, isAuthorContact, judgeText,
  looksIncomplete, regexOnlyFlags, regexVerdict, spanHit, spanStatement, toneLevel,
} from "./data.ts";

// looksIncomplete() is policy now, not a statement, so it gets a check that needs no API key.
for (const [draft, want] of [
  ["Rolled back the relay because the signature check was rejecting v1 payloads and the", true],
  ["The root cause is TODO - I'll fill this in once Priya confirms.", true],
  ["Hi [name], thanks for the ticket.", true],
  ["Rollback is done, 5xx back to 0.1%.", false],
  ["Any chance you could take a look?", false],
  ["", false],
]) {
  if (looksIncomplete(draft) !== want) throw new Error(`looksIncomplete(${JSON.stringify(draft)}) should be ${want}`);
}

const KEY = process.env.MS_API_KEY;
if (!KEY) throw new Error("set MS_API_KEY");
const API = "https://api.milliseconds.ai/v1/decision-machine-1";

const samples = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The demo key is shared and capped at 200 requests a minute, so back off rather than die. */
async function post(route, body) {
  for (let attempt = 0; ; attempt++) {
    const t0 = performance.now();
    const res = await fetch(`${API}/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
    });
    const wallMs = Math.round(performance.now() - t0);
    if (res.status === 429 && attempt < 5) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${route} ${res.status}: ${await res.text()}`);
    samples.push({ wallMs, inferenceMs: Number(res.headers.get("x-inference-ms") ?? 0), tokens: Number(res.headers.get("x-input-tokens") ?? 0) });
    return res.json();
  }
}

const pct = (v) => `${String(Math.round(v * 100)).padStart(3)}%`;
const mark = (v, hit) => (v >= hit ? "<" : " ");
let correct = 0;
let regexCorrect = 0;
let tuningCorrect = 0;
/** Every measured probability per core key, so the tuning comments can be checked, not trusted. */
const spread = {};

for (const sc of [...SCENARIOS, ...TUNING_DRAFTS]) {
  const tuning = TUNING_DRAFTS.includes(sc);
  const channel = CHANNELS.find((c) => c.id === sc.channelId);
  const spans = findSpans(sc.draft);
  const text = judgeText(channel, sc.draft);

  // Exactly the three bodies the island sends: A on every typing pause, B with it, C on settle.
  const [a, b, legal] = await Promise.all([
    post("yes-no", { text, statements: [...CORE_STATEMENTS.map((s) => s.text), ...spans.map(spanStatement)] }),
    post("classify", { text, labels: VERDICT_LABELS }),
    post("rate", { text, scale: LEGAL_SCALE }),
  ]);

  const p = {};
  CORE_STATEMENTS.forEach((s, i) => (p[s.key] = a.results[i].probability));
  spans.forEach((s, i) => (p[s.id] = a.results[CORE_STATEMENTS.length + i].probability));

  const j = { p, verdict: b.label, verdictScore: b.scores[b.label], legal: legal.level };
  const d = decide(j, channel.audience, spans, sc.draft);
  const rx = regexVerdict(regexOnlyFlags(spans).map((s) => s.kind));
  const ok = d.verdict === sc.expect;
  if (tuning) {
    if (ok) tuningCorrect++;
  } else {
    if (ok) correct++;
    if (rx.verdict === sc.expect) regexCorrect++;
  }
  for (const s of CORE_STATEMENTS) (spread[s.key] ??= []).push(p[s.key]);

  console.log(`\n${ok ? "OK  " : "MISS"} ${tuning ? "[tuning] " : ""}${sc.title}  [${channel.name}]`);
  console.log(`     expect ${sc.expect} · policy ${d.verdict} (${d.reason}) · regex-only DLP ${rx.verdict} (${rx.reason})`);
  console.log(`     /classify ${b.label} ${Object.entries(b.scores).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(" ")}`);
  console.log(`     /rate legal ${LEGAL_LEVELS[legal.level]} (level ${legal.level}, score ${legal.score.toFixed(2)})${legal.level >= THRESHOLDS.legalWarn ? " <" : ""}`);
  console.log(`     tone from yes/no: ${TONE_LEVELS[toneLevel(p)]} · code looksIncomplete ${looksIncomplete(sc.draft) ? "yes" : "no"}`);
  for (const s of CORE_STATEMENTS) {
    const hit = s.key === "toneHostile" ? THRESHOLDS.hostile : THRESHOLDS.yes;
    console.log(`     ${pct(p[s.key])} ${mark(p[s.key], hit)} ${s.key}`);
  }
  for (const s of spans)
    console.log(`     ${pct(p[s.id])} ${mark(p[s.id], spanHit(s.kind))} span ${s.kind} "${s.text.slice(0, 44)}"${isAuthorContact(s) ? " (author's own — code carve-out)" : ""}`);
}

const med = (xs) => xs.slice().sort((x, y) => x - y)[Math.floor(xs.length / 2)];
console.log(`\nspread per statement over all ${SCENARIOS.length + TUNING_DRAFTS.length} drafts (min .. max):`);
for (const [k, xs] of Object.entries(spread))
  console.log(`     ${k.padEnd(19)} ${pct(Math.min(...xs))} .. ${pct(Math.max(...xs))}`);
console.log(`\npolicy correct on ${correct}/${SCENARIOS.length} seed drafts · regex-only DLP baseline ${regexCorrect}/${SCENARIOS.length}`);
console.log(`tuning regressions (author's own contact details, benign internal notes): ${tuningCorrect}/${TUNING_DRAFTS.length}`);
console.log(`${samples.length} calls · model time p50 ${med(samples.map((s) => s.inferenceMs))} ms · round trip p50 ${med(samples.map((s) => s.wallMs))} ms · ${samples.reduce((t, s) => t + s.tokens, 0)} input tokens`);
