// Sends the demo's real request bodies straight to the API and prints what comes back.
//   MS_API_KEY=sk-ms-... node src/demos/commit-sentry/smoke.mjs [--strict] [--messages]
// --messages adds a panel of commit messages scored against the claims the run produced, at
// several coverage floors. That panel is the measurement behind COVERAGE_MIN and the
// message-coverage limit published on the page.
// It drives runSentry() from data.ts, so what it checks is exactly what the island sends.
import {
  HUNKS, COMMIT_MESSAGE, FINDING_IDS, FINDING_LABELS, RULES,
  addedLines, evaluate, summariseFiles, runSentry, runRegexBaseline, compareWithBaseline, percentile,
} from "./data.ts";

const probs = (r) => r.results.map((s) => s.probability);

const KEY = process.env.MS_API_KEY;
if (!KEY) throw new Error("Set MS_API_KEY.");
const API = "https://api.milliseconds.ai/v1/decision-machine-1";
const STRICT = process.argv.includes("--strict");
// MSG="drop users.legacy_email, delete all audit_log rows, ..." to check the coverage step.
const MESSAGE = process.env.MSG || COMMIT_MESSAGE;

const calls = [];
const call = async (route, body) => {
  for (let attempt = 0; ; attempt++) {
    const t0 = performance.now();
    const res = await fetch(`${API}/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.status === 429 && attempt < 5) {
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`${route} ${res.status}: ${JSON.stringify(data)}`);
    const meta = {
      inferenceMs: Number(res.headers.get("x-inference-ms") ?? 0),
      tokens: Number(res.headers.get("x-input-tokens") ?? 0),
      wallMs: Math.round(performance.now() - t0),
    };
    calls.push(meta);
    return { data, meta };
  }
};

let last = null;
for await (const ev of runSentry(call, HUNKS, MESSAGE)) {
  last = ev;
  console.log(
    `  ${ev.step.padEnd(16)} /${ev.route.padEnd(9)} ${String(ev.meta.inferenceMs).padStart(5)} ms model` +
      `  ${String(ev.meta.wallMs).padStart(5)} ms round trip  ${ev.meta.tokens} tokens`,
  );
}

const { judgments, lineScores, message } = last;
const result = evaluate(HUNKS, judgments, message, STRICT);

console.log(`\nverdict: ${result.verdict.toUpperCase()}  (${result.blocking.length} blocking, ${result.warnings.length} warnings)\n`);

console.log("per hunk:");
for (const h of HUNKS) {
  const j = judgments.find((x) => x.hunkId === h.id);
  const hot = FINDING_IDS.filter((id) => j.findings[id] >= RULES[id].report).map((id) => `${FINDING_LABELS[id]} ${j.findings[id].toFixed(2)}`);
  const adds = addedLines(h);
  const off = j.offendingLineIndex !== null ? adds[j.offendingLineIndex] : null;
  console.log(`  ${h.id.padEnd(40)} risk ${j.risk.toFixed(2)} ${j.riskLevel.padEnd(9)} kind ${j.kind}`);
  if (hot.length) console.log(`      findings: ${hot.join(", ")}`);
  if (off) console.log(`      offending: +${off.t.trim()}`);
  else if (adds.length) console.log(`      offending: none`);
}

console.log("\nfiles:");
for (const f of summariseFiles(HUNKS, judgments, result.findings))
  console.log(`  ${f.file.padEnd(40)} risk ${f.maxRisk.toFixed(2)}  ${f.findings} findings  ${f.blocking} blocking  [${f.kinds.join(", ")}]`);

console.log(`\ncommit message: "${MESSAGE}"`);
console.log(`  covers ${message.claims.filter((c) => c.probability >= 0.5).length} of ${message.claims.length} changes -> ${message.matchesChanges.toFixed(3)} (mismatch under 0.35)`);
for (const c of message.claims) console.log(`    ${c.probability.toFixed(2)}  ${c.statement}`);
console.log(`  quality: ${message.quality.toFixed(2)} / 3 -> ${message.qualityLevel} (confidence ${message.qualityConfidence.toFixed(2)})`);

const base = runRegexBaseline(HUNKS);
const pairs = result.findings.filter((f) => f.id !== "risk" && f.id !== "message_mismatch").map((f) => ({ hunkId: f.hunkId, id: f.id }));
const cmp = compareWithBaseline(pairs, base.hits);
console.log(`\nregex baseline: ${base.rules} rules caught ${cmp.caught} of ${cmp.total} reported findings in ${base.elapsedMs.toFixed(2)} ms`);

// --messages: score a panel of commit messages against the claims this run produced, at
// several coverage floors. This is the measurement behind the message-coverage limit on the page.
if (process.argv.includes("--messages")) {
  const CLAIMS = message.claims.map((c) => c.statement);
  const PANEL = [
    ["seed (control)", COMMIT_MESSAGE],
    ["empty (control)", " "],
    ["wip (control)", "wip"],
    ["terse, generic nouns", "drop a column, rename a field, log creds, add a backdoor, hardcode a host, add a key, delete rows, leave debug code, skip a test"],
    ["terse, real identifiers", "drop legacy_email, rename total, log password, add backdoor, hardcode api url, add stripe key, delete audit rows, leave console.log, skip refund test"],
    ["terse, fuller nouns", "drop a column, rename an API field, log credentials, bypass auth, hard-code a host, add a secret key, delete table rows, leave debug code, skip a test"],
    ["loose prose", "drop the legacy_email column, rename total on the orders response, log the password, add a letmein token shortcut, add the stripe key, hard-code the api url, clear out audit_log, leave a console.log in, skip the refund test"],
    ["over-claiming (control)", "rotate every production credential, migrate the billing database, rewrite auth in Rust"],
    ["claims' own register", "Drop the legacy_email column from users, rename a field in the orders API response, write credentials to the log, add a branch that grants access without a credential, add an API key to the code, hard-code the API host and port, delete rows from audit_log, leave temporary debugging code in, and skip a test."],
  ];
  const FLOORS = [0.25, 0.3, 0.35, 0.4, 0.5];
  console.log(`\nmessage panel against the ${CLAIMS.length} claims above, coverage at each floor:`);
  for (const [label, text] of PANEL) {
    const r = await call("yes-no", { text: `Commit message: ${text.trim() || "(empty)"}`, statements: CLAIMS });
    const ps = probs(r.data);
    const cov = FLOORS.map((f) => `${f.toFixed(2)}: ${(ps.filter((p) => p >= f).length / ps.length).toFixed(3)}`).join("  ");
    console.log(`  ${label.padEnd(24)} ${ps.map((p) => p.toFixed(2)).join(" ")}   ${cov}`);
  }
}

const wall = calls.map((c) => c.wallMs);
console.log(
  `\n${calls.length} requests  |  ${lineScores.size} added lines scored  |  model p50 ${percentile(calls.map((c) => c.inferenceMs), 50)} ms` +
    `  |  round trip p50 ${percentile(wall, 50)} ms p95 ${percentile(wall, 95)} ms  |  ${calls.reduce((a, c) => a + c.tokens, 0)} input tokens`,
);
