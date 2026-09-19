/**
 * How a cell value draws. Ported from the Jev experiment's src/ui/format.ts,
 * with the Google Sheets pastel fills swapped for translucent tints that work
 * on the dark milliseconds.ai surface.
 */
import { formatNumber, isError, isJev, type Value } from "./engine/values.ts";

export type CellView = { text: string; className: string; style?: React.CSSProperties; title?: string };

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

const RED = [255, 122, 122];
const AMBER = [240, 179, 90];
const GREEN = [111, 220, 140];
/** Label fills, in the order the schema lists its options. */
const PICK_FILLS = [
  [122, 162, 255],
  [167, 139, 250],
  [240, 179, 90],
  [111, 220, 140],
  [232, 196, 104],
  [238, 130, 190],
  [104, 206, 214],
  [255, 122, 122],
];

const mix = (a: number[], b: number[], t: number) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
const rgba = (c: number[], alpha: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha.toFixed(3)})`;

/** red (0) → amber (0.5) → green (1). */
function diverging(t: number, alpha: number): string {
  const x = clamp01(t);
  return rgba(x < 0.5 ? mix(RED, AMBER, x * 2) : mix(AMBER, GREEN, (x - 0.5) * 2), alpha);
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function viewOf(v: Value): CellView {
  if (v === null || v === undefined) return { text: "", className: "cell" };
  if (isError(v)) {
    if (v.error === "#PENDING") return { text: "", className: "cell pending", title: "waiting for a judgment" };
    return { text: v.error, className: "cell error", title: v.message };
  }
  if (isJev(v)) {
    if (v.jev === "judge") {
      const p = typeof v.value === "number" ? v.value : 0;
      const yes = p >= 0.5;
      const conf = Math.abs(p - 0.5) * 2;
      return {
        text: `${yes ? "Yes" : "No"} · ${Math.round(p * 100)}%`,
        className: "cell jev judge",
        style: { background: rgba(yes ? GREEN : RED, 0.1 + conf * 0.3) },
        title: `probability ${p.toFixed(3)}`,
      };
    }
    if (v.jev === "pick") {
      const label = String(v.value);
      const idx = v.levels?.indexOf(label) ?? -1;
      const fill = PICK_FILLS[(idx >= 0 ? idx : hash(label)) % PICK_FILLS.length];
      const probs = v.probabilities
        ? Object.entries(v.probabilities)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([k, p]) => `${k} ${Math.round(p * 100)}%`)
            .join(" · ")
        : "";
      return {
        text: label,
        className: "cell jev pick",
        style: { background: rgba(fill, 0.12 + v.confidence * 0.26) },
        title: `${label} (confidence ${Math.round(v.confidence * 100)}%)\n${probs}`,
      };
    }
    const n = typeof v.value === "number" ? v.value : 0;
    const max = Math.max(1, (v.levels?.length ?? 2) - 1);
    const label = v.levels?.[Math.round(n)] ?? "";
    return {
      text: label ? `${label} · ${n.toFixed(1)}` : formatNumber(n),
      className: "cell jev rate",
      style: { background: diverging(n / max, 0.12 + v.confidence * 0.26) },
      title: `score ${n.toFixed(2)} of ${max} = ${label} (confidence ${Math.round(v.confidence * 100)}%)`,
    };
  }
  if (typeof v === "number") return { text: formatNumber(v), className: "cell num" };
  if (typeof v === "boolean") return { text: v ? "TRUE" : "FALSE", className: "cell bool" };
  return { text: v, className: "cell text" };
}

export function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s`;
  return `${Math.round(ms)} ms`;
}

export function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(seconds < 600 ? 1 : 0)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}
