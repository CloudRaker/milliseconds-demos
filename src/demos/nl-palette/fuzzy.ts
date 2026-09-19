import type { Command } from "./data.ts";

/**
 * fzf-style fuzzy scoring (Smith–Waterman-like, greedy forward pass with the
 * fzf v1 bonus scheme): all pattern characters must appear in order in the
 * text; consecutive matches and matches on word boundaries score higher.
 * Returns null when the pattern does not match at all.
 */
const SCORE_MATCH = 16;
const SCORE_GAP_START = -3;
const SCORE_GAP_EXTENSION = -1;
const BONUS_BOUNDARY = SCORE_MATCH / 2;
const BONUS_CAMEL = BONUS_BOUNDARY - 1;
const BONUS_CONSECUTIVE = -(SCORE_GAP_START + SCORE_GAP_EXTENSION);
const BONUS_FIRST_CHAR_MULTIPLIER = 2;

function charClass(ch: string): "lower" | "upper" | "digit" | "space" | "other" {
  if (ch >= "a" && ch <= "z") return "lower";
  if (ch >= "A" && ch <= "Z") return "upper";
  if (ch >= "0" && ch <= "9") return "digit";
  if (ch === " " || ch === "_" || ch === "-" || ch === "/" || ch === ".") return "space";
  return "other";
}

function bonusAt(text: string, i: number): number {
  const cur = charClass(text[i]);
  if (i === 0) return cur === "space" ? 0 : BONUS_BOUNDARY;
  const prev = charClass(text[i - 1]);
  if (prev === "space" && cur !== "space") return BONUS_BOUNDARY;
  if (prev === "lower" && cur === "upper") return BONUS_CAMEL;
  if (prev !== "digit" && cur === "digit") return BONUS_CAMEL;
  return 0;
}

export interface Match {
  score: number;
  /** Index in `text` where the match begins (used as a tie-break, like fzf's `--tiebreak=begin`). */
  start: number;
}

export function fuzzyMatch(pattern: string, text: string): Match | null {
  const p = pattern.toLowerCase();
  const t = text.toLowerCase();
  if (p.length === 0) return { score: 0, start: 0 };

  // forward pass: find the first feasible alignment
  let pi = 0;
  let start = -1;
  let end = -1;
  for (let ti = 0; ti < t.length && pi < p.length; ti++) {
    if (t[ti] === p[pi]) {
      if (start < 0) start = ti;
      pi++;
      end = ti;
    }
  }
  if (pi < p.length) return null;

  // backward pass tightens the window (fzf v1 behaviour)
  pi = p.length - 1;
  for (let ti = end; ti >= start; ti--) {
    if (t[ti] === p[pi]) {
      pi--;
      if (pi < 0) {
        start = ti;
        break;
      }
    }
  }

  // score the window greedily
  let score = 0;
  let inGap = false;
  let consecutive = 0;
  let firstBonus = 0;
  pi = 0;
  for (let ti = start; ti <= end && pi < p.length; ti++) {
    if (t[ti] === p[pi]) {
      score += SCORE_MATCH;
      let bonus = bonusAt(text, ti);
      if (consecutive === 0) firstBonus = bonus;
      else {
        if (bonus === BONUS_BOUNDARY) firstBonus = bonus;
        bonus = Math.max(bonus, firstBonus, BONUS_CONSECUTIVE);
      }
      score += pi === 0 ? bonus * BONUS_FIRST_CHAR_MULTIPLIER : bonus;
      inGap = false;
      consecutive++;
      pi++;
    } else {
      score += inGap ? SCORE_GAP_EXTENSION : SCORE_GAP_START;
      inGap = true;
      consecutive = 0;
      firstBonus = 0;
    }
  }
  return { score, start };
}

export interface FuzzyResult {
  command: Command;
  score: number;
  start: number;
}

/**
 * Ranks commands like a classic palette: each whitespace-separated term is
 * fuzzy-matched against the command title (and, at a discount, its id); every
 * term must match somewhere. Commands whose title contains no matching term
 * are dropped, so a query about the *effect* ("make this louder") usually
 * returns nothing useful — which is the problem Jev solves.
 */
export function fuzzyRank(query: string, commands: readonly Command[]): FuzzyResult[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results: FuzzyResult[] = [];
  for (const command of commands) {
    let total = 0;
    let start = 0;
    let ok = true;
    for (const term of terms) {
      const onTitle = fuzzyMatch(term, command.title);
      const onId = fuzzyMatch(term, command.id.replace(/_/g, " "));
      const idScore = onId === null ? -Infinity : onId.score * 0.9;
      const titleScore = onTitle?.score ?? -Infinity;
      if (titleScore === -Infinity && idScore === -Infinity) {
        ok = false;
        break;
      }
      if (titleScore >= idScore) {
        total += titleScore;
        start = Math.max(start, onTitle!.start);
      } else {
        total += idScore;
        start = Math.max(start, onId!.start);
      }
    }
    if (ok && terms.length > 0) results.push({ command, score: total, start });
  }
  results.sort(
    (a, b) => b.score - a.score || a.start - b.start || a.command.title.length - b.command.title.length || a.command.title.localeCompare(b.command.title),
  );
  return results;
}
