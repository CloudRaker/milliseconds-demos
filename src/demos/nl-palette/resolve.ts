// Turns one /classify response over the 64 command labels into the ranked list the
// palette shows. Ported from the experiment's resolve.ts; the only change is the
// source of the probabilities: Jev returned a choice distribution, DM1 returns `scores`.
import { COMMAND_BY_ID, type ArgSlot, type Command } from "./data.ts";

export interface RankedCommand {
  command: Command;
  probability: number;
  /** Argument for this command's slot, filled by the chained second classify. */
  arg?: string;
  argProbability?: number;
}

export type Gate = "confident" | "uncertain";

export const CONFIDENCE_GATE = 0.55;
export const DESTRUCTIVE_GATE = 0.5;

export function describeArg(slot: ArgSlot, value: string): string {
  switch (slot) {
    case "font_size_delta":
      return `by ${value} pt`;
    case "theme":
      return `to ${value.replace("_", " ")}`;
    case "heading_level":
      return `to H${value}`;
    case "export_format":
      return `as ${value.replace("_", " ").toUpperCase()}`;
  }
}

/** Label shown for a ranked command, e.g. "Change Font Size by +2 pt". */
export function previewLabel(r: { command: Command; arg?: string }): string {
  if (r.command.arg && r.arg) return `${r.command.title} ${describeArg(r.command.arg, r.arg)}`;
  return r.command.title;
}

/** Sorted, top-N view of one level's per-label scores. */
export function rank(scores: Record<string, number>, topN = 8): RankedCommand[] {
  return Object.entries(scores ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .flatMap(([id, probability]) => {
      const command = COMMAND_BY_ID.get(id);
      return command ? [{ command, probability }] : [];
    });
}

export function gateOf(probability: number): Gate {
  return probability >= CONFIDENCE_GATE ? "confident" : "uncertain";
}

/** Words that name a theme. "give me a different look" has none of them. */
const THEME_WORDS = /night|dark|black|dim|day|light|bright|white|warm|paper|parchment|sepia|vintage|contrast|accessib|legib/i;

/**
 * The theme slot has one rule the model cannot see: "give me a different look"
 * names no theme, so flip away from the current one. The model always ranks some
 * theme first (dark wins by ~0.4 even on "i'm bored of these colours"), so the
 * query decides, not the score gap.
 */
export function pickTheme(scores: Record<string, number>, current: string, query = ""): string {
  const flipped = current === "light" ? "dark" : "light";
  if (!THEME_WORDS.test(query)) return flipped;
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [top, second] = sorted;
  if (!top) return flipped;
  // Still flat after a named theme: nothing stood out, so flip.
  if (second && top[1] - second[1] < 0.15) return flipped;
  return top[0];
}
