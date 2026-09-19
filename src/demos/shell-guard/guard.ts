// Pure logic ported 1:1 from the Swift experiment: StateBuilder, Policy, Fallback, plus the
// sandboxed shell that replaces the real machine. No I/O, no React, no fetch — the island and
// smoke.mjs both import this.

import { DEFAULT_CONFIG, HOME, NOUL_IDS, SEED_ABSENT, SEED_PATH, type NoulId } from './data.ts';

export type Tree = Record<string, boolean>;

export interface PathRef {
  arg: string;
  resolved: string;
  exists: boolean;
  isDirectory: boolean;
  isHome: boolean;
  isFilesystemRoot: boolean;
  insideCwd: boolean;
}
export interface CommandState {
  command: string;
  cwd: string;
  cwdIsHome: boolean;
  tool: { name: string; foundInPath: boolean | null };
  usesSudo: boolean;
  git: { inRepo: boolean; branch: string; onDefaultBranch: boolean; workingTreeDirty: boolean };
  referencedPaths: PathRef[];
  containsTokenLikeString: boolean;
  previousCommands: string[];
}
export interface Reason {
  id: string;
  value: number;
}
export interface Decision {
  label: 'run' | 'confirm' | 'block';
  reasons: Reason[];
}
export interface Judgment {
  nouls: Record<string, number>;
  verdict: string;
  verdictProbabilities: Record<string, number>;
  verdictConfidence: number;
}

// MARK: - StateBuilder

const SEPARATORS = new Set(['|', '||', '&&', ';', '&']);
const WRAPPERS = new Set(['sudo', 'env', 'time', 'nohup', 'exec', 'command', 'builtin']);

/** Splits a command line into words with minimal quote handling. */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;
  let hasContent = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      hasContent = true;
    } else if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (hasContent) {
        tokens.push(current);
        current = '';
        hasContent = false;
      }
    } else {
      current += ch;
      hasContent = true;
    }
  }
  if (hasContent) tokens.push(current);
  return tokens;
}

/** The program name of the first simple command, skipping sudo/env-style wrappers and VAR=x. */
export function primaryTool(tokens: string[]): string {
  for (const t of tokens) {
    const isAssignment = t.includes('=') && !t.startsWith('-');
    if (WRAPPERS.has(t) || isAssignment || t.startsWith('-')) continue;
    return t;
  }
  return '';
}

const TOKEN_PATTERNS = [
  /sk-[A-Za-z0-9_-]{8,}/,
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{12,}/,
  /xox[abpr]-[A-Za-z0-9-]{10,}/,
  /bearer\s+[A-Za-z0-9._~+/=-]{16,}/i,
  /(password|passwd|pwd|secret|token|api[_-]?key)\s*[=:]\s*\S{6,}/i,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /:\/\/[^/\s:]+:[^@\s]{4,}@/,
];

export const containsTokenLikeString = (line: string) => TOKEN_PATTERNS.some((re) => re.test(line));

/** leaks_secret's criteria.false — "not read from a $VARIABLE, a file or a prompt" — as a fact.
 *  One pattern the ported Swift list misses, so the fact covers all three seed secrets:
 *  `AWS_SECRET_ACCESS_KEY=...`, a shouted env assignment. The glued `-p` password is the other
 *  miss, below. TOKEN_PATTERNS itself stays byte-for-byte, because Fallback.swift uses it. */
const LITERAL_SECRET_PATTERNS = [
  ...TOKEN_PATTERNS,
  /[A-Z][A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PASSWD|KEY)[A-Z0-9_]*=[^\s$]{8,}/,
];

/** `-p` with the password glued to it. The rule is gated on the tool, not on the shape of the
 *  tail: only these take a password that way. Gating on the shape instead let an all-lowercase
 *  `-ppassword` through, and still matched `rsync -progress2`. A bare `-p` prompt is a reference,
 *  so it never matches. psql is deliberately NOT here: its `-p` is the port, so `psql -p543210 prod`
 *  would have been read as a leaked password. Only mysql and mysqldump take `-p<password>`. */
const GLUED_PASSWORD_TOOLS = new Set(['mysql', 'mysqldump']);
const GLUED_PASSWORD = /(^|\s)-p[^\s$]{6,}/;

/** True when the secret's own characters are typed in the line. A `$NAME`, a `${NAME}`, a
 *  `--password-file=` path and a bare `-p` prompt are references, so they are erased first. */
export const containsLiteralSecret = (line: string) => {
  const bare = line.replace(/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/g, '$');
  if (LITERAL_SECRET_PATTERNS.some((re) => re.test(bare))) return true;
  return GLUED_PASSWORD_TOOLS.has(primaryTool(tokenize(bare))) && GLUED_PASSWORD.test(bare);
};

/** likely_typo's criteria.true — "a transposition or misspelling of a real tool" — as a fact.
 *  This is the demo's one unsolved question, and this comment says so rather than claiming a fix.
 *
 *  The gate is BOTH halves of the test in `foldNoul`: the name is not in our seed PATH list AND it
 *  is one edit from a name we do know. Each half alone is worse. "Not in the list" alone asks the
 *  model to score every correctly spelled tool the list omits — measured that way `tmux` answered
 *  0.48 and `uptime` 0.41, above the bench's own typos at 0.38 and 0.32. "One edit" alone would
 *  fire on docker, kubectl and cargo, which are spelled correctly and merely not installed — the
 *  original's criteria.false.
 *
 *  Both halves together STILL fail on a correctly spelled real program that our list omits and
 *  that sits one edit from a name in it. That is not rare: of the 1979 programs on a real macOS
 *  PATH, 149 open this gate. The model does not close it either. Measured twice, identical both
 *  runs, on the shipped statement: rg 0.64, gh 0.60, cal 0.47, ksh 0.45, vi 0.41 —
 *  against the bench's own typos at 0.77, 0.51, 0.38 and 0.32. Four real tools outrank two real
 *  typos, so no threshold on this column separates them.
 *
 *  Two fixes were tried and measurement refuted both:
 *   1. Lengthen SEED_PATH, the obvious one. Adding 38 real names closes 21 and opens 27 fresh
 *      neighbours — adding ghc opens gcc, adding java opens javac and javap — so the live PATH
 *      count goes 149 -> 155. A list of names cannot fence a space of names one edit wide.
 *   2. Reword the statement so the model tells a real tool from a typo: "The first word of this
 *      command is not the name of any program that exists; it is a misspelling of a different,
 *      real program." Measured twice: rg 0.64, fd and ksh 0.56, against a real typo at
 *      0.20 — strictly worse, because the typo now falls under the threshold and runs silently.
 *
 *  So the gate ships as a keyword fallback, and the UI labels every line it fires (TYPO_LIMIT in
 *  data.ts). It can only ever reach `confirm`, never a block: a block needs destructive and
 *  wrong_target together, or a block verdict, and this noul is neither. The cost of the limit is
 *  one y/N prompt on an unusual-but-real tool name, with the reason printed beside it. */
const KNOWN_PROGRAMS = [...SEED_PATH, ...SEED_ABSENT];

/** True when `a` and `b` differ by exactly one insertion, deletion, substitution or adjacent
 *  transposition — Damerau-Levenshtein distance 1, without building the matrix for it. */
export function withinOneEdit(a: string, b: string): boolean {
  const drop = a.length - b.length;
  if (drop < -1 || drop > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (drop === 1) i++;
    else if (drop === -1) j++;
    else if (a[i + 1] === b[j] && a[i] === b[j + 1]) {
      i += 2;
      j += 2;
    } else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) === 1;
}

export const isNearMiss = (name: string) =>
  name !== '' && !KNOWN_PROGRAMS.includes(name) && KNOWN_PROGRAMS.some((k) => withinOneEdit(name, k));

function looksLikePath(token: string) {
  if (token.startsWith('/') || token.startsWith('~') || token.startsWith('.')) return true;
  return token.includes('/') && !token.includes('://');
}

/** Resolves ~, relative paths and . / .. the way NSString.standardizingPath does. */
export function resolvePath(arg: string, cwd: string, home = HOME): string {
  let p = arg;
  if (p === '~') p = home;
  else if (p.startsWith('~/')) p = home + p.slice(1);
  if (!p.startsWith('/')) p = cwd + '/' + p;
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

export const probe = (tree: Tree, path: string) =>
  path in tree ? { exists: true, isDirectory: tree[path]! } : { exists: false, isDirectory: false };

/** Extracts path-like arguments and probes them. Globs are probed on their literal parent. */
export function referencedPaths(tokens: string[], cwd: string, tree: Tree, home = HOME): PathRef[] {
  const refs: PathRef[] = [];
  let expectTool = true;
  for (const raw of tokens) {
    if (SEPARATORS.has(raw)) {
      expectTool = true;
      continue;
    }
    let token = raw;
    if (token.startsWith('-')) {
      const eq = token.indexOf('=');
      if (eq >= 0 && token.startsWith('--')) token = token.slice(eq + 1);
      else continue;
    }
    if (expectTool) {
      expectTool = WRAPPERS.has(token);
      if (!looksLikePath(token)) continue;
    }
    const glob = token.search(/[*?]/);
    let literal = token;
    if (glob >= 0) {
      literal = token.slice(0, glob);
      const slash = literal.lastIndexOf('/');
      literal = slash >= 0 ? literal.slice(0, slash + 1) : '.';
    }
    if (refs.some((r) => r.arg === token)) continue;
    if (!looksLikePath(token) && !probe(tree, resolvePath(token, cwd, home)).exists) continue;
    const resolved = resolvePath(literal, cwd, home);
    const { exists, isDirectory } = probe(tree, resolved);
    refs.push({
      arg: token,
      resolved,
      exists,
      isDirectory,
      isHome: resolved === home,
      isFilesystemRoot: resolved === '/',
      insideCwd: resolved === cwd || resolved.startsWith(cwd + '/'),
    });
    if (refs.length >= 8) break;
  }
  return refs;
}

export interface Machine {
  cwd: string;
  tree: Tree;
  git: CommandState['git'];
  history: string[];
}

export function buildState(command: string, m: Machine): CommandState {
  const tokens = tokenize(command);
  const name = primaryTool(tokens);
  return {
    command,
    cwd: m.cwd,
    cwdIsHome: m.cwd === HOME,
    tool: { name, foundInPath: name === '' || name.includes('/') ? null : SEED_PATH.includes(name) },
    usesSudo: tokens.includes('sudo'),
    git: m.git,
    referencedPaths: referencedPaths(tokens, m.cwd, m.tree),
    containsTokenLikeString: containsTokenLikeString(command),
    previousCommands: m.history.slice(-3),
  };
}

/** The command line, then one bracketed line of the facts code computed: this is the `text`
 *  sent to /yes-no and /classify. Measured against the dump-style rendering the brief suggested,
 *  this wording separates the seed commands far better — a full JSON-ish dump flattens every
 *  probability toward its prior. The typo question gets the bare command instead (see PLAIN_TEXT).
 *
 *  Eight of the nine state fields ride in this line. `previous_commands` is the one that does not,
 *  and it is left out on a measurement, not an oversight. Appending `after ls; git status --short;
 *  npm test` to every text pulls the whole table down, because a mundane session reads the next
 *  command as mundane too. On the 50 bench commands, with the bit against without it:
 *    sudo rm -rf /usr ... destructive .32 -> .25 flagged->unflagged, wrong_target .37 -> .25 : BLOCK -> confirm
 *    rm -rf / ......... wrong_target .53 -> .37        rm -rf ~/ ... wrong_target .40 -> .31
 *    git reset --hard . destructive  .57 -> .45        git stash ... destructive  .58 -> .47
 *    mysql -pHunter2Secret ... wrong_target .21 -> under threshold
 *  The split moves from 34/13/3 to 34/14/2, away from the CLI's 35/11/4, and it costs the third
 *  catastrophe its block. So the history stays in the state object, where the explain panel shows
 *  it, and out of the text. `contains_token_like_string` is free by the same measurement — the
 *  table is identical with it, row for row — so it goes in. */
export function stateText(s: CommandState): string {
  const bits = [`in ${s.cwd}${s.cwdIsHome ? ', the home directory' : ''}`];
  if (s.tool.name) bits.push(`${s.tool.name} ${s.tool.foundInPath ? 'is on the PATH' : 'is not on the PATH'}`);
  if (s.usesSudo) bits.push('runs as root through sudo');
  if (s.git.inRepo)
    bits.push(
      `git branch ${s.git.branch}${s.git.onDefaultBranch ? ' (the default branch)' : ''}, working tree ${s.git.workingTreeDirty ? 'dirty' : 'clean'}`,
    );
  for (const p of s.referencedPaths)
    bits.push(
      `${p.arg} is ${p.isHome ? 'the home directory' : p.isFilesystemRoot ? 'the filesystem root' : p.insideCwd ? 'inside the project' : 'outside the project'}${p.exists ? '' : ' and does not exist'}`,
    );
  if (s.containsTokenLikeString) bits.push('the line holds something token-shaped');
  return `${s.command}\n[${bits.join('; ')}]`;
}

/** One noul value out of the answers to its statements: the highest, because the original's
 *  criteria.true is an OR of clauses and each statement carries one clause.
 *
 *  likely_typo also gets its criteria applied here, because they cannot live in the statement: put
 *  the PATH fact in the text and the model reads every typo as a missing install and the whole
 *  question flattens; leave it out and `ls` scores 0.58 on its own two letters. So code asks the
 *  question only about a name that is both absent from our list and one edit from a name in it. A
 *  name on the list, a name spelled exactly like a known program, and a name nothing resembles all
 *  fold to 0. This gate is a keyword heuristic with a measured ceiling, not a solved question —
 *  a correctly spelled real program we do not list can open it, and the model cannot tell it from
 *  a typo. See KNOWN_PROGRAMS above for the numbers and the two refuted fixes.
 *
 *  leaks_secret gets the same treatment, for the same measured reason (see data.ts): no statement
 *  wording separates `$OPENAI_API_KEY` from a key that is actually typed out, because the variable
 *  *name* reads as a secret. So the question keeps asking "is this a secret?" and the fact answers
 *  "are its characters here?". The model still decides whether the literal span is a credential;
 *  it just never fires on a line that holds no literal at all. */
export function foldNoul(id: NoulId, values: number[], state: CommandState): number {
  if (id === 'likely_typo' && (state.tool.foundInPath !== false || !isNearMiss(state.tool.name))) return 0;
  if (id === 'leaks_secret' && !containsLiteralSecret(state.command)) return 0;
  return values.length ? Math.max(...values) : 0;
}

/** byStatement is parallel to the `[id, statement]` pair list the calls were built from. */
export function foldNouls(pairs: ReadonlyArray<readonly [NoulId, string]>, values: number[], state: CommandState) {
  const byId = new Map<NoulId, number[]>();
  pairs.forEach(([id], i) => byId.set(id, [...(byId.get(id) ?? []), values[i] ?? 0]));
  const out: Record<string, number> = {};
  for (const [id, vs] of byId) out[id] = foldNoul(id, vs, state);
  return out;
}

// MARK: - Policy (deterministic, byte-for-byte with Policy.decide)

export type Config = typeof DEFAULT_CONFIG;

export function decide(j: Judgment, config: Config = DEFAULT_CONFIG): Decision {
  const flagged: Reason[] = NOUL_IDS.map((id) => ({ id, value: j.nouls[id] ?? 0 }))
    .filter((r) => r.value >= (config.thresholds[r.id] ?? 1))
    .sort((a, b) => b.value - a.value);

  const blockProbability = j.verdictProbabilities.block ?? 0;
  const verdictSaysBlock = j.verdict === 'block' && blockProbability >= config.blockVerdictProbability;

  if (flagged.length === 0) {
    if (verdictSaysBlock) return { label: 'confirm', reasons: [{ id: 'verdict:block', value: blockProbability }] };
    return { label: 'run', reasons: [] };
  }
  const catastrophic =
    (j.nouls.destructive ?? 0) >= config.blockThreshold && (j.nouls.wrong_target ?? 0) >= config.blockThreshold;
  return { label: verdictSaysBlock || catastrophic ? 'block' : 'confirm', reasons: flagged };
}

// MARK: - Fallback (regex only, used when the model misses the deadline or errors)

const DENY: Array<[RegExp, string]> = [
  [/(^|\s)rm\s+(-[a-zA-Z]*\s+)*(\/|~|~\/|\$HOME\/?|\/\*)(\s|$)/, 'rm on / or ~'],
  [/(^|\s)(mkfs|fdisk|diskutil\s+erase)/, 'disk format'],
  [/(^|\s)dd\s+.*of=\/dev\//, 'raw disk write'],
  [/>\s*\/dev\/(disk|sd|nvme)/, 'raw disk write'],
  [/:\(\)\s*\{\s*:\|:&\s*\};:/, 'fork bomb'],
  [/(^|\s)chmod\s+(-R\s+)?[0-7]{3,4}\s+\/(\s|$)/, 'chmod on /'],
  [/(^|\s)chown\s+-R\s+\S+\s+\/(\s|$)/, 'chown on /'],
];

const CONFIRM: Array<[RegExp, string]> = [
  [/(^|\s)rm\s+-[a-zA-Z]*[rR][a-zA-Z]*f|rm\s+-[a-zA-Z]*f[a-zA-Z]*[rR]/, 'recursive force rm'],
  [/(^|\s)git\s+push\s+.*(--force|-f)(\s|$)/, 'force push'],
  [/(^|\s)git\s+reset\s+--hard/, 'git reset --hard'],
  [/(^|\s)git\s+clean\s+-[a-zA-Z]*[fdx]/, 'git clean'],
  [/(^|\s)git\s+branch\s+-D/, 'branch delete'],
  [/(^|\s)git\s+checkout\s+--\s+\./, 'discard changes'],
  [/drop\s+(table|database|schema)/i, 'SQL drop'],
  [/truncate\s+table/i, 'SQL truncate'],
  [/(^|\s)sudo\s+rm/, 'sudo rm'],
  [/(^|\s)kubectl\s+delete/, 'kubectl delete'],
  [/(^|\s)terraform\s+destroy/, 'terraform destroy'],
  [/(^|\s)(shutdown|reboot|halt)(\s|$)/, 'power'],
  [/(^|\s)kill(all)?\s+-9/, 'SIGKILL'],
];

export function fallbackDecide(command: string, toolFound: boolean | null = null): Decision {
  const hit = (list: Array<[RegExp, string]>) => list.find(([re]) => re.test(command))?.[1];
  const deny = hit(DENY);
  if (deny) return { label: 'block', reasons: [{ id: 'regex:' + deny, value: 1 }] };
  const confirm = hit(CONFIRM);
  if (confirm) return { label: 'confirm', reasons: [{ id: 'regex:' + confirm, value: 1 }] };
  if (toolFound === false) return { label: 'confirm', reasons: [{ id: 'regex:command not found', value: 1 }] };
  if (containsTokenLikeString(command)) return { label: 'confirm', reasons: [{ id: 'regex:inline secret', value: 1 }] };
  return { label: 'run', reasons: [] };
}

/** `destructive 0.82 · wrong_target 0.71`, the Banner.reasons string. */
export const reasonText = (reasons: Reason[]) =>
  reasons.map((r) => `${r.id} ${r.value.toFixed(2)}`).join(' · ');

// MARK: - The sandboxed shell

const parent = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/';

/** Runs an accepted command against the in-memory tree. Ten builtins; anything else is a stub. */
export function execute(command: string, m: Machine): { out: string[]; cwd: string; tree: Tree } {
  const tokens = tokenize(command);
  const tree = { ...m.tree };
  let cwd = m.cwd;
  const out: string[] = [];
  const tool = primaryTool(tokens);
  const args = tokens.slice(tokens.indexOf(tool) + 1).filter((a) => !a.startsWith('-'));
  const abs = (a: string) => resolvePath(a, cwd);
  const children = (dir: string) =>
    Object.keys(tree)
      .filter((p) => parent(p) === dir && p !== dir)
      .map((p) => p.slice(dir === '/' ? 1 : dir.length + 1) + (tree[p] ? '/' : ''))
      .sort();
  const remove = (dir: string) => {
    for (const p of Object.keys(tree)) if (p === dir || p.startsWith(dir + '/')) delete tree[p];
  };

  switch (tool) {
    case 'ls': {
      const dir = args.length ? abs(args[0]!) : cwd;
      if (!probe(tree, dir).exists) out.push(`ls: ${args[0] ?? dir}: No such file or directory`);
      else out.push(children(dir).join('  ') || '');
      break;
    }
    case 'cd': {
      const dir = args.length ? abs(args[0]!) : HOME;
      if (!probe(tree, dir).isDirectory) out.push(`cd: no such file or directory: ${args[0] ?? dir}`);
      else cwd = dir;
      break;
    }
    case 'pwd':
      out.push(cwd);
      break;
    case 'cat': {
      const f = args.length ? abs(args[0]!) : '';
      if (!probe(tree, f).exists) out.push(`cat: ${args[0]}: No such file or directory`);
      else out.push(`(${args[0]}: ${Math.round(Math.abs(hash(f)) % 900) + 100} bytes, contents elided)`);
      break;
    }
    case 'echo':
      out.push(tokens.slice(1).join(' '));
      break;
    case 'mkdir':
      for (const a of args) tree[abs(a)] = true;
      break;
    case 'touch':
      for (const a of args) if (!(abs(a) in tree)) tree[abs(a)] = false;
      break;
    case 'rm':
      for (const a of args) {
        const p = abs(a);
        if (!probe(tree, p).exists) out.push(`rm: ${a}: No such file or directory`);
        else remove(p);
      }
      break;
    case 'mv':
    case 'cp': {
      const [from, to] = [abs(args[0] ?? ''), abs(args[1] ?? '')];
      if (!probe(tree, from).exists) out.push(`${tool}: ${args[0]}: No such file or directory`);
      else {
        const dest = probe(tree, to).isDirectory ? to + '/' + from.slice(from.lastIndexOf('/') + 1) : to;
        tree[dest] = tree[from]!;
        if (tool === 'mv') remove(from);
      }
      break;
    }
    case 'git':
      if (tokens[1] === 'status') {
        out.push(`On branch ${m.git.branch}`);
        out.push(m.git.workingTreeDirty ? 'Changes not staged for commit:\n\tmodified:   src/app.ts' : 'nothing to commit, working tree clean');
      } else out.push(`git ${tokens.slice(1).join(' ')}: simulated, the sandbox repo is unchanged`);
      break;
    default:
      out.push(`${tool || command}: simulated, nothing ran`);
  }
  return { out: out.filter((l) => l !== ''), cwd, tree };
}

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
};
