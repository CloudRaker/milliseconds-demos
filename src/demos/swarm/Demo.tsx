import { useEffect, useRef, useState } from "react";
import { PERSONALITIES, type Decision, type Judgments, type StatKey, type Stats } from "./data";
import { HUMAN_COLOR, PERSONALITY_COLOR, drawWorld, screenToWorld } from "./render";
import { RUN_LIMIT_MS, Swarm, type Settings } from "./swarm";
import "./demo.css";
import { hasKey, openKeyPanel } from "../../lib/dm1";

interface Row {
  id: string;
  personality: string;
  color: string;
  action: string;
  jud: Judgments;
}
interface Snapshot {
  running: boolean;
  scene: number;
  paused: boolean;
  left: number;
  alive: number;
  total: number;
  perSecond: number;
  inFlight: number;
  decisions: number;
  stale: number;
  fallbacks: number;
  errors: number;
  rateLimited: number;
  error: string | null;
  sample: Swarm["sample"];
  rows: Row[];
  stats: Record<StatKey, Stats>;
  human: { size: number; kills: number; deaths: number };
}

const LEGEND: { key: StatKey; label: string; color: string }[] = [
  ...PERSONALITIES.map((p) => ({ key: p as StatKey, label: p, color: PERSONALITY_COLOR[p] })),
  { key: "human", label: "you", color: HUMAN_COLOR },
];


/** Read the action off the decision the agent is actually running, not off the numbers. */
function actionOf(d: Decision): string {
  if (d.source === "none") return "–";
  if (d.source !== "dm1") return "fallback";
  if (!d.target) return "flee";
  return d.target.startsWith("p") ? "feed" : "chase";
}

export default function Demo() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const swarmRef = useRef<Swarm | null>(null);
  const hoverRef = useRef(false);
  const targetsRef = useRef(true);
  const [settings, setSettings] = useState<Settings>(() => new Swarm().settings);
  const [showTargets, setShowTargets] = useState(true);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  targetsRef.current = showTargets;

  useEffect(() => {
    const swarm = new Swarm();
    swarmRef.current = swarm;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let lastSnap = 0;
    const loop = (now: number) => {
      swarm.frame(now);
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawWorld(ctx, swarm.world, rect.width, rect.height, { showTargets: targetsRef.current, nowMs: now });
      if (now - lastSnap > 220) {
        lastSnap = now;
        const m = swarm.metrics;
        const bots = swarm.world.agents.filter((a) => a.controller !== "human");
        const human = swarm.human;
        setSnap({
          running: swarm.running,
          scene: swarm.sceneNumber,
          paused: swarm.paused,
          left: swarm.secondsLeft(now),
          alive: bots.filter((a) => a.alive).length,
          total: bots.length,
          perSecond: m.perSecond(now),
          inFlight: m.inFlight,
          decisions: m.decisions,
          stale: m.stale,
          fallbacks: m.fallbacks,
          errors: m.errors,
          rateLimited: m.rateLimited,
          error: swarm.error,
          sample: swarm.sample,
          stats: swarm.world.stats,
          human: { size: human?.size ?? 0, kills: human?.kills ?? 0, deaths: human?.deaths ?? 0 },
          rows: bots
            .filter((a) => a.controller === "dm1" && a.alive)
            .slice(0, 8)
            .map((a) => ({
              id: a.id,
              personality: a.personality,
              color: PERSONALITY_COLOR[a.personality],
              action: actionOf(a.decision),
              jud: swarm.judgmentsOf(a.id),
            })),
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      swarm.stop();
    };
  }, []);

  const boostHuman = () => {
    const human = swarmRef.current?.human;
    if (human && !swarmRef.current?.settings.stock) human.decision = { ...human.decision, boost: true, source: "human" };
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !hoverRef.current) return;
      e.preventDefault();
      boostHuman();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const update = (patch: Partial<Settings>, resetWorld: boolean) => {
    const swarm = swarmRef.current;
    if (!swarm) return;
    if (resetWorld) swarm.reset(patch);
    else swarm.settings = { ...swarm.settings, ...patch };
    setSettings({ ...swarm.settings });
  };

  const toggleRun = () => {
    const swarm = swarmRef.current;
    if (!swarm) return;
    if (swarm.running) swarm.stop();
    else swarm.start(performance.now());
  };

  const s = snap;

  return (
    <div className="d-swarm">
      <p className="muted">Free scenes reset every five seconds. Continuous play uses your key; steer the green agent.</p>
      <div className="swarm-controls">
        <button className={`btn ${s?.running ? "" : "primary"}`} onClick={toggleRun}>
          {s?.running ? `Stop · ${s.left}s left` : `Run the swarm · ${RUN_LIMIT_MS / 1000}s`}
        </button>
        <label className="ctl"><input type="checkbox" checked={!settings.stock} onChange={e => { if (e.target.checked && !hasKey()) { openKeyPanel(); return; } update({ stock: !e.target.checked }, true); }} /> Continuous play · your key</label>
        <label className="ctl" title="32 scenes is the batch ceiling for one texts array, so the count is a capped select">
          <span>agents</span>
          <select className="select" value={settings.agentCount} onChange={(e) => update({ agentCount: Number(e.target.value) }, true)}>
            {[8, 16, 24, 32].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="ctl">
          <span>continuous tick</span>
          <select className="select" value={settings.tickMs} disabled={settings.stock} onChange={(e) => update({ tickMs: Number(e.target.value) }, false)}>
            {[500, 1000, 2000].map((n) => (
              <option key={n} value={n}>
                {n} ms
              </option>
            ))}
          </select>
        </label>
        <button className={`btn small ${showTargets ? "on" : ""}`} onClick={() => setShowTargets((v) => !v)}>
          targets
        </button>
        <button
          className="btn small"
          onClick={() => {
            const swarm = swarmRef.current;
            if (!swarm) return;
            swarm.paused = !swarm.paused;
            setSettings({ ...swarm.settings });
          }}
        >
          {s?.paused ? "resume" : "pause"}
        </button>
        <button className="btn small" onClick={() => update({}, true)}>
          reset
        </button>
      </div>

      <div className="metrics" aria-label="Simulation outcomes">
        {settings.stock && <span>Stock scene <b>{s?.scene ?? 1} / 6</b></span>}
        <span>Agents alive <b>{s?.alive ?? settings.agentCount}</b></span>
        <span>Decisions per second <b>{s ? s.perSecond.toFixed(1) : "0.0"}</b></span>
        <span>Decisions in progress <b>{s?.inFlight ?? 0}</b></span>
        {!!s?.fallbacks && <span className="warn">Safety fallback decisions <b>{s.fallbacks}</b></span>}
      </div>

      {s?.error && <p className="error">{s.error}</p>}

      <div className="swarm-body">
        <div className="panel arena">
          <canvas
            ref={canvasRef}
            onPointerMove={(e) => {
              const human = swarmRef.current?.human;
              if (human && canvasRef.current && !settings.stock) human.steerTo = screenToWorld(canvasRef.current, e.clientX, e.clientY);
            }}
            onPointerDown={boostHuman}
            onPointerEnter={() => (hoverRef.current = true)}
            onPointerLeave={() => (hoverRef.current = false)}
          />
          {!s?.running && <p className="arena-note">Local preview · Run to apply model decisions.</p>}
          <div className="legend">
            {LEGEND.map((l) => (
              <span key={l.key}>
                <i style={{ background: l.color, borderRadius: "99px" }} /> {l.label}
              </span>
            ))}
            <span className="muted">dashed ring = call in flight · flash = answer received · pointer controls need continuous play</span>
          </div>
        </div>

        <div className="swarm-side">
          <div className="panel">
            <p className="panel-title">Agent decisions</p><p className="muted">0–1 probability of fleeing, chasing, or boosting.</p>
            <table className="jud">
              <thead>
                <tr>
                  <th>agent</th>
                  <th>flee?</th>
                  <th>chase?</th>
                  <th>boost?</th>
                  <th>doing</th>
                </tr>
              </thead>
              <tbody>
                {(s?.rows ?? []).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <i style={{ background: r.color }} />
                      {r.id} <span className="muted">{r.personality.slice(0, 4)}</span>
                    </td>
                    <td>{prob(r.jud.flee)}</td>
                    <td>{prob(r.jud.chase)}</td>
                    <td>{prob(r.jud.boost)}</td>
                    <td>
                      <span className={`tag ${r.action === "flee" ? "hot" : r.action === "chase" ? "warn" : r.action === "feed" ? "good" : ""}`}>{r.action}</span>
                    </td>
                  </tr>
                ))}
                {!s?.rows.length && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No model agents on the board yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <p className="panel-title">Leaderboard</p><p className="muted">Win rate = kills divided by kills plus deaths.</p>
            <table className="board">
              <thead>
                <tr>
                  <th />
                  <th>kills</th>
                  <th>deaths</th>
                  <th>food</th>
                  <th>win rate</th>
                </tr>
              </thead>
              <tbody>
                {LEGEND.map((l) => {
                  const st = s?.stats[l.key];
                  if (!st) return null;
                  const win = st.kills + st.deaths ? (100 * st.kills) / (st.kills + st.deaths) : 0;
                  return (
                    <tr key={l.key}>
                      <td>
                        <i style={{ background: l.color }} />
                        {l.label}
                      </td>
                      <td>{st.kills}</td>
                      <td>{st.deaths}</td>
                      <td>{st.pellets}</td>
                      <td>{st.kills + st.deaths ? `${win.toFixed(0)}%` : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <p className="panel-title">Scene sent to the model</p>
            {s?.sample ? (
              <>
                <p className="wire-head mono">
                  one of {Math.min(s.total, 32)} texts · <b>{s.sample.key}</b> · p={s.sample.probability.toFixed(2)}
                </p>
                <pre className="wire">{s.sample.text}</pre>
              </>
            ) : (
              <p className="muted">Run to inspect an agent’s input.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function prob(p: number) {
  if (!p) return <span className="muted">–</span>;
  return (
    <span className="p">
      <i className="bar">
        <i style={{ width: `${Math.round(p * 100)}%` }} />
      </i>
      <b>{p.toFixed(2)}</b>
    </span>
  );
}
