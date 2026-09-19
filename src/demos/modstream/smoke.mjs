// Sends the demo's real request bodies to the live API and scores the answers
// against the labelled corpus. Same three calls per batch of 32 as the page.
//
//   MS_API_KEY=sk-... node src/demos/modstream/smoke.mjs [--grid]
//
// --grid re-decides the cached judgments over a threshold grid: no extra inference.

import {
  ACTION_LABELS,
  DEFAULT_THRESHOLDS,
  HARMFUL_TRUTHS,
  SEVERITY_SCALE,
  STATEMENTS,
  allFixtureLines,
  decide,
  emptyScore,
  isBlocking,
  scoreVerdict,
  wordListMatch,
} from "./data.ts";

// ---------------------------------------------------------------------------
// Policy self-check. Pure, no network, no key: it runs on every invocation and on
// `node smoke.mjs` alone. Every case here is a real measured line whose numbers once
// produced the wrong verdict, so a policy edit that reintroduces one fails loudly
// instead of shipping. The joking-crisis case is the one that matters most: a viewer
// saying a real thing with "lmao" on the end must never be punished for it.
// ---------------------------------------------------------------------------
const zero = { action: "allow", actionScores: {}, actionConfidence: 0, harassment: 0, scam_or_phishing: 0, self_harm_risk: 0, spam: 0, group_attack: 0, is_obfuscated_slur_or_evasion: 0, wish_harm: 0, unwanted: 0, doxxing: 0, no_one_would_miss: 0, stated_intent: 0, first_person: 0, own_feelings: 0, game_frustration: 0, joking: 0, severity: 0, severityConfidence: 0 };
const CASES = [
  // Every row is a real measured line: the text is sent to decide() exactly as the page
  // sends it, and the numbers are what the live API returned for it.
  ["ngl im probably gonna off myself tonight lmao dont worry about it",
   { self_harm_risk: 0.35, stated_intent: 0.95, joking: 0.95, wish_harm: 0.45, first_person: 0.95, own_feelings: 0.86, actionScores: { escalate_to_human: 0.87 } }, "review", "joking crisis reaches a human, is never removed or banned"],
  ["honestly i dont see the point anymore. nobody would care if i was gone",
   { self_harm_risk: 0.38, no_one_would_miss: 0.94, first_person: 0.65, own_feelings: 0.79, actionScores: { escalate_to_human: 0.99 } }, "care", "plain crisis gets the supportive reply"],
  ["k!ll urself streamer",
   { stated_intent: 0.91, is_obfuscated_slur_or_evasion: 0.66, harassment: 0.55, wish_harm: 0.58, group_attack: 0.38, first_person: 0.27, own_feelings: 0.46 }, "timeout_user", "abuse that scores as crisis is still abuse"],
  ["i keep dying on this level too, its brutal",
   { self_harm_risk: 0.40, game_frustration: 0.69, first_person: 0.07, own_feelings: 0.55, severity: 1.99, actionScores: { escalate_to_human: 0.95 } }, "allow", "game frustration is not a cry for help"],
  ["im gonna kill this boss if it takes me all night",
   { harassment: 0.16, stated_intent: 0.19, first_person: 0.64, own_feelings: 0.32, severity: 2.0 }, "allow", "game-directed aggression is not harassment"],
  ["kys already n0body cares",
   { unwanted: 0.22, no_one_would_miss: 0.14, self_harm_risk: 0.13, first_person: 0.05, own_feelings: 0.13 }, "review", "a weak attack signal holds the message for a human"],

  // The direction cases. `harassment`, `group_attack`, `unwanted` and `wish_harm` fire on
  // the topic, not on the target, so each of these was once decided wrong: the crisis
  // lines banned or hidden, the abusive ones handed the hotline reply. The first three are
  // the regression a previous round shipped — ordinary self-directed wording, banned at
  // DEFAULT_THRESHOLDS on the insult and unwanted statements.
  ["nadie me quiere, ya no aguanto mas",
   { self_harm_risk: 0.87, no_one_would_miss: 0.17, harassment: 0.58, is_obfuscated_slur_or_evasion: 0.24, unwanted: 0.99, group_attack: 0.34, first_person: 0.56, own_feelings: 0.76, severity: 2.29 }, "care", "crisis in Spanish is a crisis, not harassment 0.58"],
  ["everyone hates me and im done",
   { self_harm_risk: 0.46, harassment: 0.46, unwanted: 0.66, group_attack: 0.38, first_person: 0.36, own_feelings: 0.70, severity: 1.33 }, "care", "an insult score on the sender's own despair is not an insult"],
  ["nobody likes me. nobody wants me. thats it",
   { self_harm_risk: 0.35, harassment: 0.54, is_obfuscated_slur_or_evasion: 0.17, unwanted: 0.98, group_attack: 0.41, first_person: 0.28, own_feelings: 0.65, severity: 1.09 }, "care", "and first_person 0.28 must not be what decides a ban"],
  ["i cant do this anymore im so tired of everything",
   { self_harm_risk: 0.39, first_person: 0.56, own_feelings: 0.84, severity: 1.01, actionScores: { escalate_to_human: 0.94 } }, "care", "quiet exhaustion reaches the care queue"],
  ["im such a waste of space everyone would be better off without me",
   { self_harm_risk: 0.21, no_one_would_miss: 0.59, harassment: 0.49, unwanted: 0.23, group_attack: 0.26, joking: 0.26, first_person: 0.52, own_feelings: 0.65, severity: 1.12 }, "care", "self-loathing scores as an insult and is still not one"],
  ["nobody wants me around anymore, not even my own family",
   { self_harm_risk: 0.41, no_one_would_miss: 0.13, unwanted: 0.98, harassment: 0.34, group_attack: 0.27, first_person: 0.35, own_feelings: 0.64, severity: 1.61 }, "care", "the lowest measured self-directed line still clears the direction bar"],
  ["i hate myself so much right now",
   { self_harm_risk: 0.17, first_person: 0.92, own_feelings: 0.98, severity: 1.94, actionScores: { escalate_to_human: 0.79 } }, "review", "a quiet self-directed line reaches a human, is never removed"],

  // The pronoun-veto regression: a first-person crisis line that says "you" anywhere was
  // banned on the topic statements, because presence of a pronoun was read as direction.
  // All four measured live at DEFAULT_THRESHOLDS and reproduced on a second run; each one
  // decided timeout_user before the verb's object was tested. The model is not what failed
  // on them — crisis 0.30-0.68, the two direction statements 0.63-0.89 / 0.57-0.84.
  ["nobody wants me here and you all know it, im done",
   { self_harm_risk: 0.67, no_one_would_miss: 0.44, stated_intent: 0.14, harassment: 0.34, group_attack: 0.23, is_obfuscated_slur_or_evasion: 0.09, wish_harm: 0.10, unwanted: 0.97, joking: 0.11, first_person: 0.79, own_feelings: 0.84, severity: 1.03, actionScores: { escalate_to_human: 0.23 } }, "care", "'nobody wants me … you all know it' is about its sender, not about you"],
  ["sorry to dump this on you chat but nobody likes me and i cant keep going",
   { self_harm_risk: 0.68, harassment: 0.28, group_attack: 0.19, is_obfuscated_slur_or_evasion: 0.06, wish_harm: 0.07, unwanted: 0.90, joking: 0.09, first_person: 0.89, own_feelings: 0.84, severity: 1.45, actionScores: { escalate_to_human: 0.19 } }, "care", "and apologising to chat is not an attack on chat"],
  ["i know you all think im a joke, everyone hates me, im done tonight",
   { self_harm_risk: 0.30, harassment: 0.30, group_attack: 0.52, is_obfuscated_slur_or_evasion: 0.10, wish_harm: 0.07, unwanted: 0.86, joking: 0.59, first_person: 0.69, own_feelings: 0.64, severity: 1.95, actionScores: { escalate_to_human: 0.01 } }, "review", "joking 0.59 on the same shape suppresses the reply, never the human check"],
  ["thanks for the stream, you helped, but honestly nobody wants me here",
   { self_harm_risk: 0.15, no_one_would_miss: 0.32, harassment: 0.13, group_attack: 0.12, is_obfuscated_slur_or_evasion: 0.04, wish_harm: 0.13, unwanted: 0.93, joking: 0.08, first_person: 0.63, own_feelings: 0.57, severity: 1.06, actionScores: { escalate_to_human: 0.02 } }, "care", "thanking the streamer is not addressing a victim"],

  // Abuse aimed at a named third party. The model reads it as the sender's own intent —
  // crisis 0.38-0.80 with every attack statement under 0.25 — so the care reply went to the
  // harasser. Measured live, 4 of 4 wrong before the care branch required a first person in
  // the text; each reproduced on a second run. They reach a human instead of a hotline text.
  ["honestly pixel_otter42 should kill himself, the world would be better",
   { self_harm_risk: 0.53, stated_intent: 0.73, harassment: 0.09, group_attack: 0.13, is_obfuscated_slur_or_evasion: 0.06, wish_harm: 0.15, unwanted: 0.03, joking: 0.12, first_person: 0.07, own_feelings: 0.28, severity: 2.0, actionScores: { escalate_to_human: 0.73 } }, "review", "abuse at a named third party is never handed the hotline reply"],
  ["this streamer should honestly just end it already, nobody would miss him",
   { self_harm_risk: 0.29, no_one_would_miss: 0.80, harassment: 0.11, group_attack: 0.05, is_obfuscated_slur_or_evasion: 0.02, wish_harm: 0.07, unwanted: 0.09, joking: 0.15, first_person: 0.09, own_feelings: 0.20, severity: 0.97, actionScores: { escalate_to_human: 0.94 } }, "review", "…even at crisis 0.80 with every attack statement under 0.12"],
  ["i think that streamer should honestly just kill himself",
   { self_harm_risk: 0.40, stated_intent: 0.78, harassment: 0.03, group_attack: 0.08, is_obfuscated_slur_or_evasion: 0.02, wish_harm: 0.09, unwanted: 0.04, first_person: 0.11, own_feelings: 0.18, severity: 2.0, actionScores: { escalate_to_human: 0.90 } }, "review", "and an 'i think' in front of it does not make it a cry for help"],

  // …and the mirror: abuse wrapped in a first-person clause. Each of these reads
  // first_person and own_feelings high enough that the statements alone gate them as
  // self-directed and hand them the hotline reply. The pronoun in the text is what stops it.
  ["honestly i hate you and i wish you would just kill yourself",
   { self_harm_risk: 0.73, stated_intent: 0.90, harassment: 0.55, is_obfuscated_slur_or_evasion: 0.22, wish_harm: 0.24, unwanted: 0.38, first_person: 0.39, own_feelings: 0.84, severity: 2.76 }, "timeout_user", "'i hate you and i wish you would' is an attack, not a cry for help"],
  ["i genuinely feel like nobody in this chat wants you here",
   { no_one_would_miss: 0.49, self_harm_risk: 0.10, unwanted: 0.73, harassment: 0.23, group_attack: 0.15, first_person: 0.40, own_feelings: 0.51, severity: 2.11 }, "timeout_user", "and so is 'i genuinely feel like nobody wants you here'"],
  ["i think you should just die honestly",
   { stated_intent: 0.43, self_harm_risk: 0.30, wish_harm: 0.47, harassment: 0.14, first_person: 0.14, own_feelings: 0.28, severity: 2.03 }, "timeout_user", "the first-person framing does not soften 'you should die'"],
  ["i hope you kill yourself you worthless trash",
   { stated_intent: 0.92, self_harm_risk: 0.59, harassment: 0.76, is_obfuscated_slur_or_evasion: 0.89, wish_harm: 0.67, group_attack: 0.49, first_person: 0.22, own_feelings: 0.27, severity: 2.73 }, "timeout_user", "nor 'i hope you'"],
  ["just kill yourself already",
   { stated_intent: 0.96, self_harm_risk: 0.77, wish_harm: 0.71, is_obfuscated_slur_or_evasion: 0.06, first_person: 0.07, own_feelings: 0.10, severity: 2.0 }, "timeout_user", "plain 'kill yourself' is abuse, never a cry for help"],
  ["you should kill yourself, seriously",
   { stated_intent: 0.98, self_harm_risk: 0.75, wish_harm: 0.87, is_obfuscated_slur_or_evasion: 0.05, first_person: 0.06, own_feelings: 0.15, severity: 2.0 }, "timeout_user", "and so is the second-person spelling of it"],
  ["everyone in chat is laughing at you, nobody actually likes you",
   { unwanted: 0.56, harassment: 0.17, group_attack: 0.23, joking: 0.31, first_person: 0.06, own_feelings: 0.09, severity: 2.05 }, "timeout_user", "'nobody wants you' aimed outward is still an attack"],
];
for (const [text, partial, want, why] of CASES) {
  const got = decide({ ...zero, ...partial }, DEFAULT_THRESHOLDS, text);
  if (got.decision !== want) throw new Error(`policy self-check failed: ${why} — wanted ${want}, got ${got.decision} (${got.reason})`);
}
// No self-harm judgment may ever be removed or punished, whatever the gates say.
let combos = 0;
for (const joking of [0, 0.5, 0.95]) {
  for (const gate of [0, 0.5, 0.95]) {
    combos++;
    const d = decide({ ...zero, self_harm_risk: 0.8, stated_intent: 0.9, joking, game_frustration: gate }, DEFAULT_THRESHOLDS, "i just want it all to stop").decision;
    if (d === "hide" || d === "timeout_user") throw new Error(`policy self-check failed: crisis judged ${d} at joking ${joking}, game talk ${gate}`);
  }
}
// And no self-directed crisis line may be removed or punished on the four topic statements,
// whatever they say. The direction values below are the LOWEST measured on a real crisis
// line (first_person 0.28 on "nobody likes me. nobody wants me. thats it", own_feelings
// 0.22 on "no one would even notice if i stopped showing up"), not values picked from the
// lines that already passed — the previous round pinned this loop at 0.35/0.64 and shipped
// a ban on three crisis phrasings that sit under it.
for (const fp of [0.05, 0.28, 0.56]) {
  for (const own of [0.22, 0.65, 0.98]) {
    for (const topic of [0, 0.54, 0.99]) {
      combos++;
      const j = { ...zero, self_harm_risk: 0.71, unwanted: topic, wish_harm: topic, harassment: topic, group_attack: topic, first_person: fp, own_feelings: own };
      const d = decide(j, DEFAULT_THRESHOLDS, "nobody likes me. nobody wants me. thats it").decision;
      // Either route is acceptable — care or a human — but never removal and never a ban.
      if (d === "hide" || d === "timeout_user") throw new Error(`policy self-check failed: self-directed crisis judged ${d} at fp ${fp}, own ${own}, topic ${topic}`);
      // The mirror: with an attack signal at ban level AND a second-person pronoun in the
      // text, the same numbers must never reach the care queue, whatever the direction
      // statements read. (At topic 0 there is no attack signal to read, so a crisis score
      // is a crisis score and care is the right answer for both texts.)
      if (topic >= DEFAULT_THRESHOLDS.timeout) {
        const abuse = decide(j, DEFAULT_THRESHOLDS, "i feel like you should just kill yourself").decision;
        if (abuse === "care") throw new Error(`policy self-check failed: abuse judged care at fp ${fp}, own ${own}, topic ${topic}`);
      }
    }
  }
}
// The two text tests carry direction, so assert them as shapes and not only as lines: a
// message whose verb takes the sender as its object is never removed or banned, whatever
// the topic statements read, and a message with no first person in it never gets the care
// reply, whatever the crisis statements read.
for (const topic of [0, 0.5, 0.99]) {
  for (const crisis of [0.31, 0.8]) {
    combos++;
    const j = { ...zero, self_harm_risk: crisis, unwanted: topic, wish_harm: topic, harassment: topic, group_attack: topic, first_person: 0.05, own_feelings: 0.05 };
    const own = decide(j, DEFAULT_THRESHOLDS, "nobody wants me here and you all know it, im done").decision;
    if (own === "hide" || own === "timeout_user") throw new Error(`policy self-check failed: self-object crisis judged ${own} at topic ${topic}, crisis ${crisis}`);
    const third = decide(j, DEFAULT_THRESHOLDS, "that mod should just off himself, nobody would miss that guy").decision;
    if (third === "care") throw new Error(`policy self-check failed: third-party abuse judged care at topic ${topic}, crisis ${crisis}`);
  }
}
console.log(`policy self-check: ${CASES.length} cases + ${combos} gate combinations pass.`);

const KEY = process.env.MS_API_KEY;
if (!KEY) throw new Error("Set MS_API_KEY.");
const API = "https://api.milliseconds.ai/v1/decision-machine-1";

let calls = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Same 429 backoff as src/lib/dm1.ts: the demo key shares one org quota, so a smoke
 *  run that happens to land next to a live visitor must wait, not die. */
async function post(route, body) {
  calls++;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/${route}`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 5) {
      const retry = Number(res.headers.get("retry-after") ?? 2);
      await sleep(Math.min(8000, (retry || 2) * 1000 * (attempt + 1)));
      continue;
    }
    const json = await res.json();
    if (!res.ok) throw new Error(`${route} ${res.status}: ${JSON.stringify(json)}`);
    return { json, inferenceMs: Number(res.headers.get("x-inference-ms") ?? 0), tokens: Number(res.headers.get("x-input-tokens") ?? 0) };
  }
}

/** The page's batch: one /yes-no (15 statements), one /classify, one /rate, joined by index. */
async function judgeBatch(texts) {
  const t0 = performance.now();
  const [yes, cls, rate] = await Promise.all([
    post("yes-no", { texts, statements: STATEMENTS.map((s) => s.statement) }),
    post("classify", { texts, labels: ACTION_LABELS }),
    post("rate", { texts, scale: SEVERITY_SCALE }),
  ]);
  const wallMs = Math.round(performance.now() - t0);
  const tokens = yes.tokens + cls.tokens + rate.tokens;
  const inferenceMs = Math.max(yes.inferenceMs, cls.inferenceMs, rate.inferenceMs);
  const judgments = texts.map((_, i) => {
    const j = { action: cls.json.results[i].label, actionScores: cls.json.results[i].scores, actionConfidence: cls.json.results[i].confidence, severity: rate.json.results[i].score, severityConfidence: rate.json.results[i].confidence };
    yes.json.results[i].results.forEach((r, k) => (j[STATEMENTS[k].key] = r.probability));
    return j;
  });
  return { judgments, wallMs, inferenceMs, tokens };
}

const fixture = allFixtureLines();
const judged = [];
let totalTokens = 0;
const walls = [];
const infs = [];

for (let i = 0; i < fixture.length; i += 32) {
  const slice = fixture.slice(i, i + 32);
  const { judgments, wallMs, inferenceMs, tokens } = await judgeBatch(slice.map((f) => f.text));
  slice.forEach((f, k) => judged.push({ ...f, j: judgments[k] }));
  totalTokens += tokens;
  walls.push(wallMs);
  infs.push(inferenceMs);
  process.stdout.write(`batch ${1 + i / 32}: ${slice.length} texts, 3 calls, ${wallMs} ms wall, ${inferenceMs} ms model, ${tokens} tokens\n`);
  await sleep(1500); // the page queues at 2 calls/s; keep the smoke test inside the same budget
}

const pad = (s, n) => String(s).padEnd(n);
const num = (v) => v.toFixed(2);

console.log("\nSignals by bucket (mean probability, 0–1; severity 0–3)");
console.log(pad("truth", 16), STATEMENTS.map((s) => pad(s.label, 10)).join(""), pad("severity", 9), "top action");
const buckets = new Map();
for (const r of judged) {
  if (!buckets.has(r.truth)) buckets.set(r.truth, []);
  buckets.get(r.truth).push(r);
}
for (const [truth, rows] of buckets) {
  const mean = (f) => rows.reduce((s, r) => s + f(r.j), 0) / rows.length;
  const actions = {};
  for (const r of rows) actions[r.j.action] = (actions[r.j.action] ?? 0) + 1;
  const top = Object.entries(actions).sort((a, b) => b[1] - a[1])[0];
  console.log(
    pad(truth, 16),
    STATEMENTS.map((s) => pad(num(mean((j) => j[s.key])), 10)).join(""),
    pad(num(mean((j) => j.severity)), 9),
    `${top[0]} ${top[1]}/${rows.length}`,
  );
}

function score(thresholds) {
  const dm = emptyScore();
  const wl = emptyScore();
  const counts = { allow: 0, hide: 0, timeout_user: 0, care: 0, review: 0 };
  let careRight = 0;
  let careWrong = 0;
  for (const r of judged) {
    const d = decide(r.j, thresholds, r.text);
    counts[d.decision]++;
    if (d.decision === "care") (r.truth === "self_harm" ? careRight++ : careWrong++);
    scoreVerdict(dm, r.truth, isBlocking(d.decision));
    scoreVerdict(wl, r.truth, wordListMatch(r.text) !== null);
  }
  return { dm, wl, counts, careRight, careWrong };
}

const pctOf = (a, b) => (b === 0 ? "—" : `${Math.round((100 * a) / b)}%`);
const s = score(DEFAULT_THRESHOLDS);
console.log(`\nFixture: ${judged.length} lines, ${calls} calls, ${totalTokens} input tokens.`);
console.log(`Model time per batch: ${infs.join(", ")} ms. Round trip: ${walls.join(", ")} ms.`);
console.log("\nFilter                harmful caught      clean blocked");
console.log(pad("keyword list", 22), pad(`${pctOf(s.wl.caught, s.wl.harmfulTotal)} (${s.wl.caught}/${s.wl.harmfulTotal})`, 20), `${pctOf(s.wl.wronglyBlocked, s.wl.cleanTotal)} (${s.wl.wronglyBlocked}/${s.wl.cleanTotal})`);
console.log(pad("decision-machine-1", 22), pad(`${pctOf(s.dm.caught, s.dm.harmfulTotal)} (${s.dm.caught}/${s.dm.harmfulTotal})`, 20), `${pctOf(s.dm.wronglyBlocked, s.dm.cleanTotal)} (${s.dm.wronglyBlocked}/${s.dm.cleanTotal})`);
console.log("decisions:", JSON.stringify(s.counts), `· care queue: ${s.careRight}/6 self-harm lines, ${s.careWrong} wrong`);

console.log("\nMisses (harmful, released) and false blocks (clean, removed):");
for (const r of judged) {
  const d = decide(r.j, DEFAULT_THRESHOLDS, r.text);
  const harmful = HARMFUL_TRUTHS.has(r.truth);
  if (harmful && !isBlocking(d.decision)) console.log(" MISS ", pad(r.truth, 16), pad(d.decision, 12), r.text.slice(0, 64));
  if (!harmful && r.truth !== "self_harm" && isBlocking(d.decision)) console.log(" FALSE", pad(r.truth, 16), pad(d.decision, 12), `${r.text.slice(0, 48)} — ${d.reason}`);
  if (r.truth === "self_harm" && d.decision !== "care") console.log(" CARE?", pad(r.truth, 16), pad(d.decision, 12), r.text.slice(0, 64));
  // A care reply attached to a message that is not a cry for help is its own kind of harm.
  if (r.truth !== "self_harm" && d.decision === "care") console.log(" CARE!", pad(r.truth, 16), pad(d.decision, 12), `${r.text.slice(0, 48)} — ${d.reason}`);
}

if (process.argv.includes("--grid")) {
  console.log("\nThreshold grid (no new inference):");
  const rows = [];
  for (const hide of [0.25, 0.3, 0.35, 0.4]) {
    for (const timeout of [0.45, 0.55]) {
      for (const selfHarm of [0.25, 0.3]) {
        for (const hideSeverity of [2.4, 2.7, 3.01]) {
          const t = { ...DEFAULT_THRESHOLDS, hide, timeout, selfHarm, hideSeverity, timeoutSeverity: 3.01 };
          const r = score(t);
          rows.push({ t, caught: r.dm.caught, harmful: r.dm.harmfulTotal, blocked: r.dm.wronglyBlocked, clean: r.dm.cleanTotal, care: r.careRight, careWrong: r.careWrong });
        }
      }
    }
  }
  rows.sort((a, b) => b.caught / b.harmful - b.blocked / b.clean - (a.caught / a.harmful - a.blocked / a.clean));
  for (const r of rows.slice(0, 14)) {
    console.log(` hide ${r.t.hide} timeout ${r.t.timeout} selfHarm ${r.t.selfHarm} sev ${r.t.hideSeverity} → caught ${pctOf(r.caught, r.harmful)} blocked-clean ${pctOf(r.blocked, r.clean)} care ${r.care}/6 (${r.careWrong} wrong)`);
  }
}
