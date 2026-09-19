// Sends the demo's real request bodies to the live API and prints the answers.
//   MS_API_KEY=sk-... node src/demos/jev-lint/smoke.mjs [--pairs] [--files] [--typed] [sample-id ...]
// Needs Node 22+ (it imports the demo's .ts modules directly via type stripping).
//
// Three checks, all on by default:
//   --pairs  every probe must separate each defective line from its corrected twin by
//            MARGIN raw probability. This is the gate that keeps a threshold from being
//            picked inside the noise; a probe that stops separating must not ship. It also
//            runs the unmarkable negatives (no sink, or a sink with no glue: both are where
//            the probe over-fired) and one candidate statement per dropped kind, so the
//            page's "no wording separated them" is re-measured rather than asserted.
//   --files  the same lines the page judges: scanLines, chunked to 32, MAX_BATCHES batches,
//            scored against the planted issues the demo's probes actually claim.
//   --typed  both typing buttons through the real edit path. Every sample's first snippet
//            plants a string-built query, command or path, so it must end up with at least one
//            marker: it is the flagship interaction and a dead button must fail the script.
//            The second plants a dropped kind, and the page says nothing lights up, so a
//            marker on it fails the script too.

import { changedLines, enclosingFunction, extractFunctions } from "./analysis.ts";
import { evaluate, inScope as scopeOf, pct } from "./eval.ts";
import { bareText, batchTexts, buildRefs, clusterMarkers, hasGlue, hasSink, markersFromAnswers, PROBE_IDS, PROBES, RAISE, SEVERITY_LABELS, scanLines } from "./markers.ts";
import { SAMPLES } from "./data.ts";

const KEY = process.env.MS_API_KEY;
if (!KEY) throw new Error("set MS_API_KEY");
const API = "https://api.milliseconds.ai/v1/decision-machine-1";
/** same ceiling as Demo.tsx MAX_BATCHES */
const MAX_BATCHES = 2;
/** a probe ships only if its pairs separate by at least this much raw probability */
const MARGIN = 0.15;

const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith("--"));
const flags = ["--pairs", "--files", "--typed"].filter((f) => args.includes(f));
const wants = (f) => flags.length === 0 || flags.includes(f);
const wantPairs = wants("--pairs");
const wantFiles = wants("--files");
const wantTyped = wants("--typed");

let calls = 0;
let tokens = 0;
const inference = [];
const wall = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Mirrors src/lib/dm1.ts: retry 429 with the server's retry-after, throw on anything else. */
async function post(route, body) {
  for (let attempt = 0; ; attempt++) {
    const t0 = performance.now();
    const res = await fetch(`${API}/${route}`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 8) {
      const retry = Number(res.headers.get("retry-after") ?? 1);
      await sleep(Math.min(8000, (retry || 1) * 1000 * (attempt + 1)));
      continue;
    }
    const json = await res.json();
    if (!res.ok) throw new Error(`${route} ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    calls++;
    tokens += Number(res.headers.get("x-input-tokens") ?? 0);
    inference.push(Number(res.headers.get("x-inference-ms") ?? 0));
    wall.push(Math.round(performance.now() - t0));
    await sleep(500); // page-wide rate is 2 calls/s
    return json;
  }
}

const prob = (r) => (r.results ? r.results[0] : r).probability;

// ---------------------------------------------------------------- contrasting pairs
// One defective line and the same line written correctly. `probe` is the probe that claims
// the pair; pairs with `null` belong to the planted kinds no probe separated, and are kept
// so a wording that finally cracks one of them shows up here instead of being guessed at.
const PAIRS = [
  ["injection", "python", 'row = conn.execute(f"SELECT id, name FROM users WHERE id = \'{user_id}\'").fetchone()', 'row = conn.execute("SELECT id, name FROM users WHERE id = ?", (user_id,)).fetchone()'],
  ["injection", "go", 'row := s.db.QueryRow("SELECT name FROM users WHERE id = " + id)', 'row := s.db.QueryRow("SELECT name FROM users WHERE id = ?", id)'],
  ["injection", "sql", "RETURN QUERY EXECUTE 'SELECT * FROM orders WHERE id = ' || p_id;", "RETURN QUERY SELECT * FROM orders WHERE id = p_id;"],
  ["injection", "typescript", 'const user = await db.query("SELECT * FROM users WHERE id = \'" + order.userId + "\'");', 'const user = await db.query("SELECT * FROM users WHERE id = $1", [order.userId]);'],
  ["injection", "go", 'out, err := exec.Command("sh", "-c", "ping -c 1 "+host).Output()', 'out, err := exec.Command("ping", "-c", "1", host).Output()'],
  ["injection", "rust", 'let output = Command::new("sh").arg("-c").arg(format!("{} {}", script, user_arg)).output();', 'let output = Command::new(script).arg(user_arg).output();'],
  ["injection", "bash", 'psql "postgres://app:$DB_PASSWORD@db/orders" -c "$(cat $sql_file)"', 'psql "$DB_URL" -f "$sql_file"'],
  // the typed snippets of "Type it for me": the flagship interaction is gated too, so a
  // wording change that stops lighting them up fails here instead of shipping silent
  ["injection", "typescript", `const sql = "SELECT * FROM users WHERE email = '" + email + "'";`, `const sql = "SELECT * FROM users WHERE email = $1";`],
  ["injection", "python", 'os.system("rm -rf " + base_dir + "/" + name)', 'subprocess.run(["rm", "-rf", os.path.join(base_dir, os.path.basename(name))])'],
  ["injection", "sql", "RETURN QUERY EXECUTE 'SELECT * FROM users WHERE email = ''' || p_email || '''';", "RETURN QUERY SELECT * FROM users WHERE email = p_email;"],
  ["injection", "bash", `QUERY="SELECT * FROM users WHERE email = '"$email"'"`, `QUERY='SELECT * FROM users WHERE email = $1'`],
  ["injection", "rust", `let query = format!("SELECT * FROM items WHERE sku = '{}'", sku);`, `let query = "SELECT * FROM items WHERE sku = ?";`],
  // os.path.join does not build a string, so the probe reads it as the safe form (0.647 vs
  // 0.691 on its own twin). It stays here unclaimed, and the page lists it as out of scope.
  [null, "python", "path = os.path.join(base_dir, name)", "path = os.path.join(base_dir, os.path.basename(name))"],
  [null, "go", 'return fmt.Sprintf("%x", rand.Int63())', "return hex.EncodeToString(cryptoRandBytes(32))"],
  [null, "go", "sum := md5.Sum([]byte(pw))", "sum, err := bcrypt.GenerateFromPassword([]byte(pw), 12)"],
  [null, "python", 'return "".join(random.choice("abcdef0123456789") for _ in range(32))', "return secrets.token_hex(16)"],
  [null, "typescript", 'const secret = "sk_live_9f8a7b6c5d4e3f2a1b0c";', "const secret = process.env.STRIPE_SECRET_KEY;"],
  [null, "bash", 'DB_PASSWORD="hunter2-prod-2024"', 'DB_PASSWORD="$(cat /run/secrets/db_password)"'],
  [null, "rust", '"AKIAIOSFODNN7EXAMPLE"', 'std::env::var("AWS_ACCESS_KEY_ID")?.as_str()'],
  // no shipped probe claims these. The six above are weak crypto and hardcoded secrets: a
  // probe for them separated 4 of 6 pairs but drifted upward in a 32-line file batch until
  // it fired on everything, so it was dropped. The rest are the four dropped kinds.
  [null, "typescript", "return items[items.length];", "return items[items.length - 1];"],
  [null, "go", "for i := 0; i <= len(xs); i++ {", "for i := 0; i < len(xs); i++ {"],
  [null, "sql", "DELETE FROM users WHERE email LIKE '%@example.com' OR 1 = 1;", "DELETE FROM users WHERE email LIKE '%@example.com';"],
  [null, "typescript", "const hasCoupon = code === undefined;", "const hasCoupon = code !== undefined;"],
  [null, "python", 'is_invalid = "@" in address and "." in address', 'is_valid = "@" in address and "." in address'],
  [null, "rust", "let in_stock = item.qty == 0;", "let in_stock = item.qty > 0;"],
  [null, "python", "row = conn.execute(SELECT_ONE, (user_id,)).fetchone()", "rows = conn.execute(SELECT_MANY, (tuple(user_ids),)).fetchall()"],
];

/**
 * Lines that must never be marked, whatever the model says, because the probe was never
 * measured on them: every pair above has a sink AND something glued into it on both halves.
 * Two ways to fall outside that:
 *
 *  - no sink. The line runs no query, no command and no path. Ungated, plain logging
 *    concatenation came back at 0.947 and drew a red security error.
 *  - no glue. The line has a sink but nothing from outside is spliced into it: a fixed string
 *    literal, or a `$1` / `?` / `%s` bound call. Gated on the sink alone, the most ordinary
 *    safe database line there is scored 0.780 on the edit path and 0.712-0.780 on the scan
 *    path. Wording did not close it; `hasGlue` does.
 *
 * This is the block that fails a future wording or threshold change that reopens either hole.
 */
const UNMARKABLE = [
  // no sink
  ["typescript", "return n + suffix;"],
  ["typescript", 'const line = "user=" + userId + " action=" + action;'],
  ["typescript", "const grand = total + tax + shipping;"],
  ["typescript", 'console.log("user " + userId + " did " + action);'],
  ["python", 'msg = "user=" + user_id + " action=" + action'],
  ["python", "total = sum(item.price for item in cart) + shipping"],
  ["go", 'msg := "user=" + userId + " action=" + action'],
  ["rust", 'let msg = format!("user={} action={}", user, action);'],
  ["bash", 'echo "done"'],
  // sink, no glue: a fixed literal query, the three twins the verifier measured at 0.78-0.80
  ["typescript", 'const rows = await db.query("SELECT id, name FROM users WHERE active = true");'],
  ["python", 'rows = conn.execute("SELECT id, name FROM users WHERE active = 1").fetchall()'],
  ["go", 'rows, err := s.db.Query("SELECT id, name FROM users WHERE active = true")'],
  ["typescript", 'const ACTIVE = "SELECT id, name FROM users WHERE active = true";'],
  // sink, no glue: bound parameters, the safe half of the pairs above
  ["typescript", 'const user = await db.query("SELECT * FROM users WHERE id = $1", [order.userId]);'],
  ["python", 'row = conn.execute("SELECT id, name FROM users WHERE id = ?", (user_id,)).fetchone()'],
  ["go", 'out, err := exec.Command("ping", "-c", "1", host).Output()'],
  // not a sink at all: RegExp.prototype.exec is not a shell, and this one has glue
  ["typescript", 'const m = VERSION_RE.exec(tag + "-" + build);'],
];

/**
 * One candidate statement per dropped kind, run over that kind's own pairs. The page says no
 * wording separated these; this re-measures it instead of trusting a number in a comment. It
 * prints and never fails: a kind that starts separating is news, not a regression.
 */
const DROPPED = [
  {
    kind: "probable_bug",
    statement: "This line of code is wrong: it does not do what it is plainly meant to do.",
    when_true: "The line has a real defect — an off-by-one, an inverted condition, a swallowed error — and running it produces a wrong result.",
    when_false: "The line is correct as written and produces the result it is meant to produce.",
    pairs: [
      ["typescript", "return items[items.length];", "return items[items.length - 1];"],
      ["go", "for i := 0; i <= len(xs); i++ {", "for i := 0; i < len(xs); i++ {"],
      ["sql", "DELETE FROM users WHERE email LIKE '%@example.com' OR 1 = 1;", "DELETE FROM users WHERE email LIKE '%@example.com';"],
    ],
  },
  {
    kind: "misleading_name",
    statement: "The name this line assigns to does not describe the value it is given.",
    when_true: "The name says the opposite of, or something different from, what the expression computes, so a reader of the name would be misled.",
    when_false: "The name describes the value the expression computes.",
    pairs: [
      ["typescript", "const hasCoupon = code === undefined;", "const hasCoupon = code !== undefined;"],
      ["python", 'is_invalid = "@" in address and "." in address', 'is_valid = "@" in address and "." in address'],
      ["rust", "let in_stock = item.qty == 0;", "let in_stock = item.qty > 0;"],
    ],
  },
  {
    kind: "dead_or_unreachable",
    statement: "This line can never run.",
    when_true: "Control has already left the function or the block before this line is reached, so it executes on no input at all.",
    when_false: "This line runs on at least some input.",
    pairs: [
      ["typescript", 'console.log("described", order.id);', 'return `Order ${order.id}`;'],
      ["python", "print('cleaned', removed)", "return removed"],
    ],
  },
  {
    kind: "performance_smell",
    statement: "This line does far more work than the result needs.",
    when_true: "It repeats work, scans the same data again, or queries inside a loop, so the cost grows much faster than the answer requires.",
    when_false: "The work it does is what producing the result costs.",
    pairs: [
      ["python", "row = conn.execute(SELECT_ONE, (user_id,)).fetchone()", "rows = conn.execute(SELECT_MANY, (tuple(user_ids),)).fetchall()"],
      ["typescript", "for (const a of xs) for (const b of xs) if (a.sku === b.sku) dupes.push(a.sku);", "const seen = new Set(xs.map((a) => a.sku));"],
    ],
  },
];

/** A pair half becomes exactly the text a batch would send for it. */
const pairText = (lang, code) => bareText(lang, code);

/** The same object `buildRefs` produces, for lines that are not in a seed file. */
const refOf = (lang, code, i) => ({ line: i + 1, text: code, bare: bareText(lang, code), sink: hasSink(code, lang), glue: hasGlue(code, lang) });

/**
 * The gates decide before any call is made, so check them before making one: every UNMARKABLE
 * line must fail a gate, and every planted line a probe claims must pass both. This costs
 * nothing and catches a regex typo — an f-string whose `{` sits behind a quote, say — without
 * spending the round trips below on it.
 */
function runGates() {
  console.log(`\n### gates — deterministic, no call: sink and glue decide before a probability is read\n`);
  let bad = 0;
  for (const [lang, code] of UNMARKABLE) {
    if (!(hasSink(code, lang) && hasGlue(code, lang))) continue;
    bad++;
    console.log(`  LEAK  ${lang}  ${code.slice(0, 74)}`);
  }
  for (const s of SAMPLES) {
    const lines = s.text.split("\n");
    for (const p of s.planted) {
      if (!PROBE_IDS.has(p.probe)) continue;
      const t = lines[p.line - 1];
      if (hasSink(t, s.language) && hasGlue(t, s.language)) continue;
      bad++;
      console.log(`  GATED ${s.filename}:${p.line} sink ${hasSink(t, s.language)} glue ${hasGlue(t, s.language)}  ${t.trim().slice(0, 60)}`);
    }
  }
  console.log(bad === 0 ? "every unmarkable line fails a gate; every claimed planted line passes both" : `${bad} gate error(s)`);
  return bad;
}

async function runUnmarkable() {
  console.log(`\n### unmarkable negatives — no sink, or a sink with nothing glued into it: never a marker\n`);
  let bad = 0;
  // chunked, because a ranking is only ever read inside its own call
  for (let i = 0; i < UNMARKABLE.length; i += 32) {
    const refs = UNMARKABLE.slice(i, i + 32).map(([lang, code], j) => refOf(lang, code, j));
    const { answers, sev } = await judge(refs);
    const scan = markersFromAnswers(refs, answers, sev, "scan");
    const edit = markersFromAnswers(refs, answers, sev, "edit");
    const marked = new Set([...scan, ...edit].map((m) => m.line));
    bad += marked.size;
    for (const r of refs) {
      const p = answers[PROBES[0].id][r.line - 1].probability;
      const why = r.sink ? (r.glue ? "SINK+GLUE" : "no glue  ") : "no sink  ";
      console.log(`   ${marked.has(r.line) ? "MARK" : "    "} ${p.toFixed(3)}  ${why}  ${r.text.slice(0, 66)}`);
    }
  }
  console.log(`${bad === 0 ? "no unmarkable line is marked" : `${bad} unmarkable line(s) marked — the probe is firing outside its domain`}`);
  return bad;
}

/**
 * Re-measure the dropped kinds instead of quoting old numbers. Prints, never fails: the page
 * claims no wording separated these, and this is the run behind that claim.
 */
async function runDropped() {
  console.log(`\n### dropped kinds — one candidate statement each, over that kind's own pairs\n`);
  for (const d of DROPPED) {
    const texts = d.pairs.flatMap(([lang, bad, good]) => [pairText(lang, bad), pairText(lang, good)]);
    const r = await post("yes-no", { texts, statement: d.statement, when_true: d.when_true, when_false: d.when_false });
    const ps = r.results.map(prob);
    const rows = d.pairs.map(([, bad], i) => ({ bad, p: ps[i * 2], q: ps[i * 2 + 1] }));
    const sep = rows.filter((x) => x.p - x.q >= MARGIN && x.p >= RAISE).length;
    console.log(`${sep === 0 ? "DROP" : "NEWS"} ${d.kind} — ${sep}/${rows.length} pairs separate by >= ${MARGIN}`);
    for (const x of rows) console.log(`        defect ${x.p.toFixed(3)}  fixed ${x.q.toFixed(3)}  d ${x.p - x.q >= 0 ? "+" : ""}${(x.p - x.q).toFixed(3)}  ${x.bad.slice(0, 60)}`);
  }
  console.log(`\nre-measured: a kind printed DROP is one the page is right to call out of scope`);
}

async function runPairs() {
  console.log(`\n### contrasting pairs — a probe ships only when its own pairs separate by >= ${MARGIN}\n`);
  let failed = 0;
  for (const probe of PROBES) {
    const texts = PAIRS.flatMap(([, lang, bad, good]) => [pairText(lang, bad), pairText(lang, good)]);
    const ps = [];
    for (let i = 0; i < texts.length; i += 32) {
      const r = await post("yes-no", { texts: texts.slice(i, i + 32), statement: probe.statement, when_true: probe.when_true, when_false: probe.when_false });
      ps.push(...r.results.map(prob));
    }
    const rows = PAIRS.map(([id, , bad], i) => ({ id, bad, p: ps[i * 2], q: ps[i * 2 + 1] }));
    const own = rows.filter((x) => x.id === probe.id);
    const hits = own.filter((x) => x.p - x.q >= MARGIN && x.p >= RAISE);
    const otherMax = Math.max(...rows.filter((x) => x.id !== probe.id).flatMap((x) => [x.p, x.q]));
    const ok = hits.length >= Math.ceil(own.length * 0.6);
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"} ${probe.id} (${probe.kind}, raises at ${RAISE}) — ${hits.length}/${own.length} of its own pairs separate`);
    for (const x of own) {
      const sep = x.p - x.q >= MARGIN && x.p >= RAISE;
      console.log(`   ${sep ? "sep " : "    "} defect ${x.p.toFixed(3)}  fixed ${x.q.toFixed(3)}  d ${x.p - x.q >= 0 ? "+" : ""}${(x.p - x.q).toFixed(3)}  ${x.bad.slice(0, 62)}`);
    }
    console.log(`        highest on lines this probe does not claim: ${otherMax.toFixed(3)}`);
  }
  console.log(`\n${failed === 0 ? "every shipped probe separates its pairs" : `${failed} probe(s) do not separate — do not ship them`}`);
  return failed;
}

// ---------------------------------------------------------------- whole-file scan
/** One batch of refs: one yes-no call per probe plus one classify, exactly like Demo.tsx judge(). */
async function judge(refs) {
  const answers = {};
  for (const probe of PROBES) {
    const r = await post("yes-no", { texts: batchTexts(refs), statement: probe.statement, when_true: probe.when_true, when_false: probe.when_false });
    answers[probe.id] = r.results.map((x) => (x.results ? x.results[0] : x));
  }
  const sev = await post("classify", { texts: batchTexts(refs), labels: SEVERITY_LABELS });
  if (process.env.DUMP) dump.push({ lines: refs.map((r) => r.line), answers, sev: sev.results });
  return { answers, sev: sev.results };
}

const dump = [];

async function runFiles() {
  console.log(`\n### whole-file scan — the same lines the page sends (scanLines, ${MAX_BATCHES} batches of 32)\n`);
  for (const sample of SAMPLES) {
    if (only.length && !only.includes(sample.id)) continue;
    const lines = sample.text.split("\n");
    const picked = scanLines(sample.text, sample.language).slice(0, 32 * MAX_BATCHES);
    const refs = buildRefs(sample.text, sample.language, picked);
    // only the planted issues a shipped probe claims can count for or against it
    const inScope = scopeOf(sample.planted, PROBE_IDS).filter((p) => picked.includes(p.line));
    const outOfScope = sample.planted.filter((p) => !inScope.includes(p));

    const t0 = performance.now();
    // a probability is comparable only inside its own call, so each batch is ranked against
    // itself and the selections are unioned — the same as Demo.tsx runScan
    const fresh = [];
    for (let i = 0; i < refs.length; i += 32) {
      const batch = refs.slice(i, i + 32);
      const r = await judge(batch);
      fresh.push(...markersFromAnswers(batch, r.answers, r.sev, "scan"));
    }
    const clustered = clusterMarkers(fresh);
    const wallMs = Math.round(performance.now() - t0);
    const ev = evaluate(clustered, inScope, outOfScope.map((p) => p.line));
    const plantedLines = new Set(inScope.map((p) => p.line));
    const skippedLines = new Set(outOfScope.map((p) => p.line));

    console.log(`=== ${sample.filename} (${sample.language}) · ${refs.length} lines · ${wallMs} ms ===`);
    for (const m of clustered.sort((a, b) => a.line - b.line)) {
      const label = plantedLines.has(m.line) ? "PLANTED" : skippedLines.has(m.line) ? "skipped" : "extra  ";
      console.log(`  ${label} L${String(m.line).padStart(3)} ${m.severity.padEnd(7)} ${m.message}`);
      console.log(`          ${lines[m.line - 1].trim().slice(0, 90)}`);
    }
    for (const p of inScope) if (!ev.flaggedLines.includes(p.line)) console.log(`  MISSED  L${String(p.line).padStart(3)} ${p.kind}: ${p.note}`);
    console.log(`  precision ${pct(ev.precision)} · recall ${pct(ev.recall)} · tp ${ev.tp} fp ${ev.fp} fn ${ev.fn} · kind ok ${ev.kindMatches} · ${outOfScope.length} planted issue(s) out of scope\n`);
  }
}

// ---------------------------------------------------------------- "type it for me"
/**
 * One typing button through the real edit path: append the snippet, diff it against the file,
 * group the changed lines by enclosing function and judge them with the absolute `RAISE`.
 */
async function typeSnippet(sample, snippet) {
  const before = sample.text;
  const after = before + (before.endsWith("\n") ? "" : "\n") + snippet;
  const fns = extractFunctions(after, sample.language);
  const groups = new Map();
  for (const n of changedLines(before, after)) {
    const f = enclosingFunction(fns, n);
    const key = f ? `${f.startLine}` : "top";
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const marks = [];
  for (const g of groups.values()) {
    const refs = buildRefs(after, sample.language, g).slice(0, 32);
    if (refs.length === 0) continue;
    const r = await judge(refs);
    marks.push(...markersFromAnswers(refs, r.answers, r.sev, "edit"));
    const hit = new Set(marks.map((m) => m.line));
    refs.forEach((ref, i) => {
      const p = r.answers[PROBES[0].id][i].probability;
      const gate = ref.sink ? (ref.glue ? "sink+glue" : "no glue  ") : "no sink  ";
      console.log(`   ${hit.has(ref.line) ? "MARK" : "    "} ${p.toFixed(3)}  ${gate}  ${ref.text.trim().slice(0, 70)}`);
    });
  }
  return marks;
}

/**
 * Both typing buttons. Every sample's `demo` plants a string-built query, command or path, so
 * every sample must end up with at least one marker: a dead flagship button fails the script.
 * `demoAlt` plants a kind no probe asks about, and the page says in so many words that nothing
 * lights up — so it is typed too, and a marker on it fails the script just as loudly. Asserting
 * that in prose while only ever running the first snippet is how the claim would rot.
 */
async function runTyped() {
  console.log(`\n### "Type it for me" — both typed snippets through the edit path (raises at ${RAISE})\n`);
  let dead = 0;
  let loud = 0;
  for (const sample of SAMPLES) {
    if (only.length && !only.includes(sample.id)) continue;
    const marks = await typeSnippet(sample, sample.demo);
    if (marks.length === 0) dead++;
    console.log(`=== ${sample.filename} · injection: ${marks.length} marker(s)${marks.length === 0 ? " — DEAD BUTTON" : ""}`);
    const alt = await typeSnippet(sample, sample.demoAlt);
    if (alt.length > 0) loud++;
    console.log(`=== ${sample.filename} · ${sample.demoAltKind}: ${alt.length} marker(s)${alt.length > 0 ? " — SHOULD BE SILENT" : ""}\n`);
  }
  console.log(dead === 0 ? "every injection snippet lights up" : `${dead} sample(s) type a snippet that produces nothing`);
  console.log(loud === 0 ? "every dropped-kind snippet stays silent" : `${loud} sample(s) mark a snippet the page says is silent`);
  return dead + loud;
}

let failed = 0;
if (wantPairs) {
  failed += runGates();
  failed += await runPairs();
  failed += await runUnmarkable();
  await runDropped();
}
if (wantFiles) await runFiles();
if (wantTyped) failed += await runTyped();
if (process.env.DUMP) (await import("node:fs")).writeFileSync(process.env.DUMP, JSON.stringify(dump));

const p50 = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
console.log(`${calls} calls · model p50 ${p50(inference)} ms · round trip p50 ${p50(wall)} ms · ${tokens.toLocaleString()} input tokens`);
if (failed > 0) process.exitCode = 1;
