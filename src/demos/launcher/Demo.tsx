import { ArrowElbowDownLeftIcon, CheckIcon, LightningIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { classify, yesNo, Dm1Error, type Meta } from "../../lib/dm1";
import { INDEX, KIND_LABEL, EXAMPLES, type Candidate } from "./data";
import {
  prefilter,
  rank,
  isReady,
  looksLikeSet,
  targetBody,
  readyBody,
  scopeBody,
  matchBody,
  matchCandidates,
  hasLocalRow,
  targetScores,
  GROUP_ID,
  type Judgment,
} from "./engine";
import "./demo.css";

/** Live typing stops by itself: one visitor cannot spend more than this on your key. */
const LIVE_SECONDS = 60;
const LIVE_TICKS = 20;
/** Trailing-edge spacing between ticks; the client queue already caps calls at 2/s page-wide. */
const TICK_GAP_MS = 350;

interface Applied {
  judgment: Judgment;
  query: string;
}


export default function Demo() {
  const [query, setQuery] = useState("the pdf I just downloaded");
  const [applied, setApplied] = useState<Applied | null>(null);
  const [selection, setSelection] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const [live, setLive] = useState(false);
  const [liveLeft, setLiveLeft] = useState(LIVE_SECONDS);
  const [lightMode, setLightMode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [opened, setOpened] = useState<Candidate | null>(null);

  const seq = useRef(0);
  const appliedSeq = useRef(0);
  const pending = useRef<string | null>(null);
  const busy = useRef(false);
  const ticksLeft = useRef(LIVE_TICKS);
  const inputRef = useRef<HTMLInputElement>(null);

  const pre = useMemo(() => prefilter(query, INDEX), [query]);
  const fresh = applied !== null && applied.query === query;
  const judgment = applied?.judgment ?? null;
  const hits = useMemo(() => rank(pre, judgment), [pre, judgment]);
  const ready = isReady(hits, judgment, applied?.query ?? query);
  const setish = looksLikeSet(query, pre.window);

  useEffect(() => setSelection(0), [query]);

  /** One judgment for one query: 2 calls, or 4 when the query describes several things. */
  const runTick = useCallback(async (q: string) => {
    const p = prefilter(q, INDEX);
    const members = matchCandidates(p);
    if (!hasLocalRow(p)) return; // only the web-search fallback: nothing to judge
    const mine = ++seq.current;
    const wantsSet = looksLikeSet(q, p.window) && members.length >= 2;
    setInFlight((n) => n + 1);
    try {
      const target = targetBody(q, p.candidates);
      const rdy = readyBody(q, p.candidates);
      const calls: Array<Promise<{ meta: Meta }>> = [
        classify(target.text, target.labels),
        yesNo(rdy.text, rdy.statements, { when_true: rdy.when_true, when_false: rdy.when_false }),
      ];
      if (wantsSet) {
        const scope = scopeBody(q);
        calls.push(classify(scope.text, scope.labels));
        // A bare window query ("everything from the past hour") needs no match call: prefilter()
        // already applied the window, so every dated row is a member by construction.
        if (!p.windowOnly) {
          const m = matchBody(q, p.window, members);
          calls.push(yesNo(m.text, m.statements, { when_true: m.when_true, when_false: m.when_false }));
        }
      }
      const answers = await Promise.all(calls);
      const [targetRes, readyRes, scopeRes, matchRes] = answers as [
        Awaited<ReturnType<typeof classify>>,
        Awaited<ReturnType<typeof yesNo>>,
        Awaited<ReturnType<typeof classify>> | undefined,
        Awaited<ReturnType<typeof yesNo>> | undefined,
      ];

      if (mine < appliedSeq.current) return; // a newer judgment already landed
      appliedSeq.current = mine;

      const match: Record<string, number> = {};
      matchRes?.results.forEach((r, i) => {
        const c = members[i];
        if (c) match[c.id] = r.probability;
      });
      setError(null);
      setApplied({
        query: q,
        judgment: {
          target: targetScores(targetRes.result.scores, target.ids),
          match,
          setProbability: scopeRes ? (scopeRes.result.scores["all"] ?? 0) : 0,
          ready: readyRes.results[0]?.probability ?? 0,
        },
      });
    } catch (e) {
      setError(e instanceof Dm1Error ? `${e.status} ${e.code}: ${e.message} — showing fuzzy order` : String(e));
    } finally {
      setInFlight((n) => n - 1);
    }
  }, []);

  const drain = useCallback(() => {
    if (busy.current) return;
    const q = pending.current;
    if (q === null) return;
    pending.current = null;
    busy.current = true;
    void runTick(q).finally(() => {
      busy.current = false;
      if (pending.current !== null) setTimeout(drain, TICK_GAP_MS);
    });
  }, [runTick]);

  const schedule = useCallback(
    (q: string) => {
      if (!q.trim()) return;
      pending.current = q;
      drain();
    },
    [drain],
  );

  // Live typing: bounded by a 60 s clock and a tick budget, then it stops itself.
  useEffect(() => {
    if (!live) return;
    const started = Date.now();
    const id = setInterval(() => {
      const left = LIVE_SECONDS - Math.floor((Date.now() - started) / 1000);
      setLiveLeft(Math.max(0, left));
      if (left <= 0) setLive(false);
    }, 500);
    return () => clearInterval(id);
  }, [live]);

  useEffect(() => {
    if (!live) return;
    if (ticksLeft.current <= 0) {
      setLive(false);
      return;
    }
    ticksLeft.current -= 1;
    schedule(query);
  }, [live, query, schedule]);

  function startLive() {
    ticksLeft.current = LIVE_TICKS;
    setLiveLeft(LIVE_SECONDS);
    setLive(true);
    inputRef.current?.focus();
  }

  function execute(hit: Candidate) {
    if (hit.id === GROUP_ID || hit.kind === "open_url") {
      setOpened(hit);
      return;
    }
    if (hit.kind === "calculate") {
      void navigator.clipboard?.writeText(hit.result ?? "").catch(() => {});
      say(`Copied ${hit.result} to the clipboard`);
      return;
    }
    if (hit.id === "toggle:toggleDarkMode") {
      setLightMode((v) => !v);
      say("Appearance switched (simulated)");
      return;
    }
    if (hit.kind === "system_toggle") {
      say(`${hit.title} — simulated, nothing on your machine changed`);
      return;
    }
    if (hit.kind === "open_file" || hit.kind === "open_app" || hit.kind === "run_shortcut") {
      say(`Would open ${hit.title} (simulated)`);
      return;
    }
    say(`Would search the web for “${query}”`);
  }

  const toastTimer = useRef<number | undefined>(undefined);
  function say(text: string) {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelection((s) => Math.min(s + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelection((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[selection];
      if (hit) execute(hit.candidate);
    } else if (e.key === "Escape") {
      setQuery("");
    }
  }


  return (
    <div className={`d-launcher${lightMode ? " light" : ""}`}>
      <div className="l-controls">
        <button className="btn primary" onClick={() => schedule(query)} disabled={!query.trim() || inFlight > 0}>
          Find best action
        </button>
        <button className={`btn${live ? " on" : ""}`} onClick={() => (live ? setLive(false) : startLive())}>
          {live ? `Live typing · stops in ${liveLeft}s` : "Live typing"}
        </button>
        <span className="muted l-hint">
          {setish ? "Find one item or a group of related items." : "Describe a file, app or action in your own words."}
        </span>
      </div>

      <div className="l-panel">
        <div className="l-header">
          <span className={`l-bolt${ready ? " ready" : ""}`} aria-hidden="true">
            <LightningIcon size={22} />
          </span>
          <input
            ref={inputRef}
            className="l-field"
            value={query}
            placeholder="Say what you mean…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Launcher query"
          />
          <span className={`l-dot${inFlight > 0 ? " on" : ""}`} aria-hidden="true" />
        </div>

        <div className="l-rows" role="listbox" aria-label="Results">
          {hits.length === 0 && <p className="l-empty muted">Nothing here matches yet</p>}
          {hits.map((hit, i) => (
            <div
              key={hit.candidate.id}
              role="option"
              aria-selected={i === selection}
              tabIndex={i === selection ? 0 : -1}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); execute(hit.candidate); } }}
              className={`l-row${i === selection ? " sel" : ""}`}
              onClick={() => {
                setSelection(i);
                execute(hit.candidate);
              }}
            >
              <span className={`l-icon k-${hit.candidate.kind}`}>
                {hit.candidate.id === GROUP_ID ? hit.candidate.members?.length : KIND_LABEL[hit.candidate.kind]}
              </span>
              <span className="l-text">
                <b>{hit.candidate.title}</b>
                <i>{hit.candidate.subtitle}</i>
              </span>
              {hit.inSet && (
                <span className="l-check" title="Part of the set the “Open all” row opens">
                  <CheckIcon size={16} aria-hidden="true" />
                </span>
              )}
              {/* The group row's number is P(all), not P(target): it gets its own label, not the bar. */}
              {hit.candidate.id === GROUP_ID && hit.target !== null ? (
                <span className={`l-all${fresh ? "" : " stale"}`}>
                  All items <em>{Math.round(hit.target * 100)}%</em>
                </span>
              ) : (
                hit.target !== null && (
                  <span className={`l-prob${fresh ? "" : " stale"}`}>
                    <span className="bar" style={{ width: 40 }}>
                      <i style={{ width: `${Math.round(hit.target * 100)}%` }} />
                    </span>
                    <em>{Math.round(hit.target * 100)}%</em>
                  </span>
                )
              )}
              {ready && i === 0 && <span className="l-enter" title="Enter to run" aria-label="Enter to run"><ArrowElbowDownLeftIcon size={16} aria-hidden="true" /></span>}
            </div>
          ))}
        </div>

        <div className="l-foot">
          <span className="l-chips">
            {EXAMPLES.map((ex) => (
              <button key={ex} className="l-chip" onClick={() => { setQuery(ex); schedule(ex); }}>
                {ex}
              </button>
            ))}
          </span>
        </div>
      </div>

      {error && <p className="error l-error">{error}</p>}

      <p className="muted l-hint" role="status">
        {inFlight > 0 ? "Finding the best action…" : fresh ? "Ranked by meaning · percentages show confidence in each match." : applied ? "Query changed. Find the best action again to refresh the matches." : "Describe an action, then select Find best action. Results use a sample desktop; opening is simulated."}
      </p>

      {toast && <div className="l-toast">{toast}</div>}

      {opened && (
        <div className="l-modal" role="dialog" aria-label="Simulated execution">
          <div className="panel">
            <p className="panel-title">{opened.id === GROUP_ID ? opened.title : "Would open"}</p>
            <ul>
              {(opened.members ?? [opened]).map((m) => (
                <li key={m.id}>
                  <b>{m.title}</b>
                  <span className="muted"> {m.url ?? m.subtitle}</span>
                </li>
              ))}
            </ul>
            <p className="muted">Nothing opens: this browser demo simulates execution.</p>
            <button className="btn" onClick={() => setOpened(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
