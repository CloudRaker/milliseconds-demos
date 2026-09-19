// Sends the demo's real request bodies to the live API and scores them against the
// transcript's ground truth. Node 24 strips the types in the imports.
//   MS_API_KEY=sk-... node src/demos/live-minutes/smoke.mjs [--limit 60]
import { DEMO_LINES, MEETING, TRANSCRIPT } from "./data.ts";
import { windowCalls, resolveJudgment, bucketFor, supersedes, judgeFromTruth } from "./judge.ts";
import { MEETING as CTX } from "./data.ts";

// The offline fallback the page uses when the proxy is down. No API call, so it runs every time.
{
  const u = TRANSCRIPT.find((x) => x.truth.kind === "action_item" && x.truth.deadline !== "none");
  const j = judgeFromTruth(u.truth, u.text, CTX);
  if (bucketFor(j) !== "actions" || !j.deadline.label) throw new Error(`mock fallback broken on #${u.id}: ${JSON.stringify(j)}`);
}

const KEY = process.env.MS_API_KEY;
if (!KEY) throw new Error("Set MS_API_KEY");
const API = "https://api.milliseconds.ai/v1/decision-machine-1";
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) : TRANSCRIPT.length;
const WINDOW = 30;

const inference = [];
let calls = 0;
let tokens = 0;

async function post(route, body, attempt = 0) {
  const t0 = Date.now();
  const res = await fetch(`${API}/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (res.status === 429 && attempt < 5) {
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    return post(route, body, attempt + 1);
  }
  if (!res.ok) throw new Error(`${route} ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  calls++;
  tokens += Number(res.headers.get("x-input-tokens") ?? 0);
  inference.push(Number(res.headers.get("x-inference-ms") ?? 0));
  console.log(`  ${route.padEnd(8)} ${String(body.texts.length).padStart(2)} texts  ${String(res.headers.get("x-inference-ms")).padStart(4)} ms model  ${String(Date.now() - t0).padStart(4)} ms round trip`);
  return json.results;
}

const DEMO = process.argv.includes("--demo");
const rows = DEMO ? DEMO_LINES : TRANSCRIPT.slice(0, LIMIT);
const judgments = [];

for (let start = 0; start < rows.length; start += WINDOW) {
  const chunk = rows.slice(start, start + WINDOW);
  console.log(`window ${start}–${start + chunk.length - 1}`);
  const answers = {};
  for (const call of windowCalls(chunk)) answers[call.key] = await post(call.route, call.body);
  chunk.forEach((u, i) => judgments.push({ u, j: resolveJudgment(answers, i, u.text, MEETING) }));
}

/* ------------------------------------- --demo: the page's own run, end to end */

if (DEMO) {
  // Rebuild the note list the way Demo.tsx does, and assert the one interaction the
  // curated SEGMENTS exist for: the launch-date flip-flop strikes an earlier decision.
  const notes = [];
  let id = 1;
  for (const { u, j } of judgments) {
    const bucket = bucketFor(j);
    if (!bucket) continue;
    const note = { id: id++, lineId: u.id, bucket, text: u.text, supersededBy: null, reverses: j.reverses };
    if (bucket === "decisions" && j.reverses) {
      const prev = supersedes(notes, u.id);
      if (prev) prev.supersededBy = note.id;
    }
    notes.push(note);
  }
  const struck = notes.filter((n) => n.supersededBy);
  console.log(`\n${judgments.length} demo lines -> ${notes.length} notes`);
  for (const n of notes) {
    const tags = [n.supersededBy ? "REVERSED" : "", n.reverses ? "replaces-earlier" : ""].filter(Boolean).join(" ");
    console.log(`  ${n.bucket.padEnd(9)} ${n.text.slice(0, 82).padEnd(82)} ${tags}`);
  }
  const blocked = judgments.filter(({ j }) => j.blocked);
  console.log(`\nblocked tags: ${blocked.length}`);
  for (const { u } of blocked) console.log(`  #${u.id} ${u.text.slice(0, 92)}`);
  console.log(`\ncheck  strikethrough fires: ${struck.length > 0 ? "YES" : "NO"} (${struck.length} decision struck)`);
  if (!struck.length) {
    console.error("FAIL: no decision was superseded - the flip-flop the SEGMENTS were curated for did not render.");
    process.exit(1);
  }
  process.exit(0);
}

/* ------------------------------------------------------------------ scoring */

const TRUE_BUCKET = { action_item: "actions", decision: "decisions", open_question: "questions", risk: "risks" };
const wrong = { kind: [], assignee: [], deadline: [], reverses: [], blocked: [] };
let tasks = 0;
for (const { u, j } of judgments) {
  const t = u.truth;
  if (j.kind !== t.kind) wrong.kind.push([u, t.kind, j.kind]);
  if (t.kind === "action_item") {
    tasks++;
    const want = t.assignee ? t.assignee.split(" ")[0] : "nobody";
    if ((j.assignee ?? "nobody") !== want) wrong.assignee.push([u, want, j.assignee ?? "nobody"]);
    if (j.deadline.kind !== t.deadline) wrong.deadline.push([u, t.deadline, j.deadline.kind]);
  }
  if (j.reverses !== t.reverses) wrong.reverses.push([u, t.reverses, j.reverses]);
  if (j.blocked !== t.blocked) wrong.blocked.push([u, t.blocked, j.blocked]);
}

const pct = (bad, n) => `${(((n - bad) / n) * 100).toFixed(0)}%`;
const n = judgments.length;
inference.sort((a, b) => a - b);
console.log(`\n${n} lines · ${calls} calls · ${tokens} input tokens · model p50 ${inference[Math.floor(inference.length / 2)]} ms per ${WINDOW}-line call`);

const kept = judgments.filter(({ j }) => bucketFor(j));
const right = kept.filter(({ u, j }) => TRUE_BUCKET[u.truth.kind] === bucketFor(j)).length;
const truthNotes = judgments.filter(({ u }) => TRUE_BUCKET[u.truth.kind]).length;
console.log(`notes     ${kept.length} kept of ${n} lines · ${((right / kept.length) * 100).toFixed(0)}% land in the right list · ${((right / truthNotes) * 100).toFixed(0)}% of the ${truthNotes} real notes found`);

const shownTasks = kept.filter(({ u, j }) => j.kind === "action_item" && u.truth.kind === "action_item");
const owners = shownTasks.filter(({ u, j }) => (j.assignee ?? "nobody") === (u.truth.assignee ? u.truth.assignee.split(" ")[0] : "nobody")).length;
const dates = shownTasks.filter(({ u, j }) => j.deadline.kind === u.truth.deadline).length;
console.log(`owner     ${((owners / shownTasks.length) * 100).toFixed(0)}% right on the ${shownTasks.length} to-dos shown`);
console.log(`due date  ${((dates / shownTasks.length) * 100).toFixed(0)}% right on the same to-dos`);
console.log(`reversal  ${pct(wrong.reverses.length, n)} · blocked ${pct(wrong.blocked.length, n)} · every line, against ground truth`);
console.log(`raw kind  ${pct(wrong.kind.length, n)} over all six labels, before the ${"0.6"} keep threshold`);

for (const [key, list] of Object.entries(wrong)) {
  if (!list.length || process.argv.includes("--quiet")) continue;
  console.log(`\n-- ${key}: ${list.length} wrong`);
  for (const [u, truth, got] of list.slice(0, 14)) console.log(`  #${String(u.id).padStart(3)} ${truth} -> ${got}  ${u.speaker.split(" ")[0]}: ${u.text.slice(0, 92)}`);
}

console.log(`\nThe minutes the page would show (first 16 of ${kept.length}):`);
for (const { u, j } of kept.slice(0, 16)) {
  const owner = j.assigneeUncertain ? "who owns this?" : (j.assignee ?? "");
  const bits = [owner, j.deadline.label, j.blocked ? "blocked" : "", j.reverses ? "reverses" : ""].filter(Boolean).join(" · ");
  console.log(`  ${bucketFor(j).padEnd(9)} ${u.text.slice(0, 78).padEnd(78)} ${bits}`);
}
