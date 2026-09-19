// Everything the launcher does without the model: fuzzy prefilter, arithmetic, time windows,
// ranking and the request bodies. Ported from Fuzzy.swift, Calculator.swift, TimeWindow.swift
// and Ranker.swift, nearly line for line. No network here; Demo.tsx and smoke.mjs share it.

// The .ts extension keeps `node src/demos/launcher/smoke.mjs` working (Node strips types but
// does not guess extensions); Vite resolves it the same way.
import type { Candidate, Kind } from "./data.ts";

// ---------------------------------------------------------------- Fuzzy.swift

export const STOPWORDS = new Set([
  "the", "a", "an", "i", "my", "me", "to", "of", "that", "just", "please", "open", "launch",
  "run", "go", "show", "find", "get", "up", "it", "ve", "s", "d", "ll", "re", "m", "in", "on",
  "from", "for", "with", "all", "every", "everything", "any", "and", "was", "were", "been",
  "have", "had", "ive", "did", "about", "at", "page", "pages", "site", "sites", "stuff",
  "thing", "things", "read", "looked", "saw", "some", "those", "these", "them", "this",
]);

export function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}-]+/u).filter(Boolean);
}

function searchTerms(c: Candidate): string[] {
  return [...tokens(c.title.replace(/-/g, " ")), ...c.keywords.map((k) => k.toLowerCase())];
}

/**
 * True when the query's last word is only a prefix of what it matched: the user is mid-word.
 * "sle" is half-typed against Sleep; "sleep" and "dark" are not, and "the pdf I just downloaded"
 * ends on a whole keyword. Nothing else separates a confident half-word from a finished query.
 */
export function halfTyped(query: string, c: Candidate): boolean {
  const all = tokens(query);
  const last = all[all.length - 1];
  if (!last) return false;
  const terms = searchTerms(c);
  return !terms.includes(last) && terms.some((t) => t.startsWith(last));
}

/** Fraction of adjacent matches when `needle` is a subsequence of `haystack`; null if it is not. */
export function subsequenceContiguity(needle: string, haystack: string): number | null {
  let n = 0;
  let last = -2;
  let adjacent = 0;
  for (let i = 0; i < haystack.length && n < needle.length; i++) {
    if (haystack[i] === needle[n]) {
      if (last + 1 === i) adjacent++;
      last = i;
      n++;
    }
  }
  if (n < needle.length) return null;
  return needle.length > 1 ? adjacent / (needle.length - 1) : 1;
}

function bestMatch(token: string, terms: string[], joinedTitle: string, initials: string): number {
  let best = 0;
  for (const term of terms) {
    if (term === token) return 1;
    if (term.startsWith(token)) best = Math.max(best, 0.8 + (0.15 * token.length) / term.length);
  }
  if (best > 0) return best;
  if (token.length >= 2 && initials.startsWith(token)) return 0.7;
  if (joinedTitle.includes(token)) return 0.55;
  if (token.length >= 3) {
    const contiguity = subsequenceContiguity(token, joinedTitle);
    if (contiguity !== null) return 0.2 + 0.2 * contiguity;
  }
  return 0;
}

/** Score in 0…1. Zero means the candidate should not be shown for this query. */
export function fuzzyScore(query: string, candidate: Candidate): number {
  const all = tokens(query);
  if (all.length === 0) return 0;
  let meaningful = all.filter((t) => !STOPWORDS.has(t));
  if (meaningful.length === 0) meaningful = all;

  const terms = searchTerms(candidate);
  const titleTokens = tokens(candidate.title);
  const joinedTitle = titleTokens.join("");
  const initials = titleTokens.map((t) => t[0]).join("");

  let total = 0;
  let unmatched = 0;
  for (const token of meaningful) {
    const best = bestMatch(token, terms, joinedTitle, initials);
    if (best === 0) unmatched++;
    total += best;
  }
  if (total === 0) return 0;
  let score = total / meaningful.length;
  if (unmatched > 0) score *= 0.5;
  score += 0.02 * Math.max(0, 1 - candidate.title.length / 40); // prefer shorter titles on ties
  return Math.min(1, score);
}

// ----------------------------------------------------------- Calculator.swift

export interface Evaluation {
  expression: string;
  value: number;
  formatted: string;
}

export function evaluate(raw: string): Evaluation | null {
  let text = raw.trim().toLowerCase();
  for (const prefix of ["calculate ", "calc ", "= ", "="]) {
    if (text.startsWith(prefix)) {
      text = text.slice(prefix.length);
      break;
    }
  }
  text = text
    .replaceAll(" percent of ", "% of ")
    .replaceAll("% of ", "%*")
    .replaceAll("percent", "%")
    .replaceAll(",", "")
    .replaceAll("×", "*")
    .replaceAll("÷", "/")
    .trim();
  if (!/[0-9]/.test(text)) return null;
  if (!/[+\-*/^%x(]/.test(text) && !text.startsWith("sqrt")) return null;

  const chars = text.replaceAll(" ", "");
  let pos = 0;
  const current = () => (pos < chars.length ? chars[pos] : null);

  const applyPercent = (value: number): number => {
    if (current() === "%") {
      pos++;
      return value / 100;
    }
    return value;
  };
  const parsePrimary = (): number | null => {
    if (current() === "(") {
      pos++;
      const inner = parseExpression();
      if (inner === null || current() !== ")") return null;
      pos++;
      return applyPercent(inner);
    }
    if (chars.startsWith("sqrt(", pos)) {
      pos += 5;
      const inner = parseExpression();
      if (inner === null || current() !== ")" || inner < 0) return null;
      pos++;
      return applyPercent(Math.sqrt(inner));
    }
    const start = pos;
    while (current() !== null && /[0-9.]/.test(current()!)) pos++;
    if (pos === start) return null;
    const n = Number(chars.slice(start, pos));
    if (Number.isNaN(n)) return null;
    return applyPercent(n);
  };
  const parsePower = (): number | null => {
    const base = parsePrimary();
    if (base === null) return null;
    if (current() === "^") {
      pos++;
      const exponent = parseUnary();
      return exponent === null ? null : Math.pow(base, exponent);
    }
    return base;
  };
  const parseUnary = (): number | null => {
    if (current() === "-") {
      pos++;
      const inner = parseUnary();
      return inner === null ? null : -inner;
    }
    return parsePower();
  };
  const parseTerm = (): number | null => {
    let value = parseUnary();
    if (value === null) return null;
    for (let op = current(); op === "*" || op === "/" || op === "x"; op = current()) {
      pos++;
      const rhs = parseUnary();
      if (rhs === null) return null;
      if (op === "/") {
        if (rhs === 0) return null;
        value /= rhs;
      } else value *= rhs;
    }
    return value;
  };
  function parseExpression(): number | null {
    let value = parseTerm();
    if (value === null) return null;
    for (let op = current(); op === "+" || op === "-"; op = current()) {
      pos++;
      const rhs = parseTerm();
      if (rhs === null) return null;
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  const value = parseExpression();
  if (value === null || pos < chars.length || !Number.isFinite(value)) return null;
  return { expression: raw.trim(), value, formatted: formatNumber(value) };
}

export function formatNumber(value: number): string {
  if (value === Math.round(value) && Math.abs(value) < 1e15) return String(value);
  return String(Number(value.toFixed(6)));
}

// ----------------------------------------------------------- TimeWindow.swift

export interface TimeWindow {
  /** The words that expressed the window, exactly as typed. */
  phrase: string;
  /** Oldest age that still counts, in minutes. */
  sinceMinutes: number;
  /** Newest age that still counts, in minutes; 0 means up to now. */
  untilMinutes: number;
  /** The query with the window phrase removed, for fuzzy matching against titles. */
  remainder: string;
}

const UNIT_MINUTES: Record<string, number> = {
  minute: 1, minutes: 1, min: 1, mins: 1,
  hour: 60, hours: 60, hr: 60, hrs: 60, h: 60,
  day: 1440, days: 1440,
  week: 10080, weeks: 10080,
  month: 43200, months: 43200,
};

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, couple: 2, few: 3,
};

const RELATIVE =
  /\b(?:(?:in|from|within|over|during)\s+)?(?:the\s+)?(?:past|last|previous|recent)\s+(?:(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|couple(?:\s+of)?|few)\s+)?([a-z]+)\b/i;

const NAMED =
  /\b(?:(?:from|since|during|on)\s+)?(today|yesterday|this\s+morning|this\s+afternoon|this\s+evening|tonight|this\s+week|this\s+month|last\s+week|last\s+month|last\s+night|earlier\s+today|just\s+now|recently)\b/i;

/** Minutes since local midnight, for the named windows. Fixed hour keeps the demo reproducible. */
const MINUTES_SINCE_MIDNIGHT = 15 * 60;

export function parseWindow(query: string): TimeWindow | null {
  const relative = RELATIVE.exec(query);
  if (relative) {
    const unit = UNIT_MINUTES[relative[2]!.toLowerCase()];
    if (unit) {
      const word = (relative[1] ?? "").toLowerCase().replace(" of", "");
      const count = Number(word) || NUMBER_WORDS[word] || 1;
      return {
        phrase: relative[0],
        sinceMinutes: count * unit,
        untilMinutes: 0,
        remainder: removePhrase(query, relative[0]),
      };
    }
  }
  const named = NAMED.exec(query);
  if (named) {
    const key = named[1]!.toLowerCase().split(/\s+/).join(" ");
    const startOfToday = MINUTES_SINCE_MIDNIGHT;
    let since = startOfToday;
    let until = 0;
    switch (key) {
      case "yesterday":
      case "last night":
        since = startOfToday + 1440;
        until = startOfToday;
        break;
      case "this week":
        since = startOfToday + 3 * 1440;
        break;
      case "last week":
        since = startOfToday + 10 * 1440;
        until = startOfToday + 3 * 1440;
        break;
      case "this month":
        since = startOfToday + 18 * 1440;
        break;
      case "last month":
        since = startOfToday + 48 * 1440;
        until = startOfToday + 18 * 1440;
        break;
      case "just now":
        since = 15;
        break;
      case "recently":
        since = 3 * 1440;
        break;
      default: // today, this morning/afternoon/evening, tonight, earlier today
        since = startOfToday;
    }
    return { phrase: named[0], sinceMinutes: since, untilMinutes: until, remainder: removePhrase(query, named[0]) };
  }
  return null;
}

function removePhrase(query: string, phrase: string): string {
  return query.replace(phrase, " ").split(/\s+/).filter(Boolean).join(" ");
}

export function windowContains(window: TimeWindow, ageMinutes: number): boolean {
  return ageMinutes <= window.sinceMinutes && ageMinutes >= window.untilMinutes;
}

// --------------------------------------------------------------- Ranker.swift

export const PREFILTER_LIMIT = 13;
export const WINDOWED_PREFILTER_LIMIT = 30;
export const MINIMUM_FUZZY = 0.15;
export const WINDOWED_MINIMUM_FUZZY = 0.05;
export const WEB_SEARCH_ID = "web:search";
export const CALCULATION_ID = "calc:result";
export const GROUP_ID = "group:all";

// Thresholds re-tuned on decision-machine-1 with src/demos/launcher/smoke.mjs; the model is
// calibrated differently from the Jev original, so the Swift numbers do not carry over.
/** How far the model must lean toward "all" before the group row leads the list. */
export const SET_THRESHOLD = 0.25;
/** A candidate joins the set when the model is at least this sure it fits the description. */
export const MEMBER_THRESHOLD = 0.5;
/** Below this the query reads as clearly singular and no group row is offered. */
export const OFFER_THRESHOLD = 0.1;
export const MINIMUM_SET_SIZE = 2;
export const MAXIMUM_SET_SIZE = 25;
/** The top row is ready to run on Enter at this readiness, or at this target certainty. */
export const READY_THRESHOLD = 0.7;
/** The certain-target rescue: a target this high, not hedged, and this far clear of the runner-up. */
export const CERTAIN_TARGET = 0.75;
export const CERTAIN_READY = 0.45;
export const CERTAIN_MARGIN = 0.5;
export const GROUP_READY_THRESHOLD = 0.3;

/** The browser demo drops the `action` question; its 0.20 weight goes to fuzzy. */
export const TARGET_WEIGHT = 0.65;
export const FUZZY_WEIGHT = 0.35;
export const SET_MEMBER_WEIGHT = 0.25;

export interface Prefiltered {
  candidates: Candidate[];
  fuzzy: Record<string, number>;
  window: TimeWindow | null;
  /** The query is a bare time window ("everything from the past hour"): the window IS the set. */
  windowOnly: boolean;
}

export interface Judgment {
  /** P(target) per candidate id, from the classify `scores` map. Missing id: no judgment. */
  target: Record<string, number>;
  /** P(this row fits the description) per candidate id, from the yes-no batch. */
  match: Record<string, number>;
  /** P(the query means all of them), from the scope classify. */
  setProbability: number;
  /** P(the query already means exactly one candidate), from the ready yes-no. */
  ready: number;
}

export interface Hit {
  candidate: Candidate;
  fuzzy: number;
  target: number | null;
  match: number | null;
  inSet: boolean;
  score: number;
}

/**
 * Fuzzy-scores the whole index, keeps the top-k, then appends the synthetic rows (a calculation
 * when the query parses, and a web search for any non-empty query). A time window in the query
 * is applied here, in code: items outside it are never sent.
 */
export function prefilter(query: string, index: Candidate[]): Prefiltered {
  const trimmed = query.trim();
  if (!trimmed) return { candidates: [], fuzzy: {}, window: null, windowOnly: false };
  const window = parseWindow(trimmed);
  const matchQuery = (window?.remainder ?? trimmed).trim();
  // "everything from the past hour": nothing describable is left once stopwords go.
  const windowOnly = window !== null && tokens(matchQuery).every((t) => STOPWORDS.has(t));
  const limit = window ? WINDOWED_PREFILTER_LIMIT : PREFILTER_LIMIT;
  const floor = window ? WINDOWED_MINIMUM_FUZZY : MINIMUM_FUZZY;

  const scored: Array<[Candidate, number]> = [];
  for (const candidate of index) {
    // Timeless items (apps, toggles) stay eligible; dated items must fall in the window.
    if (window && candidate.ageMinutes !== undefined && !windowContains(window, candidate.ageMinutes)) continue;
    let score: number;
    if (windowOnly) {
      if (candidate.ageMinutes === undefined) continue;
      score = 0.5;
    } else {
      score = fuzzyScore(matchQuery, candidate);
    }
    if (score >= floor) scored.push([candidate, score]);
  }
  scored.sort((a, b) => {
    if (a[1] !== b[1]) return b[1] - a[1];
    const ageA = a[0].ageMinutes ?? Infinity;
    const ageB = b[0].ageMinutes ?? Infinity;
    if (ageA !== ageB) return ageA - ageB;
    return a[0].title.localeCompare(b[0].title);
  });

  const candidates: Candidate[] = [];
  const fuzzy: Record<string, number> = {};
  const calc = evaluate(trimmed);
  if (calc) {
    candidates.push({
      id: CALCULATION_ID,
      title: `= ${calc.formatted}`,
      subtitle: `${calc.expression} · Enter copies the result`,
      kind: "calculate",
      keywords: [],
      result: calc.formatted,
    });
    fuzzy[CALCULATION_ID] = 0.95;
  }
  for (const [candidate, score] of scored.slice(0, limit)) {
    candidates.push(candidate);
    fuzzy[candidate.id] = score;
  }
  candidates.push({
    id: WEB_SEARCH_ID,
    title: `Search the web for “${trimmed}”`,
    subtitle: "Opens your default browser",
    kind: "web_search",
    keywords: [],
  });
  fuzzy[WEB_SEARCH_ID] = 0.1;
  return { candidates, fuzzy, window, windowOnly };
}

/** Candidate ids the model judged to fit the description, bounded in size. */
export function setMembers(pre: Prefiltered, judgment: Judgment | null): Set<string> {
  if (!judgment || judgment.setProbability < OFFER_THRESHOLD) return new Set();
  // A bare window query asks nothing: prefilter() already proved every dated row is inside the window,
  // so the window filter IS the membership test and no match call is made for it.
  const eligible = pre.candidates.filter(
    (c) =>
      c.id !== WEB_SEARCH_ID &&
      c.id !== CALCULATION_ID &&
      (pre.windowOnly || (judgment.match[c.id] ?? 0) >= MEMBER_THRESHOLD),
  );
  eligible.sort((a, b) => (judgment.match[b.id] ?? 0) - (judgment.match[a.id] ?? 0));
  if (eligible.length < MINIMUM_SET_SIZE) return new Set();
  return new Set(eligible.slice(0, MAXIMUM_SET_SIZE).map((c) => c.id));
}

/** "pages" / "files" / "apps" when the rows agree on a kind, "items" otherwise. */
function nounFor(members: Candidate[], plural = true): string {
  const kinds = new Set(members.map((m) => m.kind));
  const kind = kinds.size === 1 ? [...kinds][0] : null;
  const noun =
    kind === "open_url" ? "page" : kind === "open_file" ? "file" : kind === "open_app" ? "app" : "item";
  return plural ? `${noun}s` : noun;
}

export function groupCandidate(members: Candidate[]): Candidate {
  const kinds = new Set(members.map((m) => m.kind));
  const kind: Kind = kinds.size === 1 ? [...kinds][0]! : "group";
  const noun = kind === "open_url" ? "links" : kind === "open_file" ? "files" : kind === "open_app" ? "apps" : "items";
  const names = members.slice(0, 3).map((m) => m.title).join(", ");
  const more = members.length > 3 ? ` and ${members.length - 3} more` : "";
  return {
    id: GROUP_ID,
    title: `Open all ${members.length} ${noun}`,
    subtitle: names + more,
    kind: "group",
    keywords: [],
    members,
  };
}

/**
 * Merges fuzzy scores with the model's judgment. With no judgment the order is pure fuzzy, so
 * the list is always sensible and never waits on the network.
 */
export function rank(pre: Prefiltered, judgment: Judgment | null): Hit[] {
  const members = setMembers(pre, judgment);
  const hits: Hit[] = pre.candidates.map((candidate) => {
    const fuzzy = pre.fuzzy[candidate.id] ?? 0;
    if (!judgment) return { candidate, fuzzy, target: null, match: null, inSet: false, score: fuzzy };
    const target = judgment.target[candidate.id] ?? null;
    const match = judgment.match[candidate.id] ?? null;
    const inSet = members.has(candidate.id);
    let score = TARGET_WEIGHT * (target ?? 0) + FUZZY_WEIGHT * fuzzy;
    // match is null only on a bare window query, where membership is certain by construction.
    if (inSet) score += SET_MEMBER_WEIGHT * judgment.setProbability * (match ?? 1);
    return { candidate, fuzzy, target, match, inSet, score };
  });
  hits.sort((a, b) => b.score - a.score || a.candidate.title.localeCompare(b.candidate.title));
  if (!judgment || members.size === 0) return hits;

  const ordered = hits.filter((h) => members.has(h.candidate.id)).map((h) => h.candidate);
  const group: Hit = {
    candidate: groupCandidate(ordered),
    fuzzy: 0,
    target: judgment.setProbability,
    match: null,
    inSet: false,
    score: judgment.setProbability,
  };
  if (judgment.setProbability >= SET_THRESHOLD) {
    // With no single target to pick, the target choice leaks onto the web-search fallback;
    // keep it last so the members sit under the group row.
    const web = hits.findIndex((h) => h.candidate.id === WEB_SEARCH_ID);
    if (web >= 0) hits.push(hits.splice(web, 1)[0]!);
    hits.unshift(group);
  } else {
    hits.splice(Math.min(1, hits.length), 0, group);
  }
  return hits;
}

/**
 * The top row runs on Enter when readiness is high. Below that, one rescue: a target this certain,
 * this far clear of the runner-up, on a query the user has finished typing. The rescue exists for
 * "the pdf I just downloaded", where readiness hedges at 0.49 while the target sits at 78% against
 * 10%. Each guard earns its place on a measured case the original marks NOT ready: the margin drops
 * "wifi" (61 vs 37), the readiness floor drops "da" (0.35), and half-typed drops "sle", which the
 * model scores 91% on Sleep at readiness 0.57 — confident, but the user is still mid-word.
 */
export function isReady(hits: Hit[], judgment: Judgment | null, query = ""): boolean {
  if (!judgment || hits.length === 0) return false;
  const top = hits[0]!;
  if (top.candidate.id === GROUP_ID) return judgment.setProbability >= GROUP_READY_THRESHOLD;
  if (judgment.ready >= READY_THRESHOLD) return true;
  const target = top.target ?? 0;
  const second = hits.slice(1).reduce((best, h) => Math.max(best, h.target ?? 0), 0);
  return (
    target >= CERTAIN_TARGET &&
    judgment.ready >= CERTAIN_READY &&
    target - second >= CERTAIN_MARGIN &&
    !halfTyped(query, top.candidate)
  );
}

// --------------------------------------------------- Request bodies (dm1_mapping)

/** Queries that describe several things get the scope and match calls; the rest stay at 2 calls. */
const SET_WORDS = /\b(all|every|everything|links|files|pages|items|tabs|docs|photos|apps|them|these|those)\b/i;

export function looksLikeSet(query: string, window: TimeWindow | null): boolean {
  return window !== null || SET_WORDS.test(query);
}

/**
 * Each label describes what the query would have to mean for that row to be the answer, because
 * classify picks the label that describes the text. Descriptions that read as commands ("Open
 * the file …") or that mention the web fallback pull every query onto the fallback, so the web
 * row never gets a label: it has no chance of being "what the query names" and it always ranks
 * last on fuzzy alone.
 */
function labelFor(c: Candidate): string {
  switch (c.kind) {
    case "open_app":
      return `The query names the app ${c.title}.`;
    case "open_file":
      return `The query describes the file ${c.title} (${c.subtitle.replace(" · ", ", ")}).`;
    case "open_url":
      return `The query describes the web page "${c.title}" (${c.subtitle.replace(" · ", ", ")}).`;
    case "system_toggle":
      return `The query names the system setting "${c.title}" (${c.subtitle.toLowerCase()}).`;
    case "run_shortcut":
      return `The query names the shortcut ${c.title}.`;
    case "calculate":
      return `The query is arithmetic whose answer is ${c.title.replace("= ", "")}.`;
    default:
      return `The query names ${c.title}.`;
  }
}

/** classify: which row does the user mean? The `scores` map becomes P(target) per row. */
export function targetBody(query: string, candidates: Candidate[]) {
  const real = candidates.filter((c) => c.id !== WEB_SEARCH_ID);
  const labels: Record<string, string> = {};
  const ids: string[] = [];
  real.forEach((c, i) => {
    labels[`c${i}`] = labelFor(c);
    ids.push(c.id);
  });
  // classify needs two options; with a single local row, "none" is the other one.
  if (real.length < 2) labels["none"] = "The query names something that is not in this list.";
  return { text: `"${query}"`, labels, ids };
}

/** Maps the c0…cN scores back onto candidate ids. */
export function targetScores(scores: Record<string, number>, ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  ids.forEach((id, i) => {
    const value = scores[`c${i}`];
    if (value !== undefined) out[id] = value;
  });
  return out;
}

function shortList(candidates: Candidate[]): string {
  return candidates
    .map((c) => (c.id === WEB_SEARCH_ID ? "a web search (fallback only)" : `${c.title} (${c.subtitle})`))
    .join("; ");
}

/** yes-no: is the query already unambiguous enough to run the top row on Enter? */
export function readyBody(query: string, candidates: Candidate[]) {
  return {
    text: `Query: "${query}". The complete list of items the launcher can run: ${shortList(candidates)}.`,
    statements: ["The query is specific enough to run the best-matching item straight away."],
    when_true: "One listed item is the obvious meaning, so running it would not surprise the user.",
    when_false: "Several listed items fit, so the user still has to pick one from the list.",
  };
}

/** classify: one item, or every item that fits? `scores.all` is P(all). */
export function scopeBody(query: string) {
  return {
    text: `Launcher query: "${query}"`,
    labels: {
      one: "The user wants exactly one specific item: a singular noun, a name, or 'the X I just ...'.",
      all: "The user wants every item that fits: plural nouns, all, every, the links, the files, or a period of activity like 'pages I visited today'.",
    },
  };
}

/**
 * yes-no with up to 32 statements: one per real candidate, replacing N separate calls. Three things
 * had to be right before the answers separated (measured, see smoke.mjs):
 *
 *  - The text is the window remainder — "open devin ambassador links I visited" — never the whole
 *    query plus a note that the window "is already applied in code". Describing machinery the model
 *    cannot see dragged the literal announcement page down to 0.18.
 *  - Each statement asks what the user MEANT, not whether the row "matches the query". The latter
 *    reads as a relevance essay and punishes short, on-topic titles; "is what the user meant" is the
 *    question a launcher actually asks. Announcement page: 0.18 → 0.94.
 *  - The second field is the full URL when there is one, not the bare host. On the host alone the
 *    model scored pages by whether the domain said "devin", so cognition.ai lost and Hacker News
 *    crept to 0.53; the path ("/blog/devin-ambassador-program") settles it.
 */
export function matchBody(query: string, window: TimeWindow | null, candidates: Candidate[]) {
  const described = (window?.remainder ?? query).trim() || query.trim();
  const noun = nounFor(candidates, false);
  return {
    text: `The user's words: "${described}"`,
    statements: candidates.map(
      // Without a URL the subtitle's first field is the folder or the kind; the age is noise here.
      (c) => `The ${noun} "${c.title}" (${c.url ?? c.subtitle.split(" · ")[0]}) is what the user meant.`,
    ),
    when_true: `The ${noun} is what the user meant.`,
    when_false: `The ${noun} is not what the user meant.`,
  };
}

/** Real candidates only: the web search and calculator rows never join a set. */
export function matchCandidates(pre: Prefiltered): Candidate[] {
  return pre.candidates.filter((c) => c.id !== WEB_SEARCH_ID && c.id !== CALCULATION_ID).slice(0, 32);
}

/** Nothing but the web-search fallback: there is no judgment to ask for. */
export function hasLocalRow(pre: Prefiltered): boolean {
  return pre.candidates.some((c) => c.id !== WEB_SEARCH_ID);
}

// ------------------------------------------------------------ LatencyStats.swift

export function percentile(samples: number[], p: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.round(((sorted.length - 1) * p) / 100);
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)]!;
}
