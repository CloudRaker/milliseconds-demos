// Sends the demo's real request bodies straight to the API, scores the answers and
// fails when they regress.
//   MS_API_KEY=sk-ms-... node src/demos/inbox-blitz/smoke.mjs ["an intent"]
// The probe batch is the 20 hand-written traps (the emails keyword rules get wrong)
// plus 12 ordinary ones, so one batch of 32 exercises all four triage calls.
// TRAP_CATEGORY below is the original Jev experiment's own recorded answer for each
// trap (jev-experiments/inbox-blitz/server/mock-answers.json). It is the only ground
// truth this demo has, so the category answer is scored against it and asserted.
import { EMAILS, emailText, URGENCY_LEVELS, SENTIMENT_LEVELS } from "./data.ts";
import { CATEGORY_LABELS, STATEMENTS, STATEMENT_KEYS, URGENCY_SCALE, SENTIMENT_SCALE, intentStatement, classifyRules, HUMAN_CONFIDENCE, lane, toCategory } from "./logic.ts";

/** The original experiment's recorded category for each trap. */
const TRAP_CATEGORY = {
  m080: "other", // Re: Re: Re: Ticket 44120
  m082: "billing", // Great job guys
  m131: "sales_lead", // Evaluating options for Q1
  m145: "feature_request", // It's broken that I can't export to CSV
  m154: "billing", // Question about my invoice (I'm NOT cancelling!)
  m175: "bug", // Password reset link goes to a blank page
  m197: "bug", // not urgent at all
  m212: "other", // THANK YOU!!!
  m242: "billing", // Re: Duplicate charge on order 88213
  m293: "spam_marketing", // quick favor
  m300: "spam_marketing", // ASAP: 70% off ends at midnight!!!
  m325: "spam_marketing", // New: automated refund workflows...
  m335: "other", // Heads up on next month
  m339: "bug", // Re: Login loop on iPad
  m346: "spam_marketing", // Emergency preparedness: 7 critical steps...
  m364: "billing", // Numbers don't match
  m377: "bug", // small thing whenever you have a moment
  m401: "legal_privacy", // wipe my stuff
  m449: "spam_marketing", // Completed: Please review and sign your document
  m494: "spam_marketing", // URGENT: your security score dropped this week
};
/** Measured floor. The label set in logic.ts scores 12/20; the pre-fix one scored 5/20. */
const CATEGORY_FLOOR = 11;

// Offline guards for the two pure-logic fixes, before anything costs money.
import assert from "node:assert";
import { labelName } from "./logic.ts";
assert.strictEqual(labelName("..."), "...", "labelName must survive a punctuation-only intent");
assert.strictEqual(
  lane({ category: "spam_marketing", categoryConfidence: 0.9, categoryProbabilities: {}, needsReply: 0.1, urgency: 0.2, urgencyConfidence: 0.9, sentiment: 1, sentimentConfidence: 0.9, isPhishingOrScam: 0.76, mentionsChurnOrCancel: 0, asksForRefund: 0 }),
  "spam",
  "a high phishing probability must not route a marketing blast into Priority",
);
assert.strictEqual(EMAILS.filter((e) => e.trap).length, 20, "20 hand-written traps");
assert.deepStrictEqual(EMAILS.filter((e) => e.trap).map((e) => e.id), Object.keys(TRAP_CATEGORY), "trap ids must still line up with the recorded answers");

const KEY = process.env.MS_API_KEY;
if (!KEY) throw new Error("Set MS_API_KEY");
const API = "https://api.milliseconds.ai/v1/decision-machine-1";

let calls = 0;
let tokens = 0;
const inferenceMs = [];

async function post(route, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`${route} ${res.status}: ${await res.text()}`);
    calls++;
    tokens += Number(res.headers.get("x-input-tokens") ?? 0);
    inferenceMs.push(Number(res.headers.get("x-inference-ms") ?? 0));
    return res.json();
  }
}

const traps = EMAILS.filter((e) => e.trap);
const batch = [...traps, ...EMAILS.filter((e) => !e.trap).slice(0, 32 - traps.length)];
const texts = batch.map(emailText);
console.log(`probe: ${batch.length} emails (${traps.length} traps), 4 triage calls + 1 label call\n`);

// Exactly what Demo.tsx sends for one batch, in the same order.
const cat = await post("classify", { texts, labels: CATEGORY_LABELS });
const bools = await post("yes-no", { texts, statements: STATEMENT_KEYS.map((k) => STATEMENTS[k]) });
const urg = await post("rate", { texts, scale: URGENCY_SCALE });
const sent = await post("rate", { texts, scale: SENTIMENT_SCALE });

const pct = (p) => `${String(Math.round(p * 100)).padStart(3)}%`;
let lowConf = 0;
let categoryOk = 0;
const confidentlyWrong = [];
const judgments = {};
for (let i = 0; i < batch.length; i++) {
  const e = batch[i];
  const b = Object.fromEntries(STATEMENT_KEYS.map((k, n) => [k, bools.results[i].results[n].probability]));
  const j = {
    category: toCategory(cat.results[i].label),
    categoryConfidence: cat.results[i].confidence,
    categoryProbabilities: cat.results[i].scores,
    urgency: urg.results[i].score,
    sentiment: sent.results[i].score,
    ...b,
  };
  if (j.categoryConfidence < HUMAN_CONFIDENCE) lowConf++;
  if (e.trap) {
    if (j.category === TRAP_CATEGORY[e.id]) categoryOk++;
    else if (j.categoryConfidence >= HUMAN_CONFIDENCE) confidentlyWrong.push(`${e.id} ${TRAP_CATEGORY[e.id]} -> ${j.category}`);
    judgments[e.id] = j;
  }
  const rule = classifyRules(e);
  console.log(
    `${e.trap ? "TRAP" : "    "} ${e.id} ${e.subject.slice(0, 42).padEnd(42)} | ` +
      `${j.category.padEnd(15)} ${pct(j.categoryConfidence)} | ${lane(j).padEnd(8)} | ` +
      `reply ${pct(j.needsReply)} | urg ${URGENCY_LEVELS[Math.round(j.urgency)].padEnd(15)} | ` +
      `sent ${SENTIMENT_LEVELS[Math.round(j.sentiment)].padEnd(10)} | ` +
      `phish ${pct(j.isPhishingOrScam)} churn ${pct(j.mentionsChurnOrCancel)} refund ${pct(j.asksForRefund)}` +
      (e.trap ? `\n       truth: ${TRAP_CATEGORY[e.id]}${j.category === TRAP_CATEGORY[e.id] ? " ✓" : " ✗"}` : "") +
      (e.trap
        ? `\n       rules: ${rule.category}/${URGENCY_LEVELS[rule.urgency]}/${SENTIMENT_LEVELS[rule.sentiment]}` +
          `${rule.isPhishingOrScam ? "/phish" : ""}${rule.mentionsChurnOrCancel ? "/churn" : ""}${rule.asksForRefund ? "/refund" : ""}` +
          `\n       trap:  ${e.trap}`
        : ""),
  );
}

// One intent-label call, the same body the search bar sends.
const intent = process.argv[2] ?? "customers threatening to cancel";
const statement = intentStatement(intent);
const label = await post("yes-no", { texts, statement });
const hits = batch
  .map((e, i) => [e, label.results[i].probability])
  .filter(([, p]) => p >= 0.5)
  .sort((a, b) => b[1] - a[1]);
console.log(`\nintent "${intent}" -> "${statement}"`);
for (const [e, p] of hits) console.log(`  ${pct(p)} ${e.id} ${e.subject.slice(0, 60)}`);
if (hits.length === 0) console.log("  no matches in this batch");

console.log(`\ncategory vs the original experiment's own answers: ${categoryOk}/20 traps correct (floor ${CATEGORY_FLOOR})`);
if (confidentlyWrong.length) console.log(`  wrong above the ${HUMAN_CONFIDENCE} confidence bar, so they skip Needs-review: ${confidentlyWrong.join(", ")}`);

inferenceMs.sort((a, b) => a - b);
console.log(
  `\n${calls} calls · ${lowConf}/${batch.length} below the ${HUMAN_CONFIDENCE} category confidence bar (Needs review lane)` +
    ` · model time p50 ${inferenceMs[Math.floor(calls / 2)]} ms · ${tokens.toLocaleString()} input tokens · $${(tokens * 0.04e-6).toFixed(5)}`,
);

// The dimensions measured as strong. These fail loudly if a statement or a scale regresses.
assert.ok(categoryOk >= CATEGORY_FLOOR, `category scored ${categoryOk}/20 traps, below the ${CATEGORY_FLOOR} floor`);
assert.ok(judgments.m082.sentiment >= 1.5, `m082 is sarcasm over a double charge, not the friendly note the rules see; sentiment read ${judgments.m082.sentiment}`);
assert.ok(judgments.m197.urgency >= 2.5, `m197 is a sarcastic "not urgent" outage; urgency read ${judgments.m197.urgency}`);
assert.ok(judgments.m154.mentionsChurnOrCancel < 0.1, `m154 says three times she is NOT cancelling; churn read ${judgments.m154.mentionsChurnOrCancel}`);
assert.ok(judgments.m242.needsReply < 0.5, `m242 is a resolved thread; needsReply read ${judgments.m242.needsReply}`);
console.log("asserts passed");
