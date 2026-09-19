// Dispatch console island: the experiment's App + panels, restyled and driven by
// batched decision-machine-1 calls. Nothing runs until Start is pressed, and a run
// stops itself after RUN_SECONDS.

import { useCallback, useEffect, useRef, useState } from "react";
import { Dm1Error, type YesNoResult } from "../../lib/dm1.ts";
import { SEVERITY_LEVELS, type Severity } from "./data.ts";
import { fmtMs, fmtSeconds } from "./kpi.ts";
import { MapView } from "./MapView.tsx";
import {
  DEFAULT_SEED,
  RUN_SECONDS,
  Sim,
  type FeedItem,
  type Incident,
  type LogEntry,
  type Mode,
} from "./sim.ts";
import {
  CATEGORY_LABELS,
  DUPLICATE_HINTS,
  DUPLICATE_STATEMENT,
  HINTS,
  PACKAGE_LABELS,
  LOW_CONFIDENCE,
  SEVERITY_SCALE,
  STATEMENTS,
  buildDecision,
  composePair,
  composeText,
  mergeCandidate,
  type Decision,
  type TriageBatch,
  type TriageItem,
} from "./triage.ts";
import "./demo.css";
import { stockBatch } from "../../lib/stock-batch";
import { STOCK_TEXTS, STOCK_PAIRS } from "./stock";
import type { ClassifyResult, RateResult } from "../../lib/dm1";

const CHANNEL_LABEL = { call: "CALL", sms: "SMS", sensor: "SENS" } as const;

/** /yes-no with `texts` returns one entry per text, each holding one entry per statement. */
interface YesNoBatch {
  results: { results: YesNoResult[] }[];
}

/**
 * One batch of reports: four calls over the report texts (category, severity, unit package,
 * three yes/no statements) plus, when any report has an open incident close enough to be the
 * same event, one more yes/no call over "open incident + new report" pair texts. All run in
 * parallel; src/lib/dm1.ts keeps the page under three calls per second.
 */
async function triageBatch(items: TriageItem[], signal: AbortSignal): Promise<TriageBatch> {
  const texts = items.map((i) => composeText(i.report));
  const pairs = items.flatMap((item, index) => {
    const candidate = mergeCandidate(item.nearby);
    return candidate ? [{ index, text: composePair(candidate, item.report) }] : [];
  });
  const [cat, sev, pack, nouls, dup] = await Promise.all([
    stockBatch<{results: ClassifyResult[]}>("classify", { texts, labels: CATEGORY_LABELS }, STOCK_TEXTS, signal),
    stockBatch<{results: RateResult[]}>("rate", { texts, scale: SEVERITY_SCALE }, STOCK_TEXTS, signal),
    stockBatch<{results: ClassifyResult[]}>("classify", { texts, labels: PACKAGE_LABELS }, STOCK_TEXTS, signal),
    stockBatch<YesNoBatch>("yes-no", { texts, statements: STATEMENTS, ...HINTS }, STOCK_TEXTS, signal),
    pairs.length
      ? stockBatch<YesNoBatch>("yes-no", { texts: pairs.map((p) => p.text), statements: [DUPLICATE_STATEMENT], ...DUPLICATE_HINTS }, STOCK_PAIRS, signal)
      : null,
  ]);
  const dupP = new Array<number>(items.length).fill(0);
  pairs.forEach((pair, i) => (dupP[pair.index] = dup?.data.results[i]?.results[0]?.probability ?? 0));
  const decisions = items.map((item, i) =>
    buildDecision(item.report, item.nearby, cat.data.results[i], sev.data.results[i], pack.data.results[i], nouls.data.results[i]?.results ?? [], dupP[i]),
  );
  const calls = [cat.meta, sev.meta, pack.meta, nouls.meta];
  if (dup) calls.push(dup.meta);
  return { decisions, calls };
}

export default function Demo() {
  const mode: Mode = "live";
  const [running, setRunning] = useState(false);
  const [, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const makeSim = useCallback((m: Mode) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const decider = async (items: TriageItem[]) => {
      try {
        return await triageBatch(items, ac.signal);
      } catch (e) {
        throw e instanceof Dm1Error ? new Error(`${e.code} (${e.status}): ${e.message}`) : e;
      }
    };
    return new Sim(m, DEFAULT_SEED, m === "live" ? decider : null);
  }, []);

  const simRef = useRef<Sim | null>(null);
  if (!simRef.current) simRef.current = makeSim("live");
  const runningRef = useRef(running);
  runningRef.current = running;

  const load = useCallback(
    (m: Mode, start: boolean) => {
      simRef.current = makeSim(m);
      setError(null);
      setRunning(start);
      setTick((t) => t + 1);
    },
    [makeSim],
  );

  useEffect(() => () => abortRef.current?.abort(), []);

  // One animation loop for the page; it only advances the sim while `running`.
  useEffect(() => {
    let last = performance.now();
    let acc = 0;
    let errorAtCall: number | null = null;
    let raf = requestAnimationFrame(function loop(now: number) {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const sim = simRef.current;
      if (sim && runningRef.current && sim.finalKpis === null) {
        const simDt = dt;
        for (let s = simDt; s > 0; s -= 0.05) sim.step(Math.min(0.05, s));
        if (sim.lastError) {
          setError(sim.lastError);
          errorAtCall = sim.calls;
          sim.lastError = null;
        } else if (errorAtCall !== null && sim.calls !== errorAtCall) {
          // A later batch landed clean, so the red line is stale.
          errorAtCall = null;
          setError(null);
        }
      }
      acc += dt;
      if (acc >= 0.1) {
        acc = 0;
        setTick((t) => t + 1);
      }
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const sim = simRef.current!;
  const k = sim.kpis();
  const done = sim.finalKpis !== null;
  const started = sim.feed.length > 0 || done;

  useEffect(() => {
    if (sim.finalKpis) setRunning(false);
  }, [sim, sim.finalKpis]);

  return (
    <div className="d-dispatch">
      <div className="panel controls">
        <button className="btn primary" onClick={() => (running ? setRunning(false) : done ? load(mode, true) : setRunning(true))}>
          {running ? "Stop" : done ? "Run again" : started ? "Resume" : `Run ${RUN_SECONDS}s stream`}
        </button>
        <button className="btn" onClick={() => load(mode, false)}>
          Reset
        </button>
        <button className="btn" disabled={!running} onClick={() => sim.surge()} title="40 extra reports over 10 seconds">
          Surge · 40 in 10 s
        </button>
        <span className="clock mono">
          {fmtSeconds(Math.min(sim.time, RUN_SECONDS))} / {RUN_SECONDS}s{done ? " ✓" : ""}
        </span>
      </div>

      <p className="muted dispatch-summary" role="status">
        The model prioritizes incoming reports and recommends response units. {k.api.fallbacks > 0 && <span className="warn">{k.api.fallbacks} reports used fallback rules because a model decision was unavailable.</span>}
      </p>
      {error && (
        <p className="error">
          {error} — the queue keeps running on the deterministic keyword fallback.
        </p>
      )}

      <div className="kpis">
        <Kpi label="Median dispatch" value={k.medianDispatchS ? fmtSeconds(k.medianDispatchS) : "–"} sub="simulated report arrival to unit assigned" tone={k.medianDispatchS > 30 ? "hot" : k.medianDispatchS > 5 ? "warn" : "good"} />
        <Kpi label="Critical incidents waiting" value={String(k.criticalWaiting)} sub="high severity, no unit for over 60 s" tone={k.criticalWaiting > 0 ? "hot" : "good"} />
        <Kpi label="In queue" value={String(k.queued)} sub="reports awaiting a triage decision" tone={k.queued > 20 ? "hot" : k.queued > 5 ? "warn" : undefined} />
        <Kpi label="Units idle" value={`${k.unitsIdle} / ${k.unitsTotal}`} sub={`${k.incidentsOpen} open · ${k.incidentsClosed} closed`} />
        <Kpi label="Duplicates merged" value={String(k.merged)} sub={`${k.reportsDecided} / ${k.reportsArrived} triaged`} />
        <Kpi label="Decisions / s" value={k.api.decisionsPerSec.toFixed(1)} sub="trailing 10 s" tone="purple" />
      </div>

      <div className="stage">
        <Feed items={sim.feed} preview={started ? null : sim.schedule.slice(0, 14)} time={sim.time} />
        <MapView city={sim.city} units={sim.units} incidents={sim.incidents} time={sim.time} caption={`seed ${DEFAULT_SEED} · ${sim.schedule.length} reports · ${sim.city.depots.length} depots`} />
        <Incidents incidents={sim.incidents} time={sim.time} />
      </div>

      <div className="bottom">
        <EventLog log={sim.log} />
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "hot" | "warn" | "good" | "purple" }) {
  return (
    <div className={`kpi ${tone ?? ""}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value mono">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

function Chip({ category }: { category: string | null }) {
  if (!category) return <span className="tag">pending</span>;
  return <span className={`tag cat cat-${category}`}>{category.replace("_", " ")}</span>;
}

function SeverityBar({ level }: { level: Severity | null }) {
  const n = level === null ? 0 : level + 1;
  return (
    <span className="sev" title={level === null ? "not triaged yet" : SEVERITY_LEVELS[level]}>
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} className={i < n ? `on s${level}` : ""} />
      ))}
    </span>
  );
}

/** The label the model itself put on top, for the tag that says the keywords overruled it. */
function topLabel(probs: Record<string, number>): string {
  return Object.entries(probs).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "?";
}

function ProbRows({ probs, pick }: { probs: Record<string, number>; pick: string }) {
  const rows = Object.entries(probs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  return (
    <>
      {rows.map(([key, p]) => (
        <div className="prow" key={key}>
          <span>{key}</span>
          <span className="bar">
            <i className={key === pick ? "pick" : ""} style={{ width: `${Math.round(p * 100)}%` }} />
          </span>
          <span className="v mono">{(p * 100).toFixed(0)}%</span>
        </div>
      ))}
    </>
  );
}

function Probs({ d, latencyMs, top }: { d: Decision; latencyMs: number | null; top: number }) {
  return (
    <div className="probs panel" style={{ top }}>
      <p className="panel-title">/classify category · confidence {(d.categoryConfidence * 100).toFixed(0)}%</p>
      <ProbRows probs={d.categoryProbs} pick={d.category} />
      <p className="panel-title">/rate severity · {SEVERITY_LEVELS[d.severity]}</p>
      <ProbRows probs={d.severityProbs} pick={String(d.severity)} />
      <p className="panel-title">/classify unit package</p>
      <ProbRows probs={d.unitsProbs} pick={d.units} />
      <p className="panel-title">/yes-no statements</p>
      {[
        ["multiple victims", d.multipleVictims],
        ["hazmat / fire spread", d.hazmat],
        ["caller in danger", d.callerInDanger],
      ].map(([label, p]) => (
        <div className="prow" key={label as string}>
          <span>{label as string}</span>
          <span className="bar">
            <i style={{ width: `${(p as number) * 100}%` }} />
          </span>
          <span className="v mono">{((p as number) * 100).toFixed(0)}%</span>
        </div>
      ))}
      <div className="prow">
        <span>duplicate of open incident</span>
        {d.dupAsked ? (
          <>
            <span className="bar">
              <i style={{ width: `${d.duplicateP * 100}%` }} />
            </span>
            <span className="v mono">{(d.duplicateP * 100).toFixed(0)}%</span>
          </>
        ) : (
          <span className="muted">not asked (nothing open nearby)</span>
        )}
      </div>
      <p className="probs-meta muted">
        {d.source}
        {d.lowConfidence && d.source === "live"
          ? d.categoryConfidence < LOW_CONFIDENCE
            ? " · low confidence → keyword category"
            : ` · keyword override → ${d.category}`
          : ""}
        {latencyMs !== null ? ` · ${fmtMs(latencyMs)} ms batch round trip` : ""}
        {d.mergeInto ? ` · merge → ${d.mergeInto}` : ""}
      </p>
    </div>
  );
}

const PROBS_HEIGHT = 460;

function Feed({ items, preview, time }: { items: FeedItem[]; preview: FeedItem["report"][] | null; time: number }) {
  const [hover, setHover] = useState<{ id: string; top: number } | null>(null);
  const hovered = hover ? items.find((f) => f.report.id === hover.id) : undefined;
  return (
    <div className="panel feed-panel">
      <p className="panel-title">
        Incoming reports <span className="muted">· {preview ? `${preview.length} of the seeded stream` : `${items.length} arrived`}</span>
      </p>
      <div className="scroll" onMouseLeave={() => setHover(null)}>
        {preview?.map((r) => (
          <div className="feed-item queued" key={r.id}>
            <div className="feed-head">
              <span className="chan">{CHANNEL_LABEL[r.channel]}</span>
              <span className="id mono">{r.id}</span>
              <span className="addr">{r.address}</span>
              <span className="muted mono">t+{r.t.toFixed(1)}s</span>
            </div>
            <div className="feed-text">{r.text}</div>
          </div>
        ))}
        {items
          .slice(-60)
          .reverse()
          .map((f) => {
            const d = f.decision;
            const wait = (f.decidedAt ?? time) - f.report.t;
            return (
              <div
                key={f.report.id}
                className={`feed-item ${f.status}`}
                onMouseEnter={(e) => {
                  const top = e.currentTarget.getBoundingClientRect().top;
                  setHover({ id: f.report.id, top: Math.max(8, Math.min(top, window.innerHeight - PROBS_HEIGHT)) });
                }}
              >
                <div className="feed-head">
                  <span className="chan">{CHANNEL_LABEL[f.report.channel]}</span>
                  <span className="id mono">{f.report.id}</span>
                  <span className="addr">{f.report.address}</span>
                  <span className="muted mono">{f.status === "done" ? "" : f.status === "deciding" ? "deciding…" : `queued ${fmtSeconds(wait)}`}</span>
                </div>
                <div className="feed-text">{f.report.text}</div>
                <div className="feed-foot">
                  <Chip category={d?.category ?? null} />
                  <SeverityBar level={d?.severity ?? null} />
                  {d?.source === "fallback" && <span className="tag warn">{f.timedOut ? "timeout → heuristic" : "heuristic"}</span>}
                  {d?.source === "live" && d.lowConfidence && (
                    <span className="tag warn" title={`model said ${topLabel(d.categoryProbs)} at ${(d.categoryConfidence * 100).toFixed(0)}%`}>
                      {d.categoryConfidence < LOW_CONFIDENCE ? "low confidence → keywords" : "keyword override"}
                    </span>
                  )}
                  {f.outcome && (
                    <span className={`tag ${f.outcome === "merged" ? "purple" : f.outcome === "new" ? "good" : ""}`}>
                      {f.outcome === "merged" ? `→ ${f.incidentId}` : f.outcome === "new" ? f.incidentId : "no action"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        {!preview && items.length === 0 && <p className="muted">Waiting for the first report.</p>}
      </div>
      {hover && hovered?.decision && <Probs d={hovered.decision} latencyMs={hovered.latencyMs} top={hover.top} />}
    </div>
  );
}

function Incidents({ incidents, time }: { incidents: Incident[]; time: number }) {
  const open = incidents.filter((i) => i.status !== "closed").sort((a, b) => b.severity - a.severity || a.firstReportT - b.firstReportT);
  const closed = incidents.length - open.length;
  return (
    <div className="panel inc-panel">
      <p className="panel-title">
        Open incidents <span className="muted">· {open.length} open · {closed} closed</span>
      </p>
      <div className="scroll">
        {open.map((i) => (
          <div key={i.id} className={`inc ${i.status}`}>
            <div className="inc-head">
              <span className="id mono">{i.id}</span>
              <Chip category={i.category} />
              <SeverityBar level={i.severity} />
              <span className="muted mono">{fmtSeconds(time - i.firstReportT)}</span>
            </div>
            <div className="inc-addr muted">
              {i.address} · {i.summary}
            </div>
            <div className="inc-foot">
              <span className="status">{i.status.replace("_", " ")}</span>
              <span className="units mono">{i.unitIds.length ? i.unitIds.join(" ") : `needs ${i.required.join("+")}`}</span>
              {i.mergedCount > 0 && <span className="tag purple">+{i.mergedCount} merged</span>}
            </div>
          </div>
        ))}
        {open.length === 0 && <p className="muted">No open incidents.</p>}
      </div>
    </div>
  );
}

function EventLog({ log }: { log: LogEntry[] }) {
  return (
    <div className="panel log-panel">
      <p className="panel-title">Event log</p>
      <div className="lines mono">
        {log
          .slice(-40)
          .reverse()
          .map((e, idx) => (
            <div className="line" key={`${e.t}-${idx}`}>
              <span className="t">{fmtSeconds(e.t)}</span>
              <span className={`k ${e.kind}`}>{e.kind.replace("_", " ")}</span>
              <span>{e.text}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
