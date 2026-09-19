// Semantic linter on every keystroke. A textarea plus a highlighted overlay stands in for
// the original CodeMirror editor: same gutter dots, squiggles, hover probabilities and
// planted-issue reveal, plus a small regex tokenizer so the six languages are not monochrome.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chunk, classifyMany, dm1, Dm1Error, type ClassifyResult, type YesNoResult } from "../../lib/dm1";
import { changedLines, enclosingFunction, extractFunctions, type Language } from "./analysis.ts";
import { SAMPLES, type Sample } from "./data.ts";
import { evaluate, inScope as scopeOf, pct } from "./eval.ts";
import { heuristicMarker } from "./heuristics.ts";
import {
  batchTexts,
  buildRefs,
  clusterMarkers,
  KIND_LABEL,
  markersFromAnswers,
  PROBE_IDS,
  PROBES,
  scanLines,
  SEVERITY_LABELS,
  SEVERITY_RANK,
  SHOW,
  type LineRef,
  type Marker,
  type ProbeAnswers,
  type SeverityChoice,
} from "./markers.ts";
import "./demo.css";

/** Hard ceiling on one scan: 2 batches = 4 calls = about 2 s on the shared 3 calls/s queue. */
const MAX_BATCHES = 2;
/** Every auto-running loop stops itself after this long. */
const LOOP_MS = 60_000;
const TYPE_MS = 38;
const LINE_H = 20;
/** Calls per batch: one /yes-no per probe plus one /classify. */
const CALLS_PER_BATCH = PROBES.length + 1;

/** Move markers past an edit and drop the ones inside the edited region. */
function shiftMarkers(markers: Map<number, Marker>, prev: string, next: string): Map<number, Marker> {
  const a = prev.split("\n");
  const b = next.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const delta = b.length - a.length;
  const lastChangedPrev = a.length - tail;
  const moved = new Map<number, Marker>();
  for (const [line, m] of markers) {
    if (line < head + 1) moved.set(line, m);
    else if (line > lastChangedPrev) moved.set(line + delta, { ...m, line: line + delta });
    else if (delta === 0 && line <= b.length) moved.set(line, m);
  }
  return moved;
}

// ---------------------------------------------------------------- syntax highlight
const KEYWORDS =
  /^(?:if|else|elif|for|while|do|switch|case|break|continue|return|function|func|fn|def|const|let|var|class|struct|enum|trait|impl|interface|type|import|from|use|package|export|default|async|await|try|catch|except|finally|throw|raise|with|as|in|of|is|not|and|or|new|this|self|pub|mut|match|nil|null|None|undefined|true|false|True|False|local|echo|then|fi|done|esac|select|insert|update|delete|create|table|view|where|join|on|group|order|by|limit|begin|end|declare|returns|exists)$/;
const TOKEN = /(\/\/[^\n]*|#[^\n]*|--[^\n]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d[\w.]*\b)|([A-Za-z_$][\w$]*)/g;

/** Enough highlighting to tell code apart: comments, strings, numbers, keywords. */
function highlight(line: string, lang: Language): (string | { cls: string; text: string })[] {
  const out: (string | { cls: string; text: string })[] = [];
  let at = 0;
  const comment = lang === "sql" ? /^--/ : lang === "python" || lang === "bash" ? /^#/ : /^\/\//;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(line); m !== null; m = TOKEN.exec(line)) {
    if (m.index > at) out.push(line.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[1] !== undefined) {
      if (!comment.test(m[1])) out.push(m[1]);
      else {
        out.push({ cls: "t-com", text: line.slice(m.index) });
        return out;
      }
    } else if (m[2] !== undefined) out.push({ cls: "t-str", text: m[2] });
    else if (m[3] !== undefined) out.push({ cls: "t-num", text: m[3] });
    else if (KEYWORDS.test(m[4])) out.push({ cls: "t-kw", text: m[4] });
    else out.push(m[4]);
  }
  if (at < line.length) out.push(line.slice(at));
  return out;
}

export default function Demo() {
  const [sample, setSample] = useState<Sample>(SAMPLES[0]);
  const [text, setText] = useState(SAMPLES[0].text);
  const [markers, setMarkers] = useState<Map<number, Marker>>(new Map());
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [burst, setBurst] = useState<{ ms: number; calls: number; lines: number } | null>(null);
  const [autoLint, setAutoLint] = useState(false);
  /** which snippet is being typed: the injection one, the dropped-kind one, or neither */
  const [typing, setTyping] = useState<"demo" | "alt" | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const textRef = useRef(text);
  textRef.current = text;
  const genRef = useRef(0); // bumped on file change; older answers are dropped
  const baseRef = useRef(text); // last text whose changes were sent
  const scrollRef = useRef<HTMLDivElement>(null);
  const typedRef = useRef(new Set<string>()); // each snippet is appended at most once per file
  const deadlineRef = useRef(0); // wall-clock end of the auto-lint budget, not a timer

  const lines = useMemo(() => text.split("\n"), [text]);
  const shown = useMemo(() => clusterMarkers([...markers.values()]), [markers]);
  const byLine = useMemo(() => new Map(shown.map((m) => [m.line, m])), [shown]);
  // only the planted issues a shipped probe claims can count for or against it. That is finer
  // than kind: the injection probe asks about string-built queries, not about every security row
  const inScope = useMemo(() => scopeOf(sample.planted, PROBE_IDS), [sample]);
  const outOfScopeLines = useMemo(() => sample.planted.filter((p) => !inScope.includes(p)).map((p) => p.line), [sample, inScope]);
  const evaluation = useMemo(() => evaluate(shown, inScope, outOfScopeLines), [shown, inScope, outOfScopeLines]);
  const counts = { error: 0, warning: 0, info: 0 };
  for (const m of shown) counts[m.severity]++;

  /** One batch: one /yes-no per probe plus one /classify, all over the same texts. */
  const judge = useCallback(
    async (refs: LineRef[], gen: number): Promise<{ live: LineRef[]; answers: ProbeAnswers; sev: ClassifyResult[]; calls: number } | null> => {
      const texts = batchTexts(refs);
      const started = performance.now();
      try {
        const [yesNoCalls, sevCall] = await Promise.all([
          Promise.all(PROBES.map((p) => dm1<{ results: YesNoResult[] }>("yes-no", { texts, statement: p.statement, when_true: p.when_true, when_false: p.when_false }))),
          classifyMany(texts, SEVERITY_LABELS),
        ]);
        const ms = performance.now() - started;
        const answers: ProbeAnswers = {};
        PROBES.forEach((p, i) => (answers[p.id] = yesNoCalls[i].data.results));
        const metas = [...yesNoCalls.map((c) => c.meta), sevCall.meta];
        const current = textRef.current.split("\n");
        const keep = gen === genRef.current ? refs.map((r, i) => ({ r, i })).filter(({ r }) => current[r.line - 1] === r.text) : [];
        setError(null);
        const picked: ProbeAnswers = {};
        for (const p of PROBES) picked[p.id] = keep.map(({ i }) => answers[p.id]![i]);
        return { live: keep.map(({ r }) => r), answers: picked, sev: keep.map(({ i }) => sevCall.results[i]), calls: metas.length };
      } catch (err) {
        const message = err instanceof Dm1Error ? `${err.code}: ${err.message}` : String(err);
        setError(message);
        // the editor never goes blank: fall back to the regex rules for this batch
        setMarkers((prev) => {
          const next = new Map(prev);
          for (const r of refs) {
            const m = heuristicMarker(r.line, r.text, sample.language);
            if (m) next.set(r.line, m);
          }
          return next;
        });
        return null;
      }
    },
    [sample.language],
  );

  const runScan = useCallback(async () => {
    const gen = genRef.current;
    const body = textRef.current;
    setBusy(true);
    const started = performance.now();
    const refs = buildRefs(body, sample.language, scanLines(body, sample.language));
    const batches = chunk(refs, 32).slice(0, MAX_BATCHES);
    // A probability is only comparable inside the call it came from, so each batch is ranked
    // against itself and the selections are unioned. Pooling them let batch 2's lines compete
    // against batch 1's scale, and capped a 64-line file at SCAN_MAX markers in total.
    const seen: LineRef[] = [];
    const fresh: Marker[] = [];
    let calls = 0;
    for (const batch of batches) {
      if (gen !== genRef.current) break;
      const r = await judge(batch, gen);
      if (!r) continue;
      calls += r.calls;
      seen.push(...r.live);
      fresh.push(...markersFromAnswers(r.live, r.answers, r.sev, "scan"));
    }
    if (gen === genRef.current && seen.length > 0) {
      // merge: a batch that failed wrote regex markers, and those lines are not in `seen`.
      // Replacing the whole map here would delete them and make the no-blank-editor claim false.
      setMarkers((prev) => {
        const next = new Map(prev);
        for (const r of seen) next.delete(r.line);
        for (const m of fresh) next.set(m.line, m);
        return next;
      });
    }
    baseRef.current = body;
    setBurst({ ms: performance.now() - started, calls, lines: seen.length });
    setBusy(false);
  }, [judge, sample.language]);

  /** Judge the lines the user just edited, grouped by enclosing function. */
  const flushEdits = useCallback(async () => {
    const body = textRef.current;
    const changed = changedLines(baseRef.current, body);
    baseRef.current = body;
    if (changed.length === 0) return;
    const gen = genRef.current;
    const fns = extractFunctions(body, sample.language);
    const groups = new Map<string, number[]>();
    for (const n of changed) {
      const f = enclosingFunction(fns, n);
      const key = f ? `${f.startLine}` : "top";
      groups.set(key, [...(groups.get(key) ?? []), n]);
    }
    for (const g of groups.values()) {
      const refs = buildRefs(body, sample.language, g).slice(0, 32);
      if (refs.length === 0) continue;
      const r = await judge(refs, gen);
      if (!r) continue;
      // a handful of lines has no ranking to stand on: the absolute raise decides
      const fresh = markersFromAnswers(r.live, r.answers, r.sev, "edit");
      setMarkers((prev) => {
        const next = new Map(prev);
        for (const ref of r.live) next.delete(ref.line);
        for (const m of fresh) next.set(m.line, m);
        return next;
      });
    }
  }, [judge, sample.language]);

  // Auto-lint flushes edits every 1.5 s and stops after 60 seconds.
  useEffect(() => {
    if (!autoLint || typing !== null) return;
    if (deadlineRef.current === 0) deadlineRef.current = Date.now() + LOOP_MS;
    const tick = setInterval(() => {
      if (Date.now() >= deadlineRef.current) {
        setAutoLint(false);
        return;
      }
      void flushEdits();
    }, 1500);
    return () => clearInterval(tick);
  }, [autoLint, flushEdits, typing]);

  useEffect(() => {
    if (!autoLint) deadlineRef.current = 0;
  }, [autoLint]);

  // "type it for me": appends one of the two demo snippets a character at a time, once per file
  useEffect(() => {
    if (typing === null) return;
    if (typedRef.current.has(typing)) {
      setTyping(null);
      return;
    }
    const snippet = (textRef.current.endsWith("\n") ? "" : "\n") + (typing === "demo" ? sample.demo : sample.demoAlt);
    typedRef.current.add(typing);
    let i = 0;
    const tick = setInterval(() => {
      if (i >= snippet.length) {
        setTyping(null);
        void flushEdits();
        return;
      }
      const prev = textRef.current;
      const next = prev + snippet[i++];
      textRef.current = next;
      setMarkers((m) => shiftMarkers(m, prev, next));
      setText(next);
    }, TYPE_MS);
    const stop = setTimeout(() => setTyping(null), LOOP_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(stop);
    };
  }, [typing, sample.demo, sample.demoAlt, flushEdits]);

  useEffect(() => {
    if (typing !== null) setAutoLint(true);
  }, [typing]);

  const loadSample = (s: Sample) => {
    genRef.current++;
    setTyping(null);
    setAutoLint(false);
    typedRef.current = new Set();
    setSample(s);
    setText(s.text);
    textRef.current = s.text;
    baseRef.current = s.text;
    setMarkers(new Map());
    setBurst(null);
    setError(null);
  };

  const onEdit = (next: string) => {
    const prev = textRef.current;
    textRef.current = next;
    setMarkers((m) => shiftMarkers(m, prev, next));
    setText(next);
  };

  const width = Math.max(64, ...lines.map((l) => l.length)) + 4;
  const strong = shown.filter((m) => SEVERITY_RANK[m.severity] >= 1).sort((a, b) => a.line - b.line);
  const hoverMarker = hover === null ? undefined : byLine.get(hover);
  const plantedAt = useMemo(() => new Map(sample.planted.map((p) => [p.line, p])), [sample]);

  return (
    <div className="d-jev-lint">
      <div className="jl-tabs">
        {SAMPLES.map((s) => (
          <button key={s.id} className={s.id === sample.id ? "jl-tab on" : "jl-tab"} onClick={() => loadSample(s)}>
            {s.filename}
          </button>
        ))}
      </div>

      <div className="jl-main">
        <div className="panel jl-start">
          <div><p className="panel-title">Check a sample for injection risks</p><p className="muted">Choose a file, then scan it. Findings highlight external input added to queries, commands or paths.</p></div>
          <button className="btn primary" onClick={() => void runScan()} disabled={busy}>{busy ? "Scanning…" : "Scan file"}</button>
        </div>
        <section className="panel jl-editor-panel">
          <div className="jl-head">
            <span className="mono">{sample.filename}</span>
            <span className="tag">{sample.language}</span>
            <span className="jl-counts">
              <b className="sev-error">{counts.error}</b> errors <b className="sev-warning">{counts.warning}</b> warnings <b className="sev-info">{counts.info}</b> info
            </span>
            {busy && <span className="tag purple">judging…</span>}
          </div>

          <div
            className="jl-ed"
            ref={scrollRef}
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const n = Math.floor((e.clientY - box.top + e.currentTarget.scrollTop - 8) / LINE_H) + 1;
              setHover(byLine.has(n) ? n : null);
            }}
          >
            <div className="jl-ed-inner" style={{ width: `${width}ch` }}>
              <div className="jl-gutter">
                {lines.map((_, i) => {
                  const m = byLine.get(i + 1);
                  return (
                    <div key={i} className="jl-ln">
                      <span className="jl-num">{i + 1}</span>
                      {m && <span className={`jl-dot sev-${m.severity}`} />}
                    </div>
                  );
                })}
              </div>
              <div className="jl-code">
                <div className="jl-overlay" aria-hidden="true">
                  {lines.map((l, i) => {
                    const m = byLine.get(i + 1);
                    const lead = l.length - l.trimStart().length;
                    const planted = reveal && plantedAt.has(i + 1);
                    const body = l.slice(lead);
                    return (
                      <div key={i} className={`jl-row${planted ? " planted" : ""}`}>
                        {l.slice(0, lead)}
                        <span className={m ? `jl-sq sev-${m.severity}` : undefined}>
                          {body === ""
                            ? " "
                            : highlight(body, sample.language).map((t, k) =>
                                typeof t === "string" ? <span key={k}>{t}</span> : <span key={k} className={t.cls}>{t.text}</span>,
                              )}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <textarea
                  className="jl-input"
                  aria-label={`Edit ${sample.filename}`}
                  value={text}
                  wrap="off"
                  spellCheck={false}
                  style={{ height: `${lines.length * LINE_H + 16}px` }}
                  onChange={(e) => onEdit(e.target.value)}
                />
                {hoverMarker && (
                  <div className="jl-tip" style={{ top: `${hoverMarker.line * LINE_H + 12}px` }}>
                    <div className="jl-tip-head">
                      <span className={`tag ${hoverMarker.severity === "error" ? "hot" : hoverMarker.severity === "warning" ? "warn" : "purple"}`}>{hoverMarker.severity}</span>
                      <span className="muted mono">line {hoverMarker.line}</span>
                      {hoverMarker.source === "heuristic" && <span className="tag">regex fallback</span>}
                    </div>
                    {hoverMarker.kinds
                      .filter((k) => k.p >= SHOW)
                      .map((k) => (
                        <div key={k.kind} className="jl-tip-row">
                          <span>{KIND_LABEL[k.kind]}</span>
                          <span className="bar">
                            <i style={{ width: `${Math.round(k.p * 100)}%` }} />
                          </span>
                          <b className="mono">{k.p.toFixed(2)}</b>
                        </div>
                      ))}
                    {hoverMarker.severityProbabilities && (
                      <div className="jl-tip-sev">
                        {(["ignore", "info", "warning", "error"] as SeverityChoice[]).map((s) => (
                          <span key={s}>
                            {s} <b className="mono">{(hoverMarker.severityProbabilities?.[s] ?? 0).toFixed(2)}</b>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {error && <p className="error">{error} — showing regex markers for that batch.</p>}
        </section>

        <aside className="jl-side">
          <div className="panel jl-actions">
            <button className={typing === "demo" ? "btn hot" : "btn"} onClick={() => setTyping((t) => (t === "demo" ? null : "demo"))} disabled={typedRef.current.has("demo") && typing !== "demo"}>
              {typing === "demo" ? "Stop typing" : typedRef.current.has("demo") ? "Already typed" : "Type it for me"}
            </button>
            <button className={autoLint ? "btn on" : "btn"} onClick={() => setAutoLint((a) => !a)}>
              {autoLint ? "Stop linting edits" : "Lint my edits"}
            </button>
            <button className={reveal ? "btn on" : "btn"} onClick={() => setReveal((r) => !r)}>
              {reveal ? "Hide planted issues" : "Reveal planted issues"}
            </button>
            <button className="btn" onClick={() => loadSample(sample)}>
              Reset file
            </button>
            <p className="jl-hint muted">Scan a sample file for injection risks: external input added to a query, command or path. Select a finding to inspect its line. “Type it for me” adds a sample issue and checks the completed snippet. Automatic checks stop after 60 seconds.</p>
          </div>

          {burst && (
            <div className="panel jl-burst">
              <p className="panel-title">Last scan</p>
              <p className="muted">{burst.lines} lines checked in the last scan.</p>
            </div>
          )}

          {reveal && (
            <div className="panel">
              <p className="panel-title">
                Planted issues · {inScope.length} judged, {sample.planted.length - inScope.length} out of scope
              </p>
              <div className="jl-pr">
                <div>
                  <div className="jl-big">{pct(evaluation.precision)}</div>
                  <span className="muted">of flags correct</span>
                </div>
                <div>
                  <div className="jl-big">{pct(evaluation.recall)}</div>
                  <span className="muted">of sample issues found</span>
                </div>
              </div>
              <p className="muted jl-hint">{evaluation.tp} sample issues found · {evaluation.fn} missed · {evaluation.fp} extra flags. Only injection risks are checked; greyed-out examples are outside this demo’s scope.</p>
              <ul className="jl-list">
                {sample.planted.map((p) => (
                  <li key={`${p.line}-${p.kind}`} className={!inScope.includes(p) ? "skip" : evaluation.flaggedLines.includes(p.line) ? "hit" : "miss"}>
                    <span className="mono">L{p.line}</span>
                    <span className="tag">{KIND_LABEL[p.kind]}</span>
                    <span className="muted">{p.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="panel">
            <p className="panel-title">Findings · {strong.length}</p>
            <ul className="jl-list">
              {strong.map((m) => (
                <li key={m.line}>
                  <button className="jl-line-link" onClick={() => { scrollRef.current?.scrollTo({ top: Math.max(0, (m.line - 4) * LINE_H), behavior: "smooth" }); setHover(m.line); }}>
                  <span className={`jl-dot sev-${m.severity}`} />
                  <span className="mono">L{m.line}</span>
                  <span className="muted">{m.message}</span>
                  </button>
                </li>
              ))}
              {strong.length === 0 && <li className="muted">No warnings or errors yet. Press Scan file.</li>}
            </ul>
          </div>

        </aside>
      </div>
    </div>
  );
}
