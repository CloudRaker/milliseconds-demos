// Line -> request text, and answers -> markers. Pure; the network lives in Demo.tsx.
// Ported from jev-lint/src/markers.ts. The Jev fan-out (6 questions per line, one request
// per function) becomes decision-machine-1 batching: one probe is one statement, one line
// is one text, and a whole batch of up to 32 lines rides in a single call.
//
// What survived tuning. The original asked Jev six questions per line. One survives.
//
//  - `security_risk` ships, as the single `injection` probe. It separates a defective line
//    from its corrected twin by 0.18 to 0.54 raw probability across six languages, and it
//    ranks the planted security lines at or near the top of every seed file.
//  - The probe is gated twice, by `hasSink` and by `hasGlue`, because the statement asks about
//    two things at once and the model only judges one of them reliably. `hasSink` answers "is
//    there a query, a command or a path here?" — without it, plain logging concatenation came
//    back at 0.95 and drew a red security error. `hasGlue` answers "is anything concatenated
//    or interpolated in?" — without it, a fixed-literal query with no outside value anywhere
//    (`db.query("SELECT id, name FROM users WHERE active = true")`) scored 0.78-0.80 and drew
//    the same red error. Both are deterministic. What is left for the model is the one thing a
//    regex cannot do: given a sink with something glued near it, is the outside value part of
//    the text that runs, or is it handed over bound?
//  - `probable_bug`, `misleading_name`, `dead_or_unreachable` and `performance_smell` were
//    measured and dropped. Every wording tried scored the corrected twin as high as the
//    defect — on single lines, on windows, on /classify over the kinds, and on statement
//    pairs scored by difference. They stay in `Kind` because the seed data is annotated
//    with them, and the page says they are out of scope.
//  - A second security probe for weak crypto and hardcoded secrets passed the pair gate
//    (4/6) but was dropped anyway: its level drifts with the batch, so in a 32-line file
//    batch it sat above its threshold on nearly every line. Pairs alone are not enough.
//
// `smoke.mjs` runs three gates: `--pairs` re-measures every contrasting pair and fails a probe
// that stops separating, plus an unmarkable block that fails a marker on a line with no sink or
// no glue, plus one candidate statement per dropped kind so "no wording separated them" is
// re-measured and not merely asserted; `--files` scores the same lines the page sends; and
// `--typed` runs the "Type it for me" snippets through the edit path, failing a dead button on
// the injection snippet and a loud one on the dropped-kind snippet.

import { isJudgeable, type Language } from "./analysis.ts";
import type { ClassifyResult, YesNoResult } from "../../lib/dm1";

export type Kind = "probable_bug" | "security_risk" | "misleading_name" | "dead_or_unreachable" | "performance_smell";

/** Kinds the model separates, so the only kind the demo asks about. */
export const KINDS: Kind[] = ["security_risk"];
/**
 * Planted kinds no statement separated from its corrected twin. Shown, never judged.
 * Scope is finer than kind: within `security_risk` only the issues the `injection` probe
 * claims are judged, so a planted issue carries the probe id that claims it (see `eval.ts`).
 */
export const OUT_OF_SCOPE: Kind[] = ["probable_bug", "misleading_name", "dead_or_unreachable", "performance_smell"];

export const KIND_LABEL: Record<Kind, string> = {
  probable_bug: "probable bug",
  security_risk: "security risk",
  misleading_name: "misleading name",
  dead_or_unreachable: "dead / unreachable",
  performance_smell: "performance smell",
};

export type Severity = "info" | "warning" | "error";
export type SeverityChoice = "ignore" | Severity;
export const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2 };

export interface Marker {
  line: number;
  severity: Severity;
  /** every probed kind with its raw probability, sorted descending */
  kinds: { kind: Kind; p: number }[];
  message: string;
  source: "dm1" | "heuristic";
  severityProbabilities?: Record<SeverityChoice, number>;
}

export interface LineRef {
  line: number;
  text: string;
  /** exactly what one API text is: the language and the line, nothing else */
  bare: string;
  /** does this line run a query, a command or a path? see `hasSink` */
  sink: boolean;
  /** is anything concatenated or interpolated into it? see `hasGlue` */
  glue: boolean;
}

/**
 * One yes/no statement per probe. Two things decide whether a probe works on this model,
 * both found by running contrasting pairs through it (smoke.mjs `--pairs`):
 *
 *  - One text is one line. The model judges the whole text it is given, not a line inside
 *    it, so a statement about the marked line of a five-line window scores a defect and its
 *    corrected twin identically (0.994 vs 0.994 on an off-by-one). Sending the line alone
 *    is what makes a difference appear at all.
 *  - `when_false` naming the safe form concretely. The shipped wording — "The outside value is
 *    handed over separately, as a bound parameter written ?, %s or $1, or as its own entry in
 *    an argument list, so it never becomes part of the text." — is what moves a parameterised
 *    query from 0.97 down to 0.54; a vague "no problem here" leaves both sides saturated.
 *
 * What wording cannot fix is a line with no outside value at all. An earlier `when_false` also
 * named the fixed literal ("or the string is a fixed literal"); with it restored, a constant
 * query still scored 0.747-0.779, at or above `RAISE`. That is why `hasGlue` is a regex and not
 * a clause: see `markersFromAnswers`, which is also where a probability becomes a marker.
 */
export interface Probe {
  id: string;
  kind: Kind;
  statement: string;
  when_true: string;
  when_false: string;
  /** shown in the hover when this probe is the reason for the marker */
  label: string;
}

export const PROBES: Probe[] = [
  {
    id: "injection",
    kind: "security_risk",
    statement: "This code puts a value that came from outside into a SQL query, a shell command or a file path by building a string.",
    when_true: "The outside value is glued into the text with +, ||, an f-string, format! or Sprintf, so it becomes part of the query, command or path that runs.",
    when_false: "The outside value is handed over separately, as a bound parameter written ?, %s or $1, or as its own entry in an argument list, so it never becomes part of the text.",
    label: "injection",
  },
];

/** Ids of the probes that ship. A planted issue is judged only when one of them claims it. */
export const PROBE_IDS = new Set(PROBES.map((p) => p.id));

export const PROBES_BY_KIND: Record<Kind, Probe[]> = {
  probable_bug: [],
  security_risk: PROBES.filter((p) => p.kind === "security_risk"),
  misleading_name: [],
  dead_or_unreachable: [],
  performance_smell: [],
};

/** Severity labels for /classify, each described so the model can separate them. */
export const SEVERITY_LABELS: Record<SeverityChoice, string> = {
  ignore: "Nothing is wrong with this code.",
  info: "Minor or stylistic concern; the behaviour is correct.",
  warning: "A risk or smell that should be fixed but does not by itself break the program.",
  error: "A definite security hole or bug that produces wrong or dangerous behaviour.",
};

/** One API text: the language and the line itself, with nothing for the model to drift onto. */
export function bareText(lang: Language, line: string): string {
  return `${lang}: ${line.trim()}`;
}

/**
 * A line that only opens a block: a function or type header (`def f(...)`, `function f(...)`,
 * `fn f(...)`, a bash `name() {`), or a bare `try:` / `else {`. These carry no statement to
 * judge, and they were the demo's most common false positive (`def connect(...)` and `try:`
 * both scored above 0.75 on the injection probe).
 */
const STRUCTURAL =
  /^\s*(?:(?:export|default|pub(?:\([^)]*\))?|public|private|protected|static|async|unsafe|const)\s+)*(?:def|function|fn|func|class|struct|impl|trait|interface|enum|type)\b|^\s*\}?\s*(?:try|else|elif|finally|do|begin|switch|match)\s*(?:\([^)]*\))?\s*[:{]?\s*$|^\s*\w+\s*\(\s*\)\s*\{\s*$/;

/**
 * A plain field or bare-value line of a struct, enum or impl: `pub sku: String,`. Rust and Go
 * only, because in those two a `name: Type,` line is always a declaration. It declares nothing
 * to judge, and `pub sku: String,` was the worst false positive on the seed files (0.81).
 */
const FIELD = /^\s*(?:pub(?:\([^)]*\))?\s+)?\w+\s*:?\s*[\w<>:&[\]]+,?$/;

/**
 * Is this line worth one text in a batch? Every path into the API goes through here — the
 * whole-file scan and the edit path both — because the edit path used to skip the filter and
 * judged headers anyway: `pub fn fetch_item(conn: &Connection, sku: &str) -> String {` scored
 * 0.950 and drew an error on the function signature of the snippet the demo types for you.
 */
export function isSendable(line: string, lang: Language): boolean {
  if (!isJudgeable(line, lang)) return false;
  if (/^\s*(?:import|from|use|package|#!|source)\b/.test(line)) return false;
  // a Go import block is a run of bare quoted paths; they are not code to judge
  if (lang === "go" && /^\s*(?:[\w.]+\s+)?"[^"]*"$/.test(line)) return false;
  if (STRUCTURAL.test(line)) return false;
  if ((lang === "rust" || lang === "go") && FIELD.test(line)) return false;
  return true;
}

/**
 * Does this line hand something to a query, a command or a file path? The probe was measured
 * on contrasting pairs where both halves run one of those three. On a line that runs none of
 * them it has no safe twin to be scored against and drifts upward with the batch: a plain
 * `const line = "user=" + userId + " action=" + action;` came back at 0.947 and drew a red
 * security error on a logging file.
 *
 * So a regex answers the question a regex can answer — is there a sink at all? — and the model
 * answers the one it cannot: is the outside value glued into the text, or handed over bound?
 * Lines with no sink are still sent, because the batch composition is what the thresholds were
 * tuned on, but they can never raise a marker. See `markersFromAnswers`.
 */
export function hasSink(line: string, lang: Language): boolean {
  if (lang === "bash") return bashSink(line);
  if (hasQueryLiteral(line)) return true;
  // a command sink. Every name here is qualified: a bare `exec(` matched JavaScript's
  // RegExp.prototype.exec, and `const m = VERSION_RE.exec(tag + "-" + build);` scored 0.83-0.88
  // and drew a red injection error. Bare `spawn(`, `system(` and `eval(` were the same kind of
  // collision with task queues and unrelated APIs. `eval` keeps its own deterministic rule in
  // heuristics.ts, which is where a name-only match belongs.
  if (/\b(?:os\.system|subprocess\.\w+|child_process|execSync|execFileSync|execFile|spawnSync|exec\.Command|exec\.CommandContext|Command::new|shell_exec|passthru|popen)\s*\(/.test(line)) return true;
  // a query API handed a built string
  if (/\b(?:query|queryRow|QueryRow|Query|Exec|execute|executemany|prepare|rawQuery)\s*\(/.test(line)) return true;
  // a file path built for open / read / write / remove
  if (/\b(?:open|openSync|readFile|readFileSync|writeFile|writeFileSync|read_to_string|File::open|Path::new|PathBuf::from|os\.path\.join|path\.join|filepath\.Join|os\.remove|shutil\.\w+|unlink)\s*\(/.test(line)) return true;
  return false;
}

/** The glue forms, lifted from heuristics.ts RULES[2]: an f-string, `.format(`, `%` formatting,
 * `format!(` and `Sprintf(` all splice a value into a string without a `+` in sight. */
const INTERPOLATION = /\bf"[^"]*\{|\bf'[^']*\{|\.format\s*\(|\bformat!\s*\(|\bSprintf\s*\(|`[^`]*\$\{/;

/**
 * Is an outside value glued into this line's text? `hasSink` answers "is there a sink", the
 * model answers "bound or glued" — and between them nobody asks whether there is an outside
 * value at all. There is not, in the most ordinary safe database line there is:
 * `db.query("SELECT id, name FROM users WHERE active = true")` is a fixed literal with nothing
 * from outside anywhere on it, and it scored 0.780 on the edit path and 0.712-0.780 on the
 * scan path — a red "injection · security risk 78%" on a line that cannot be injected.
 * Restoring the fixed-literal clause to `when_false` does not move it (0.747-0.779, measured).
 *
 * So the third question is a regex too. A fixed literal and a `$1` / `?` / `%s` bound call both
 * have no glue and become unmarkable — which is exactly the safe half of every pair the probe
 * was measured on, so nothing it was proven to catch is lost.
 */
export function hasGlue(line: string, lang: Language): boolean {
  // in a shell script an unquoted expansion *is* the glue: the value is re-split and re-parsed
  if (lang === "bash") return bashSink(line);
  if (INTERPOLATION.test(line)) return true;
  // a string literal with `+`, `||` or `%` against it
  STRING_LITERAL.lastIndex = 0;
  for (let m = STRING_LITERAL.exec(line); m !== null; m = STRING_LITERAL.exec(line)) {
    if (/(?:\+|\|\||%)\s*$/.test(line.slice(0, m.index))) return true;
    if (/^\s*(?:\+|\|\||%)(?!=)/.test(line.slice(m.index + m[0].length))) return true;
  }
  return false;
}

/** String literals in source order. Scanning left to right is what pairs the quotes: a plain
 * `["'][^"']*verb` matches the gap *between* two literals, and read `.update(` in
 * `createHash("sha256").update(order.id + secret).digest("hex")` as a SQL query. */
const STRING_LITERAL = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;
const SQL_VERB = /\b(?:select|insert|update|delete|drop|alter|create|truncate|grant|execute|merge)\b/i;
const SQL_CLAUSE = /\b(?:from|into|set|where|values|table|join|view|index|database|column)\b/i;

/** Is one of this line's string literals a SQL statement? A verb alone is not enough — "update
 * complete" is a log message — so a clause keyword has to be in the same literal. */
function hasQueryLiteral(line: string): boolean {
  STRING_LITERAL.lastIndex = 0;
  for (let m = STRING_LITERAL.exec(line); m !== null; m = STRING_LITERAL.exec(line)) {
    if (SQL_VERB.test(m[0]) && SQL_CLAUSE.test(m[0])) return true;
  }
  return false;
}

/**
 * In a shell script every line is a command, so the sink is the expansion — but only an
 * unquoted one. `"migrations/$version.sql"` is the shell's own safe form: the value is passed
 * as one argument and is never re-split or re-parsed. `rm -rf $dir/*` and `$(cat $sql_file)`
 * are the unsafe forms, and they are exactly what the probe's pairs contrast.
 */
function bashSink(line: string): boolean {
  if (/\$\(|`|\beval\b/.test(line)) return true;
  let dq = false;
  let sq = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") i++;
    else if (c === "'" && !dq) sq = !sq;
    else if (c === '"' && !sq) dq = !dq;
    else if (c === "$" && !sq && !dq && /[\w{]/.test(line[i + 1] ?? "")) return true;
  }
  return false;
}

/** Every judgeable line of the file, in order; imports and block headers are never sent. */
export function scanLines(text: string, lang: Language): number[] {
  const all = text.split("\n");
  const out: number[] = [];
  for (let n = 1; n <= all.length; n++) if (isSendable(all[n - 1], lang)) out.push(n);
  return out;
}

/** Judgeable lines turned into refs; the caller batches them 32 at a time. */
export function buildRefs(text: string, lang: Language, lines: number[]): LineRef[] {
  const all = text.split("\n");
  return lines
    .filter((n) => n >= 1 && n <= all.length && isSendable(all[n - 1], lang))
    .map((n) => ({ line: n, text: all[n - 1], bare: bareText(lang, all[n - 1]), sink: hasSink(all[n - 1], lang), glue: hasGlue(all[n - 1], lang) }));
}

/** The texts one batch sends, the same for every probe. */
export function batchTexts(refs: LineRef[]): string[] {
  return refs.map((r) => r.bare);
}

export function severityFromChoice(choice: string, p: Record<string, number>): SeverityChoice {
  if (choice === "ignore" || choice === "info" || choice === "warning" || choice === "error") return choice;
  let best: SeverityChoice = "ignore";
  for (const k of ["ignore", "info", "warning", "error"] as const) if ((p[k] ?? 0) > (p[best] ?? 0)) best = k;
  return best;
}

export type ProbeAnswers = Partial<Record<string, YesNoResult[]>>;

/**
 * How a probability becomes a marker. The model orders lines within one call well but its
 * level is not comparable between calls: the same clean line scores 0.27 in a six-line batch
 * and 0.72 in a 32-line file batch. So a scan reads one call's answers as a ranking — the top
 * `SCAN_MAX` lines of that call, each within `SCAN_GAP` of its highest and above `SCAN_FLOOR`
 * — while the edit path, which judges a handful of lines with no ranking to stand on, falls
 * back to the absolute `RAISE` that the contrasting pairs measured. A file that needs two
 * batches is selected twice and the results unioned, because one call's scale is the only
 * scale a ranking may use; the caller never pools batches before calling this.
 */
export const RAISE = 0.75;
export const SCAN_FLOOR = 0.7;
export const SCAN_GAP = 0.2;
export const SCAN_MAX = 3;

/** Below this probability a kind is not shown in the hover. */
export const SHOW = 0.3;

export type Selection = "scan" | "edit";

/**
 * Zip one batch back onto its lines. `answers[probe.id][i]` answers `refs[i]`; `severity[i]`
 * is the /classify result for `refs[i]`. `mode` picks the rule above.
 */
export function markersFromAnswers(refs: LineRef[], answers: ProbeAnswers, severity: ClassifyResult[], mode: Selection = "scan"): Marker[] {
  const scored = refs.map((ref, i) => {
    const kinds: { kind: Kind; p: number; label: string }[] = [];
    for (const kind of KINDS) {
      let best = -1;
      let label = "";
      for (const probe of PROBES_BY_KIND[kind]) {
        const a = answers[probe.id]?.[i];
        if (a && a.probability > best) {
          best = a.probability;
          label = probe.label;
        }
      }
      if (best >= 0) kinds.push({ kind, p: best, label });
    }
    kinds.sort((x, y) => y.p - x.p);
    return { ref, i, kinds, reason: kinds[0]?.label ?? "", p: kinds[0]?.p ?? 0 };
  });

  // A marker needs both halves of the statement to be true deterministically: a sink to run
  // the text, and something glued into it. The model is only asked to settle the rest — is the
  // glued value part of the text that runs, or handed over bound? Both gates apply on both
  // paths, before any threshold is consulted.
  const eligible = scored.filter((x) => x.ref.sink && x.ref.glue);
  const top = Math.max(0, ...eligible.map((x) => x.p));
  const keep = new Set(
    mode === "edit"
      ? eligible.filter((x) => x.p >= RAISE).map((x) => x.ref.line)
      : eligible
          .filter((x) => x.p >= SCAN_FLOOR && x.p >= top - SCAN_GAP)
          .sort((a, b) => b.p - a.p)
          .slice(0, SCAN_MAX)
          .map((x) => x.ref.line),
  );

  const out: Marker[] = [];
  for (const x of scored) {
    if (!keep.has(x.ref.line)) continue;
    const sev = severity[x.i];
    const probs: Record<SeverityChoice, number> = { ignore: 0, info: 0, warning: 0, error: 0, ...(sev?.scores ?? {}) };
    const choice = sev ? severityFromChoice(sev.label, probs) : "ignore";
    // the probe decides whether the line is marked at all; /classify only grades how loud it is
    const chosen: Severity = x.p >= RAISE || choice === "error" ? "error" : "warning";
    const message = `${x.reason} · ${x.kinds
      .filter((k) => k.p >= SHOW)
      .map((k) => `${KIND_LABEL[k.kind]} ${Math.round(k.p * 100)}%`)
      .join(" · ")}`;
    out.push({ line: x.ref.line, severity: chosen, kinds: x.kinds, message, source: "dm1", severityProbabilities: probs });
  }
  return out;
}

/**
 * One diagnostic per defect. Warning/error markers on adjacent lines (gap <= `gap`) that share
 * the same top kind are one defect spilling over its neighbour: the strongest line keeps the
 * cluster's highest severity, the rest are demoted to info. `gap` is 1, not the original 2:
 * with a single kind shipping, every marker shares a kind, and two independent injections two
 * lines apart — a `%s`-built query and an `open("/etc/app/" + tpl)` — are not one defect.
 */
export function clusterMarkers(markers: Marker[], gap = 1): Marker[] {
  const sorted = [...markers].sort((a, b) => a.line - b.line);
  const out: Marker[] = [];
  let cluster: Marker[] = [];
  const flush = () => {
    if (cluster.length <= 1) {
      out.push(...cluster);
    } else {
      const primary = cluster.reduce((a, b) => (b.kinds[0].p > a.kinds[0].p ? b : a));
      const severity = cluster.reduce<Severity>((s, m) => (SEVERITY_RANK[m.severity] > SEVERITY_RANK[s] ? m.severity : s), "info");
      for (const m of cluster) out.push(m === primary ? { ...m, severity } : { ...m, severity: "info" });
    }
    cluster = [];
  };
  for (const m of sorted) {
    const prev = cluster.at(-1);
    const joins =
      prev !== undefined &&
      m.line - prev.line <= gap &&
      m.severity !== "info" &&
      prev.severity !== "info" &&
      m.kinds[0]?.kind === prev.kinds[0]?.kind &&
      m.source === "dm1" &&
      prev.source === "dm1";
    if (!joins) flush();
    cluster.push(m);
  }
  flush();
  return out;
}
