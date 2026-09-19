import { useCallback, useEffect, useRef, useState } from "react";
import type { Mode } from "./types.ts";
import { Sim, type Scorecard, type TickerEntry } from "./engine.ts";
import { Controller, decisionsPerSecond, newTelemetry, type Telemetry } from "./controller.ts";
import { Scope, type ScopeSnapshot } from "./Scope.tsx";
import { DEFAULT_SEED, RUN_LIMIT_MS, SEEDS } from "./data.ts";
import "./demo.css";
import { hasKey, openKeyPanel } from "../../lib/dm1";
import { stockSector } from "./stock";

const TICK_S = 0.5;


interface View {
  t: number;
  scene: number;
  count: number;
  score: Scorecard;
  telemetry: Telemetry;
  dps: number;
  ticker: TickerEntry[];
  conflicts: number;
}

interface Runtime {
  sim: Sim;
  controller: Controller;
  telemetry: Telemetry;
  acc: number;
  loading: boolean;
  nextSceneAt: number;
  scene: number;
}

function makeRuntime(mode: Mode, seed: number, rushHour: boolean): Runtime {
  const sim = new Sim({ seed, rushHour });
  const telemetry = newTelemetry();
  return { sim, controller: new Controller(mode, sim, telemetry), telemetry, acc: 0, loading: false, nextSceneAt: 0, scene: 0 };
}

function snapshotView(r: Runtime): View {
  return {
    t: r.sim.t,
    scene: r.scene,
    count: r.sim.aircraft.length,
    score: r.sim.scorecard,
    telemetry: r.telemetry,
    dps: decisionsPerSecond(r.telemetry, performance.now()),
    ticker: r.sim.ticker.slice(),
    conflicts: r.sim.conflicts.length,
  };
}

export default function Demo() {
  const mode: Mode = "api";
  const [stock, setStock] = useState(true);
  const [speed, setSpeed] = useState<1 | 4>(1);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [rushHour, setRushHour] = useState(false);
  // Starts paused: the seeded sector is drawn, and nothing is sent until the visitor presses Run.
  const [running, setRunning] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [budgetMs, setBudgetMs] = useState(RUN_LIMIT_MS);
  const [stopped, setStopped] = useState(false);
  const budget = useRef(RUN_LIMIT_MS);
  const rt = useRef<Runtime>(undefined as unknown as Runtime);
  if (!rt.current) rt.current = makeRuntime("api", DEFAULT_SEED, false);
  const [view, setView] = useState<View>(() => snapshotView(rt.current));
  const [size, setSize] = useState({ w: 720, h: 620 });
  const stage = useRef<HTMLDivElement>(null);

  const reset = useCallback((m: Mode, s: number, rush: boolean) => {
    rt.current.controller.dispose();
    rt.current = makeRuntime(m, s, rush);
    setView(snapshotView(rt.current));
    setRunning(false);
    setStopped(false);
    budget.current = RUN_LIMIT_MS;
    setBudgetMs(RUN_LIMIT_MS);
    setEpoch((e) => e + 1);
  }, []);

  // The scope is a canvas, so it needs pixel sizes; keep it square-ish and inside its column.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = Math.max(280, Math.floor(el.clientWidth));
      setSize({ w, h: Math.round(Math.min(w, 640)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastView = 0;
    const loop = (now: number): void => {
      const r = rt.current;
      const dtReal = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (running) {
        // Hard wall-clock budget: one visitor cannot leave the API key running.
        budget.current -= dtReal * 1000;
        if (budget.current <= 0) {
          budget.current = 0;
          setRunning(false);
          setStopped(true);
        }
        if (stock && !r.loading && now >= r.nextSceneAt) {
          r.controller.dispose();
          r.sim = stockSector(seed, rushHour, r.scene++);
          r.controller = new Controller(mode, r.sim, r.telemetry);
          r.loading = true;
          r.acc = 0;
          void r.controller.stockDecision().finally(() => {
            r.loading = false;
            r.nextSceneAt = performance.now() + 8000;
          });
        }
        if (!r.loading) r.acc += dtReal * speed;
        let ticks = 0;
        while (r.acc >= TICK_S && ticks < 8) {
          r.acc -= TICK_S;
          r.sim.step(TICK_S);
          if (!stock) r.controller.tick();
          ticks++;
        }
      }
      if (now - lastView > 200) {
        lastView = now;
        setView(snapshotView(r));
        setBudgetMs(budget.current);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [running, speed, epoch, stock, seed, rushHour]);

  useEffect(() => () => rt.current?.controller.dispose(), []);

  const toggleRun = useCallback(() => {
    if (stopped) {
      budget.current = RUN_LIMIT_MS;
      setBudgetMs(RUN_LIMIT_MS);
      setStopped(false);
      setRunning(true);
      return;
    }
    setRunning((v) => !v);
  }, [stopped]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, select, textarea, button, a")) return;
      if (e.key === " ") {
        e.preventDefault();
        toggleRun();
      } else if (e.key.toLowerCase() === "r") reset(mode, seed, rushHour);
      else if (e.key.toLowerCase() === "f") setSpeed((s) => (s === 1 ? 4 : 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleRun, reset, mode, seed, rushHour]);

  const snapshot = useCallback((): ScopeSnapshot => {
    const s = rt.current.sim;
    return { t: s.t, aircraft: s.aircraft, conflicts: s.conflicts };
  }, []);

  const tm = view.telemetry;
  const budgetPct = Math.max(0, Math.min(100, (budgetMs / RUN_LIMIT_MS) * 100));

  return (
    <div className="d-tower">
      <div className="t-bar panel">
        <div className="t-controls">
          <button className="btn" onClick={toggleRun}>
            {running ? "Pause" : stopped ? "Run again" : "Run"}
          </button>
          <button
            className={`btn ${rushHour ? "primary" : ""}`}
            onClick={() => {
              const next = !rushHour;
              setRushHour(next);
              reset(mode, seed, next);
            }}
          >
            Rush hour
          </button>
          <button className={`btn ${speed === 4 ? "primary" : ""}`} onClick={() => setSpeed(speed === 1 ? 4 : 1)}>
            {speed}&times;
          </button>
          <label className="t-seed"><input type="checkbox" checked={!stock} onChange={e => { if (e.target.checked && !hasKey()) { openKeyPanel(); return; } setStock(!e.target.checked); reset(mode, seed, rushHour); }} /> Continuous sector · your key</label>
          <label className="t-seed">
            <span className="muted">seed</span>
            <select
              className="input"
              value={seed}
              onChange={(e) => {
                const v = Number(e.target.value);
                setSeed(v);
                reset(mode, v, rushHour);
              }}
            >
              {SEEDS.map((s) => (
                <option key={s.seed} value={s.seed}>
                  {s.seed} — {s.note}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" onClick={() => reset(mode, seed, rushHour)}>
            Reset
          </button>
        </div>
      </div>

      <p className="t-blurb muted">
        Free stock scenes show model heading, altitude and speed instructions, then play traffic for eight seconds before resetting. Enable a continuous sector with your API key. <span className="t-keys">Space run/pause · F speed · R reset</span>
      </p>

      <div className="t-body">
        <section className="t-left panel">
          <div className="t-stage" ref={stage}>
            <Scope snapshot={snapshot} width={size.w} height={size.h} />
            {!running && (
              <div className="t-overlay">
                <p>{stopped ? "Auto-stopped after 60 s." : view.t > 0 ? "Paused." : "Seeded sector, nothing sent yet."}</p>
                <button className="btn primary" onClick={toggleRun}>
                  {stopped ? "Run again" : "Run"}
                </button>
              </div>
            )}
          </div>
          <div className="t-clock mono">
            <span>{stock ? `Scene ${((view.scene || 1) - 1) % 6 + 1} / 6 · ` : ""}T+{fmtClock(view.t)}</span>
            <span>{view.count} aircraft</span>
            <span className={view.conflicts ? "t-warn" : ""}>{view.conflicts} predicted conflicts</span>
            <span className="t-budget" title="Each run stops after 60 seconds to bound API usage.">
              <i className="bar">
                <i style={{ width: `${budgetPct}%` }} />
              </i>
              {Math.ceil(budgetMs / 1000)} s left
            </span>
          </div>
        </section>

        <aside className="t-right">
          <div className="panel">
            <p className="panel-title">{stock ? "Current scene outcomes" : "Scoreboard"}</p>
            <div className="t-stats">
              <Stat label="Unsafe spacing events" value={view.score.losses} tone={view.score.losses ? "bad" : "good"} big />
              <Stat label="Near misses" value={view.score.nearMisses} tone={view.score.nearMisses ? "bad" : "good"} big />
              <Stat
                label="Average extra flight time"
                value={`${view.score.avgDelayS >= 0 ? "+" : ""}${view.score.avgDelayS.toFixed(0)} s`}
                sub={`${view.score.completed} handed off`}
              />
              <Stat label="Decisions per second" value={view.dps.toFixed(2)} sub={`${view.score.decisions} total · ${view.score.instructions} instructions`} />
            </div>
          </div>

          <div className="panel">
            <p className="panel-title">Controller status</p>
            <p className="muted">{tm.inFlight} decisions in progress · {tm.stale} outdated decisions ignored · {tm.errors} failed requests</p>
            {tm.rateLimited && <p className="tag warn t-badge">Rate limited — safety rules active</p>}
            {tm.lastError && <p className="error">{tm.lastError}</p>}
          </div>

          <div className="panel t-ticker">
            <p className="panel-title">Instructions</p>
            <ul>
              {view.ticker.length === 0 && <li className="t-empty muted">Nothing issued yet. Press Run.</li>}
              {view.ticker
                .slice(-40)
                .reverse()
                .map((e, i) => (
                  <li key={`${e.t}-${e.callsign}-${i}`} className={`t-${e.kind}`}>
                    <span className="t-tt mono">{fmtClock(e.t)}</span>
                    <span className="t-tc mono">{e.callsign}</span>
                    <span className="t-tx">{e.text}</span>
                  </li>
                ))}
            </ul>
          </div>
        </aside>
      </div>

    </div>
  );
}

function Stat({ label, value, sub, tone, big }: { label: string; value: string | number; sub?: string; tone?: "good" | "bad"; big?: boolean }) {
  return (
    <div className={`t-stat ${big ? "t-big" : ""} ${tone ?? ""}`}>
      <div className="t-stat-label">{label}</div>
      <div className="t-stat-value mono">{value}</div>
      {sub && <div className="t-stat-sub">{sub}</div>}
    </div>
  );
}

function fmtClock(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
