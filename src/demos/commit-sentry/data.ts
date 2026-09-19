/**
 * Seed data, prompts and pure logic for the Commit Sentry demo.
 *
 * The staged diff of the fictional "ledgerline" repo (11 files, 15 hunks, 26 added lines)
 * was produced once by the original experiment's fixture builder
 * (jev-experiments/commit-sentry/src/fixture.ts -> git diff --cached -U3 -> src/diff.ts)
 * and frozen at the bottom of this file, because a browser has no git.
 *
 * The prompts and the policy thresholds live here too, so smoke.mjs sends exactly the
 * bodies the island sends. Nothing in this file touches the network.
 */

export interface DiffLine {
  /** "+" added, "-" removed, " " context. */
  k: "+" | "-" | " ";
  t: string;
  /** 1-based line number in the new file. */
  n: number | null;
}
export interface Hunk {
  id: string;
  file: string;
  language: string;
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  isNewFile: boolean;
  isDeletedFile: boolean;
  lines: DiffLine[];
}

export const COMMIT_MESSAGE = "chore: tidy up logging and small fixes";

// ---------------------------------------------------------------- the prompts
// Every wording below was picked by running candidates against the 15 seed hunks
// with src/demos/commit-sentry/smoke.mjs and keeping the pair that separated best.

export const FINDING_IDS = [
  "leaks_secret_or_token",
  "logs_sensitive_data",
  "disables_or_skips_tests",
  "destructive_data_change",
  "changes_public_api_shape",
  "leftover_debug_or_temp",
  "hardcoded_env_specific_value",
  "bypasses_auth_check",
] as const;
export type FindingId = (typeof FINDING_IDS)[number];

export const FINDING_LABELS: Record<FindingId, string> = {
  leaks_secret_or_token: "leaks a secret or token",
  logs_sensitive_data: "logs sensitive data",
  disables_or_skips_tests: "disables or skips tests",
  destructive_data_change: "destructive data change",
  changes_public_api_shape: "changes public API shape",
  leftover_debug_or_temp: "leftover debug / temporary code",
  hardcoded_env_specific_value: "hard-coded environment value",
  bypasses_auth_check: "grants access without a credential",
};

/**
 * One short declarative per finding, in FINDING_IDS order. Sent as `statements` to /yes-no.
 *
 * Every number quoted here was measured the way the policy consumes it: the full eight-statement
 * batch, hunk pass and line pass, `max` of the two — not a statement on its own, which reads
 * differently.
 *
 * These are raw batched probabilities, so a number is only meaningful next to the batch it came
 * from: quote the composition, never the score alone. Two compositions were run for the table
 * below — batch A, the 15 seed hunks plus 17 SQL controls (31 texts, 43 lines); batch B, the 17
 * controls alone (16 texts, 17 lines). They agreed to 0.01 on every control. That is two
 * compositions agreeing, not a guarantee; a different batch can move a score, and an earlier
 * review saw the seed DROP COLUMN hunk swing 0.21 in a composition not reproduced here.
 *
 * Statement [0], secrets. The exclusion clause is the whole point of asking a model instead of a
 * regex: without it `process.env.STRIPE_KEY ?? "<your-key-here>"` read 0.63 and the
 * `apiUrl: "http://10.0.3.12:8080"` line read 0.68, both false positives over `report`. With it
 * the placeholder control reads 0.27 and the real sk_live line still reads 0.62.
 *
 * Statement [3], destructive. The old wording ("a delete statement is written without a WHERE
 * clause") did not survive: at hunk level it read the DELETE and not the clause. The wording
 * below asks about the effect instead of the syntax, and it is better — but it does not separate
 * cleanly either, and two earlier rounds of this file claimed a separation that measurement does
 * not support. So the tier was measured across CONSTRUCTIONS rather than across three examples:
 * bare SQL, IF EXISTS, a drop inside a multi-statement migration, a drop or truncate inside a
 * `db.query` string, an ORM whole-table delete, and the filtered forms that must stay low.
 * Batch A, then batch B (see above); the two agreed to 0.01, so one column is printed:
 *
 *   should score HIGH — the change destroys stored data
 *     DROP COLUMN, seed migration                              0.88
 *     DELETE FROM users;                    bare SQL           0.61
 *     DROP TABLE IF EXISTS legacy_sessions; bare SQL           0.59
 *     TRUNCATE TABLE sessions;              bare SQL           0.54
 *     DROP TABLE orders;                    bare SQL           0.54
 *     await db.query("DROP TABLE orders")   in TypeScript      0.47
 *     DELETE FROM audit_log, seed cleanup hunk                 0.38
 *     DROP TABLE events_2019; inside a 4-line migration hunk   0.36
 *     await db.query("TRUNCATE TABLE events")                  0.27
 *     await db.query("DELETE FROM sessions") unfiltered        0.24
 *     await prisma.session.deleteMany({})   every row          0.14
 *
 *   should score LOW — the change is scoped, additive or structural
 *     DELETE FROM sessions WHERE created_at < ... (90 days)    0.51
 *     DELETE FROM sessions WHERE user_id = $1;  bare SQL       0.29
 *     DROP INDEX idx_sessions_user;                            0.15
 *     ALTER TABLE orders DROP CONSTRAINT orders_user_fk;       0.12
 *     UPDATE users SET tier = 'free' WHERE tier IS NULL;       0.07
 *     CREATE TABLE events (...);                               0.03
 *     ALTER TABLE users ADD COLUMN tier text ...;              0.02
 *
 * The two lists interleave, and not by a little: a correctly filtered ninety-day purge reads 0.51
 * while a genuine `DROP TABLE` wrapped in `db.query` reads 0.47 and a whole-table `deleteMany({})`
 * reads 0.14. Every threshold between 0.14 and 0.51 therefore either blocks a correct delete or
 * waves a drop through. There is no gap, so RULES gives this rule no `block` at all.
 *
 * What the rule does track is the surface form: destructive SQL written AS SQL scores high, the
 * same SQL hidden inside an application string or an ORM call scores low. `report` at 0.35 is set
 * on that, and the tier means "this hunk touches stored data, look at it" — nothing more.
 *
 * Statement [7], auth bypass. New. The seven above never fired on the fixture's worst hunk,
 * `if (token === "letmein") return { userId: "admin" }`, so it blocked on its risk band alone
 * with no evidence behind it. Three wordings were tried. "The change removes or bypasses an
 * authentication or authorization check" read 0.16 on that hunk (it adds a short circuit, it
 * removes nothing); "An added branch grants access when a value equals a hard-coded string" read
 * 0.99 there but only 0.32 on the `x-skip-auth` header control. The wording below covers both:
 * the backdoor 0.78, the header control 0.59, and no other hunk in the run above 0.07.
 *
 * Not sent: `when_true` / `when_false`. One pair has to serve all eight statements, so it can
 * only repeat what the statements already say. The brief's own pair was measured over the same
 * 23 hunks ("The added lines contain the described risky pattern as a literal value or
 * operation." / "The change is benign, reads values from config, adds tests, or is additive
 * only."), and it destroys the signal: every statement saturates on every text. The README hunk
 * goes from 0.14 to 0.99 on secrets and 0.07 to 0.98 on sensitive logging, the benign rename
 * control from 0.02 to 0.95 on secrets, and 170 of the 184 scores in the run land above 0.5. The
 * hints tell the model what a yes looks like in general, and a general yes fits everything. The
 * per-hunk, per-line and message calls all go without them, and the page notes say so.
 */
export const STATEMENTS: string[] = [
  "A new line assigns a real API key, token or password as a literal string. A placeholder or an environment variable read does not count.",
  "The change prints sensitive user data to the log or console.",
  "The change marks a test as skipped so it no longer runs.",
  "The change deletes every row of a table, or drops a database column or table.",
  "The change renames or removes a field in a public API response shape.",
  "The change adds temporary debugging code or a shortcut meant to be removed before merge.",
  "The change hard-codes an environment-specific host, IP address, file path or port.",
  "An added branch grants access without a real credential.",
];

export const RISK_LEVELS = ["cosmetic", "low", "moderate", "high", "dangerous"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * Sent as `scale` to /rate, low to high. `score` comes back on this 0..4 axis.
 * Both ends are anchored on what a hunk visibly contains rather than on how it feels,
 * because the first wording compressed every seed hunk into 1.29..3.00 and nothing could
 * reach the block threshold. Level 4 names bypassing a check as well as removing one, because
 * without "or bypasses" the `if (token === "letmein") return { userId: "admin" }` backdoor in
 * src/auth/session.ts scored 2.997 against a 3.0 block threshold — the most dangerous hunk in
 * the fixture produced a warning and nothing else.
 *
 * Measured with smoke.mjs on the seed diff: src/utils/format.ts (a one-character fix) 0.66,
 * README 1.71, the session.ts backdoor 3.13, the DROP COLUMN migration 3.35, the sk_live hunk
 * 3.44.
 *
 * The scale reads literal content, so documentation that warns against a practice rates as
 * though it committed it: a docs/security.md hunk telling readers never to commit an sk_live key
 * and never to run DROP TABLE rated 3.93. Writing the exclusion into level 0 did not help
 * (3.94 with it). /classify does get that hunk right, so DOCS_RISK_CAP below uses the label
 * instead. A sharper level 4 that named the backdoor pattern was also tried and rejected: it
 * pulled the whole spread down by 0.3 to 0.6 (the DROP COLUMN migration 3.35 -> 2.90) without
 * separating the backdoor, which statement [7] now catches on evidence anyway.
 */
export const RISK_SCALE: string[] = [
  "cosmetic: the added lines are only documentation, comments, blank lines or formatting, so no code runs differently",
  "low: one self-contained code change such as a version bump, a rename, or an off-by-one fix",
  "moderate: it changes behaviour that other code depends on, or adds new branching logic",
  "high: it changes authentication, payments, a database migration, or a public API contract",
  "dangerous: an added line contains a live credential, deletes or drops stored data, or removes or bypasses a security or authentication check",
];

export const KIND_LABELS: Record<string, string> = {
  feature: "adds a new user-visible capability or new behaviour",
  bugfix: "corrects existing behaviour that was wrong",
  refactor: "restructures code without changing what it does",
  test: "adds, changes or removes test code",
  docs: "README text, code comments or documentation prose, whatever subject the prose is about",
  config: "configuration, environment, dependency versions, build or CI settings",
  chore: "housekeeping such as formatting, logging tweaks or version bumps",
};

export const MESSAGE_QUALITY_LEVELS = ["placeholder", "vague", "adequate", "excellent"] as const;

/** Sent as `scale` to /rate over the commit message alone. `score` is on a 0..3 axis. */
export const MESSAGE_SCALE: string[] = [
  "a placeholder with no information at all, such as wip, fix, asdf or stuff",
  "a topic with no detail, such as tidy up logging, small fixes or update config",
  "a concrete statement of what changed, such as rename the total field to totalCents",
  "what changed and why, naming the scope, the risk and any migration needed",
];

/**
 * The commit-message check is a coverage check, not a claim check: for every hunk that
 * crossed a finding threshold we ask whether the message mentions that change. Free text
 * typed by a visitor is never sent as a `statement` — these are the statements, and the
 * message is the text.
 *
 * Measured with `smoke.mjs --messages`, an eight-message panel against the nine claims the seed
 * diff produces, twice, identical to 0.01. At the old COVERAGE_MIN of 0.5 the check accused
 * honest developers: three terse messages that each name all nine real changes read 0.222,
 * 0.222 and 0.333, all UNDER MESSAGE_MISMATCH 0.35. A terse honest message is not a claim the
 * model scores at 0.5 — "log creds" against "the message says credentials are written to the
 * log" reads 0.43, not 0.85. Dropping COVERAGE_MIN to 0.30 separates the panel and nothing
 * above it does: controls seed 0.000, empty 0.000, "wip" 0.111; honest terse 0.444, 0.778,
 * 0.778, loose prose 0.778, the claims' own register 1.000. MESSAGE_MISMATCH 0.35 sits in the
 * 0.111-to-0.444 gap. The floor is still only one claim clear of the line, so the finding is a
 * warning and never a block — see evaluate(). Sending shared when_true/when_false hints here
 * costs separation, so this call goes without them, like the per-hunk call.
 *
 * This half measures omission only. The other half — does the message claim something the
 * diff does not do — was built as a seventh request and removed; the comment block below
 * records what was measured and why it is not here.
 */
export const MESSAGE_CLAIMS: Record<FindingId, string> = {
  leaks_secret_or_token: "The message says an API key or secret is added to the code.",
  logs_sensitive_data: "The message says credentials or user data are written to the log.",
  disables_or_skips_tests: "The message says a test is skipped.",
  destructive_data_change: "The message says rows are deleted from a table.",
  changes_public_api_shape: "The message says a field in an API response is renamed or removed.",
  leftover_debug_or_temp: "The message says temporary debugging code is left in.",
  hardcoded_env_specific_value: "The message says a host, IP address or port is hard-coded.",
  bypasses_auth_check: "The message says an authentication check can be bypassed.",
};

/**
 * The other half of the original's message question — does the message claim a change the diff
 * does not make — was built as a seventh request and then removed, because it does not work on
 * this data. The `text` was the commit message plus a summary of the staged changes that code
 * built from the judgments; five statement wordings, two text layouts (message first, list
 * first), a three-level /rate scale and a bare file list were measured against five messages:
 * the seed message, an honest one naming every real change, that same message plus "and rewrite
 * the billing engine in Rust", one that invents everything, and an empty one. Every
 * configuration came back flat — the best /yes-no wording read 0.42 on the honest message and
 * 0.41 on the over-claiming one, the empty message 0.42, and the /rate scale put all five inside
 * 0.08 of each other. The route can say whether a message mentions a change we name; it cannot
 * do the set difference the other way, over a list, with no statement to anchor it. So the
 * message check stays a coverage check, an over-claiming message is caught only when it also
 * omits, and the page says so in "What this does not check" rather than shipping a seventh
 * request that answers nothing.
 */

/** Dropping a column and deleting rows are both "destructive", but a message names one or the other. */
export function messageClaim(h: Hunk, id: FindingId): string {
  if (id === "destructive_data_change" && /\bDROP\s+(COLUMN|TABLE)\b/i.test(hunkBody(h)))
    return "The message says a database column is dropped.";
  return MESSAGE_CLAIMS[id];
}

/**
 * A claim counts as covered at or above this probability. 0.30, not the 0.5 two earlier drafts
 * used: at 0.5 every terse honest message measured landed under MESSAGE_MISMATCH and was accused
 * of not describing the commit. See the panel in the comment above.
 */
export const COVERAGE_MIN = 0.3;

// ------------------------------------------------------------- request bodies

export const changeType = (h: Hunk) => (h.isNewFile ? "new file" : h.isDeletedFile ? "deleted file" : "modification");
export const addedLines = (h: Hunk) => h.lines.filter((l) => l.k === "+");
export const hunkBody = (h: Hunk) => h.lines.map((l) => l.k + l.t).join("\n");

/**
 * A hunk on the wire: a one-line header, the @@ range, then the unified diff body.
 *
 * No +/- legend. The original's instruction carried one ("lines starting with + are added,
 * - removed") and adding it back was measured on the 15 seed hunks plus eight controls: it
 * makes the model answer about the act of changing rather than about the change. "adds
 * temporary debugging code" went from 0.30 to 0.82 on src/logger.ts, 0.11 to 0.42 on the
 * one-character format fix and 0.13 to 0.47 on a benign rename control; "renames or removes a
 * field in a public API response shape" went from 0.03 to 0.49 on that same rename and from
 * 0.11 to 0.70 on an un-skipped test.
 *
 * It does not buy much either. The un-skipped-test control, the false positive the legend was
 * meant to fix, reads 0.48 without it — re-measured in batches A and B, agreeing to 0.01. An
 * earlier version of this comment quoted 0.33 and called it comfortably under the report line;
 * that number does not reproduce. 0.48 is over the old 0.45 threshold, which is why
 * `disables_or_skips_tests.report` is now 0.55 and the margin is named there: 0.07, narrow, the
 * same way RISK_BLOCK names its 0.04. The legend costs four measured regressions to fix one
 * false positive that a threshold fixes for free, so it stays out.
 */
export function hunkText(h: Hunk): string {
  return `${h.file} (${h.language}, ${changeType(h)})\n@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@\n${hunkBody(h)}`;
}

/** One added line on the wire, for the per-line pass that names the offending line. */
export const lineText = (h: Hunk, l: DiffLine) => `${h.file}\n+${l.t}`;

/** A comment-only added line, for the per-line pass. The SQL comment above a DROP COLUMN
 *  outscores the DROP COLUMN itself, so comments never become the quoted offending line. */
export const isCommentLine = (t: string) => /^\s*(--|\/\/|#|\*|\/\*)/.test(t);

// -------------------------------------------------------------------- policy
// Ported from jev-experiments/commit-sentry/src/policy.ts. Thresholds over the
// probabilities decide block vs warn; the model supplies the semantics.
// `report` is 0.45 rather than the original 0.5: these probabilities are raw
// per-statement scores, not the calibrated ones Jev returned.

interface Rule {
  report: number;
  block: number | null;
}
export const RULES: Record<FindingId, Rule> = {
  // Every threshold below sits on the max(hunk, lines) score, the one evaluateHunk reads.
  // Secret: 0.62 on the sk_live line, 0.29 on the next-highest line anywhere, 0.27 on the
  // `process.env.X ?? "<your-key-here>"` control — the exclusion clause in the statement is
  // what makes 0.55 a safe block.
  leaks_secret_or_token: { report: 0.45, block: 0.55 },
  // Destructive has no `block`, and that is a measured result, not a shortcut. Eighteen drop,
  // truncate and delete constructions were scored (the table in STATEMENTS above): a correctly
  // filtered ninety-day purge reads 0.51, a real `DROP TABLE` inside `db.query` reads 0.47, and
  // `prisma.session.deleteMany({})` — every row of a table — reads 0.14. The destructive forms
  // and the scoped forms interleave, so no threshold separates them, and two previous rounds of
  // this file published a gap that is not there. `report` at 0.35 still earns its place: the
  // seed's DROP COLUMN migration reads 0.88 and its `DELETE FROM audit_log` 0.38, so both get a
  // warning with the offending line quoted. Nothing here judges the WHERE clause, and nothing
  // here stops a commit on this rule alone — the risk branch and the other seven rules do that.
  destructive_data_change: { report: 0.35, block: null },
  logs_sensitive_data: { report: 0.45, block: 0.8 },
  // `report` is 0.55 here, not the usual 0.45. The two known false positives sit just under it —
  // a hunk RE-ENABLING a test (`-it.skip(...)` / `+it(...)`) reads 0.48, and the `x-skip-auth`
  // header bypass reads 0.31 because of the word "skip" in the header name — while the seed's
  // real `it.skip` hunk reads 0.94. That is 0.07 of headroom over the worst false positive and
  // 0.39 under the true positive, the widest margin available on this rule.
  disables_or_skips_tests: { report: 0.55, block: null },
  changes_public_api_shape: { report: 0.45, block: null },
  leftover_debug_or_temp: { report: 0.45, block: null },
  hardcoded_env_specific_value: { report: 0.45, block: null },
  // The widest rule in the file: 0.78 on the `letmein` backdoor, 0.59 on an `x-skip-auth`
  // header control, 0.07 on the highest of everything else.
  bypasses_auth_check: { report: 0.45, block: 0.55 },
};
// A hunk blocks on its risk alone only at the dangerous end of the scale. RISK_BLOCK used to be
// 3.0, which is the bottom of level 3 — "changes authentication, payments, a database migration,
// or a public API contract", ordinary high-touch code. Every such hunk blocked with no finding
// behind it: a benign config hunk adding `stripeKey: process.env.STRIPE_KEY ?? "<your-key-here>"`
// rates 3.2 to 3.5 depending on how it is framed — 3.24 written as a replacement inside the seed
// config hunk, 3.46 as a standalone added line — so under the old bar it blocked every time, with
// no finding behind it. 3.5 is halfway to `dangerous`. It clears the highest seed hunk (3.44) and
// that control's worst framing (3.46), so nothing benign has blocked on risk alone in any run,
// but by 0.04 in the tightest case — this bar is the demo's narrowest margin, not a wide one.
// Strict mode keeps the old bar, which is what the strict contrast is for.
export const RISK_BLOCK = 3.5;
export const RISK_WARN = 2.2;
export const STRICT_RISK_BLOCK = 3.0;
/**
 * The risk scale reads what a hunk literally contains, so prose that warns against a practice
 * rates as though it committed it (docs/security.md quoting an sk_live key and DROP TABLE:
 * 3.93). /classify labels that hunk `docs` at high confidence, so a confident `docs` label caps
 * the risk at the top of `low`: documentation changes no behaviour, whatever it quotes.
 */
export const DOCS_RISK_CAP = 1.5;
export const DOCS_RISK_CONFIDENCE = 0.5;
export const STRICT_BLOCK = 0.6;
export const MESSAGE_MISMATCH = 0.35;

export interface Judgment {
  hunkId: string;
  /** 0 (cosmetic) .. 4 (dangerous). */
  risk: number;
  riskLevel: RiskLevel;
  riskConfidence: number;
  kind: string;
  kindConfidence: number;
  /** Highest probability seen for each statement, over the hunk and its added lines. */
  findings: Record<FindingId, number>;
  /** Index into addedLines(hunk), or null when no single line stood out. */
  offendingLineIndex: number | null;
}
export interface MessageJudgment {
  /** Share of the claims below that the message covers, 0..1. */
  matchesChanges: number;
  /** One per significant change found in the diff, with how far the message mentions it. */
  claims: Array<{ statement: string; probability: number }>;
  quality: number;
  qualityLevel: string;
  qualityConfidence: number;
}
export interface Finding {
  hunkId: string;
  file: string;
  id: FindingId | "risk" | "message_mismatch";
  label: string;
  probability: number;
  severity: "block" | "warn";
  quoted: string[];
  line: number | null;
}

function quoteOffending(h: Hunk, j: Judgment): { quoted: string[]; line: number | null } {
  const adds = addedLines(h);
  if (adds.length === 0) {
    const dels = h.lines.filter((l) => l.k === "-").slice(0, 3);
    return { quoted: dels.map((l) => "-" + l.t), line: null };
  }
  const pick = j.offendingLineIndex !== null ? adds[j.offendingLineIndex] : undefined;
  if (pick) return { quoted: ["+" + pick.t], line: pick.n };
  const first = adds.slice(0, 3);
  return { quoted: first.map((l) => "+" + l.t), line: first[0]?.n ?? null };
}

export function evaluateHunk(h: Hunk, j: Judgment, strict: boolean): Finding[] {
  const out: Finding[] = [];
  const { quoted, line } = quoteOffending(h, j);
  for (const id of FINDING_IDS) {
    const rule = RULES[id];
    const p = j.findings[id] ?? 0;
    if (p < rule.report) continue;
    let severity: "block" | "warn" = "warn";
    if (rule.block !== null && p >= rule.block) severity = "block";
    if (strict && p >= STRICT_BLOCK) severity = "block";
    out.push({ hunkId: h.id, file: h.file, id, label: FINDING_LABELS[id], probability: p, severity, quoted, line });
  }
  const riskBlock = strict ? STRICT_RISK_BLOCK : RISK_BLOCK;
  if (j.risk >= riskBlock || (j.risk >= RISK_WARN && out.length === 0)) {
    out.push({
      hunkId: h.id,
      file: h.file,
      id: "risk",
      label: `${j.riskLevel} risk change`,
      probability: j.riskConfidence,
      severity: j.risk >= riskBlock ? "block" : "warn",
      quoted,
      line,
    });
  }
  return out.sort((a, b) => rank(b.severity) - rank(a.severity) || b.probability - a.probability);
}

const rank = (s: "block" | "warn") => (s === "block" ? 1 : 0);

export function evaluate(hunks: Hunk[], judgments: Judgment[], message: MessageJudgment | null, strict: boolean) {
  const byId = new Map(judgments.map((j) => [j.hunkId, j]));
  const findings: Finding[] = [];
  for (const h of hunks) {
    const j = byId.get(h.id);
    if (j) findings.push(...evaluateHunk(h, j, strict));
  }
  if (message && message.matchesChanges < MESSAGE_MISMATCH) {
    findings.push({
      hunkId: "commit-message",
      file: "commit message",
      id: "message_mismatch",
      label: "review the commit message: it may not describe the staged changes",
      probability: 1 - message.matchesChanges,
      // Never a block, not even in strict mode. The commit message is the one field a visitor
      // edits, and coverage is wording-sensitive: honest terse wordings measure anywhere from 1 of 9
      // to 9 of 9, and one that names every change in flat shorthand reads 1 of 9, the same as `wip`.
      // A rule that thin must not stop a commit by itself.
      severity: "warn",
      quoted: [],
      line: null,
    });
  }
  const blocking = findings.filter((f) => f.severity === "block");
  const warnings = findings.filter((f) => f.severity === "warn");
  return {
    verdict: blocking.length > 0 ? ("block" as const) : warnings.length > 0 ? ("warn" as const) : ("pass" as const),
    findings,
    blocking,
    warnings,
  };
}

export interface FileSummary {
  file: string;
  hunks: number;
  maxRisk: number;
  findings: number;
  blocking: number;
  kinds: string[];
}

export function summariseFiles(hunks: Hunk[], judgments: Judgment[], findings: Finding[]): FileSummary[] {
  const byId = new Map(judgments.map((j) => [j.hunkId, j]));
  const map = new Map<string, FileSummary>();
  for (const h of hunks) {
    const j = byId.get(h.id);
    const s = map.get(h.file) ?? { file: h.file, hunks: 0, maxRisk: 0, findings: 0, blocking: 0, kinds: [] };
    s.hunks++;
    if (j) {
      s.maxRisk = Math.max(s.maxRisk, j.risk);
      if (!s.kinds.includes(j.kind)) s.kinds.push(j.kind);
    }
    map.set(h.file, s);
  }
  for (const f of findings) {
    const s = map.get(f.file);
    if (!s) continue;
    s.findings++;
    if (f.severity === "block") s.blocking++;
  }
  return [...map.values()].sort((a, b) => b.maxRisk - a.maxRisk || a.file.localeCompare(b.file));
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
}

// ------------------------------------------------------------------- baseline
// The "old way": the six regex rules a lint plugin would ship, as the comparison line.

export const REGEX_RULES: Array<{ id: FindingId; pattern: RegExp }> = [
  { id: "leaks_secret_or_token", pattern: /(sk_live_[0-9a-zA-Z]{8,}|ghp_[0-9a-zA-Z]{20,}|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/ },
  { id: "logs_sensitive_data", pattern: /console\.(log|debug|info)\([^)]*(password|token|secret)/i },
  { id: "disables_or_skips_tests", pattern: /\b(it|test|describe)\.(skip|only)\(|\bxit\(|\bxdescribe\(/ },
  { id: "destructive_data_change", pattern: /\b(DROP\s+(TABLE|COLUMN)|TRUNCATE\s+TABLE)\b/i },
  { id: "leftover_debug_or_temp", pattern: /\bdebugger;|TODO:? remove|FIXME before/i },
  { id: "hardcoded_env_specific_value", pattern: /https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)/ },
];

export interface BaselineHit {
  hunkId: string;
  id: FindingId;
  line: string;
}

export function runRegexBaseline(hunks: Hunk[]): { hits: BaselineHit[]; elapsedMs: number; rules: number } {
  const started = performance.now();
  const hits: BaselineHit[] = [];
  for (const h of hunks) {
    for (const l of addedLines(h)) {
      for (const rule of REGEX_RULES) if (rule.pattern.test(l.t)) hits.push({ hunkId: h.id, id: rule.id, line: l.t });
    }
  }
  return { hits, elapsedMs: performance.now() - started, rules: REGEX_RULES.length };
}

/** How many of the model's (hunk, finding) pairs the regex rules also caught. */
export function compareWithBaseline(pairs: Array<{ hunkId: string; id: string }>, hits: BaselineHit[]) {
  const base = new Set(hits.map((h) => `${h.hunkId}|${h.id}`));
  const missed = pairs.filter((p) => !base.has(`${p.hunkId}|${p.id}`));
  return { caught: pairs.length - missed.length, missed: missed.length, total: pairs.length };
}

// --------------------------------------------------------------- the fixture
// The invented Stripe key in the fixture is assembled at load time, exactly as the
// original fixture does it, so no string that looks like a live key sits in this
// repository's source and trips a secret scanner.
const FAKE_STRIPE_KEY = ["sk", "live", "51Hq7ZkL2mN8pQrS3tUvWxYz0123456789abcdefghij"].join("_");
const KEY_PLACEHOLDER = "__FAKE_KEY__";

export const HUNKS: Hunk[] = [
 {
  "id": "README.md#0",
  "file": "README.md",
  "language": "Markdown",
  "header": "npm install",
  "oldStart": 9,
  "oldCount": 6,
  "newStart": 9,
  "newCount": 10,
  "isNewFile": false,
  "isDeletedFile": false,
  "lines": [
   {
    "k": " ",
    "t": "npm run dev",
    "n": 9
   },
   {
    "k": " ",
    "t": "```",
    "n": 10
   },
   {
    "k": " ",
    "t": "",
    "n": 11
   },
   {
    "k": "+",
    "t": "## Configuration",
    "n": 12
   },
   {
    "k": "+",
    "t": "",
    "n": 13
   },
   {
    "k": "+",
    "t": "All settings are read from environment variables; see `src/config.ts`.",
    "n": 14
   },
   {
    "k": "+",
    "t": "",
    "n": 15
   },
   {
    "k": " ",
    "t": "## Testing",
    "n": 16
   },
   {
    "k": " ",
    "t": "",
    "n": 17
   },
   {
    "k": " ",
    "t": "```sh",
    "n": 18
   }
  ]
 },
 {
  "id": "migrations/0007_drop_legacy_email.sql#0",
  "file": "migrations/0007_drop_legacy_email.sql",
  "language": "SQL",
  "header": "",
  "oldStart": 0,
  "oldCount": 0,
  "newStart": 1,
  "newCount": 2,
  "isNewFile": true,
  "isDeletedFile": false,
  "lines": [
   {
    "k": "+",
    "t": "-- Remove the legacy_email column now that all users have moved to the identities table.",
    "n": 1
   },
   {
    "k": "+",
    "t": "ALTER TABLE users DROP COLUMN legacy_email;",
    "n": 2
   }
  ]
 },
 {
  "id": "package.json#0",
  "file": "package.json",
  "language": "JSON",
  "header": "",
  "oldStart": 9,
  "oldCount": 7,
  "newStart": 9,
  "newCount": 7,
  "isNewFile": false,
  "isDeletedFile": false,
  "lines": [
   {
    "k": " ",
    "t": "  },",
    "n": 9
   },
   {
    "k": " ",
    "t": "  \"dependencies\": {",
    "n": 10
   },
   {
    "k": " ",
    "t": "    \"pg\": \"8.11.3\",",
    "n": 11
   },
   {
    "k": "-",
    "t": "    \"pino\": \"9.0.0\"",
    "n": null
   },
   {
    "k": "+",
    "t": "    \"pino\": \"9.1.0\"",
    "n": 12
   },
   {
    "k": " ",
    "t": "  },",
    "n": 13
   },
   {
    "k": " ",
    "t": "  \"devDependencies\": {",
    "n": 14
   },
   {
    "k": " ",
    "t": "    \"tsx\": \"4.19.2\",",
    "n": 15
   }
  ]
 },
 {
  "id": "src/api/orders.ts#0",
  "file": "src/api/orders.ts",
  "language": "TypeScript",
  "header": "import type { Order } from \"../db/orders\";",
  "oldStart": 3,
  "oldCount": 8,
  "newStart": 3,
  "newCount": 7,
  "isNewFile": false,
  "isDeletedFile": false,
  "lines": [
   {
    "k": " ",
    "t": "/** Public JSON shape returned by GET /api/orders/:id */",
    "n": 3
   },
   {
    "k": " ",
    "t": "export interface OrderResponse {",
    "n": 4
   },
   {
    "k": " ",
    "t": "  id: string;",
    "n": 5
   },
   {
    "k": "-",
    "t": "  total: number;",
    "n": null
   },
   {
    "k": "-",
    "t": "  currency: string;",
    "n": null
   },
   {
    "k": "+",
    "t": "  totalCents: number;",
    "n": 6
   },
   {
    "k": " ",
    "t": "  items: number;",
    "n": 7
   },
   {
    "k": " ",
    "t": "  status: string;",
    "n": 8
   },
   {
    "k": " ",
    "t": "}",
    "n": 9
   }
  ]
 },
 {
  "id": "src/api/orders.ts#1",
  "file": "src/api/orders.ts",
  "language": "TypeScript",
  "header": "export interface OrderResponse {",
  "oldStart": 12,
  "oldCount": 8,
  "newStart": 11,
  "newCount": 7,
  "isNewFile": false,
  "isDeletedFile": false,
  "lines": [
   {
    "k": " ",
    "t": "export function toOrderResponse(order: Order): OrderResponse {",
    "n": 11
   },
   {
    "k": " ",
    "t": "  return {",
    "n": 12
   },
   {
    "k": " ",
    "t": "    id: order.id,",
    "n": 13
   },
   {
    "k": "-",
    "t": "    total: order.totalCents / 100,",
    "n": null
   },
   {
    "k": "-",
    "t": "    currency: order.currency,",
    "n": null
   },
   {
    "k": "+",
    "t": "    totalCents: order.totalCents,",
    "n": 14
   },
   {
    "k": " ",
    "t": "    items: order.items.length,",
    "n": 15
   },
   {
    "k": " ",
    "t": "    status: order.status,",
    "n": 16
   },
   {
    "k": " ",
    "t": "  };",
    "n": 17
   }
  ]
 },
 {
  "id": "src/api/users.ts#0",
  "file": "src/api/users.ts",
  "language": "TypeScript",
  "header": "export async function login(input: LoginInput) {",
  "oldStart": 19,
  "oldCount": 6,
  "newStart": 19,
  "newCount": 6,
  "isNewFile": false,
  "isDeletedFile": false,
  "lines": [
   {
    "k": " ",
    "t": "  }",
    "n": 19
   },
   {
    "k": " ",
    "t": "",
    "n": 20
   },
   {
    "k": " ",
    "t": "  const session = await createSession(user.id);",
    "n": 21
   },
   {
    "k": "-",
    "t": "  logger.info(\"login ok\", { userId: user.id });",
    "n": null
   },
   {
    "k": "+",
    "t": "  logger.info(\"login ok\", { userId: user.id, email: input.email, password: input.password, hash: user.password_hash });",
    "n": 22
   },
   {
    "k": " ",
    "t": "  return { ok: true as const, session };",
    "n": 23
   },
   {
    "k": " ",
    "t": "}",
    "n": 24
   }
  ]
 },
 {
  "id": "src/auth/session.ts#0",
  "file": "src/auth/session.ts",
  "language": "TypeScript",
  "header": "export async function createSession(userId: string): Promise<Session> {",
  "oldStart": 20,
  "oldCount": 6,
  "newStart": 20,
  "newCount": 7,
  "isNewFile": false,
  "isDeletedFile": false,
  "lines": [
   {
    "k": " ",
    "t": "    expiresAt,",
    "n": 20
   },
   {
    "k": " ",
    "t": "  ]);",
    "n": 21
   },
   {
    "k": " ",
    "t": "  logger.info(\"session created\", { userId });",
    "n": 22
   },
   {
    "k": "+",
    "t": "  console.log(\"issued session token\", token, \"for user\", userId);",
    "n": 23
   },
   {
    "k": " ",
    "t": "  return { id: token.slice(0, 8), userId, token, expiresAt };",
    "n": 24
   },
   {
    "k": " ",
    "t": "}",
    "n": 25
   },
   {
    "k": " ",
    "t": "",
    "n": 26
   }
  ]
 },
 {
  "id": "src/auth/session.ts#1",
  "file": "src/auth/session.ts",
  "language": "TypeScript",
  "header": "function isExpired(row: SessionRow): boolean {",
  "oldStart": 35,
  "oldCount": 6,
  "newStart": 36,
  "newCount": 9,
  "isNewFile": false,
  "isDeletedFile": false,
  "lines": [
   {
    "k": " ",
    "t": "}",
    "n": 36
   },
   {
    "k": " ",
    "t": "",
    "n": 37
   },
   {
    "k": " ",
    "t": "export async function verifySession(token: string): Promise<Session | null> {",
    "n": 38
   },
   {
    "k": "+",
    "t": "  if (token === \"letmein\") {",
    "n": 39
   },
   {
    "k": "+",
    "t": "    return { id: \"dev\", userId: \"admin\", token, expiresAt: new Date(8640000000000000) };",
    "n": 40
   },
   {
    "k": "+",
    "t": "  }",
    "n": 41
   },
   {
    "k": " ",
    "t": "  const row = await db.queryOne<SessionRow>(\"SELECT * FROM sessions WHERE token = $1\", [token]);",
    "n": 42
   },
   {
    "k": " ",
    "t": "  if (!row) return null;",
    "n": 43
   },
   {
    "k": " ",
    "t": "  if (isExpired(row)) {",
    "n": 44
   }
  ]
 },
 {
  "id": "src/config.ts#0",
  "file": "src/config.ts",
  "language": "TypeScript",
  "header": "export interface AppConfig {",
  "oldStart": 6,
  "oldCount": 6,
  "newStart": 6,
  "newCount": 8,
  "isNewFile": false,
  "isDeletedFile": false,
  "lines": [
   {
    "k": " ",
    "t": "  region: string;",
    "n": 6
   },
   {
    "k": " ",
    "t": "}",
    "n": 7
   },
   {
    "k": " ",
    "t": "",
    "n": 8
   },
   {
    "k": "+",
    "t": "const STRIPE_FALLBACK_KEY = \"__FAKE_KEY__\";",
    "n": 9
   },
   {
    "k": "+",
    "t": "",
    "n": 10
   },
   {
    "k": " ",
    "t": "function required(name: string): string {",
    "n": 11
   },
   {
    "k": " ",
    "t": "  const v = process.env[name];",
    "n": 12
   },
   {
    "k": " ",
    "t": "  if (!v) throw new Error(`Missing env var ${name}`);",
    "n": 13
   }
  ]
 },
 {
  "id": "src/config.ts#1",
  "file": "src/config.ts",
  "language": "TypeScript",
  "header": "function optionalNumber(name: string, fallback: number): number {",
  "oldStart": 18,
  "oldCount": 8,
  "newStart": 20,
  "newCount": 8,
  "isNewFile": false,
  "isDeletedFile": false,
  "lines": [
   {
    "k": " ",
    "t": "}",
    "n": 20
   },
   {
    "k": " ",
    "t": "",
    "n": 21
   },
   {
    "k": " ",
    "t": "export const config: AppConfig = {",
    "n": 22
   },
   {
    "k": "-",
    "t": "  apiUrl: required(\"API_URL\"),",
    "n": null
   },
   {
    "k": "-",
    "t": "  stripeKey: required(\"STRIPE_SECRET_KEY\"),",
    "n": null
   },
   {
    "k": "+",
    "t": "  apiUrl: \"http://10.0.3.12:8080\",",
    "n": 23
   },
   {
    "k": "+",
    "t": "  stripeKey: process.env.STRIPE_SECRET_KEY ?? STRIPE_FALLBACK_KEY,",
    "n": 24
   },
   {
    "k": " ",
    "t": "  retries: optionalNumber(\"RETRIES\", 3),",
    "n": 25
   },
   {
    "k": " ",
    "t": "  timeoutMs: optionalNumber(\"TIMEOUT_MS\", 5000),",
    "n": 26
   },
   {
    "k": " ",
    "t": "  region: process.env.AWS_REGION ?? \"us-east-1\",",
    "n": 27
   }
  ]
 },
 {
  "id": "src/jobs/cleanup.ts#0",
  "file": "src/jobs/cleanup.ts",
  "language": "TypeScript",
  "header": "export async function runCleanup(): Promise<CleanupState> {",
  "oldStart": 16,
  "oldCount": 7,
  "newStart": 16,
  "newCount": 7,
  "isNewFile": false,
  "isDeletedFile": false,
  "lines": [
   {
    "k": " ",
    "t": "  const sessions = await db.query(\"DELETE FROM sessions WHERE expires_at < NOW()\");",
    "n": 16
   },
   {
    "k": " ",
    "t": "  state.deletedSessions = sessions.rowCount;",
    "n": 17
   },
   {
    "k": " ",
    "t": "",
    "n": 18
   },
   {
    "k": "-",
    "t": "  const audit = await db.query(\"DELETE FROM audit_log WHERE created_at < $1\", [cutoff]);",
    "n": null
   },
   {
    "k": "+",
    "t": "  const audit = await db.query(\"DELETE FROM audit_log\");",
    "n": 19
   },
   {
    "k": " ",
    "t": "  state.deletedAuditRows = audit.rowCount;",
    "n": 20
   },
   {
    "k": " ",
    "t": "",
    "n": 21
   },
   {
    "k": " ",
    "t": "  logger.info(\"cleanup finished\", {",
    "n": 22
   }
  ]
 },
 {
  "id": "src/jobs/cleanup.ts#1",
  "file": "src/jobs/cleanup.ts",
  "language": "TypeScript",
  "header": "export async function runCleanup(): Promise<CleanupState> {",
  "oldStart": 27,
  "oldCount": 7,
  "newStart": 27,
  "newCount": 10,
  "isNewFile": false,
  "isDeletedFile": false,
  "lines": [
   {
    "k": " ",
    "t": "}",
    "n": 27
   },
   {
    "k": " ",
    "t": "",
    "n": 28
   },
   {
    "k": " ",
    "t": "export function scheduleCleanup(intervalMs: number): NodeJS.Timeout {",
    "n": 29
   },
   {
    "k": "+",
    "t": "  // TODO remove before merge - debugging the double-run race",
    "n": 30
   },
   {
    "k": "+",
    "t": "  intervalMs = 500;",
    "n": 31
   },
   {
    "k": " ",
    "t": "  return setInterval(() => {",
    "n": 32
   },
   {
    "k": "+",
    "t": "    console.log(\"cleanup tick\", new Date().toISOString());",
    "n": 33
   },
   {
    "k": " ",
    "t": "    runCleanup().catch((err) => logger.error(\"cleanup failed\", { err }));",
    "n": 34
   },
   {
    "k": " ",
    "t": "  }, intervalMs);",
    "n": 35
   },
   {
    "k": " ",
    "t": "}",
    "n": 36
   }
  ]
 },
 {
  "id": "src/logger.ts#0",
  "file": "src/logger.ts",
  "language": "TypeScript",
  "header": "export const logger = pino({",
  "oldStart": 8,
  "oldCount": 6,
  "newStart": 8,
  "newCount": 5,
  "isNewFile": false,
  "isDeletedFile": false,
  "lines": [
   {
    "k": " ",
    "t": "});",
    "n": 8
   },
   {
    "k": " ",
    "t": "",
    "n": 9
   },
   {
    "k": " ",
    "t": "export function childLogger(component: string) {",
    "n": 10
   },
   {
    "k": "-",
    "t": "  const l = logger.child({ component });",
    "n": null
   },
   {
    "k": "-",
    "t": "  return l;",
    "n": null
   },
   {
    "k": "+",
    "t": "  return logger.child({ component });",
    "n": 11
   },
   {
    "k": " ",
    "t": "}",
    "n": 12
   }
  ]
 },
 {
  "id": "src/utils/format.ts#0",
  "file": "src/utils/format.ts",
  "language": "TypeScript",
  "header": "",
  "oldStart": 1,
  "oldCount": 5,
  "newStart": 1,
  "newCount": 5,
  "isNewFile": false,
  "isDeletedFile": false,
  "lines": [
   {
    "k": " ",
    "t": "export function truncate(s: string, max: number): string {",
    "n": 1
   },
   {
    "k": "-",
    "t": "  if (s.length < max) return s;",
    "n": null
   },
   {
    "k": "+",
    "t": "  if (s.length <= max) return s;",
    "n": 2
   },
   {
    "k": " ",
    "t": "  return s.slice(0, max - 1) + \"…\";",
    "n": 3
   },
   {
    "k": " ",
    "t": "}",
    "n": 4
   },
   {
    "k": " ",
    "t": "",
    "n": 5
   }
  ]
 },
 {
  "id": "test/payments.test.ts#0",
  "file": "test/payments.test.ts",
  "language": "TypeScript",
  "header": "describe(\"payments\", () => {",
  "oldStart": 8,
  "oldCount": 7,
  "newStart": 8,
  "newCount": 8,
  "isNewFile": false,
  "isDeletedFile": false,
  "lines": [
   {
    "k": " ",
    "t": "    expect(result.amountCents).toBe(1999);",
    "n": 8
   },
   {
    "k": " ",
    "t": "  });",
    "n": 9
   },
   {
    "k": " ",
    "t": "",
    "n": 10
   },
   {
    "k": "-",
    "t": "  it(\"refunds partial amounts\", async () => {",
    "n": null
   },
   {
    "k": "+",
    "t": "  // temporarily skipping, flaky on CI",
    "n": 11
   },
   {
    "k": "+",
    "t": "  it.skip(\"refunds partial amounts\", async () => {",
    "n": 12
   },
   {
    "k": " ",
    "t": "    const c = await charge({ amountCents: 5000, currency: \"usd\" });",
    "n": 13
   },
   {
    "k": " ",
    "t": "    const r = await refund(c.id, 1200);",
    "n": 14
   },
   {
    "k": " ",
    "t": "    expect(r.amountCents).toBe(1200);",
    "n": 15
   }
  ]
 }
];

for (const h of HUNKS) {
  for (const l of h.lines) if (l.t.includes(KEY_PLACEHOLDER)) l.t = l.t.replace(KEY_PLACEHOLDER, FAKE_STRIPE_KEY);
}

// -------------------------------------------------------------- the run plan
// One implementation of the six requests, shared by the island (which passes the
// queued /api/run helper from src/lib/dm1.ts) and by smoke.mjs (which passes a
// direct fetch to the API). Nothing here knows about fetch, React or the DOM.

export interface CallMeta {
  inferenceMs: number;
  tokens: number;
  wallMs: number;
}
export type Call = (route: string, body: Record<string, unknown>) => Promise<{ data: any; meta: CallMeta }>;

export type Step = "risk" | "kind" | "findings" | "lines" | "message-match" | "message-quality";
export const STEP_LABELS: Record<Step, string> = {
  risk: "risk of each hunk",
  kind: "kind of each hunk",
  findings: "eight checks per hunk",
  lines: "eight checks per added line",
  "message-match": "message against the diff",
  "message-quality": "message quality",
};

export interface RunEvent {
  step: Step;
  route: string;
  meta: CallMeta;
  /** Running judgments, one per hunk, filled in as the steps land. */
  judgments: Judgment[];
  /** Per added line ("<hunk id>#<index>"), the probability of each statement. */
  lineScores: Map<string, number[]>;
  message: MessageJudgment | null;
}

/**
 * One claim per hunk whose top finding crossed its report threshold, deduplicated, in hunk
 * order. Falls back to the riskiest hunk's top finding so the call always has a statement.
 */
export function messageClaims(hunks: Hunk[], judgments: Judgment[]): string[] {
  const byId = new Map(judgments.map((j) => [j.hunkId, j]));
  const out: string[] = [];
  for (const h of hunks) {
    const j = byId.get(h.id);
    if (!j) continue;
    const top = FINDING_IDS.reduce((a, b) => (j.findings[a] >= j.findings[b] ? a : b));
    if (j.findings[top] < RULES[top].report) continue;
    const claim = messageClaim(h, top);
    if (!out.includes(claim)) out.push(claim);
  }
  if (out.length === 0) {
    const h = [...hunks].sort((a, b) => (byId.get(b.id)?.risk ?? 0) - (byId.get(a.id)?.risk ?? 0))[0];
    const j = h ? byId.get(h.id) : undefined;
    if (h && j) out.push(messageClaim(h, FINDING_IDS.reduce((a, b) => (j.findings[a] >= j.findings[b] ? a : b))));
  }
  return out.slice(0, 32);
}

/** Fixed question universe: later model findings select scores, never new public request bodies. */
export const allMessageClaims = (hunks: Hunk[]) => [...new Set(hunks.flatMap(h => FINDING_IDS.map(id => messageClaim(h, id))))];

const emptyFindings = () => Object.fromEntries(FINDING_IDS.map((id) => [id, 0])) as Record<FindingId, number>;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const probs = (r: any): number[] => r.results.map((s: any) => s.probability);

/**
 * Six requests for a whole commit, each one batched over every hunk or every added line:
 * risk, kind, the eight checks per hunk, the same eight per added line (which names the
 * offending line and sharpens the per-hunk score), then the two commit-message checks.
 * Yields after every request so the report streams in.
 */
export async function* runSentry(call: Call, hunks: Hunk[], message: string): AsyncGenerator<RunEvent> {
  const texts = hunks.map(hunkText);
  const judgments: Judgment[] = hunks.map((h) => ({
    hunkId: h.id,
    risk: 0,
    riskLevel: "cosmetic",
    riskConfidence: 0,
    kind: "chore",
    kindConfidence: 0,
    findings: emptyFindings(),
    offendingLineIndex: null,
  }));
  const lineScores = new Map<string, number[]>();
  let msg: MessageJudgment | null = null;
  const state = () => ({
    judgments: judgments.map((j) => ({ ...j, findings: { ...j.findings } })),
    lineScores: new Map(lineScores),
    message: msg,
  });

  // 1. Risk, one /rate call over every hunk. `score` already lands on the 0..4 scale.
  let r = await call("rate", { texts, scale: RISK_SCALE });
  (r.data.results as any[]).forEach((res, i) => {
    const j = judgments[i]!;
    j.risk = clamp(res.score, 0, 4);
    // The level name comes from the score, not from `level` (the argmax), so the word
    // on screen always agrees with the bar next to it.
    j.riskLevel = RISK_LEVELS[Math.round(j.risk)]!;
    j.riskConfidence = res.confidence ?? 0;
  });
  yield { step: "risk", route: "rate", meta: r.meta, ...state() };

  // 2. Kind, one /classify call over every hunk. A confident `docs` label also caps the risk
  //    from step 1 — see DOCS_RISK_CAP: prose changes no behaviour, whatever it quotes.
  r = await call("classify", { texts, labels: KIND_LABELS });
  (r.data.results as any[]).forEach((res, i) => {
    const j = judgments[i]!;
    j.kind = res.label;
    j.kindConfidence = res.confidence ?? 0;
    if (j.kind === "docs" && j.kindConfidence >= DOCS_RISK_CONFIDENCE) {
      j.risk = Math.min(j.risk, DOCS_RISK_CAP);
      j.riskLevel = RISK_LEVELS[Math.round(j.risk)]!;
    }
  });
  yield { step: "kind", route: "classify", meta: r.meta, ...state() };

  // 3. Eight checks per hunk: one /yes-no call, 15 texts x 8 statements = 120 judgments.
  r = await call("yes-no", { texts, statements: STATEMENTS });
  (r.data.results as any[]).forEach((res, i) => {
    const p = probs(res);
    FINDING_IDS.forEach((id, k) => (judgments[i]!.findings[id] = p[k]!));
  });
  yield { step: "findings", route: "yes-no", meta: r.meta, ...state() };

  // 4. The same eight checks per added line. A line on its own carries the evidence the
  //    surrounding context dilutes, so the per-hunk score is the max of the two, and the
  //    line that scores highest on the hunk's top finding is the offending line.
  const flat = hunks.flatMap((h, hi) =>
    addedLines(h)
      .map((l, li) => ({ hi, li, key: `${h.id}#${li}`, text: lineText(h, l), blank: l.t.trim().length === 0 }))
      .filter((x) => !x.blank),
  );
  for (let i = 0; i < flat.length; i += 32) {
    const batch = flat.slice(i, i + 32);
    r = await call("yes-no", { texts: batch.map((b) => b.text), statements: STATEMENTS });
    (r.data.results as any[]).forEach((res, k) => lineScores.set(batch[k]!.key, probs(res)));
    hunks.forEach((h, hi) => {
      const j = judgments[hi]!;
      const lines = addedLines(h).map((_, li) => ({ li, p: lineScores.get(`${h.id}#${li}`) })).filter((x) => x.p);
      FINDING_IDS.forEach((id, k) => (j.findings[id] = Math.max(j.findings[id], ...lines.map((l) => l.p![k]!), 0)));
      const top = FINDING_IDS.reduce((a, b) => (j.findings[a] >= j.findings[b] ? a : b));
      const ti = FINDING_IDS.indexOf(top);
      // Comment lines still raise the hunk score above, but they never win the quote: the
      // SQL comment over `ALTER TABLE users DROP COLUMN` scored higher than the statement.
      const adds = addedLines(h);
      const code = lines.filter((l) => !isCommentLine(adds[l.li]!.t));
      const best = (code.length ? code : lines).sort((a, b) => b.p![ti]! - a.p![ti]!)[0];
      j.offendingLineIndex = best && best.p![ti]! >= RULES[top].report ? best.li : null;
    });
    yield { step: "lines", route: "yes-no", meta: r.meta, ...state() };
  }

  // 5. Does the message describe the commit? The message is the text and the statements are
  //    ours, one short declarative per significant change the steps above found, so nothing a
  //    visitor types is ever sent as a statement. Score the fixed possible claims, then
  //    select the actual findings locally so cached stock requests stay deterministic.
  const claims = messageClaims(hunks, judgments);
  const scores = new Map<string, number>();
  const possible = allMessageClaims(hunks);
  for (let i = 0; i < possible.length; i += 32) {
    const statements = possible.slice(i, i + 32);
    r = await call("yes-no", { text: `Commit message: ${message.trim() || "(empty)"}`, statements });
    probs(r.data).forEach((p, k) => scores.set(statements[k]!, p));
    if (i + 32 < possible.length) yield { step: "message-match", route: "yes-no", meta: r.meta, ...state() };
  }
  const ps = claims.map(claim => scores.get(claim)!);
  msg = {
    matchesChanges: ps.filter((p) => p >= COVERAGE_MIN).length / (ps.length || 1),
    claims: claims.map((statement, i) => ({ statement, probability: ps[i]! })),
    quality: 0,
    qualityLevel: "adequate",
    qualityConfidence: 0,
  };
  yield { step: "message-match", route: "yes-no", meta: r.meta, ...state() };

  // 6. How well the message is written, on its own.
  // An empty message is a valid input — MESSAGE_SCALE level 0 is written for it — but /rate
  // rejects "" with HTTP 400 (`texts.0: Too small`), which ended the whole run in a Dm1Error
  // after five requests had already been spent. A single space is the substitute rather than a
  // word like "(empty)", because here the text *is* the thing being rated: " " comes back
  // 0.00 level 0, the same as a whitespace-only message, while "(empty)" comes back 2.02
  // level 2 and would call a missing message adequate.
  r = await call("rate", { text: message || " ", scale: MESSAGE_SCALE });
  msg = {
    ...msg,
    quality: clamp(r.data.score, 0, 3),
    qualityLevel: MESSAGE_QUALITY_LEVELS[clamp(r.data.level ?? 0, 0, 3)]!,
    qualityConfidence: r.data.confidence ?? 0,
  };
  yield { step: "message-quality", route: "rate", meta: r.meta, ...state() };
}

// --------------------------------------------------------------- recorded run
/**
 * One real run of the six requests above on the seed diff and the seed commit message,
 * recorded with smoke.mjs. The island replays it when your key is rate limited, so a
 * visitor who arrives during a 429 still sees a finished report instead of an error line.
 */
export const MOCK = {
 "steps": [
  {
   "step": "risk",
   "route": "rate",
   "meta": {
    "inferenceMs": 715,
    "tokens": 1620,
    "wallMs": 516
   }
  },
  {
   "step": "kind",
   "route": "classify",
   "meta": {
    "inferenceMs": 767,
    "tokens": 1604,
    "wallMs": 359
   }
  },
  {
   "step": "findings",
   "route": "yes-no",
   "meta": {
    "inferenceMs": 2739,
    "tokens": 1651,
    "wallMs": 537
   }
  },
  {
   "step": "lines",
   "route": "yes-no",
   "meta": {
    "inferenceMs": 3110,
    "tokens": 824,
    "wallMs": 529
   }
  },
  {
   "step": "message-match",
   "route": "yes-no",
   "meta": {
    "inferenceMs": 61,
    "tokens": 353,
    "wallMs": 345
   }
  },
  {
   "step": "message-quality",
   "route": "rate",
   "meta": {
    "inferenceMs": 25,
    "tokens": 295,
    "wallMs": 271
   }
  }
 ],
 "judgments": [
  {
   "hunkId": "README.md#0",
   "risk": 1.713,
   "riskLevel": "moderate",
   "riskConfidence": 0.049,
   "kind": "config",
   "kindConfidence": 0.812,
   "findings": {
    "leaks_secret_or_token": 0.14,
    "logs_sensitive_data": 0.072,
    "disables_or_skips_tests": 0.037,
    "destructive_data_change": 0.023,
    "changes_public_api_shape": 0.062,
    "leftover_debug_or_temp": 0.212,
    "hardcoded_env_specific_value": 0.308,
    "bypasses_auth_check": 0.037
   },
   "offendingLineIndex": null
  },
  {
   "hunkId": "migrations/0007_drop_legacy_email.sql#0",
   "risk": 3.352,
   "riskLevel": "high",
   "riskConfidence": 0.324,
   "kind": "bugfix",
   "kindConfidence": 0.887,
   "findings": {
    "leaks_secret_or_token": 0.017,
    "logs_sensitive_data": 0.021,
    "disables_or_skips_tests": 0.005,
    "destructive_data_change": 0.884,
    "changes_public_api_shape": 0.161,
    "leftover_debug_or_temp": 0.032,
    "hardcoded_env_specific_value": 0.061,
    "bypasses_auth_check": 0.011
   },
   "offendingLineIndex": 1
  },
  {
   "hunkId": "package.json#0",
   "risk": 1.86,
   "riskLevel": "moderate",
   "riskConfidence": 0.148,
   "kind": "config",
   "kindConfidence": 0.347,
   "findings": {
    "leaks_secret_or_token": 0.091,
    "logs_sensitive_data": 0.047,
    "disables_or_skips_tests": 0.018,
    "destructive_data_change": 0.023,
    "changes_public_api_shape": 0.057,
    "leftover_debug_or_temp": 0.174,
    "hardcoded_env_specific_value": 0.108,
    "bypasses_auth_check": 0.016
   },
   "offendingLineIndex": null
  },
  {
   "hunkId": "src/api/orders.ts#0",
   "risk": 2.864,
   "riskLevel": "high",
   "riskConfidence": 0.621,
   "kind": "bugfix",
   "kindConfidence": 0.373,
   "findings": {
    "leaks_secret_or_token": 0.031,
    "logs_sensitive_data": 0.023,
    "disables_or_skips_tests": 0.008,
    "destructive_data_change": 0.009,
    "changes_public_api_shape": 0.807,
    "leftover_debug_or_temp": 0.054,
    "hardcoded_env_specific_value": 0.064,
    "bypasses_auth_check": 0.013
   },
   "offendingLineIndex": null
  },
  {
   "hunkId": "src/api/orders.ts#1",
   "risk": 2.671,
   "riskLevel": "high",
   "riskConfidence": 0.233,
   "kind": "bugfix",
   "kindConfidence": 0.423,
   "findings": {
    "leaks_secret_or_token": 0.038,
    "logs_sensitive_data": 0.024,
    "disables_or_skips_tests": 0.009,
    "destructive_data_change": 0.006,
    "changes_public_api_shape": 0.489,
    "leftover_debug_or_temp": 0.1,
    "hardcoded_env_specific_value": 0.069,
    "bypasses_auth_check": 0.012
   },
   "offendingLineIndex": null
  },
  {
   "hunkId": "src/api/users.ts#0",
   "risk": 3.432,
   "riskLevel": "high",
   "riskConfidence": 0.41,
   "kind": "bugfix",
   "kindConfidence": 0.549,
   "findings": {
    "leaks_secret_or_token": 0.11,
    "logs_sensitive_data": 0.854,
    "disables_or_skips_tests": 0.005,
    "destructive_data_change": 0.009,
    "changes_public_api_shape": 0.224,
    "leftover_debug_or_temp": 0.539,
    "hardcoded_env_specific_value": 0.204,
    "bypasses_auth_check": 0.074
   },
   "offendingLineIndex": 0
  },
  {
   "hunkId": "src/auth/session.ts#0",
   "risk": 3.152,
   "riskLevel": "high",
   "riskConfidence": 0.245,
   "kind": "feature",
   "kindConfidence": 0.441,
   "findings": {
    "leaks_secret_or_token": 0.073,
    "logs_sensitive_data": 0.733,
    "disables_or_skips_tests": 0.003,
    "destructive_data_change": 0.008,
    "changes_public_api_shape": 0.097,
    "leftover_debug_or_temp": 0.317,
    "hardcoded_env_specific_value": 0.112,
    "bypasses_auth_check": 0.062
   },
   "offendingLineIndex": 0
  },
  {
   "hunkId": "src/auth/session.ts#1",
   "risk": 3.126,
   "riskLevel": "high",
   "riskConfidence": 0.509,
   "kind": "bugfix",
   "kindConfidence": 0.824,
   "findings": {
    "leaks_secret_or_token": 0.197,
    "logs_sensitive_data": 0.071,
    "disables_or_skips_tests": 0.077,
    "destructive_data_change": 0.046,
    "changes_public_api_shape": 0.196,
    "leftover_debug_or_temp": 0.331,
    "hardcoded_env_specific_value": 0.315,
    "bypasses_auth_check": 0.779
   },
   "offendingLineIndex": 0
  },
  {
   "hunkId": "src/config.ts#0",
   "risk": 3.442,
   "riskLevel": "high",
   "riskConfidence": 0.386,
   "kind": "config",
   "kindConfidence": 0.86,
   "findings": {
    "leaks_secret_or_token": 0.618,
    "logs_sensitive_data": 0.06,
    "disables_or_skips_tests": 0.004,
    "destructive_data_change": 0.013,
    "changes_public_api_shape": 0.022,
    "leftover_debug_or_temp": 0.231,
    "hardcoded_env_specific_value": 0.355,
    "bypasses_auth_check": 0.014
   },
   "offendingLineIndex": 0
  },
  {
   "hunkId": "src/config.ts#1",
   "risk": 3.05,
   "riskLevel": "high",
   "riskConfidence": 0.244,
   "kind": "config",
   "kindConfidence": 0.801,
   "findings": {
    "leaks_secret_or_token": 0.295,
    "logs_sensitive_data": 0.041,
    "disables_or_skips_tests": 0.007,
    "destructive_data_change": 0.014,
    "changes_public_api_shape": 0.024,
    "leftover_debug_or_temp": 0.171,
    "hardcoded_env_specific_value": 0.798,
    "bypasses_auth_check": 0.018
   },
   "offendingLineIndex": 0
  },
  {
   "hunkId": "src/jobs/cleanup.ts#0",
   "risk": 2.868,
   "riskLevel": "high",
   "riskConfidence": 0.153,
   "kind": "refactor",
   "kindConfidence": 0.344,
   "findings": {
    "leaks_secret_or_token": 0.034,
    "logs_sensitive_data": 0.089,
    "disables_or_skips_tests": 0.006,
    "destructive_data_change": 0.379,
    "changes_public_api_shape": 0.023,
    "leftover_debug_or_temp": 0.257,
    "hardcoded_env_specific_value": 0.084,
    "bypasses_auth_check": 0.02
   },
   "offendingLineIndex": null
  },
  {
   "hunkId": "src/jobs/cleanup.ts#1",
   "risk": 1.745,
   "riskLevel": "moderate",
   "riskConfidence": 0.166,
   "kind": "refactor",
   "kindConfidence": 0.298,
   "findings": {
    "leaks_secret_or_token": 0.082,
    "logs_sensitive_data": 0.188,
    "disables_or_skips_tests": 0.058,
    "destructive_data_change": 0.018,
    "changes_public_api_shape": 0.202,
    "leftover_debug_or_temp": 0.997,
    "hardcoded_env_specific_value": 0.111,
    "bypasses_auth_check": 0.014
   },
   "offendingLineIndex": null
  },
  {
   "hunkId": "src/logger.ts#0",
   "risk": 1.753,
   "riskLevel": "moderate",
   "riskConfidence": 0.141,
   "kind": "refactor",
   "kindConfidence": 0.475,
   "findings": {
    "leaks_secret_or_token": 0.035,
    "logs_sensitive_data": 0.048,
    "disables_or_skips_tests": 0.007,
    "destructive_data_change": 0.008,
    "changes_public_api_shape": 0.073,
    "leftover_debug_or_temp": 0.298,
    "hardcoded_env_specific_value": 0.098,
    "bypasses_auth_check": 0.033
   },
   "offendingLineIndex": null
  },
  {
   "hunkId": "src/utils/format.ts#0",
   "risk": 0.668,
   "riskLevel": "low",
   "riskConfidence": 0.347,
   "kind": "refactor",
   "kindConfidence": 0.41,
   "findings": {
    "leaks_secret_or_token": 0.034,
    "logs_sensitive_data": 0.016,
    "disables_or_skips_tests": 0.006,
    "destructive_data_change": 0.006,
    "changes_public_api_shape": 0.026,
    "leftover_debug_or_temp": 0.106,
    "hardcoded_env_specific_value": 0.026,
    "bypasses_auth_check": 0.02
   },
   "offendingLineIndex": null
  },
  {
   "hunkId": "test/payments.test.ts#0",
   "risk": 2.679,
   "riskLevel": "high",
   "riskConfidence": 0.215,
   "kind": "test",
   "kindConfidence": 0.818,
   "findings": {
    "leaks_secret_or_token": 0.164,
    "logs_sensitive_data": 0.036,
    "disables_or_skips_tests": 0.939,
    "destructive_data_change": 0.035,
    "changes_public_api_shape": 0.08,
    "leftover_debug_or_temp": 0.872,
    "hardcoded_env_specific_value": 0.232,
    "bypasses_auth_check": 0.053
   },
   "offendingLineIndex": 1
  }
 ],
 "message": {
  "matchesChanges": 0,
  "claims": [
   {
    "statement": "The message says a database column is dropped.",
    "probability": 0.004
   },
   {
    "statement": "The message says a field in an API response is renamed or removed.",
    "probability": 0.021
   },
   {
    "statement": "The message says credentials or user data are written to the log.",
    "probability": 0.086
   },
   {
    "statement": "The message says an authentication check can be bypassed.",
    "probability": 0.005
   },
   {
    "statement": "The message says an API key or secret is added to the code.",
    "probability": 0.013
   },
   {
    "statement": "The message says a host, IP address or port is hard-coded.",
    "probability": 0.011
   },
   {
    "statement": "The message says rows are deleted from a table.",
    "probability": 0.025
   },
   {
    "statement": "The message says temporary debugging code is left in.",
    "probability": 0.169
   },
   {
    "statement": "The message says a test is skipped.",
    "probability": 0.002
   }
  ],
  "quality": 1.086,
  "qualityLevel": "vague",
  "qualityConfidence": 0.704
 }
} as unknown as {
  steps: Array<{ step: Step; route: string; meta: CallMeta }>;
  judgments: Judgment[];
  message: MessageJudgment;
};
