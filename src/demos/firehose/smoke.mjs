// Sends the demo's real request bodies to the live API, prints the answers, and asserts the
// properties the console depends on. The seeded generator is the same one the page runs, so the
// first sample is the demo's own traffic.
//
//   MS_API_KEY=sk-ms-... node src/demos/firehose/smoke.mjs
//
// Exits non-zero if a check fails, so this is the thing to run after touching a label description.

import {
  AIMED_AT_A_PERSON,
  CATEGORY_LABELS,
  DEFAULT_TH,
  FLAG_AT,
  SEVERITY_QUEUE_AT,
  BENIGN_CONFIDENT,
  HOSTILE_FLOOR,
  benignOf,
  LANGUAGE_LABELS,
  RULE_BREAKING,
  SEVERITY_SCALE,
  createGenerator,
  detectLang,
  inModQueue,
  modReason,
  ruleBreakOf,
  zeroScores,
} from "./data.ts";

const KEY = process.env.MS_API_KEY;
if (!KEY) throw new Error("set MS_API_KEY");
const API = "https://api.milliseconds.ai/v1/decision-machine-1";

async function call(route, body) {
  const t0 = Date.now();
  const res = await fetch(`${API}/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json)}`);
  return { json, ms: Date.now() - t0, inference: res.headers.get("x-inference-ms"), tokens: res.headers.get("x-input-tokens") };
}

// 32 is the API's own `texts` limit; the benign section below runs several hundred lines through
// these, so both helpers batch rather than making the caller do it.
const chunk = (a, n = 32) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

const classify = async (texts, labels = CATEGORY_LABELS) => {
  const out = [];
  for (const c of chunk(texts)) {
    const r = await call("classify", { texts: c, labels });
    out.push(...r.json.results.map((x) => ({ label: x.label, probability: x.probability, scores: { ...zeroScores(), ...x.scores } })));
  }
  return out;
};
const rate = async (texts) => {
  const out = [];
  for (const c of chunk(texts)) out.push(...(await call("rate", { texts: c, scale: SEVERITY_SCALE })).json.results);
  return out;
};

/**
 * The console's whole pipeline for one batch: /classify, then /rate for whatever cleared FLAG_AT,
 * then the mod-queue policy. Every recall and false-positive number below goes through this, so the
 * script cannot pass on a gate the page does not actually run.
 */
async function pipeline(texts) {
  const cs = await classify(texts);
  const idx = cs.map((x, i) => [x, i]).filter(([x]) => ruleBreakOf(x.scores) >= FLAG_AT).map(([, i]) => i);
  const rs = idx.length ? await rate(idx.map((i) => texts[i])) : [];
  return cs.map((x, i) => {
    const k = idx.indexOf(i);
    const sev = k === -1 ? undefined : rs[k];
    return { ...x, severity: sev?.score, level: sev?.level, queued: inModQueue({ scores: x.scores, severity: sev?.score }) };
  });
}

const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

// ---------------------------------------------------------------- 1. the demo's own seeded batch
const gen = createGenerator(2024);
const msgs = Array.from({ length: 32 }, () => gen.next());
const c = await call("classify", { texts: msgs.map((m) => m.text), labels: CATEGORY_LABELS });
console.log(`/classify  32 texts · 9 labels · ${c.inference} ms model · ${c.ms} ms round trip · ${c.tokens} tokens\n`);

let hits = 0;
let queuedBenign = 0;
const flagged = [];
c.json.results.forEach((r, i) => {
  const m = msgs[i];
  const scores = { ...zeroScores(), ...r.scores };
  const rule = ruleBreakOf(scores);
  const ok = r.label === m.category;
  hits += ok;
  if (rule >= 0.6) flagged.push(m);
  const inQueue = inModQueue({ scores });
  const benign = !RULE_BREAKING.includes(m.category);
  if (inQueue && benign) queuedBenign++;
  console.log(
    `${ok ? "ok " : "XX "} ${m.category.padEnd(10)} -> ${r.label.padEnd(10)} p=${r.probability.toFixed(2)} rule=${rule.toFixed(2)}${inQueue ? (benign ? " FALSE-POS" : " QUEUE    ") : "          "} ${m.text.slice(0, 44)}`,
  );
});
console.log(`\ngenerator label matched: ${hits}/32\n`);
check("seed batch: no benign message reaches the mod queue", queuedBenign === 0, `${queuedBenign} false positives`);
check("seed batch: the generator label is recovered at least half the time", hits >= 16, `${hits}/32`);

// ---------------------------------------------------------------- 2. questions clear their slider
const QUESTIONS = [
  "what mouse do you use?", "how long have you been playing Valorant?", "what sens are you on?",
  "are you doing ranked later?", "whats your favorite agent?", "when is the next tournament?",
  "do you have a video on this build?", "what settings do you run for Apex?", "how do you get out of gold?",
  "is this on PC or console?", "can you explain why you did that rotate?", "what keyboard is that?",
  "how many hours in League?", "will you play Zelda with viewers?", "what's your dpi?",
  "hey what headset is that", "@streamer why not take the top route?", "do you stream every day?",
  "que raton usas?", "qual mouse voce usa?", "welche maus benutzt du?", "마우스 뭐 쓰세요?",
];
const qr = await classify(QUESTIONS);
const clears = qr.filter((x) => x.scores.question >= DEFAULT_TH.question).length;
// Not just the slider: every feed candidate is also rated, and a row the scale puts at a person is
// dropped. That guard is what stops "kys, and also what mouse do you use?" (section 5), but /rate
// reads some plain questions as pointed too, so the feed's real recall is measured through both.
const qsev = await call("rate", { texts: QUESTIONS, scale: SEVERITY_SCALE });
const reaches = qr.map((x, i) => ({ x, i })).filter(({ x, i }) => x.scores.question >= DEFAULT_TH.question && qsev.json.results[i].level < AIMED_AT_A_PERSON);
qr.forEach((x, i) => {
  const lvl = qsev.json.results[i].level;
  const pass = x.scores.question >= DEFAULT_TH.question && lvl < AIMED_AT_A_PERSON;
  console.log(`question ${x.scores.question.toFixed(2)} L${lvl} ${pass ? "feed" : x.scores.question >= DEFAULT_TH.question ? "DROPPED-BY-SEVERITY" : "low "}  ${QUESTIONS[i].slice(0, 46)}`);
});
check(`streamer feed: 14+ of 22 corpus questions clear the shipped default (${DEFAULT_TH.question})`, clears >= 14, `${clears}/22`);
check(
  "streamer feed: 12+ of 22 corpus questions survive the slider AND the severity guard",
  reaches.length >= 12,
  `${reaches.length}/22 reach the feed, ${clears - reaches.length} of the ${clears} over the slider are dropped as pointed`,
);

// ---------------------------------------------------------------- 3. benign hype and emotes stay out
// Drawn from createGenerator, not hand-written. A fixed list was what let a real false positive
// ship: the corpus template is "best {game} player alive" and {game} is substituted at run time,
// so the page emits ten of it, while the old 32-line list happened to contain only the Valorant
// expansion - the single one that clears the veto. "best Tekken 8 player alive" and "best Elden
// Ring player alive" were landing in the mod queue with a red harassment badge and the script could
// not see it. Enumerating the generator's own output measures every {game}/{emote} expansion the
// page ships. 20k draws saturate at 689 unique benign lines.
const benignSeen = new Map();
const bgen = createGenerator(2024);
for (let i = 0; i < 20_000; i++) {
  const m = bgen.next();
  if (!RULE_BREAKING.includes(m.category)) benignSeen.set(m.text, m.category);
}
const BENIGN = [...benignSeen.keys()];
const br = await pipeline(BENIGN);
const falsePos = br.map((x, i) => [BENIGN[i], x]).filter(([, x]) => x.queued);
falsePos.forEach(([t, x]) => console.log(`FALSE-POS rule=${ruleBreakOf(x.scores).toFixed(2)} har=${x.scores.harassment.toFixed(3)} sev=${x.severity?.toFixed(2) ?? "-"} ${x.label.padEnd(10)} ${t}`));
check(`mod queue: zero of the generator's ${BENIGN.length} benign lines are queued`, falsePos.length === 0, `${falsePos.length} queued`);
// The two bars the English recall fix rests on, asserted from the benign side.
const maxHar = Math.max(...br.map((x) => x.scores.harassment));
check(`mod queue: the benign harassment ceiling clears the ${DEFAULT_TH.harass} bar`, maxHar < DEFAULT_TH.harass, `highest benign harassment ${maxHar.toFixed(2)}`);
// /rate scores enthusiasm, not hostility: a dozen of these land at 1.90-2.02, the same band as a
// real insult. Benign mass does NOT separate them - 4 of the 12 sit under BENIGN_CONFIDENT, which
// is the bug this section now covers. HOSTILE_FLOOR does: praise leaks no harassment mass at all.
const hot = br.map((x, i) => [BENIGN[i], x]).filter(([, x]) => (x.severity ?? 0) >= SEVERITY_QUEUE_AT);
hot.forEach(([t, x]) => console.log(`hot-but-benign sev=${x.severity.toFixed(2)} har=${x.scores.harassment.toFixed(4)} benign mass=${benignOf(x.scores).toFixed(2)} ${t}`));
const hotHarCeiling = Math.max(0, ...hot.map(([, x]) => x.scores.harassment));
check(
  `mod queue: every benign line /rate calls severe stays under the ${HOSTILE_FLOOR} harassment floor`,
  hot.every(([, x]) => x.scores.harassment < HOSTILE_FLOOR),
  `${hot.length} rated >= ${SEVERITY_QUEUE_AT}, highest harassment among them ${hotHarCeiling.toFixed(4)}`,
);
const leaky = hot.filter(([, x]) => benignOf(x.scores) < BENIGN_CONFIDENT).length;
console.log(`of those ${hot.length}, ${leaky} carry benign mass under ${BENIGN_CONFIDENT} - the benign-mass veto alone would queue them`);

// ---------------------------------------------------------------- 4. non-English rule breaks land
const NON_ENGLISH = [
  "下手すぎる、やめろ", "誰も見てないよ、黙れ", "진짜 못한다 접어라", "아무도 안 봐 닥쳐",
  "t'es nul, désinstalle", "desinstala o jogo lixo", "callate idiota nadie te quiere",
  "тебя никто не смотрит, заткнись", "du bist so schlecht, hör auf",
  "犯人は執事だよ", "el mayordomo es el asesino", "der butler ist der mörder", "c'est le majordome le tueur",
  "бесплатные скины на valo-drop[.]ru код CHAT", "skins gratis en valo-gratis[.]xyz codigo CHAT",
  "sigan mi canal twitch.tv/kai99",
];
const nr = await pipeline(NON_ENGLISH);
const landed = nr.filter((x) => x.queued).length;
nr.forEach((x, i) => console.log(`${x.queued ? "queued " : "MISSED "} rule=${ruleBreakOf(x.scores).toFixed(2)} har=${x.scores.harassment.toFixed(2)} sev=${x.severity?.toFixed(2) ?? "-"} ${x.label.padEnd(10)} ${NON_ENGLISH[i].slice(0, 36)}`));
// 13, not 16: the two Russian and Spanish scam lines and one Japanese insult stay out. Every label
// wording that lifted them cost more than it bought elsewhere - see the note in data.ts.
check("recall: 13+ of 16 non-English rule breaks reach the mod queue", landed >= 13, `${landed}/16`);

// ------------------------------------------------- 4b. English rule breaks land (the corpus's own)
// This is the check that was missing while the page blamed the recall gap on non-English alone. All
// 13 English harassment templates from data.ts, through the console's real /classify -> /rate -> policy
// path. At the old 0.40 harassment bar with no severity condition, 7 of these 13 were never queued.
const EN_HARASSMENT = [
  "kys trash streamer", "uninstall the game you are garbage", "nobody watches this crap, get a job",
  "you're so bad it's embarrassing, quit", "your voice is unbearable shut up", "@pixel99 shut your mouth idiot",
  "worst player i have ever seen, actual bot", "go back to your bronze lobby loser",
  "you should be banned from the internet", "you people are subhuman",
  "hope you lose every game tonight, clown", "fat pathetic loser lmao", "cry more you washed up nobody",
];
const er = await pipeline(EN_HARASSMENT);
const enLanded = er.filter((x) => x.queued).length;
er.forEach((x, i) =>
  console.log(`${x.queued ? "queued " : "MISSED "} rule=${ruleBreakOf(x.scores).toFixed(2)} har=${x.scores.harassment.toFixed(2)} sev=${x.severity?.toFixed(2) ?? "-"} ${x.label.padEnd(10)} ${EN_HARASSMENT[i].slice(0, 42)}`),
);
// 12, not 13: "cry more you washed up nobody" wins `hype` at harassment 0.01 and rates only 1.59,
// so neither bar reaches it. It is the one documented English miss.
check("recall: 12+ of 13 English harassment templates reach the mod queue", enLanded >= 12, `${enLanded}/13`);
const bySeverity = er.filter((x) => x.scores.harassment < DEFAULT_TH.harass && x.queued);
console.log(`of those, ${bySeverity.length} are queued by severity alone - the nine-way score lost them`);
// The far side of the gap section 3 measured from below: the insults severity rescues must leak
// more harassment mass than praise does, or the floor that keeps praise out would drop them too.
const rescueFloor = Math.min(1, ...bySeverity.map((x) => x.scores.harassment));
check(
  `recall: the insults severity rescues clear the ${HOSTILE_FLOOR} harassment floor`,
  bySeverity.length > 0 && rescueFloor >= HOSTILE_FLOOR,
  `${bySeverity.length} rescued, lowest harassment among them ${rescueFloor.toFixed(4)} against a benign ceiling of ${hotHarCeiling.toFixed(4)}`,
);
const ceiling = Math.max(0, ...bySeverity.map((x) => benignOf(x.scores)));
check(
  `recall: the insults severity rescues carry benign mass under ${BENIGN_CONFIDENT}`,
  bySeverity.length > 0 && ceiling < BENIGN_CONFIDENT,
  `${bySeverity.length} rescued, highest benign mass among them ${ceiling.toFixed(2)}`,
);

// ---------------------------------------------------------------- 5. severity levels the whole probe set
// Severity sorts the mod queue and guards the streamer feed, so every probe asserts its level, not
// only the ones that happen to pass. Three levels here were wrong until the scale was rewritten: a
// spoiler and a flood sat at 2 (the spoiler sorting above a real insult), an advert sat at 0, and
// "kys, and also what mouse do you use?" sat at 0 because level 0 said "a question".
const SEV = [
  ["kys trash streamer", 3],
  ["you people are subhuman", 3],
  ["you're so bad it's embarrassing, quit", 2],
  ["go back to your bronze lobby loser", 2],
  ["the butler is the killer btw", 1],
  ["follow my channel twitch.tv/pixel99 for Apex content", 1],
  ["AAAAAAAAAAAAAAAAAAAAAAAAAAAA", 1],
  ["kys, and also what mouse do you use?", 3],
  ["are you always this bad or just today? what sens are you on?", 2],
  ["hi everyone", 0],
  ["what mouse do you use?", 0],
];
const sr = await call("rate", { texts: SEV.map(([t]) => t), scale: SEVERITY_SCALE });
console.log(`\n/rate  ${SEV.length} texts · 4 levels · ${sr.inference} ms model · ${sr.ms} ms round trip · ${sr.tokens} tokens\n`);
sr.json.results.forEach((x, i) =>
  console.log(`${x.level === SEV[i][1] ? "ok " : "XX "} severity ${x.score.toFixed(2)}/3 level ${x.level} conf ${x.confidence.toFixed(2)}  want ${SEV[i][1]}  ${SEV[i][0].slice(0, 46)}`),
);
const lv = sr.json.results.map((x) => x.level);
const wrongLevels = SEV.filter(([, want], i) => lv[i] !== want).map(([t], i) => `${t.slice(0, 24)} -> ${lv[i]}`);
check("severity: all 11 probes land on their level", wrongLevels.length === 0, wrongLevels.join("; "));
check("severity: a suicide taunt outranks a spoiler", sr.json.results[0].score > sr.json.results[4].score, `${sr.json.results[0].score.toFixed(2)} vs ${sr.json.results[4].score.toFixed(2)}`);
check("severity: a spoiler sorts below a plain insult", sr.json.results[4].score < sr.json.results[2].score, `${sr.json.results[4].score.toFixed(2)} vs ${sr.json.results[2].score.toFixed(2)}`);
check(
  "streamer feed: both insults phrased as questions are rated at a person, a real question is not",
  lv[7] >= AIMED_AT_A_PERSON && lv[8] >= AIMED_AT_A_PERSON && lv[10] < AIMED_AT_A_PERSON,
  `levels ${lv[7]}, ${lv[8]}, benign ${lv[10]}`,
);

// ---------------------------------------------------------------- 5b. spoiler needs an unreached reveal
// A spoiler blurs the row and queues it, so benign past-tense talk about content the host has already
// played is expensive. "reveals ... a death" alone scored both of these 0.91-0.98, over the 0.80
// default. Ending the description with "the host has not reached yet" fixes the second and not the
// first: "that ending was so good" is a reveal to this route no matter how the sentence is tensed, and
// every longer wording cost questions and non-English recall elsewhere. One asserted, one recorded.
const NOT_SPOILERS = ["i died laughing when the boss killed you", "that ending was so good in the last game you played"];
const nsr = await classify(NOT_SPOILERS);
nsr.forEach((x, i) => console.log(`spoiler ${x.scores.spoiler.toFixed(2)}${x.scores.spoiler >= DEFAULT_TH.spoiler ? " FALSE-POS" : " ok       "} ${NOT_SPOILERS[i]}`));
check(
  `spoiler: "i died laughing when the boss killed you" stays under the default (${DEFAULT_TH.spoiler})`,
  nsr[0].scores.spoiler < DEFAULT_TH.spoiler,
  `${nsr[0].scores.spoiler.toFixed(2)} - a thin margin: it was 0.91 before the rewrite and lands near 0.78 now`,
);
console.log(`known miss: "that ending was so good in the last game you played" scores ${nsr[1].scores.spoiler.toFixed(2)} and is still blurred`);

// ------------------------------------------------- 5d. the badge names the reason, not the severity
// A queued card shows a reason badge above its own probability bars, so a badge the bars contradict
// is a card that argues with itself. That shipped: with the severity branch ahead of the worst-label
// check, every corpus spoiler /rate calls hostile was badged "harassment" over a harassment bar
// reading 0.00. Run the corpus's own rule breaks through the real cascade and check the badge.
const REASONED = [
  ["the twist is that the mentor was the villain the whole time", "spoiler"],
  ["el mayordomo es el asesino", "spoiler"],
  ["c'est le majordome le tueur", "spoiler"],
  ["the butler is the killer btw", "spoiler"],
  ["spoiler: the main character dies at the end", "spoiler"],
  ["streamer is giving away 5000 vbucks claim here: free-vbucks-gift[.]com", "scam"],
  ["follow my channel twitch.tv/pixel99 for Apex content", "selfpromo"],
  ["copypasta copypasta copypasta copypasta copypasta", "spam"],
  ["kys trash streamer", "harassment"],
  ["nobody watches this crap, get a job", "harassment"],
];
const rr = await pipeline(REASONED.map(([t]) => t));
const badges = rr.map((x) => modReason({ scores: x.scores, severity: x.severity }));
rr.forEach((x, i) =>
  console.log(
    `${badges[i] === REASONED[i][1] ? "ok " : "XX "} badge ${badges[i].padEnd(10)} want ${REASONED[i][1].padEnd(10)} har=${x.scores.harassment.toFixed(2)} spo=${x.scores.spoiler.toFixed(2)} sev=${x.severity?.toFixed(2) ?? "-"}  ${REASONED[i][0].slice(0, 40)}`,
  ),
);
const misbadged = REASONED.filter(([, want], i) => badges[i] !== want).map(([t], i) => `${t.slice(0, 28)} -> ${badges[i]}`);
check("mod queue: the reason badge agrees with the bars under it", misbadged.length === 0, misbadged.join("; "));

// ---------------------------------------------------------------- 5c. why /rate has to guard the feed
// These two come back label=question with harassment 0.00, so the feed's `harassment < t.harass`
// guard - the Jev original's own guard - cannot fire. Section 5 is what catches them.
const HOSTILE_Q = [SEV[7][0], SEV[8][0], SEV[10][0]];
const hq = await classify(HOSTILE_Q);
hq.forEach((x, i) => console.log(`hostile-q ${x.label.padEnd(10)} q=${x.scores.question.toFixed(2)} har=${x.scores.harassment.toFixed(2)}  ${HOSTILE_Q[i]}`));
check(
  "streamer feed: the harassment guard alone is blind to an insult phrased as a question",
  hq[0].scores.harassment < DEFAULT_TH.harass && hq[0].scores.question >= DEFAULT_TH.question,
  `har=${hq[0].scores.harassment.toFixed(2)} q=${hq[0].scores.question.toFixed(2)} - severity level ${lv[7]} is what drops it`,
);

// ---------------------------------------------------------------- 6. the language call beats the regex
const lr = await classify(NON_ENGLISH, LANGUAGE_LABELS);
const TRUE_LANG = ["japanese", "japanese", "korean", "korean", "french", "portuguese", "spanish", "russian", "german", "japanese", "spanish", "german", "french", "russian", "spanish", "spanish"];
let model = 0;
let regex = 0;
lr.forEach((x, i) => {
  const r = detectLang(NON_ENGLISH[i]);
  model += x.label === TRUE_LANG[i];
  regex += r === TRUE_LANG[i];
  console.log(`model ${x.label.padEnd(11)} regex ${r.padEnd(11)} want ${TRUE_LANG[i].padEnd(11)} ${NON_ENGLISH[i].slice(0, 30)}`);
});
console.log(`\nlanguage: model ${model}/16 · regex fallback ${regex}/16`);
check("language: the regex fallback is usable on its own (12+ of 16)", regex >= 12, `${regex}/16`);

console.log(`\n${failures.length === 0 ? "all checks passed" : `${failures.length} FAILED: ${failures.join("; ")}`}`);
process.exit(failures.length === 0 ? 0 : 1);
