// Precision / recall of markers against planted issues (line-level).

import type { Kind, Marker, Severity } from "./markers.ts";
import { SEVERITY_RANK } from "./markers.ts";

export interface Planted {
  line: number;
  kind: Kind;
  note: string;
  /** id of the probe that claims this issue. No probe claims it -> it is never judged. */
  probe?: string;
}

/** The planted issues a shipped probe actually asks about. */
export function inScope(planted: Planted[], probeIds: Set<string>): Planted[] {
  return planted.filter((p) => p.probe !== undefined && probeIds.has(p.probe));
}

export interface Evaluation {
  tp: number;
  fp: number;
  fn: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  /** planted lines that were flagged with the planted kind among the top-2 kinds */
  kindMatches: number;
  flaggedLines: number[];
  missedLines: number[];
  falseLines: number[];
}

/**
 * A marker counts as a flag when its severity is at or above `minSeverity`. `ignore` holds the
 * lines of planted issues no probe asks about: flagging one of them is neither a hit nor a
 * false positive, so those markers are dropped before scoring rather than counted against it.
 */
export function evaluate(markers: Marker[], planted: Planted[], ignore: number[] = [], minSeverity: Severity = "warning"): Evaluation {
  const skip = new Set(ignore);
  const flagged = new Map<number, Marker>();
  for (const m of markers) if (!skip.has(m.line) && SEVERITY_RANK[m.severity] >= SEVERITY_RANK[minSeverity]) flagged.set(m.line, m);
  const plantedLines = new Map(planted.map((p) => [p.line, p]));
  let tp = 0;
  let kindMatches = 0;
  const falseLines: number[] = [];
  for (const [line, m] of flagged) {
    const p = plantedLines.get(line);
    if (p) {
      tp++;
      if (m.kinds.slice(0, 2).some((k) => k.kind === p.kind)) kindMatches++;
    } else falseLines.push(line);
  }
  const missedLines = [...plantedLines.keys()].filter((l) => !flagged.has(l));
  const fp = falseLines.length;
  const fn = missedLines.length;
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  return { tp, fp, fn, precision, recall, f1, kindMatches, flaggedLines: [...flagged.keys()].sort((a, b) => a - b), missedLines: missedLines.sort((a, b) => a - b), falseLines: falseLines.sort((a, b) => a - b) };
}

export function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}
