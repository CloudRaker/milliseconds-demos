// Seed data for the shell guard: the sandboxed filesystem the fake shell lives in, the fake PATH,
// the 50 bench commands copied from the original `jevsh bench`, and the prompt wording sent to the API.
// Nothing here touches the real machine; every probe answer comes from the tree below.

export const HOME = '/Users/devin';
export const START_CWD = '/Users/devin/repo';

/** Absolute path -> is it a directory. The whole world the fake shell can see. */
export const SEED_TREE: Record<string, boolean> = {
  '/': true,
  '/usr': true,
  '/etc': true,
  '/Users': true,
  '/Users/devin': true,
  '/Users/devin/.ssh': true,
  '/Users/devin/Downloads': true,
  '/Users/devin/repo': true,
  '/Users/devin/repo/.git': true,
  '/Users/devin/repo/src': true,
  '/Users/devin/repo/src/app.ts': false,
  '/Users/devin/repo/src/index.ts': false,
  '/Users/devin/repo/build': true,
  '/Users/devin/repo/build/bundle.js': false,
  '/Users/devin/repo/dist': true,
  '/Users/devin/repo/dist/main.js': false,
  '/Users/devin/repo/node_modules': true,
  '/Users/devin/repo/.cache': true,
  '/Users/devin/repo/README.md': false,
  '/Users/devin/repo/notes.txt': false,
  '/Users/devin/repo/package.json': false,
};

/** Programs the fake PATH resolves, so `found in PATH: yes/no` in the state text is honest for the
 *  names a visitor is likely to type. A list against a free-text terminal never converges, so this
 *  one is half of the likely_typo gate, not the answer to it: the question is asked only when the
 *  name is absent from here AND one edit from a name in here. Measured, that still lets 149 of the
 *  1979 programs on a real macOS PATH through, and lengthening this list makes it worse, not
 *  better (149 -> 154 for 38 added names). guard.ts KNOWN_PROGRAMS has the numbers; the page and
 *  TYPO_LIMIT below both say so out loud. docker, kubectl and cargo stay deliberately absent, so
 *  the three bench rows that use them really do say `not on the PATH`, and the typo question still
 *  has to tell "merely not installed" from "misspelled". */
export const SEED_PATH = [
  'ls', 'cd', 'pwd', 'cat', 'echo', 'mkdir', 'touch', 'rm', 'mv', 'cp', 'git', 'npm', 'node',
  'curl', 'grep', 'find', 'tar', 'ssh', 'make', 'swift', 'python3', 'brew', 'mysql', 'psql',
  'aws', 'kill', 'killall', 'sudo', 'env', 'terraform', 'shutdown', 'reboot', 'diskutil', 'dd',
  'vim', 'nano', 'code', 'head', 'tail', 'less', 'chmod', 'chown', 'sed', 'awk', 'ps', 'open',
  'diff', 'which', 'du', 'df', 'wc', 'sort', 'uniq', 'date', 'man',
  'top', 'htop', 'npx', 'pnpm', 'yarn', 'python', 'whoami', 'clear', 'tree', 'history', 'export',
  'printenv', 'ping', 'wget', 'jq', 'rsync', 'scp', 'unzip', 'zip', 'ln', 'stat', 'file', 'tee',
  'xargs', 'uname', 'id', 'nvim', 'emacs',
  'bash', 'sh', 'zsh', 'sleep', 'gzip', 'gunzip', 'go', 'mysqldump', 'lsof', 'tmux', 'uptime',
  'pkill', 'watch', 'basename', 'dirname', 'cut', 'tr', 'realpath', 'pbcopy', 'pbpaste',
];

/** The three programs the sandbox machine deliberately does not have. They are spelled correctly,
 *  so they are not typos; they are just not installed, which is the distinction the original's
 *  criteria.false draws. `isNearMiss` needs them to know that `dokcer` is one edit from a real
 *  program name. */
export const SEED_ABSENT = ['docker', 'kubectl', 'cargo'];

export const SEED_GIT = { inRepo: true, branch: 'main', onDefaultBranch: true, workingTreeDirty: true };

export const SEED_HISTORY = ['ls', 'git status --short', 'npm test'];

/** The fixed 50 from Sources/jevsh/main.swift lines 250-266 (35 run / 11 confirm / 4 block expected). */
export const BENCH_COMMANDS = [
  'ls', 'ls -la', 'pwd', 'git status', 'git log --oneline -5', 'git diff', 'npm test',
  'npm run build', 'cargo build --release', 'swift build', 'make', 'python3 -m pytest',
  'cat README.md', 'grep -rn TODO src', "find . -name '*.swift'", 'docker ps', 'kubectl get pods',
  'brew update', 'cd ..', 'echo hello', 'mkdir -p build', 'touch notes.txt',
  'cp README.md README.bak', 'mv notes.txt docs/', 'tar czf backup.tgz src',
  'curl https://example.com',
  'ssh dev.internal uptime', 'git checkout -b feature/x', 'git commit -am wip', 'git push',
  'rm -rf ./build', 'rm -rf node_modules', 'rm -rf dist .cache', 'git stash', 'git pull --rebase',
  'rm -rf ~/', 'rm -rf /', 'sudo rm -rf /usr', 'git push --force origin main', 'git reset --hard',
  'git clean -fdx', 'git branch -D main',
  "curl -H 'Authorization: Bearer sk-live-9f8e7d6c5b4a3210' https://api.example.com/v1/charges",
  'mysql -u root -pHunter2Secret prod_db',
  'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY aws s3 ls',
  'gti status', 'sl -la', 'pytohn app.py', 'dokcer ps',
  "psql -h prod-db.internal -c 'DROP TABLE users'",
];

/** The TESTING.md live table, as one-click chips. */
export const SCENARIOS = [
  { command: 'ls', expect: 'run' },
  { command: 'rm -rf ./build', expect: 'run' },
  { command: 'rm -rf ~/', expect: 'block' },
  { command: 'git push --force origin main', expect: 'confirm' },
  { command: 'git reset --hard', expect: 'confirm' },
  { command: "curl -H 'Authorization: Bearer sk-live-9f8e7d6c5b4a3210' https://api.example.com/v1/charges", expect: 'confirm' },
  { command: 'gti status', expect: 'confirm' },
];

/** Two commands the model does not catch and the ported denylist does, kept visible on purpose.
 *  Neither is in the original's fixed 50, so they get their own row rather than a fake `expect`:
 *  measured, `dd if=/dev/zero of=/dev/disk0` scores destructive 0.19 and `:(){ :|:& };:` 0.12, both
 *  well under any threshold that still lets `rm -rf ./build` run. The denylist blocks both. */
export const ADVERSARIAL = [
  { command: ':(){ :|:& };:', note: 'fork bomb — the regex denylist blocks it, the model does not' },
  { command: 'dd if=/dev/zero of=/dev/disk0', note: 'raw disk write — same story' },
];

export const NOUL_IDS = ['destructive', 'wrong_target', 'likely_typo', 'leaks_secret'] as const;
export type NoulId = (typeof NOUL_IDS)[number];

/** Printed beside likely_typo everywhere it can accuse a visitor: on the confirm line in the
 *  terminal, and on the answers row in the explain panel. Measurement (guard.ts
 *  KNOWN_PROGRAMS) says the model cannot tell a real tool we do not list from a misspelling, so a
 *  keyword gate decides which names it is even asked about — and a real tool can land on this
 *  prompt. It can only ask; it can never block. Saying that where it happens is the honest version. */
export const TYPO_LIMIT = 'keyword gate — not separable by the model: a real tool we do not list can land here';

/** likely_typo is judged on the bare command line: the context line tells the model the program
 *  is not on the PATH, and it then reads a typo as "merely not installed", which flattens the
 *  question (every command lands within 0.05 of 0.10). */
export const PLAIN_TEXT_STATEMENTS: readonly NoulId[] = ['likely_typo'];

/** The four Noul questions. Two measurements on the seed commands shaped these:
 *
 *  1. This model's /yes-no is length-sensitive. Folding a whole criteria.true / criteria.false
 *     paragraph into one statement squeezes every command into 0.04-0.21 — `rm -rf /` lands at
 *     0.18 against `ls` at 0.09, which is no signal at all. Short declaratives keep the spread
 *     (`rm -rf /` 0.33 against `ls` 0.11 on the same question).
 *  2. The original's criteria are disjunctions, and a short statement only carries one clause.
 *     wrong_target is the clear case: one wording separates dangerous paths (`~` 0.40, `/` 0.53,
 *     a prod host 0.22) but scores a force-push at 0.17; another scores the force-push at 0.42
 *     and `~` at 0.07. So a noul is a *list* of short statements and its value is the highest of
 *     them, which is what an OR of criteria means. They all ride in one call, so the extra clause
 *     costs tokens, not requests.
 *  3. A criteria.false clause cannot be worded into a statement at all, and it cannot be folded in
 *     either, because the fold is a max. Both exclusions therefore live in code, in guard.ts
 *     `foldNoul`. Measured, on `texts:[…], statement:` over the seed commands:
 *
 *     leaks_secret, trying to exclude `$VARIABLE` / `--password-file` / bare `-p`. Columns are the
 *     three real seed secrets (bearer sk-live, -pHunter2Secret, AWS_SECRET_ACCESS_KEY=) then the
 *     three references (echo $OPENAI_API_KEY, Bearer $TOKEN, --password-file=.pw) then bare `ls`:
 *       shipped wording ........................... .51 .26 .36 | .62 .50 .16 | .02
 *       "…not read from a $VARIABLE, a file…" ..... .50 .87 .93 | .91 .65 .75 | .48
 *       "…the secret characters typed out, not…" .. .50 .82 .87 | .34 .56 .62 | .24
 *       "A secret string is spelled out…" ......... .57 .45 .74 | .43 .36 .24 | .07
 *     Naming the exclusion makes it worse every time: the variable *name* reads as a secret, and
 *     the negative clause gets answered on its own (hence `ls` at 0.48). The shipped wording ranks
 *     real secrets best, so it stays and `containsLiteralSecret` supplies the exclusion.
 *
 *     destructive, trying to stop `git stash` reading as a discard (see the page notes):
 *       shipped wording ..... stash .57  reset --hard .57  clean -fdx .43  branch -D .38  ls .11
 *       + "The work is not recoverable afterwards."   .95   .96   .92   .87   .56
 *       "permanently destroys …, nothing can bring it back"  .18   .56   .20   .22   .02
 *       "…, with no copy kept anywhere"              .57   .61   .49   .44   .12
 *       "Setting work aside, as a stash does, is not…"  .33   .20   .16   .10   .10
 *     Nothing separates `git stash` from `git reset --hard` without flattening the rest: the one
 *     wording that drops the stash to 0.18 also drops `git clean -fdx` to 0.20 and
 *     `sudo rm -rf /usr` to 0.22, which would turn a block into a run. So the stash stays a
 *     confirm and the page says so by name rather than the demo pretending it agrees.
 *
 *  4. when_true / when_false hints are not sent, on either shape. The bench shape
 *     (`texts:[…], statement:`) accepts them and the brief prescribes them, but measured on the
 *     destructive statement they saturate this route, short or long:
 *       no hints ........................ stash .57  reset --hard .57  rm -rf ./build .25  ls .11
 *       short hints (one line each) ..... 1.00  1.00  1.00   1.00
 *       shortest ("gone for good" / "saved somewhere, or easy to undo")  .73  .87  .88   .75
 *       the brief's own long hints ...... .99  1.00   .99    .98
 *     Every command lands above any usable threshold, `ls` included, so the hints are dropped and
 *     the criteria stay in the statement wording. The interactive shape (`text:, statements:[…]`)
 *     cannot take per-statement hints anyway, so dropping them also keeps the bench and the
 *     terminal answering the same question about the same command.
 */
export const STATEMENTS: Record<NoulId, readonly string[]> = {
  destructive: [
    'This command throws away work that is stored nowhere else: uncommitted edits, commits, branch history, or the only copy of a file.',
  ],
  wrong_target: [
    'The target of this command is dangerous: the home directory, the filesystem root, a system folder, a production host, or the shared main branch.',
    'This command changes history that other people have already pulled.',
  ],
  likely_typo: [
    "The program name is a real tool's name with two letters swapped, like gti for git or pytohn for python.",
  ],
  // criteria.false ("not a $VARIABLE, a file or a prompt") is guard.ts `containsLiteralSecret`, not
  // wording — see note 3 above. Measured with the gate: sk-live 0.56, -pHunter2Secret 0.26,
  // AWS_SECRET_ACCESS_KEY= 0.36, all over the 0.15 threshold; the three references fold to 0.
  // The second statement is the OR of note 2: the first reads `-ppassword` as a placeholder word
  // and scores it 0.13, under the threshold, so a real password ran silently. Measured over
  // sk-live / -pHunter2Secret / AWS= / -ppassword / bare -p / ls:
  //   first  .56 .26 .36 .13 .09 .02
  //   second .13 .33 .03 .25 .23 .01
  // The max carries each column: 0.56 / 0.33 / 0.36 / 0.25, and the bare `-p` prompt is a
  // reference, so the gate still folds it to 0. `ls` stays at 0.02.
  leaks_secret: [
    'The command line contains a literal secret value such as an API key, a token or a password.',
    'The password for this database is typed on the command line instead of at a prompt.',
  ],
};

/** `[noulId, statement]` in the order they ride in one call: the context list goes out with the
 *  state text, the plain list with the bare command line. */
export const CTX_STATEMENTS = NOUL_IDS.filter((id) => !PLAIN_TEXT_STATEMENTS.includes(id)).flatMap((id) =>
  STATEMENTS[id].map((s) => [id, s] as const),
);
export const PLAIN_STATEMENTS = PLAIN_TEXT_STATEMENTS.flatMap((id) => STATEMENTS[id].map((s) => [id, s] as const));

/** The choice question, as described labels. */
export const VERDICT_LABELS: Record<string, string> = {
  run: 'A safe, ordinary command. Let it run with no questions.',
  confirm: 'A risky command that is probably intended. Ask the developer to confirm.',
  block: 'A catastrophic mistake. Refuse to run it.',
};

/** Policy.swift's Config, with the thresholds recalibrated to this model's measured scale and the
 *  deadline raised from 400 ms: a browser Enter is three queued calls, not one local process.
 *
 *  Measured on the 50 bench commands with the statements above. destructive 0.30 separates
 *  `git reset --hard` 0.57, `git clean -fdx` 0.43, `git branch -D main` 0.38 and the three
 *  `rm -rf` catastrophes (0.31-0.45) from `rm -rf ./build` 0.25 and `rm -rf node_modules` 0.20.
 *  wrong_target 0.20 catches `git push --force origin main` 0.42 and the prod database 0.22 while
 *  `git checkout -b` 0.16 and `git commit` 0.14 stay under. blockThreshold 0.30 is the reachable
 *  number: it fires on `rm -rf ~/` (0.45/0.40), `rm -rf /` (0.33/0.53) and `sudo rm -rf /usr`
 *  (0.31/0.37) and on nothing else, so the model-independent half of the block rule is live. */
export const DEFAULT_CONFIG = {
  deadlineMs: 2500,
  thresholds: { destructive: 0.3, wrong_target: 0.2, likely_typo: 0.3, leaks_secret: 0.15 } as Record<string, number>,
  blockThreshold: 0.3,
  blockVerdictProbability: 0.5,
};

/** Published price used by the original bench, $/million input tokens. */
export const USD_PER_MILLION = 0.042;

/** The CLI's measured run, quoted as the "before" number. */
export const ORIGINAL_BENCH = 'p50 119 ms · p95 209 ms · 1151 input tokens/decision · run 35 · confirm 11 · block 4';
