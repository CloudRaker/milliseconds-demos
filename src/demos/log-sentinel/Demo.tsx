import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type WheelEvent } from "react";
import type { Severity } from "./data";
import { Engine, MAX_RUN_MS, RATE_MAX, RATE_MIN, type Incident, type Row, type Snapshot } from "./engine";
import "./demo.css";

const SEV_LABEL: Record<Severity, string> = {
  noise: "noise",
  informational: "info",
  degraded: "degraded",
  "customer-impacting": "cust-impact",
  outage: "OUTAGE",
};

const pct = (n: number) => `${Math.round(n * 100)}%`;
const clock = (ts: number) => new Date(ts).toISOString().slice(11, 19);
const ago = (ts: number, now: number) => {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ${s % 60}s ago`;
};

export default function Demo() {
  const engine = useMemo(() => new Engine(typeof location !== "undefined" && new URLSearchParams(location.search).get("mock") === "1"), []);
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  useEffect(() => () => engine.destroy(), [engine]);

  // Background tabs throttle timers to once a second, which would stall the stream and leave
  // requests hanging. Stop instead, and say so.
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && engine.stop("Stopped: the tab went to the background, where browsers throttle timers.");
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [engine]);

  const toggle = useCallback(() => (state.running ? engine.stop("Stopped.") : engine.start()), [engine, state.running]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === "r") toggle();
      if (e.key === "s") engine.triggerStorm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine, toggle]);

  const m = state.metrics;

  return (
    <div className="d-log-sentinel">
      <div className="ls-bar panel">
        <button className={`btn ${state.running ? "" : "primary"}`} onClick={toggle}>
          {state.running ? "Stop" : "Start log stream"}
          <kbd>R</kbd>
        </button>
        <button className="btn" onClick={() => engine.triggerStorm()}>
          Inject storm<kbd>S</kbd>
        </button>
        <label className="ls-slider">
          <span>
            Log rate <b>{state.rate}</b> lines/s
          </span>
          <input type="range" min={RATE_MIN} max={RATE_MAX} step={1} value={state.rate} onChange={(e) => engine.setRate(Number(e.target.value))} />
        </label>
        <span className={`tag ${state.mock ? "warn" : state.running ? "good" : "purple"}`}>{state.mock ? "Sample data" : state.running ? "Simulated stream" : "idle"}</span>
        {state.running && <span className="ls-timer mono">{Math.max(0, Math.ceil((MAX_RUN_MS - m.elapsedMs) / 1000))} s left</span>}
      </div>

      <div className="metrics ls-metrics">
        <span>
          Incoming lines / sec <b>{m.eventsPerSec.toFixed(1)}</b>
        </span>
        <span>
          Judged lines / sec <b>{m.judgmentsPerSec.toFixed(1)}</b>
        </span>
        <span>
          Requests running <b>{m.inFlight}</b>
        </span>
        <span>
          Lines waiting <b className={m.backlog > 40 ? "warn" : undefined}>{m.backlog}</b>
        </span>
        {m.errors > 0 && (
          <span>
            errors <b className="warn">{m.errors}</b>
          </span>
        )}
      </div>

      {state.error && <p className="error ls-note">{state.error}</p>}
      {!state.error && state.notice && <p className="ls-note muted">{state.notice}</p>}
      {!state.error && !state.notice && !state.running && <p className="ls-note muted">Start the simulated log stream to identify actionable incidents. Inject a storm to see a payment outage unfold. The free stream replays dated sample logs. Analysis uses fixed sample groups; recorded usage includes the full group. Each run stops after 60 seconds.</p>}

      <div className="ls-panes">
        <Firehose rows={state.rows} running={state.running} />
        <Incidents incidents={state.incidents} storm={state.storm} />
        <Scoreboard state={state} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- firehose
function Firehose({ rows, running }: { rows: Row[]; running: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [rows, follow]);
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0) setFollow(false);
  };
  const onScroll = () => {
    const el = ref.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 40) setFollow(true);
  };
  return (
    <section className="panel ls-pane">
      <p className="panel-title">
        Firehose <span className="ls-dim">seven services · colour is the verdict</span>
        {!follow && (
          <button className="ls-mini" onClick={() => setFollow(true)}>
            follow
          </button>
        )}
      </p>
      <div className="ls-scroll mono" ref={ref} onScroll={onScroll} onWheel={onWheel}>
        {rows.map(({ event, judgment }) => (
          <div key={event.id} className={`ls-line sev-${judgment ? judgment.severity : "pending"} ${judgment?.actionable ? "act" : ""} ${event.storm ? "storm" : ""}`}>
            <span className="ls-svc">{event.service}</span>
            <span className="ls-sev">{judgment ? SEV_LABEL[judgment.severity] : running ? "…" : "—"}</span>
            {judgment?.security && <span className="ls-sec">sec</span>}
            <span className="ls-txt">{event.line}</span>
            {judgment && <span className="ls-age">{judgment.ageMs} ms</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- incidents
function Incidents({ incidents, storm }: { incidents: Incident[]; storm: { phase: string; at: number }[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const open = incidents.filter((i) => now - i.lastSeen < 60_000);
  const older = incidents.filter((i) => now - i.lastSeen >= 60_000);
  return (
    <section className="panel ls-pane">
      <p className="panel-title">
        Incidents <span className="ls-dim">grouped by service and cause over 60 seconds</span>
        <span className="ls-count">{open.length} open</span>
      </p>
      <div className="ls-scroll">
        {storm.length > 0 && (
          <div className="ls-storm">
            {storm.filter((s) => !s.phase.startsWith("Regex")).map((s, i) => (
              <div key={i} className={s.phase.startsWith("decision") ? "dm" : s.phase.startsWith("Regex") ? "rx" : s.phase.startsWith("Verdict") ? "verdict" : ""}>
                <span className="ls-t">{clock(s.at)}</span> {s.phase}
              </div>
            ))}
          </div>
        )}
        {incidents.length === 0 && <p className="muted ls-empty">No actionable lines yet. Press Run, then Inject storm to degrade the payments provider.</p>}
        {open.map((i) => (
          <IncidentCard key={i.key} i={i} now={now} />
        ))}
        {older.length > 0 && <p className="ls-divider">quiet</p>}
        {older.map((i) => (
          <IncidentCard key={i.key} i={i} now={now} muted />
        ))}
      </div>
    </section>
  );
}

function IncidentCard({ i, now, muted }: { i: Incident; now: number; muted?: boolean }) {
  return (
    <article className={`ls-card sev-${i.severity} ${muted ? "quiet" : ""}`}>
      <div className="ls-card-head">
        <span className="ls-pill">{SEV_LABEL[i.severity]}</span>
        <span className="ls-svc">{i.service}</span>
        <span className="ls-cat">{i.category.replace("_", " ")}</span>
        {i.security && <span className="ls-sec">security</span>}
        <span className="ls-n">×{i.count}</span>
      </div>
      <p className="ls-sample mono">{i.sample}</p>
      <p className="ls-foot">
        first {clock(i.firstSeen)} · last {clock(i.lastSeen)} ({ago(i.lastSeen, now)})
      </p>
    </article>
  );
}

// ---------------------------------------------------------------- scoreboard
function Scoreboard({ state }: { state: Snapshot }) {
  const m = state.metrics;
  const dmMiss = state.disagreements.filter((d) => d.kind === "dm_fp" || d.kind === "dm_fn");
  return (
    <section className="panel ls-pane">
      <p className="panel-title">
        Detection quality <span className="ls-dim">compared with the sample’s expected outcomes</span>
      </p>
      <div className="ls-scroll">
        <div className="ls-vs">
          <div className="ls-col dm">
            <span className="ls-big">{m.dmActionable}</span>
            <span className="ls-lbl">lines the model calls actionable</span>
            <span className="ls-pr">
              Alerts that were correct: {m.totalJudged ? pct(m.dm.precision) : "—"} · Issues detected: {m.totalJudged ? pct(m.dm.recall) : "—"}
            </span>
            <div className="bar">
              <i style={{ width: pct(m.dm.precision) }} />
            </div>
          </div>
        </div>
        <p className="ls-truth">
          {m.totalJudged} lines checked · {m.dm.fp} false alerts · {m.dm.fn} missed issues
        </p>

        {dmMiss.length > 0 && (
          <>
            <p className="panel-title ls-sub">
              Model mistakes <span className="ls-dim">{dmMiss.length} recent</span>
            </p>
            <div className="ls-miss mono">
              {dmMiss.slice(0, 16).map((d) => (
                <div key={d.id} className={d.kind}>
                  <span className="ls-k">{d.kind === "dm_fp" ? "false page" : "missed"}</span>
                  <span className="ls-svc">{d.service}</span>
                  <span className="ls-txt">{d.line}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <p className="ls-batch muted">An alert is correct when it matches the sample’s expected label. A missed issue is an actionable line the model did not flag.</p>
      </div>
    </section>
  );
}
