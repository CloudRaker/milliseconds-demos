import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { classify, yesNo, Dm1Error } from "../../lib/dm1";
import {
  askStep, decide, fallback, flatten, rect, actionTarget, isTerminal, summary, textCandidates,
  type Answers, type AXNode, type AXSnapshot, type Ask, type Decision, type FlatElement, type FlatTree,
  type PilotContext, type Rect, type StepRecord,
} from "./pilot";
import { APPS, PRESETS, RECORDED, applyAction, snapshot, type SimApp, type SimNode } from "./data";
import "./demo.css";

/** Bound both cached demonstrations and live custom runs. */
const MAX_STEPS = 12;
const RUN_MS = 60_000;

interface LogRow {
  step: number;
  action: string;
  target?: string;
  source: string;
  ms?: number;
  goalReached: number;
  elements: number;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (p: number) => `${Math.round(p * 100)}%`;
/** One paint, or 100 ms: requestAnimationFrame never fires while the tab sits in the background,
 *  and a run left behind on another tab must still finish rather than hang on step one. */
const nextFrame = () =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 100);
    requestAnimationFrame(done);
  });

/**
 * The AX reader. The Swift app walked the frontmost window's AXUIElement children and read each
 * one's role, title, value, state and on-screen frame. This walks the rendered window and reads the
 * same six things back off the DOM, with getBoundingClientRect() as the frame, so the pruning step
 * runs over the drawn UI rather than over a list handed to it. Every control publishes those six as
 * data-ax-*, which is what an AppKit view publishes to an accessibility client. Returns undefined
 * before the window is mounted; the caller then falls back to the app's own node list.
 */
function readWindow(root: HTMLElement | null, appName: string, windowTitle: string): AXSnapshot | undefined {
  if (!root) return undefined;
  const box = (el: Element): Rect => {
    const r = el.getBoundingClientRect();
    return rect(Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height));
  };
  const plain: AXNode[] = [];
  const inSheet: AXNode[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-ax-role]"))) {
    const d = el.dataset;
    const node: AXNode = {
      role: d.axRole as string,
      subrole: d.axSubrole || undefined,
      title: d.axTitle || undefined,
      value: d.axValue || undefined,
      enabled: true,
      focused: d.axFocused === "1",
      selected: d.axSelected === "1",
      frame: box(el),
      key: d.axKey,
    };
    (el.closest(".g-sheet") ? inSheet : plain).push(node);
  }
  if (!plain.length && !inSheet.length) return undefined;
  // The window frame is the union of what was read, not the .win box: a sidebar tall enough to
  // scroll would otherwise have its lower rows pruned as off-window, and nothing here scrolls one
  // on purpose. ponytail: union rect, switch to the .win box if a simulated app ever does scroll.
  const all = [...plain, ...inSheet].map((n) => n.frame as Rect);
  const x = Math.min(...all.map((f) => f.x));
  const y = Math.min(...all.map((f) => f.y));
  const frame = rect(x, y, Math.max(...all.map((f) => f.x + f.w)) - x, Math.max(...all.map((f) => f.y + f.h)) - y);
  const children: AXNode[] = [...plain];
  if (inSheet.length) children.push({ role: "AXSheet", enabled: true, frame, children: inSheet });
  return {
    appName,
    windowTitle,
    root: {
      role: "AXApplication",
      title: appName,
      children: [{ role: "AXWindow", title: windowTitle, frame, children }],
    },
  };
}

/** Both stock and personal calls use the shared transport and its provenance ledger. */
function createAsk(signal: AbortSignal): Ask {
  return {
    classify: async (text, labels) => {
      const { result } = await classify(text, labels, signal);
      return { label: result.label, probability: result.probability, scores: result.scores };
    },
    yesNo: async (text, statements) => {
      const { results } = await yesNo(text, statements, undefined, signal);
      return results.map((result) => result.probability);
    },
  };
}

export default function Demo() {
  const [tab, setTab] = useState<"sim" | "recorded">("sim");
  const [presetIndex, setPresetIndex] = useState(0);
  const [custom, setCustom] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preset = PRESETS[presetIndex];
  const goal = custom.trim() || preset.goal;
  const stockPreset = PRESETS.find((item) => item.goal === goal);
  const appName = useMemo(() => {
    const named = Object.keys(APPS).find((n) => goal.toLowerCase().includes(n.toLowerCase()));
    return named ?? preset.app;
  }, [goal, preset.app]);
  const app = APPS[appName] as SimApp;

  // App and state travel together: picking another goal must not render Notes with Calculator state.
  const [sim, setSim] = useState<{ name: string; state: any }>(() => ({ name: appName, state: app.initial() }));
  const appState = sim.name === appName ? sim.state : app.initial();
  const setAppState = useCallback((state: any) => setSim({ name: appName, state }), [appName]);
  const [status, setStatus] = useState("Idle. Pick a goal and press Run.");
  const [log, setLog] = useState<LogRow[]>([]);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [runMs, setRunMs] = useState(0);
  const [outcome, setOutcome] = useState<"verified" | "unverified" | null>(null);
  const stopRef = useRef<{ stop: boolean; abort?: AbortController }>({ stop: true });
  const winRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => () => { stopRef.current.stop = true; stopRef.current.abort?.abort(); }, []);

  // Point the goal at another app and the desktop starts over, with the seed state already visible.
  useEffect(() => {
    if (!stopRef.current.stop) return;
    setSim({ name: appName, state: app.initial() });
    setLog([]);
    setDecision(null);
    setAnswers(null);
    setHighlight(null);
    setOutcome(null);
    setStatus("Idle. Pick a goal and press Run.");
    setError(null);
    setRunMs(0);
  }, [app, appName, goal]);

  const stop = useCallback((why: string) => {
    stopRef.current.stop = true;
    stopRef.current.abort?.abort();
    setRunning(false);
    setStatus(why);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !stopRef.current.stop) stop("Stopped with Escape.");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stop]);

  async function run() {
    const ctl = { stop: false, abort: new AbortController() };
    stopRef.current = ctl;
    setRunning(true);
    setError(null);
    setLog([]);
    setDecision(null);
    setAnswers(null);
    setOutcome(null);
    setRunMs(0);
    let state = app.initial();
    flushSync(() => setAppState(state));

    const candidates = textCandidates(goal);
    const history: StepRecord[] = [];
    const typedTexts: string[] = [];
    const startedAt = Date.now();
    let failures = 0;

    for (let step = 1; step <= MAX_STEPS; step++) {
      if (ctl.stop) return;
      if (Date.now() - startedAt > RUN_MS) return stop("Stopped: the 60 second run limit was reached.");
      setStatus(`Step ${step} of ${MAX_STEPS}: reading the tree…`);
      // Let the window paint the state this step acts on, then read that window back off the screen.
      await nextFrame();
      if (ctl.stop) return;
      // Stock traces use the canonical tree published by this exact simulated state.
      // Custom goals still read the rendered desktop; arbitrary DOM is never sponsored.
      const tree = flatten(stockPreset ? snapshot(app, state) : readWindow(winRef.current, app.name, app.title(state)) ?? snapshot(app, state), goal);
      const ctx: PilotContext = { goal, step, textCandidates: candidates, typedTexts, history };
      let next: Decision;
      const t0 = performance.now();
      setStatus(`Step ${step} of ${MAX_STEPS}: choosing the next action…`);
      try {
        const a = await askStep(tree, ctx, createAsk(ctl.abort.signal));
        if (ctl.stop) return;
        setError(null);
        setAnswers(a);
        next = decide(a, tree, ctx);
      } catch (e) {
        if (ctl.stop) return;
        failures += 1;
        const why = e instanceof Dm1Error ? `${e.code}: ${e.message}` : String((e as Error)?.message ?? e);
        setError(why);
        setAnswers(null);
        if (stockPreset || (e instanceof Dm1Error && e.status === 401)) return stop("Stopped: the request failed. Try again when it is available.");
        next = { action: fallback(tree, ctx), source: "fallback", goalReached: 0, needsText: 0, isDestructive: 0, confidence: 0, probabilities: [] };
        if (failures >= 3) {
          setDecision(next);
          return stop("Stopped: three model steps failed.");
        }
      }

      const { action } = next;
      setDecision(next);
      setHighlight(action.kind === "press" ? (action.element.key ?? null) : null);
      const row: LogRow = {
        step,
        action: action.kind,
        target: actionTarget(action),
        source: next.source,
        ms: Math.round(performance.now() - t0),
        goalReached: next.goalReached,
        elements: tree.elements.length,
      };
      setLog((l) => [...l, row]);
      setRunMs(Date.now() - startedAt);
      history.push({ step, action: action.kind, target: actionTarget(action), source: next.source });
      if (action.kind === "type_text") typedTexts.push(action.text);
      state = applyAction(app, state, action);
      // The next decision reads the DOM; commit this action before it can read the previous tree.
      flushSync(() => setAppState(state));
      const settle = app.settleMs?.(state) ?? 0;
      if (settle) await sleep(settle);
      if (ctl.stop) return;
      setRunMs(Date.now() - startedAt);
      // The app state is the result. Stop as soon as it passes, before another action can undo it.
      if (stockPreset?.verify(state)) {
        setOutcome("verified");
        setHighlight(null);
        return stop(`Verified in the simulated app: ${stockPreset.expect}.`);
      }
      if (isTerminal(action)) {
        setOutcome(action.kind === "done" ? "unverified" : null);
        const source = next.source === "model" ? "The model" : "The fallback rule";
        return stop(
          action.kind === "done"
            ? !stockPreset
              ? `${source} reported completion. Custom goals have no independent app-state check; inspect the result.`
              : `${source} reported completion, but the app-state check did not pass. Expected: ${stockPreset.expect}.`
            : `${action.kind === "blocked" ? "Blocked" : "Stuck"}: ${actionTarget(action)}`,
        );
      }
    }
    stop(`Stopped: the ${MAX_STEPS} step limit was reached.`);
  }

  const tree = useMemo(() => flatten(snapshot(app, appState), goal), [app, appState, goal]);

  return (
    <div className="d-ax-pilot">
      <div className="tabs" role="tablist">
        <button className={`tab ${tab === "sim" ? "on" : ""}`} role="tab" aria-selected={tab === "sim"} disabled={running} onClick={() => setTab("sim")}>
          Simulated desktop
        </button>
        <button className={`tab ${tab === "recorded" ? "on" : ""}`} role="tab" aria-selected={tab === "recorded"} disabled={running} onClick={() => setTab("recorded")}>
          Recorded macOS trees
        </button>
      </div>

      {tab === "sim" ? (
        <div className="stage">
          <section className="panel controls">
            <label className="panel-title" htmlFor="ax-goal">Choose a goal</label>
            <select id="ax-goal" className="select" value={presetIndex} disabled={running} onChange={(e) => { setPresetIndex(Number(e.target.value)); setCustom(""); }}>
              {PRESETS.map((p, i) => <option key={p.goal} value={i}>{p.goal}</option>)}
            </select>
            {stockPreset && <p className="hint muted">Goal: {stockPreset.expect}.</p>}
            <input
              className="input"
              aria-label="Custom pilot goal"
              placeholder="Or a custom goal naming one of the five apps"
              value={custom}
              disabled={running}
              onChange={(e) => setCustom(e.target.value)}
            />
            <p className="hint muted">
              The pilot will operate <b>{appName}</b> in the simulated window. Your real apps stay untouched.
            </p>
            <p className="hint muted">{stockPreset ? "Free recorded example: real model decisions replay against this simulated app. Fallback rules and the final app-state check still run in your browser." : "Custom goals run live with your API key."}</p>
            {custom && <button className="btn" disabled={running} onClick={() => setCustom("")}>Restore example</button>}
            <div className="row">
              <button className="btn primary" onClick={running ? () => stop("Stopped.") : run}>
                {running ? "Stop" : stockPreset ? "Run example" : "Run custom goal"}
              </button>
              <span className="muted small">{running ? "Escape stops it too." : `At most ${MAX_STEPS} steps or 60 seconds.`}</span>
            </div>
            {error && <p className={outcome === "verified" ? "hint muted" : "error"}>
              {outcome === "verified" ? "Completed using a fallback after a model request failed: " : "Model request failed: "}{error}
            </p>}
          </section>

          <section className="panel stagepanel">
            <p className="panel-title">Simulated {appName}</p>
            <p className="muted small">
              Watch each model decision choose a control, then check the result in the simulated app. Stock goals replay recorded decisions; custom goals use live inference.
            </p>
            <Window app={app} state={appState} highlight={highlight} winRef={winRef} />
          </section>

          <section className="panel hud">
            <p className="panel-title">Run progress</p>
            <p className={`status ${running ? "live" : ""}`} role="status">
              {outcome === "verified" && <span className="tag good">Goal completed</span>}
              {outcome === "unverified" && <span className="tag warn">Completion not verified</span>} {status}
            </p>
            <div className="metrics">
              <span>
                <b>{tree.elements.length}</b> elements in tree
              </span>
              <span>
                <b>{log.length}</b> of {MAX_STEPS} steps
              </span>
              <span>
                <b>{(runMs / 1000).toFixed(1)} s</b> on the run clock
              </span>
            </div>
            {decision && <p className="panel-title">Last action</p>}
            {decision && (
              <p className="decision">
                <span className={`tag ${decision.source === "model" ? "purple" : "warn"}`}>{decision.source}</span>{" "}
                <b className="mono">{decision.action.kind}</b> <span className="muted mono">{actionTarget(decision.action)}</span>
              </p>
            )}
            {answers && (
              <details>
                <summary className="small muted">Model assessment before the last action</summary>
                <Nouls answers={answers} />
                <p className="panel-title">Action candidates</p>
                <Bars rows={answers.probabilities.slice(0, 7)} />
              </details>
            )}
            {!decision && !running && <p className="muted small">Pick a goal and run the pilot to see its decisions.</p>}
          </section>

          <section className="panel logpanel">
            <p className="panel-title">Steps</p>
            {log.length === 0 && <p className="muted small">Each step shows the chosen action and whether it came from the model or a fallback rule.</p>}
            <ol className="log">
              {log.map((r) => (
                <li key={r.step}>
                  <span className="muted">{String(r.step).padStart(2, "0")}</span>
                  <b>{r.action}</b>
                  <span className="target">{r.target}</span>
                  <span className={`tag ${r.source === "model" ? "purple" : "warn"}`}>{r.source}</span>
                  <span className="muted mono">{r.ms} ms delivery</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : (
        <Recorded />
      )}
    </div>
  );
}

function Nouls({ answers }: { answers: Answers }) {
  const rows: Array<[string, number]> = [
    ["goal reached", answers.goalReached],
    ["needs text input", answers.needsText],
    ["destructive", answers.destructive],
  ];
  return (
    <div className="nouls">
      {rows.map(([label, p]) => (
        <div key={label}>
          <span>{label}</span>
          <div className="bar">
            <i style={{ width: `${Math.round(p * 100)}%` }} />
          </div>
          <span className="mono">{pct(p)}</span>
        </div>
      ))}
    </div>
  );
}

function Bars({ rows }: { rows: Array<[string, number]> }) {
  return (
    <div className="bars">
      {rows.map(([label, p]) => (
        <div key={label}>
          <span className="blabel">{label}</span>
          <div className="bar">
            <i style={{ width: `${Math.round(p * 100)}%` }} />
          </div>
          <span className="mono">{pct(p)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- the simulated window

function Window({
  app, state, highlight, winRef,
}: {
  app: SimApp;
  state: any;
  highlight: string | null;
  winRef?: { current: HTMLDivElement | null };
}) {
  const nodes = app.nodes(state);
  const of = (group: SimNode["group"]) => nodes.filter((n) => n.group === group);
  const draw = (list: SimNode[]) => list.map((n) => <Control key={n.key} node={n} highlight={highlight} />);
  const sheet = of("sheet");
  const sidebar = of("sidebar");
  return (
    <div className="win" data-app={app.name} ref={winRef}>
      <div className="win-bar">
        <i /> <i /> <i />
        <b>{app.title(state)}</b>
      </div>
      {of("tabs").length > 0 && <div className="g-tabs">{draw(of("tabs"))}</div>}
      {of("toolbar").length > 0 && <div className="g-toolbar">{draw(of("toolbar"))}</div>}
      <div className="win-main">
        {sidebar.length > 0 && <div className="g-sidebar">{draw(sidebar)}</div>}
        <div className="g-content">
          {of("display").length > 0 && <div className="g-display">{draw(of("display"))}</div>}
          {of("pane").length > 0 && <div className="g-pane">{draw(of("pane"))}</div>}
          {of("page").length > 0 && <div className="g-page">{draw(of("page"))}</div>}
          {of("keys").length > 0 && <div className="g-keys">{draw(of("keys"))}</div>}
        </div>
      </div>
      {sheet.length > 0 && (
        <div className="g-sheet">
          <div className="sheet-card">{draw(sheet)}</div>
        </div>
      )}
    </div>
  );
}

/** What each rendered control publishes for readWindow() to read back, as an AppKit view would. */
const axAttrs = (node: SimNode) => ({
  "data-ax-role": node.role,
  "data-ax-subrole": node.subrole,
  "data-ax-title": node.title,
  "data-ax-value": node.value,
  "data-ax-key": node.key,
  "data-ax-focused": node.focused ? "1" : undefined,
  "data-ax-selected": node.selected ? "1" : undefined,
});

function Control({ node, highlight }: { node: SimNode; highlight: string | null }) {
  const text = node.display ?? node.title ?? node.value ?? "";
  const ax = axAttrs(node);
  const cls = [
    "ctl",
    node.selected ? "sel" : "",
    node.focused ? "foc" : "",
    highlight && node.key === highlight ? "hl" : "",
  ]
    .filter(Boolean)
    .join(" ");
  if (node.role === "AXStaticText") return <p className="txt" {...ax}>{node.value}</p>;
  if (node.role === "AXTextField" || node.role === "AXTextArea") {
    return (
      <div className={`${cls} field ${node.role === "AXTextArea" ? "area" : ""}`} aria-label={node.title} {...ax}>
        {node.value || <span className="ph">{node.title ?? "empty"}</span>}
      </div>
    );
  }
  if (node.role === "AXRow" || node.role === "AXTab")
    return <div className={`${cls} ${node.role === "AXTab" ? "tab-chip" : "row"}`} {...ax}>{text}</div>;
  // No role="button" and no aria-selected: the visitor never operates these, the pilot does, and a
  // focusable control that does nothing when clicked reads worse to a screen reader than the plain
  // label already in reading order. The accessibility data the reader needs rides on data-ax-*.
  return <div className={cls} {...ax}>{text}</div>;
}

// ---------------------------------------------------------------- recorded trees

function Recorded() {
  const [results, setResults] = useState<Record<string, { answers: Answers; decision: Decision }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<{ stop: boolean; abort?: AbortController }>({ stop: true });

  useEffect(() => () => { stopRef.current.stop = true; stopRef.current.abort?.abort(); }, []);

  async function judge() {
    const ctl = { stop: false, abort: new AbortController() };
    stopRef.current = ctl;
    setBusy(true);
    setError(null);
    setResults({});
    for (const entry of RECORDED) {
      if (ctl.stop) break;
      const ctx: PilotContext = {
        goal: entry.goal,
        step: 1,
        textCandidates: textCandidates(entry.goal),
        typedTexts: [],
        history: [],
      };
      try {
        const answers = await askStep(entry.tree as FlatTree, ctx, createAsk(ctl.abort.signal));
        if (ctl.stop) break;
        setResults((r) => ({ ...r, [entry.file]: { answers, decision: decide(answers, entry.tree as FlatTree, ctx) } }));
      } catch (e) {
        if (ctl.stop) break;
        setError(e instanceof Dm1Error ? `${e.code}: ${e.message}` : String((e as Error)?.message ?? e));
        break;
      }
    }
    ctl.stop = true;
    setBusy(false);
  }

  return (
    <div className="stage recorded">
      <section className="panel controls">
        <p className="panel-title">Five real macOS accessibility trees</p>
        <p className="muted small">
          These saved snapshots describe controls in five macOS apps. Replay the model’s recorded first decision for each goal. No real app is controlled.
        </p>
        <div className="row">
          <button className="btn primary" onClick={busy ? () => { stopRef.current.stop = true; stopRef.current.abort?.abort(); } : judge}>
            {busy ? "Stop" : "Run five recorded examples"}
          </button>
          <span className="muted small">Free recorded examples. Model decisions and usage were captured together.</span>
        </div>
        {error && <p className="error">{error}</p>}
      </section>
      {RECORDED.map((entry) => {
        const got = results[entry.file];
        const chosen = got && (entry.tree as FlatTree).elements.find((e: FlatElement) => e.id === got.answers.choice);
        return (
          <section className="panel rec" key={entry.file}>
            <p className="panel-title">
              {entry.file} · {entry.rawNodes} recorded nodes pruned to {(entry.tree as FlatTree).elements.length}{" "}
              actionable elements
            </p>
            <p className="goalline">{entry.goal}</p>
            <p className="muted small mono">
              {(entry.tree as FlatTree).elements
                .slice(0, 8)
                .map((e: FlatElement) => `${e.id} ${summary(e)}`)
                .join(" · ")}
              {(entry.tree as FlatTree).elements.length > 8 ? " …" : ""}
            </p>
            {got ? (
              <>
                <p className="decision">
                  <span className={`tag ${got.decision.source === "model" ? "purple" : "warn"}`}>{got.decision.source}</span>{" "}
                  <b className="mono">{got.decision.action.kind}</b>{" "}
                  <span className="muted mono">{actionTarget(got.decision.action) ?? (chosen ? summary(chosen) : "")}</span>
                </p>
                <Nouls answers={got.answers} />
                <Bars rows={got.answers.probabilities.slice(0, 5)} />
              </>
            ) : (
              <p className="muted small">Not judged yet.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
