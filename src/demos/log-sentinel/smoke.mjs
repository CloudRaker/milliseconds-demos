// Sends the demo's real request bodies straight to the API and scores them against the fixture
// ground truth. MS_API_KEY=... node src/demos/log-sentinel/smoke.mjs
import { TEMPLATES, STORM, Rng, SEVERITIES, ACTIONABLE, ACTIONABLE_THRESHOLD, SECURITY, SECURITY_THRESHOLD, SEVERITY_SCALE, CATEGORY_LABELS, forModel, regexPages } from "./data.ts";

// A deterministic self-check of the parts that hold the demo's claims up, before spending requests.
function assert(ok, msg) {
  if (!ok) throw new Error(`self-check: ${msg}`);
}
function selfCheck() {
  const rng = new Rng(11);
  const iso = "2026-09-19T14:03:11.000Z";
  const byName = Object.fromEntries(TEMPLATES.map((t) => [t.name, t]));
  const render = (n) => byName[n].render(rng, iso).join("\n");
  // The baseline pages on a canary job that is meant to fail, and misses a backup that wrote nothing.
  assert(regexPages(render("cron.canary")) && !byName["cron.canary"].truth.actionable, "canary should be a regex false page");
  assert(!regexPages(render("cron.empty_backup")) && byName["cron.empty_backup"].truth.actionable, "empty backup should be a regex miss");
  // The +5.4 s the page quotes is the first storm step the keyword rules can see.
  const first = STORM.find((s) => regexPages(s.template.render(new Rng(3), iso).join("\n")));
  assert(first?.atMs === 5400, `the baseline first pages the storm at ${first?.atMs} ms, not 5400`);
  // Stack traces reach the model as head plus two frames.
  const trace = forModel({ service: "payments", line: render("pay.npe") });
  assert(trace.startsWith("[payments] ") && trace.split("\n").length === 4, "a 6-line trace should be sent as 4 lines");
  console.log("self-check ok");
}
selfCheck();

const KEY = process.env.MS_API_KEY;
if (!KEY) throw new Error("set MS_API_KEY");
const BASE = "https://api.milliseconds.ai/v1/decision-machine-1";

async function call(route, body) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${route} ${res.status}: ${text.slice(0, 300)}`);
  return {
    data: JSON.parse(text),
    wallMs: Math.round(performance.now() - t0),
    inferenceMs: Number(res.headers.get("x-inference-ms") ?? 0),
    tokens: Number(res.headers.get("x-input-tokens") ?? 0),
  };
}

/** One rendered event per template, so every tricky fixture line is checked. */
function sample(templates, seed) {
  const rng = new Rng(seed);
  const iso = new Date("2026-09-19T14:03:11.000Z").toISOString();
  return templates.map((t) => {
    const lines = t.render(rng, iso);
    return { name: t.name, service: t.service, line: lines.join("\n"), truth: t.truth };
  });
}

async function batch(title, events) {
  const texts = events.map(forModel);
  const [act, rate, cls, sec] = await Promise.all([
    call("yes-no", { texts, statement: ACTIONABLE.statement, when_true: ACTIONABLE.when_true, when_false: ACTIONABLE.when_false }),
    call("rate", { texts, scale: SEVERITY_SCALE }),
    call("classify", { texts, labels: CATEGORY_LABELS }),
    call("yes-no", { texts, statement: SECURITY.statement, when_true: SECURITY.when_true, when_false: SECURITY.when_false }),
  ]);
  console.log(`\n=== ${title}: ${events.length} lines, 4 calls`);
  console.log(
    `    wall ${act.wallMs}/${rate.wallMs}/${cls.wallMs}/${sec.wallMs} ms · inference ${act.inferenceMs}/${rate.inferenceMs}/${cls.inferenceMs}/${sec.inferenceMs} ms · tokens ${act.tokens + rate.tokens + cls.tokens + sec.tokens}`,
  );
  let wrongA = 0, wrongS = 0, wrongC = 0, wrongSec = 0;
  const conf = { rx: { tp: 0, fp: 0, fn: 0 }, dm: { tp: 0, fp: 0, fn: 0 } };
  events.forEach((e, i) => {
    const a = act.data.results[i];
    const s = rate.data.results[i];
    const c = cls.data.results[i];
    // Same as judge() in engine.ts: security is its own question, and a security line is actionable.
    const security = sec.data.results[i].probability >= SECURITY_THRESHOLD;
    const actionable = a.probability >= ACTIONABLE_THRESHOLD || security;
    // Same gate as judge() in engine.ts: severity and root cause only apply to actionable lines.
    const sev = actionable ? SEVERITIES[Math.max(0, Math.min(4, s.level))] : "noise";
    const cat = actionable ? c.label : "noise";
    const okA = actionable === e.truth.actionable;
    const okS = sev === e.truth.severity;
    const okC = cat === e.truth.category;
    const okSec = security === e.truth.security;
    if (!okA) wrongA++;
    if (!okS) wrongS++;
    if (!okC) wrongC++;
    if (!okSec) wrongSec++;
    const rx = regexPages(e.line);
    for (const [k, pred] of [["rx", rx], ["dm", actionable]]) {
      if (pred && e.truth.actionable) conf[k].tp++;
      else if (pred && !e.truth.actionable) conf[k].fp++;
      else if (!pred && e.truth.actionable) conf[k].fn++;
    }
    const flag = okA && okS && okC && okSec ? "   " : !okA ? "!! " : " ~ ";
    console.log(
      `${flag}${e.name.padEnd(20)} act ${actionable ? "Y" : "n"}${okA ? " " : "X"}(${a.probability.toFixed(2)}) truth ${e.truth.actionable ? "Y" : "n"} | sev ${sev.padEnd(18)}${okS ? " " : "X"} truth ${e.truth.severity.padEnd(18)} | cat ${cat.padEnd(18)}${okC ? " " : "X"} truth ${e.truth.category} | sec ${security ? "Y" : "n"}${okSec ? " " : "X"}(${sec.data.results[i].probability.toFixed(2)})`,
    );
  });
  const pr = (c) => `precision ${(c.tp / (c.tp + c.fp) || 0).toFixed(2)} recall ${(c.tp / (c.tp + c.fn) || 0).toFixed(2)} (fp ${c.fp} fn ${c.fn})`;
  console.log(`    actionable wrong ${wrongA}/${events.length} · severity wrong ${wrongS} · category wrong ${wrongC} · security wrong ${wrongSec}`);
  console.log(`    regex  ${pr(conf.rx)}`);
  console.log(`    dm1    ${pr(conf.dm)}`);
}

const all = sample(TEMPLATES, 11);
for (let i = 0; i < all.length; i += 32) await batch(`templates ${i}-${Math.min(all.length, i + 32) - 1}`, all.slice(i, i + 32));
await batch("storm sequence", sample(STORM.map((s) => s.template), 3));
