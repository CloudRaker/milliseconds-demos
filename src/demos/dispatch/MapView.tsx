// Procedural city canvas, ported from the experiment's src/MapView.tsx.
// Same drawing: districts, street grids, river, depots, pulsing incidents, moving units.
// Repainted on the milliseconds.ai surface colours.

import { useEffect, useRef } from "react";
import type { City, District, Unit, UnitType } from "./data.ts";
import type { Incident } from "./sim.ts";
import type { Category } from "./data.ts";

export const CATEGORY_COLOR: Record<Category, string> = {
  fire: "#ff6a4a",
  medical: "#ff5c93",
  police: "#6d8cff",
  traffic: "#f0b35a",
  utility: "#c3e653",
  rescue: "#36dcc8",
  non_emergency: "#8a8697",
  duplicate_update: "#a089ff",
};

export const UNIT_COLOR: Record<UnitType, string> = {
  ambulance: "#ff5c93",
  police: "#6d8cff",
  engine: "#ff6a4a",
  ladder: "#ff9c78",
  utility: "#c3e653",
};

const DISTRICT_FILL: Record<District["kind"], string> = {
  downtown: "#16161d",
  residential: "#131318",
  industrial: "#181712",
  waterfront: "#11161c",
  park: "#121a14",
};

interface Props {
  city: City;
  units: Unit[];
  incidents: Incident[];
  time: number;
  caption: string;
}

export function MapView({ city, units, incidents, time, caption }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (cw === 0 || ch === 0) return;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    const scale = Math.min(cw / city.width, ch / city.height) * 0.96;
    const ox = (cw - city.width * scale) / 2;
    const oy = (ch - city.height * scale) / 2;
    const X = (x: number) => ox + x * scale;
    const Y = (y: number) => oy + y * scale;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    for (const d of city.districts) {
      ctx.fillStyle = DISTRICT_FILL[d.kind];
      ctx.fillRect(X(d.x), Y(d.y), d.w * scale, d.h * scale);
      ctx.strokeStyle = "#ffffff12";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = d.x + d.blockSize; x < d.x + d.w; x += d.blockSize) {
        ctx.moveTo(X(x), Y(d.y));
        ctx.lineTo(X(x), Y(d.y + d.h));
      }
      for (let y = d.y + d.blockSize; y < d.y + d.h; y += d.blockSize) {
        ctx.moveTo(X(d.x), Y(y));
        ctx.lineTo(X(d.x + d.w), Y(y));
      }
      ctx.stroke();
      ctx.strokeStyle = "#ffffff24";
      ctx.strokeRect(X(d.x) + 0.5, Y(d.y) + 0.5, d.w * scale, d.h * scale);
      ctx.fillStyle = "#6d6a76";
      ctx.font = "600 10px 'Space', system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(d.name.toUpperCase(), X(d.x) + 6, Y(d.y) + 5);
    }

    ctx.strokeStyle = "#1d3a4a";
    ctx.lineWidth = 9 * scale + 2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    city.river.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
    ctx.stroke();

    for (const depot of city.depots) {
      const color =
        depot.kind === "hospital"
          ? UNIT_COLOR.ambulance
          : depot.kind === "precinct"
            ? UNIT_COLOR.police
            : depot.kind === "firehouse"
              ? UNIT_COLOR.engine
              : UNIT_COLOR.utility;
      ctx.fillStyle = "#111114";
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(X(depot.pos.x) - 5, Y(depot.pos.y) - 5, 10, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = "9px 'Ioskeley', monospace";
      ctx.textBaseline = "middle";
      ctx.fillText(depot.name, X(depot.pos.x) + 8, Y(depot.pos.y));
    }

    const byId = new Map(incidents.map((i) => [i.id, i]));
    ctx.lineWidth = 1;
    for (const u of units) {
      if (u.status !== "enroute" || !u.incidentId) continue;
      const inc = byId.get(u.incidentId);
      if (!inc) continue;
      ctx.strokeStyle = UNIT_COLOR[u.type] + "55";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(X(u.pos.x), Y(u.pos.y));
      ctx.lineTo(X(inc.loc.x), Y(inc.loc.y));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (const inc of incidents) {
      if (inc.status === "closed") continue;
      const color = CATEGORY_COLOR[inc.category];
      const x = X(inc.loc.x);
      const y = Y(inc.loc.y);
      const r = 4 + inc.severity * 1.5;
      const age = time - inc.openedAt;
      if (inc.status === "awaiting_units") {
        const pulse = (age * 1.5) % 1;
        ctx.strokeStyle = color;
        ctx.globalAlpha = 1 - pulse;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r + 4 + pulse * 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = color;
      ctx.globalAlpha = inc.status === "on_scene" ? 0.55 : 0.95;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (inc.mergedCount > 0) {
        ctx.fillStyle = "#111114";
        ctx.font = "700 8px 'Space', system-ui, sans-serif";
        ctx.textBaseline = "middle";
        ctx.textAlign = "center";
        ctx.fillText(String(inc.mergedCount + 1), x, y + 0.5);
        ctx.textAlign = "left";
      }
    }

    for (const u of units) {
      if (u.status === "idle") continue;
      const x = X(u.pos.x);
      const y = Y(u.pos.y);
      ctx.fillStyle = UNIT_COLOR[u.type];
      ctx.globalAlpha = u.status === "returning" ? 0.45 : 1;
      ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
      ctx.globalAlpha = 1;
    }
  }, [city, units, incidents, time]);

  return (
    <div className="panel map-panel">
      <p className="panel-title">
        Live city map <span className="muted">· {caption}</span>
      </p>
      <div className="map-wrap">
        <canvas ref={ref} />
      </div>
      <div className="legend">
        {(Object.keys(UNIT_COLOR) as UnitType[]).map((t) => (
          <span key={t}>
            <i style={{ background: UNIT_COLOR[t] }} />
            {t}
          </span>
        ))}
        <span>
          <i style={{ background: "#f4f1ed", borderRadius: "50%" }} />
          incident
        </span>
      </div>
    </div>
  );
}
