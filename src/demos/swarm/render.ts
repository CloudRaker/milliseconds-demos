// Canvas draw, ported from jev-swarm src/render.ts with the milliseconds.ai palette.
import { ARENA_H, ARENA_W, DIR_VEC, type Agent, type Personality, type World } from "./data";

export const PERSONALITY_COLOR: Record<Personality, string> = {
  aggressive: "#ff7a90",
  cautious: "#6ad7ff",
  greedy: "#ffc866",
  trickster: "#b58aff",
};
export const HEURISTIC_COLOR = "#8d8a99";
export const HUMAN_COLOR = "#6fdc8c";
const INK = "#111114";
const SURFACE = "#0e0e12";
const GRID = "#ffffff12";
const EDGE = "#ffffff2e";
const FOOD = "#f4f1ed";
/** the mono face site.css gives --mono; canvas needs a literal family list, not a var(). */
const MONO = "Ioskeley, monospace";

export function agentColor(a: Agent): string {
  if (a.controller === "human") return HUMAN_COLOR;
  if (a.controller === "heuristic") return HEURISTIC_COLOR;
  return PERSONALITY_COLOR[a.personality];
}

export interface RenderOptions {
  showTargets: boolean;
  nowMs: number;
}

export function drawWorld(ctx: CanvasRenderingContext2D, world: World, width: number, height: number, opts: RenderOptions): void {
  const scale = Math.min(width / ARENA_W, height / ARENA_H);
  const ox = (width - ARENA_W * scale) / 2;
  const oy = (height - ARENA_H * scale) / 2;
  ctx.save();
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, width, height);
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);

  ctx.fillStyle = SURFACE;
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  for (let x = 100; x < ARENA_W; x += 100) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ARENA_H);
    ctx.stroke();
  }
  for (let y = 100; y < ARENA_H; y += 100) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(ARENA_W, y);
    ctx.stroke();
  }
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, ARENA_W, ARENA_H);

  ctx.fillStyle = FOOD;
  ctx.globalAlpha = 0.7;
  for (const p of world.pellets) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const e of world.events) {
    const age = world.time - e.at;
    if (age > 0.6) continue;
    const r = e.kind === "eat" ? 20 + age * 90 : 10 + age * 40;
    ctx.strokeStyle = e.kind === "eat" ? `rgba(255,122,144,${1 - age / 0.6})` : `rgba(111,220,140,${1 - age / 0.6})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (opts.showTargets) {
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    for (const a of world.agents) {
      if (!a.alive || !a.decision.target) continue;
      const t = world.agents.find((o) => o.id === a.decision.target) ?? world.pellets.find((p) => p.id === a.decision.target);
      if (!t) continue;
      ctx.strokeStyle = agentColor(a);
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  const sorted = world.agents.filter((a) => a.alive).sort((a, b) => a.size - b.size);
  for (const a of sorted) {
    const color = agentColor(a);
    const boosting = a.boostLeft > 0;
    ctx.save();
    ctx.translate(a.x, a.y);
    if (a.inFlight > 0) {
      ctx.strokeStyle = "#ffffff59";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 5]);
      ctx.lineDashOffset = -(opts.nowMs / 40) % 9;
      ctx.beginPath();
      ctx.arc(0, 0, a.size + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const sinceDecision = opts.nowMs - a.decision.at;
    if (a.controller === "dm1" && sinceDecision < 260 && a.decision.source === "dm1") {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 1 - sinceDecision / 260;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, a.size + 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.shadowColor = color;
    ctx.shadowBlur = boosting ? 26 : 10;
    ctx.fillStyle = color;
    ctx.globalAlpha = a.controller === "heuristic" ? 0.7 : 0.95;
    ctx.beginPath();
    if (a.controller === "heuristic") {
      const s = a.size * 0.9;
      ctx.rect(-s, -s, s * 2, s * 2);
    } else {
      ctx.arc(0, 0, a.size, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    let hx = 0;
    let hy = 0;
    if (a.steerTo) {
      const dx = a.steerTo.x - a.x;
      const dy = a.steerTo.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      hx = dx / d;
      hy = dy / d;
    } else if (a.heading !== "hold") {
      hx = DIR_VEC[a.heading].x;
      hy = DIR_VEC[a.heading].y;
    }
    if (hx || hy) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(hx * a.size * 0.3, hy * a.size * 0.3);
      ctx.lineTo(hx * a.size * 0.95, hy * a.size * 0.95);
      ctx.stroke();
    }
    ctx.fillStyle = "#f4f1edcc";
    ctx.font = `600 ${Math.max(11, a.size * 0.5)}px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(a.controller === "human" ? "YOU" : a.id, 0, a.size + 4);
    ctx.restore();
  }
  ctx.restore();
}

export function screenToWorld(canvas: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / ARENA_W, rect.height / ARENA_H);
  const ox = (rect.width - ARENA_W * scale) / 2;
  const oy = (rect.height - ARENA_H * scale) / 2;
  return { x: (clientX - rect.left - ox) / scale, y: (clientY - rect.top - oy) / scale };
}
