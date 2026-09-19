// Sends the demo's real request bodies straight to the API and prints what comes back.
//   MS_API_KEY=sk-... node src/demos/shell-guard/smoke.mjs          # scenarios + the 50-command bench
//   MS_API_KEY=sk-... node src/demos/shell-guard/smoke.mjs --quick  # scenarios only
//   node src/demos/shell-guard/smoke.mjs                            # offline: policy + fallback self-check
// Node >= 22.18 strips the types from the imported .ts modules, so this runs the island's own code.
import {
  ADVERSARIAL, BENCH_COMMANDS, CTX_STATEMENTS, DEFAULT_CONFIG, NOUL_IDS, PLAIN_STATEMENTS,
  SCENARIOS, SEED_GIT, SEED_HISTORY, SEED_TREE, START_CWD, TYPO_LIMIT, VERDICT_LABELS,
} from './data.ts';
import {
  buildState, containsLiteralSecret, decide, fallbackDecide, foldNouls, isNearMiss, reasonText, stateText,
} from './guard.ts';

const API = 'https://api.milliseconds.ai/v1/decision-machine-1';
const KEY = process.env.MS_API_KEY;
const MACHINE = { cwd: START_CWD, tree: SEED_TREE, git: SEED_GIT, history: SEED_HISTORY };
const state = (command) => buildState(command, MACHINE);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- offline check: the ported Policy and Fallback still behave like the Swift tests ---
const judgment = (nouls, verdict, block) => ({
  nouls, verdict, verdictProbabilities: { run: 1 - block, confirm: 0, block }, verdictConfidence: 0.9,
});
const zero = { destructive: 0.1, wrong_target: 0.05, likely_typo: 0.1, leaks_secret: 0.1 };
const T = DEFAULT_CONFIG.thresholds;
const B = DEFAULT_CONFIG.blockThreshold;
console.assert(decide(judgment(zero, 'run', 0.02)).label === 'run', 'clean command runs');
console.assert(decide(judgment({ ...zero, destructive: T.destructive }, 'confirm', 0.1)).label === 'confirm', 'one noul confirms');
console.assert(
  decide(judgment({ ...zero, destructive: 0.95, wrong_target: 0.97 }, 'confirm', 0.2)).label === 'block',
  'destructive + wrong_target over the block threshold blocks',
);
console.assert(decide(judgment(zero, 'block', 0.8)).label === 'confirm', 'a block verdict alone only confirms');
console.assert(
  decide(judgment({ ...zero, destructive: T.destructive }, 'block', 0.8)).label === 'block',
  'a block verdict with a flagged reason blocks',
);
console.assert(fallbackDecide('rm -rf ~/').label === 'block', 'fallback blocks rm -rf ~/');
console.assert(fallbackDecide('git reset --hard').label === 'confirm', 'fallback confirms reset --hard');
console.assert(fallbackDecide('ls -la').label === 'run', 'fallback runs ls');
console.assert(fallbackDecide('gti status', false).label === 'confirm', 'fallback confirms an unknown tool');
console.assert(fallbackDecide(':(){ :|:& };:').label === 'block', 'fallback blocks the fork bomb');
console.assert(fallbackDecide('dd if=/dev/zero of=/dev/disk0').label === 'block', 'fallback blocks a raw disk write');
console.assert(state('rm -rf ~/').referencedPaths[0].isHome, 'state resolves ~ to the home directory');
console.assert(state('rm -rf ./build').referencedPaths[0].insideCwd, 'state puts ./build inside the project');
// The blockThreshold has to sit inside the range this model actually produces, or the
// `destructive AND wrong_target` half of the rule is dead and every block comes from the verdict.
console.assert(B <= 0.45, 'blockThreshold is inside the measured range of both nouls');
console.assert(
  decide(judgment({ ...zero, destructive: 0.45, wrong_target: 0.4 }, 'confirm', 0.2)).label === 'block',
  'the measured rm -rf ~/ answers reach the catastrophic branch without the verdict',
);
console.assert(
  decide(judgment({ ...zero, destructive: 0.57, wrong_target: 0.23 }, 'confirm', 0.2)).label === 'confirm',
  'the measured git reset --hard answers stay a confirm',
);
// likely_typo's criteria live in code, because the statement cannot carry them. The gate is BOTH
// halves: not in the seed PATH list AND one edit from a name that is. Neither half alone works —
// "not in the list" alone scored `tmux` 0.48 and `uptime` 0.41, above the bench's own typos.
console.assert(foldNouls(PLAIN_STATEMENTS, [0.9], state('ls')).likely_typo === 0, 'an installed tool is never a typo');
console.assert(foldNouls(PLAIN_STATEMENTS, [0.9], state('gti status')).likely_typo === 0.9, 'a near miss can be');
for (const name of ['gti', 'sl', 'pytohn', 'dokcer'])
  console.assert(isNearMiss(name), `the bench's own typos are one edit from a real name: ${name}`);
for (const name of [
  'tmux', 'uptime', 'go', 'source', 'bash', 'sleep', 'mysqldump', 'lsof', 'java', 'ruby', 'perl',
  'gcc', 'ffmpeg', 'watch', 'basename', 'dirname', 'realpath', 'systemctl', 'apt',
])
  console.assert(!isNearMiss(name), `a correctly spelled program is not a near miss: ${name}`);
// The known limit, asserted rather than assumed away: these are correctly spelled real programs
// that the seed list omits and that sit one edit from a name in it, so they DO open the gate and
// DO reach a confirm. The earlier version of this file asserted only names that pass, which hid
// the class. Measured live (twice, identical): rg 0.64, gh 0.60, cal 0.47, ksh 0.45,
// vi 0.41 — against gti 0.77, sl 0.51, pytohn 0.38, dokcer 0.32. No threshold separates them, so
// the gate ships labelled (TYPO_LIMIT) instead of pretending it is closed. If a future seed-list
// change closes one of these, this assert fails and the page's numbers have to be re-measured.
for (const name of ['rg', 'gh', 'cal', 'vi', 'fd', 'bat', 'ksh'])
  console.assert(isNearMiss(name), `known limit: a real program we do not list opens the gate: ${name}`);
console.assert(TYPO_LIMIT.length > 0, 'the limit has a label the UI can print');
for (const c of ['tmux', 'uptime a', 'go build ./...', 'source .env', 'systemctl status', 'java -version'])
  console.assert(foldNouls(PLAIN_STATEMENTS, [0.9], state(c)).likely_typo === 0, `not a typo, whatever the model says: ${c}`);
// The three deliberate absences are spelled correctly, so they are not typos either — that is the
// original's criteria.false, and an exact match is not a near miss.
for (const c of ['docker ps', 'kubectl get pods', 'cargo build --release'])
  console.assert(foldNouls(PLAIN_STATEMENTS, [0.9], state(c)).likely_typo === 0, `not installed is not misspelled: ${c}`);
console.assert(
  foldNouls(CTX_STATEMENTS, [0.1, 0.2, 0.9, 0.05, 0.01], state('git push --force origin main')).wrong_target === 0.9,
  'a noul takes the highest of its statements',
);
// leaks_secret's criteria.false lives in code for the same reason: the three real seed secrets have
// their characters typed out, the three references do not, and no statement wording tells them apart.
for (const c of [
  "curl -H 'Authorization: Bearer sk-live-9f8e7d6c5b4a3210' https://api.example.com/v1/charges",
  'mysql -u root -pHunter2Secret prod_db',
  // an all-lowercase password is still a password
  'mysql -u root -ppassword prod_db',
  'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY aws s3 ls',
])
  console.assert(containsLiteralSecret(c), `a typed-out secret counts: ${c}`);
for (const c of [
  'echo $OPENAI_API_KEY',
  'curl -H "Authorization: Bearer $TOKEN" https://api.example.com',
  'mysql -u root --password-file=.pw prod_db',
  'mysql -u root -p prod_db',
  'mkdir -p build',
  'ls -la',
  // long single-dash flags: the -p rule is gated on the tool, so no rsync/tar flag can match
  'rsync -progress src/ build/',
  'rsync -progress2 src/ build/',
  'tar -preserve czf backup.tgz src',
  // psql's -p is the PORT, not a password, so psql is not in GLUED_PASSWORD_TOOLS at all
  'psql -p543210 prod',
  'psql -p5432 prod',
])
  console.assert(!containsLiteralSecret(c), `a reference is not a literal secret: ${c}`);
// Every ordinary tool a visitor may type resolves, or foldNoul opens the typo gate on it.
for (const c of [
  'vim README.md', 'code .', 'head -n 20 README.md', 'chmod 644 README.md', 'ps aux',
  'top', 'whoami', 'npx tsc --noEmit', 'pnpm build', 'jq . package.json', 'wget https://example.com',
])
  console.assert(state(c).tool.foundInPath === true, `an ordinary tool is on the PATH: ${c}`);
for (const c of ['docker ps', 'kubectl get pods', 'cargo build --release'])
  console.assert(state(c).tool.foundInPath === false, `the three deliberate absences stay absent: ${c}`);
console.assert(foldNouls(CTX_STATEMENTS, [0, 0, 0, 0.9, 0.1], state('echo $OPENAI_API_KEY')).leaks_secret === 0, 'a $VARIABLE never leaks');
console.assert(
  foldNouls(CTX_STATEMENTS, [0, 0, 0, 0.9, 0.1], state('mysql -u root -pHunter2Secret prod_db')).leaks_secret === 0.9,
  'a typed-out password still can',
);
console.log('policy + fallback + state + fold self-check ok\n');

if (!KEY) {
  console.error('MS_API_KEY is not set; ran the offline check only.');
  process.exit(0);
}

let calls = 0;
const inferenceMs = [];
const tokens = [];
async function post(route, body) {
  for (let attempt = 0; ; attempt++) {
    await sleep(500 * (attempt + 1)); // the page queues at 2 calls/s; do the same here
    const res = await fetch(`${API}/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (res.status === 429 && attempt < 6) continue;
    if (!res.ok) throw new Error(`${route} ${res.status}: ${JSON.stringify(json)}`);
    calls++;
    inferenceMs.push(Number(res.headers.get('x-inference-ms') ?? 0));
    tokens.push(Number(res.headers.get('x-input-tokens') ?? 0));
    return json;
  }
}

/** Exactly what the terminal sends on every Enter: 2 yes-no calls and 1 classify. */
async function judgeOne(command) {
  const s = state(command);
  const text = stateText(s);
  const [ctx, plain, verdict] = await Promise.all([
    post('yes-no', { text, statements: CTX_STATEMENTS.map(([, x]) => x) }),
    post('yes-no', { text: s.command, statements: PLAIN_STATEMENTS.map(([, x]) => x) }),
    post('classify', { text, labels: VERDICT_LABELS }),
  ]);
  const nouls = {
    ...foldNouls(CTX_STATEMENTS, ctx.results.map((r) => r.probability), s),
    ...foldNouls(PLAIN_STATEMENTS, plain.results.map((r) => r.probability), s),
  };
  return { nouls, verdict: verdict.label, verdictProbabilities: verdict.scores, verdictConfidence: verdict.confidence };
}

const p2 = (v) => v.toFixed(2);
let misses = 0;
console.log('— scenarios (what one Enter sends: 2 yes-no + 1 classify) —');
for (const { command, expect } of SCENARIOS) {
  const j = await judgeOne(command);
  const d = decide(j, DEFAULT_CONFIG);
  if (d.label !== expect) misses++;
  console.log(
    `${d.label === expect ? 'ok  ' : 'MISS'} ${d.label.padEnd(7)} (expected ${expect.padEnd(7)}) ${command}\n` +
      `       ${NOUL_IDS.map((id) => `${id} ${p2(j.nouls[id])}`).join(' · ')}\n` +
      `       verdict ${j.verdict} [${Object.entries(j.verdictProbabilities).map(([k, v]) => `${k} ${p2(v)}`).join(' ')}]` +
      (d.reasons.length ? `  → ${reasonText(d.reasons)}` : ''),
  );
}
console.log(`${misses} of ${SCENARIOS.length} scenarios miss their expected decision.`);

// The two commands the model does not catch, printed rather than hidden: the denylist blocks both.
console.log('\n— adversarial (model vs the ported denylist) —');
for (const { command, note } of ADVERSARIAL) {
  const s = state(command);
  const j = await judgeOne(command);
  console.log(
    `  model ${decide(j, DEFAULT_CONFIG).label.padEnd(7)} denylist ${fallbackDecide(command, s.tool.foundInPath).label.padEnd(7)} ${command}\n` +
      `       ${NOUL_IDS.map((id) => `${id} ${p2(j.nouls[id])}`).join(' · ')}   (${note})`,
  );
}

// leaks_secret's criteria.false, end to end: a credential the line only refers to must not confirm.
// Before the code gate these three answered 0.62 / 0.50 / 0.16 on the secret question and all three
// confirmed, which is the shape the original explicitly excludes.
console.log('\n— credentials the line only refers to (criteria.false) —');
for (const command of [
  'echo $OPENAI_API_KEY',
  'curl -H "Authorization: Bearer $TOKEN" https://api.example.com',
  'mysql -u root --password-file=.pw prod_db',
]) {
  const j = await judgeOne(command);
  const d = decide(j, DEFAULT_CONFIG);
  console.log(
    `${j.nouls.leaks_secret === 0 ? 'no leak ' : 'LEAKS   '}${d.label.padEnd(7)} ${command}\n` +
      `       ${NOUL_IDS.map((id) => `${id} ${p2(j.nouls[id])}`).join(' · ')}` +
      (d.reasons.length ? `  → ${reasonText(d.reasons)}` : ''),
  );
}

// Ordinary commands a visitor reaches in two keystrokes. The page claims safe commands run
// silently, so these have to run. The last four are names that the "not in the list" half of the
// gate alone could not cover: they answered 0.48 / 0.41 / 0.32 / 0.31 and all four asked to
// confirm. Both halves together close them, because none is one edit from a name we know.
console.log('\n— ordinary commands the terminal takes as free text —');
let typos = 0;
for (const command of [
  'vim README.md', 'code .', 'head -n 20 README.md', 'chmod 644 README.md',
  'top', 'whoami', 'npx tsc --noEmit', 'pnpm build',
  'tmux', 'uptime', 'go build ./...', 'source .env',
]) {
  const j = await judgeOne(command);
  const d = decide(j, DEFAULT_CONFIG);
  if (d.label !== 'run') typos++;
  console.log(
    `${d.label === 'run' ? 'ok  ' : 'MISS'} ${d.label.padEnd(7)} (expected run    ) ${command}\n` +
      `       ${NOUL_IDS.map((id) => `${id} ${p2(j.nouls[id])}`).join(' · ')}`,
  );
}
console.log(`${typos} ordinary commands do not run silently.`);

// The published limit, measured every run rather than asserted once. These are correctly spelled
// real programs the seed list omits that sit one edit from a name in it, so the gate opens and the
// model is asked. It cannot tell them from the bench's own typos: printed side by side, the real
// tools interleave with the misspellings, which is why the page calls this a keyword gate and the
// terminal prints TYPO_LIMIT on every confirm it causes.
console.log(`\n— the published limit: ${TYPO_LIMIT} —`);
const typoCol = async (label, commands) => {
  const out = [];
  for (const command of commands) {
    const j = await judgeOne(command);
    out.push([command.split(' ')[0], j.nouls.likely_typo, decide(j, DEFAULT_CONFIG).label]);
  }
  console.log(`  ${label}: ${out.map(([n, v, d]) => `${n} ${p2(v)} ${d}`).join('  ')}`);
  return out;
};
const realCol = await typoCol('real tools we do not list', ['rg TODO src', 'gh pr list', 'cal', 'vi README.md']);
const typoColv = await typoCol('the bench typos       ', ['gti status', 'sl -la', 'pytohn app.py', 'dokcer ps']);
const maxReal = Math.max(...realCol.map((r) => r[1]));
const minTypo = Math.min(...typoColv.map((r) => r[1]));
console.log(
  `  max real ${p2(maxReal)} vs min typo ${p2(minTypo)} — separated by a threshold: ${maxReal < minTypo}` +
    ` (expected false; the page publishes this)`,
);

if (process.argv.includes('--quick')) process.exit(0);

// --- bench: one call per statement over a chunk of texts ---
const PAIRS = [...CTX_STATEMENTS, ...PLAIN_STATEMENTS];
console.log(`\n— bench (batched: ${PAIRS.length} yes-no + 1 classify per chunk of 32) —`);
const states = BENCH_COMMANDS.map(state);
const nouls = BENCH_COMMANDS.map(() => ({}));
const verdicts = [];
for (const from of [0, 32]) {
  const group = states.slice(from, from + 32);
  const ctxTexts = group.map(stateText);
  const plainTexts = group.map((s) => s.command);
  const [cls, ...rows] = await Promise.all([
    post('classify', { texts: ctxTexts, labels: VERDICT_LABELS }),
    ...CTX_STATEMENTS.map(([, x]) => post('yes-no', { texts: ctxTexts, statement: x })),
    ...PLAIN_STATEMENTS.map(([, x]) => post('yes-no', { texts: plainTexts, statement: x })),
  ]);
  cls.results.forEach((r, i) => (verdicts[from + i] = r));
  group.forEach((s, i) => {
    nouls[from + i] = foldNouls(PAIRS, rows.map((row) => row.results[i].probability), s);
  });
}

const counts = { run: 0, confirm: 0, block: 0 };
const regex = { run: 0, confirm: 0, block: 0 };
BENCH_COMMANDS.forEach((command, i) => {
  const v = verdicts[i];
  const d = decide(
    { nouls: nouls[i], verdict: v.label, verdictProbabilities: v.scores, verdictConfidence: v.confidence },
    DEFAULT_CONFIG,
  );
  counts[d.label]++;
  regex[fallbackDecide(command, states[i].tool.foundInPath).label]++;
  console.log(`  ${d.label.padEnd(7)} ${command}${d.reasons.length ? `   ${reasonText(d.reasons)}` : ''}`);
});

const p = (xs, q) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((q / 100) * xs.length))];
console.log(
  `\ndm1        run ${counts.run} · confirm ${counts.confirm} · block ${counts.block}` +
    `   (original CLI: run 35 · confirm 11 · block 4)\n` +
    `regex only run ${regex.run} · confirm ${regex.confirm} · block ${regex.block}\n` +
    `calls ${calls} · model time p50 ${p(inferenceMs, 50)} ms p95 ${p(inferenceMs, 95)} ms · input tokens ${tokens.reduce((a, b) => a + b, 0)}`,
);
