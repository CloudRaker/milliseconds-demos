import { useEffect, useRef } from "react";
import type { Aircraft, Conflict } from "./types.ts";
import { SCOPE_RADIUS_NM } from "./types.ts";
import { FIXES } from "./world.ts";
import { inViolation } from "./conflict.ts";
import { velocity } from "./kinematics.ts";

export interface ScopeSnapshot {
  t: number;
  aircraft: readonly Aircraft[];
  conflicts: readonly Conflict[];
}

interface Props {
  snapshot: () => ScopeSnapshot;
  width: number;
  height: number;
}

// Repainted from the original green-phosphor scope into the milliseconds.ai palette: the page background,
// the brand purple for clean traffic, and the demos.css warn/hot colours for conflicts.
const BG = "#111114";
const TRACK = "#a08cff";
const TRACK_DIM = "rgba(142, 121, 255, 0.30)";
const RING = "rgba(255, 255, 255, 0.13)";
const RING_EDGE = "rgba(255, 255, 255, 0.26)";
const RADIAL = "rgba(255, 255, 255, 0.06)";
const AMBER = "#f0b35a";
const RED = "#ff8a8a";
const CYAN = "#6fdc8c";
const LABEL = "#c9c6d2";
const FIELD = "rgba(244, 241, 237, 0.55)";
const MONO = "11px Ioskeley, ui-monospace, monospace";
const MONO_SM = "10px Ioskeley, ui-monospace, monospace";
const TRAIL_LEN = 6;

export function Scope({ snapshot, width, height }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const trails = useRef(new Map<number, { x: number; y: number }[]>());
  const lastTrail = useRef(-1);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    let raf = 0;
    const draw = (): void => {
      const snap = snapshot();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render(ctx, snap, width, height, trails.current, lastTrail);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [snapshot, width, height]);

  return <canvas ref={ref} style={{ width, height }} className="scope" aria-label="Radar scope" />;
}

function render(
  ctx: CanvasRenderingContext2D,
  snap: ScopeSnapshot,
  w: number,
  h: number,
  trails: Map<number, { x: number; y: number }[]>,
  lastTrail: { current: number },
): void {
  const cx = w / 2;
  const cy = h / 2;
  const scale = (Math.min(w, h) / 2 - 14) / SCOPE_RADIUS_NM;
  const px = (x: number): number => cx + x * scale;
  const py = (y: number): number => cy - y * scale;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);

  // Range rings and radials.
  ctx.lineWidth = 1;
  for (let r = 10; r <= SCOPE_RADIUS_NM; r += 10) {
    ctx.strokeStyle = r === SCOPE_RADIUS_NM ? RING_EDGE : RING;
    ctx.beginPath();
    ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = RADIAL;
  for (let a = 0; a < 360; a += 30) {
    const rad = (a * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.sin(rad) * SCOPE_RADIUS_NM * scale, cy - Math.cos(rad) * SCOPE_RADIUS_NM * scale);
    ctx.stroke();
  }

  // Sweep.
  const sweep = ((performance.now() / 4000) % 1) * Math.PI * 2;
  const grad = ctx.createConicGradient(sweep - Math.PI / 2, cx, cy);
  grad.addColorStop(0, "rgba(109, 74, 255, 0.20)");
  grad.addColorStop(0.12, "rgba(109, 74, 255, 0)");
  grad.addColorStop(1, "rgba(109, 74, 255, 0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, SCOPE_RADIUS_NM * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(142, 121, 255, 0.75)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.sin(sweep) * SCOPE_RADIUS_NM * scale, cy - Math.cos(sweep) * SCOPE_RADIUS_NM * scale);
  ctx.stroke();

  // Runway 27 and fixes.
  ctx.strokeStyle = FIELD;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(px(-1.2), py(0));
  ctx.lineTo(px(1.2), py(0));
  ctx.stroke();
  ctx.strokeStyle = "rgba(244, 241, 237, 0.18)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.moveTo(px(1.2), py(0));
  ctx.lineTo(px(14), py(0));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = MONO_SM;
  ctx.fillStyle = "rgba(176, 173, 185, 0.72)";
  ctx.textAlign = "center";
  for (const f of FIXES) {
    if (f.name === "RW27") continue;
    const x = px(f.x);
    const y = py(f.y);
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x + 4, y + 3);
    ctx.lineTo(x - 4, y + 3);
    ctx.closePath();
    ctx.stroke();
    ctx.fillText(f.name, x, y + 14);
  }

  if (snap.t < lastTrail.current) {
    trails.clear();
    lastTrail.current = -1;
  }
  // Trails: record every 4 s of sim time.
  if (snap.t - lastTrail.current >= 4) {
    lastTrail.current = snap.t;
    const live = new Set<number>();
    for (const ac of snap.aircraft) {
      live.add(ac.id);
      const tr = trails.get(ac.id) ?? [];
      tr.push({ x: ac.x, y: ac.y });
      if (tr.length > TRAIL_LEN) tr.shift();
      trails.set(ac.id, tr);
    }
    for (const id of trails.keys()) if (!live.has(id)) trails.delete(id);
  }

  const byId = new Map(snap.aircraft.map((a) => [a.id, a]));
  const inConflict = new Set<number>();

  // Predicted conflict lines.
  for (const c of snap.conflicts) {
    const a = byId.get(c.a);
    const b = byId.get(c.b);
    if (!a || !b) continue;
    inConflict.add(a.id);
    inConflict.add(b.id);
    const urgent = c.tLoss < 45;
    ctx.strokeStyle = urgent ? RED : AMBER;
    ctx.lineWidth = urgent ? 1.5 : 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(px(a.x), py(a.y));
    ctx.lineTo(px(b.x), py(b.y));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = urgent ? RED : AMBER;
    ctx.font = MONO_SM;
    ctx.textAlign = "center";
    ctx.fillText(`${Math.round(c.tLoss)}s`, (px(a.x) + px(b.x)) / 2, (py(a.y) + py(b.y)) / 2 - 3);
  }

  // Aircraft. Data blocks take the first candidate offset that overlaps neither a symbol nor an already-drawn block.
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const LABEL_W = 62;
  const LABEL_H = 36;
  const QUADRANTS = [
    [10, -12],
    [10, 14],
    [-LABEL_W - 10, -12],
    [-LABEL_W - 10, 14],
    [-LABEL_W / 2, -LABEL_H - 6],
    [-LABEL_W / 2, 24],
    [22, -30],
    [22, 32],
    [-LABEL_W - 22, -30],
    [-LABEL_W - 22, 32],
  ];
  const overlaps = (r: { x: number; y: number; w: number; h: number }) =>
    placed.some((p) => p.x < r.x + r.w && r.x < p.x + p.w && p.y < r.y + r.h && r.y < p.y + p.h);
  for (const ac of snap.aircraft) placed.push({ x: px(ac.x) - 6, y: py(ac.y) - 6, w: 12, h: 12 });
  for (const ac of snap.aircraft) {
    const x = px(ac.x);
    const y = py(ac.y);
    const violating = snap.aircraft.some((o) => o.id !== ac.id && inViolation(ac, o));
    const color = violating ? RED : inConflict.has(ac.id) ? AMBER : TRACK;

    const tr = trails.get(ac.id) ?? [];
    tr.forEach((p, i) => {
      ctx.fillStyle = `rgba(142, 121, 255, ${0.10 + (i / TRAIL_LEN) * 0.32})`;
      ctx.fillRect(px(p.x) - 1, py(p.y) - 1, 2, 2);
    });

    // Halo: Jev (or another controller) just decided for this aircraft, coloured by the urgency it judged.
    if (ac.haloUntil > snap.t) {
      const k = (ac.haloUntil - snap.t) / 6;
      const rgb = ac.urgency >= 3 ? "255, 138, 138" : ac.urgency >= 2 ? "240, 179, 90" : "111, 220, 140";
      ctx.strokeStyle = `rgba(${rgb}, ${0.15 + 0.7 * k})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 10 + (1 - k) * 14, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Separation ring for anything in conflict.
    if (inConflict.has(ac.id) || violating) {
      ctx.strokeStyle = violating ? "rgba(255, 138, 138, 0.45)" : "rgba(240, 179, 90, 0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 1.5 * scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Velocity vector: one minute ahead.
    const v = velocity(ac.hdg, ac.spd);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(px(ac.x + v.vx * 60), py(ac.y + v.vy * 60));
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
    ctx.fillStyle = BG;
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);

    // Data block.
    ctx.textAlign = "left";
    ctx.font = MONO;
    ctx.fillStyle = color;
    let bx = x + 10;
    let by = y - 12;
    for (const [dx, dy] of QUADRANTS) {
      if (!overlaps({ x: x + dx, y: y + dy - 10, w: LABEL_W, h: LABEL_H })) {
        bx = x + dx;
        by = y + dy;
        break;
      }
    }
    const bh = ac.instruction !== "maintain" ? LABEL_H : LABEL_H - 10;
    placed.push({ x: bx, y: by - 10, w: LABEL_W, h: bh });
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(Math.min(Math.max(x, bx - 2), bx + LABEL_W + 2), Math.min(Math.max(y, by - 10), by - 10 + bh));
    ctx.strokeStyle = `${color}66`;
    ctx.stroke();
    ctx.fillStyle = "rgba(17, 17, 20, 0.82)";
    ctx.fillRect(bx - 2, by - 10, LABEL_W + 4, bh);
    ctx.fillStyle = color;
    ctx.fillText(ac.callsign, bx, by);
    ctx.font = MONO_SM;
    ctx.fillStyle = LABEL;
    const trend = ac.targetAlt > ac.alt + 50 ? "↑" : ac.targetAlt < ac.alt - 50 ? "↓" : " ";
    const handoff = ac.handoff >= 0.5 && !inConflict.has(ac.id) ? " H" : "";
    ctx.fillText(`${String(Math.round(ac.alt / 100)).padStart(3, "0")}${trend} ${Math.round(ac.spd)}${handoff}`, bx, by + 12);
    if (ac.instruction !== "maintain") {
      ctx.fillStyle = CYAN;
      ctx.fillText(short(ac.instruction), bx, by + 23);
    }
  }
}

function short(i: Aircraft["instruction"]): string {
  switch (i) {
    case "turn_left_20":
      return "L20";
    case "turn_right_20":
      return "R20";
    case "turn_left_45":
      return "L45";
    case "turn_right_45":
      return "R45";
    case "climb_1000":
      return "CLB";
    case "descend_1000":
      return "DES";
    case "speed_minus_30":
      return "SPD-";
    case "speed_plus_30":
      return "SPD+";
    case "direct_to_next_fix":
      return "DCT";
    case "maintain":
      return "";
  }
}
