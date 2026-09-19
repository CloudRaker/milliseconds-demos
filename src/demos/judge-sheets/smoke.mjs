/**
 * Sends the exact bodies this demo sends, to the real API, and prints the answers.
 *
 *   MS_API_KEY=sk-... node src/demos/judge-sheets/smoke.mjs
 *
 * Bodies come from predict.ts (`bodyFor`), texts from data.ts, so anything that
 * drifts between the page and this script is a bug in one of them. Node 22.12+
 * strips the types on import; no build step.
 */
import { generateLeads, generateReviews } from "./data.ts";
import { bodyFor, exactSchema, freeScale, INTENT_LABELS, instructionsFor, intentText, pickSchema, SCHEMAS, statementFor } from "./predict.ts";

const KEY = process.env.MS_API_KEY;
if (!KEY) {
  console.error("MS_API_KEY is not set");
  process.exit(1);
}
const BASE = "https://api.milliseconds.ai/v1/decision-machine-1";
const ROWS = 8;

const reviews = generateReviews(300);
const leads = generateLeads(150);
const clip = (s, n = 74) => (s.length > n ? s.slice(0, n - 1) + "…" : s).padEnd(n);

async function post(route, body) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/${route}`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const wall = Math.round(performance.now() - t0);
  const json = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json)}`);
  return { json, wall, inference: Number(res.headers.get("x-inference-ms") ?? 0), tokens: Number(res.headers.get("x-input-tokens") ?? 0) };
}

const byId = (id) => SCHEMAS.find((s) => s.id === id);
const spec = (schema, header = "") => ({
  kind: schema.kind,
  text: "",
  instructions: instructionsFor(schema, header),
  options: schema.options,
});

/** One /classify call per header: which of the 14 schemas is this? */
async function headers() {
  console.log("\n=== header → schema (/classify, 14 described labels)\n");
  const cases = [
    ["Reviews", "Sentiment", "sentiment"],
    ["Reviews", "Urgency", "urgency"],
    ["Reviews", "Topic", "topic"],
    ["Reviews", "Tone", "tone"],
    ["Reviews", "Priority", "priority"],
    ["Reviews", "Stars", "stars"],
    ["Reviews", "Defect?", "defect"],
    ["Reviews", "Refund risk?", "refund"],
    ["Leads", "Intent", "intent"],
    ["Leads", "Spam?", "spam"],
    ["Reviews", "Mentions a competitor?", "yesno"],
    ["Reviews", "Asks for a discount?", "yesno"],
    ["Reviews", "Enthusiasm", "scale"],
    ["Reviews", "Clarity", "scale"],
    // the four the classifier used to get wrong, now answered without a call
    ["Reviews", "Emotional tone", "tone"],
    ["Reviews", "Severity", "priority"],
    ["Reviews", "Category", "topic"],
    ["Leads", "Buying signal", "buying"],
  ];
  let wrong = 0;
  for (const [sheetName, header, want] of cases) {
    const exact = exactSchema(header);
    if (exact) {
      const ok = exact.id === want;
      if (!ok) wrong++;
      console.log(`${ok ? "ok  " : "MISS"} ${sheetName.padEnd(8)} "${header}"`.padEnd(42), `→ ${exact.label.padEnd(14)} exact match, no call`);
      continue;
    }
    const samples = (sheetName === "Leads" ? leads : reviews).slice(0, 3).map((r) => r.text);
    const { json, wall, inference } = await post("classify", { text: intentText(header, samples), labels: INTENT_LABELS });
    const { schema, fallback } = pickSchema(json.label, json.probability, header);
    const ok = schema.id === want;
    if (!ok) wrong++;
    console.log(
      `${ok ? "ok  " : "MISS"} ${sheetName.padEnd(8)} "${header}"`.padEnd(42),
      `→ ${schema.label.padEnd(14)} ${(json.probability * 100).toFixed(0)}%${fallback ? " (header shape)" : "               "} ${inference} ms model / ${wall} ms round trip`,
    );
    if (!ok) console.log(`     wanted ${want}, top scores:`, Object.entries(json.scores).sort((a, b) => b[1] - a[1]).slice(0, 3));
  }
  return wrong;
}

/** One batched call per column, exactly as the runner sends it. */
async function column(label, schemaId, texts, header = "") {
  const schema = byId(schemaId);
  const { route, body } = bodyFor(spec(schema, header));
  const { json, wall, inference, tokens } = await post(route, { texts, ...body });
  console.log(`\n=== ${label}  (/${route}, ${texts.length} texts, ${inference} ms model / ${wall} ms round trip, ${tokens} input tokens)`);
  if (route === "yes-no") console.log(`    statement: "${body.statement}"`);
  if (route === "rate") console.log(`    scale: ${body.scale.map((s) => `"${s}"`).join(" → ")}`);
  console.log();
  json.results.forEach((r, i) => {
    const answer =
      route === "yes-no"
        ? `${r.answer ? "Yes" : "No "} ${(r.probability * 100).toFixed(0)}%`
        : route === "classify"
          ? `${r.label} ${(r.probability * 100).toFixed(0)}%`
          : // the cell shows the rounded expected level, which is what the summary
            // formulas average; r.level is the single most likely level
            `${schema.options[Math.round(r.score)]} (${r.score.toFixed(2)}, argmax ${schema.options[r.level]})`;
    console.log(`  ${clip(texts[i])} → ${answer}`);
  });
}

/**
 * The fixtures know their own answers: a review carries a DEFECTS sentence or it
 * does not, a lead comes from the spam template or it does not. Statements and
 * label descriptions are tuned against these three scores, so a reworded hint
 * that reads better but judges worse shows up here.
 */
const DEFECT_SENTENCES = [
  "The motor started making a grinding noise on day three.",
  "One of the buttons stopped responding after a week.",
  "It arrived with a crack down the side.",
  "The battery won't hold a charge for more than an hour.",
  "There's a dead pixel right in the middle of the display.",
  "The lid doesn't seal and it leaks everywhere.",
  "It randomly shuts off mid-use.",
  "A stitched seam split open on the second day.",
];
const SPAM_OPENERS = [
  "Boost your SEO ranking",
  "we offer offshore development services",
  "your domain has been selected",
  "We noticed your website could use more traffic",
];
const LEAD_INTENT_MARKERS = {
  pricing: ["budget approved for Q4", "enterprise tier cost", "Looking to buy for our team", "Need pricing for 200 users", "curious what your pricing", "free tier", "cost for a solo user", "30-person customer service team", "contract ends in two months"],
  "demo request": ["schedule a demo", "walkthrough of the reporting", "show us how the integration", "see the product in action", "pending a final demo", "Send over a demo link"],
  support: ["Existing customer here", "can't log in after the password reset", "dashboard shows last month's", "add a second admin"],
  partnership: ["run a consultancy", "co-marketing webinar", "integration partnership"],
  "job inquiry": ["hiring frontend engineers", "offer internships", "account executive role"],
  spam: SPAM_OPENERS,
};

const truthDefect = (t) => DEFECT_SENTENCES.some((d) => t.includes(d) || t.includes(d.charAt(0).toLowerCase() + d.slice(1)));
const truthSpam = (t) => SPAM_OPENERS.some((s) => t.includes(s));
const truthIntent = (t) => Object.keys(LEAD_INTENT_MARKERS).find((k) => LEAD_INTENT_MARKERS[k].some((m) => t.includes(m))) ?? "?";

async function groundTruth() {
  console.log("\n=== answers vs the fixtures' own labels (32 rows each)\n");
  const rows = reviews.slice(0, 32).map((r) => r.text);
  const msgs = leads.slice(0, 32).map((l) => l.text);
  const out = [];

  for (const [name, schemaId, texts, truth] of [
    ["Defect?", "defect", rows, truthDefect],
    ["Spam?", "spam", msgs, truthSpam],
  ]) {
    const schema = byId(schemaId);
    const { body } = bodyFor(spec(schema));
    const { json } = await post("yes-no", { texts, ...body });
    const wrong = json.results.filter((r, i) => r.answer !== truth(texts[i]));
    out.push([name, texts.length - wrong.length, texts.length]);
    for (const [i, r] of json.results.entries())
      if (r.answer !== truth(texts[i])) console.log(`  ${r.answer ? "false yes" : "missed   "} ${(r.probability * 100).toFixed(0)}%  ${clip(texts[i])}`);
  }

  const intent = byId("intent");
  const { json } = await post("classify", { texts: msgs, ...bodyFor(spec(intent)).body });
  const bad = json.results.filter((r, i) => r.label !== truthIntent(msgs[i]));
  out.push(["Intent", msgs.length - bad.length, msgs.length]);
  for (const [i, r] of json.results.entries())
    if (r.label !== truthIntent(msgs[i])) console.log(`  want ${truthIntent(msgs[i])}, got ${r.label} ${(r.probability * 100).toFixed(0)}%  ${clip(msgs[i], 60)}`);

  console.log();
  for (const [name, ok, total] of out) console.log(`  ${name.padEnd(10)} ${ok}/${total}`);
  return out;
}

const missed = await headers();
const rt = reviews.slice(0, ROWS).map((r) => r.text);
const lt = leads.slice(0, ROWS).map((l) => l.text);

await column("Reviews · Sentiment", "sentiment", rt);
await column("Reviews · Star rating", "stars", rt);
await column("Reviews · Topic", "topic", rt);
await column("Reviews · Defect?", "defect", rt);
await column("Reviews · Refund risk?", "refund", rt);
await column("Reviews · Urgency", "urgency", rt);
await column("Leads · Intent", "intent", lt);
await column("Leads · Buying intent", "buying", lt);
await column("Leads · Spam?", "spam", lt);
await column('Reviews · free-form yes/no "Mentions a competitor?"', "yesno", rt, "Mentions a competitor?");
await column('Reviews · free-form scale "Enthusiasm"', "scale", rt, "Enthusiasm");

const scored = await groundTruth();

console.log(`\nfree-form rewrites: "${statementFor("Mentions a competitor?")}" · ${JSON.stringify(freeScale("Enthusiasm"))}`);
console.log(missed === 0 ? "header routing: all cases matched" : `header routing: ${missed} case(s) picked another schema`);
console.log(`ground truth: ${scored.map(([n, ok, total]) => `${n} ${ok}/${total}`).join(" · ")}`);
