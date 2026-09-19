import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dm1Error, classify, rateMany, yesNo } from "../../lib/dm1";
import {
  AUDIENCE_TAG, CHANNELS, CORE_STATEMENTS, LEGAL_LEVELS, LEGAL_SCALE, PEOPLE, SCENARIOS, SEED,
  THRESHOLDS, TONE_LEVELS, VERDICT_LABELS, decide, findSpans, judgeText, looksIncomplete,
  spanStatement, toneLevel,
  type Channel, type Message, type Span, type Verdict,
} from "./data";
import "./demo.css";

/** A pause long enough to judge. The original used 120 ms; the API key wants fewer calls. */
const PAUSE_MS = 400;
/** A draft that has stopped moving earns the extra /rate reading. */
const SETTLE_MS = 1500;
/**
 * Replay is bounded twice over: seven scenarios, and a wall clock that ends it regardless.
 * 90 s, not 60: each scenario now also waits for the settle /rate reading before it records a
 * row, and dm1.ts meters the whole page at three calls a second, so seven drafts need the room.
 */
const REPLAY_MAX_MS = 90_000;
const TYPE_MS = 12;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Frame-paced wait, used for the replay's keystrokes. A hidden tab clamps setTimeout to
 * about one tick a second, which would make every replayed character its own judged pause
 * and pour requests into the shared quota; requestAnimationFrame simply stops instead, so
 * the replay suspends with the tab and resumes when it comes back.
 */
const typeWait = (ms: number) =>
  new Promise<void>((resolve) => {
    const start = performance.now();
    const step = () => (performance.now() - start >= ms ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });
const now = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

interface Sample {
  inferenceMs: number;
  wallMs: number;
  tokens: number;
}

interface Guard {
  p: Record<string, number>;
  spans: Span[];
  verdict: Verdict | null;
  verdictScores: Record<string, number> | null;
  /** /rate level, and the draft it was measured on. */
  legal: number | null;
  legalDraft: string;
  judgedDraft: string;
  judgedChannel: string;
  inflight: boolean;
  statements: number;
  lastMs: number;
  calls: number;
  samples: Sample[];
  error: string | null;
}

const EMPTY: Guard = {
  p: {}, spans: [], verdict: null, verdictScores: null, legal: null, legalDraft: "",
  judgedDraft: "", judgedChannel: "", inflight: false, statements: 0, lastMs: 0,
  calls: 0, samples: [], error: null,
};

/**
 * One judging pipeline. Every pause sends call A (/yes-no, the whole statement batch) and
 * call B (/classify) together; a draft that then sits still for SETTLE_MS earns call C
 * (/rate). A new pause never fires while A and B are out — it sets a dirty flag instead, so
 * a fast typist costs two calls per pause and not two per keystroke.
 */
function useGuard(draft: string, channel: Channel, suspended: boolean) {
  const [g, setG] = useState<Guard>(EMPTY);
  const busy = useRef(false);
  const dirty = useRef(false);
  /** True while a debounce timer is armed, i.e. the draft has moved since the last pause. */
  const pending = useRef(false);
  const latest = useRef({ draft, channel });
  latest.current = { draft, channel };

  const judge = useCallback(async (text: string, ch: Channel) => {
    if (busy.current) {
      dirty.current = true;
      return;
    }
    busy.current = true;
    const spans = findSpans(text);
    setG((s) => ({ ...s, inflight: true, spans }));
    const prompt = judgeText(ch, text);
    const statements = [...CORE_STATEMENTS.map((s) => s.text), ...spans.map(spanStatement)];
    const t0 = performance.now();
    try {
      const [a, b] = await Promise.all([yesNo(prompt, statements), classify(prompt, VERDICT_LABELS)]);
      const p: Record<string, number> = {};
      CORE_STATEMENTS.forEach((s, i) => (p[s.key] = a.results[i]?.probability ?? 0));
      spans.forEach((s, i) => (p[s.id] = a.results[CORE_STATEMENTS.length + i]?.probability ?? 0));
      setG((s) => ({
        ...s,
        p, spans,
        verdict: b.result.label as Verdict,
        verdictScores: b.result.scores,
        judgedDraft: text,
        judgedChannel: ch.id,
        inflight: false,
        statements: statements.length,
        lastMs: Math.round(performance.now() - t0),
        calls: s.calls + 2,
        samples: [...s.samples, a.meta, b.meta].slice(-400),
        error: null,
      }));
    } catch (err) {
      setG((s) => ({ ...s, inflight: false, error: err instanceof Dm1Error ? `${err.code}: ${err.message}` : String(err) }));
    } finally {
      busy.current = false;
      // Only pick up a pause that was dropped because A and B were still out. If the draft
      // has moved since, its own debounce timer is already armed and will judge the newer
      // text — re-firing here instead would judge on every keystroke.
      if (dirty.current) {
        dirty.current = false;
        const { draft: d, channel: c } = latest.current;
        if (!pending.current && d.trim()) void judge(d, c);
      }
    }
  }, []);

  /** Call C: the one genuinely ordinal reading, sent once the draft has stopped moving. */
  const rateLegal = useCallback(async (text: string, ch: Channel) => {
    try {
      const r = await rateMany([judgeText(ch, text)], LEGAL_SCALE);
      setG((s) => ({
        ...s,
        legal: r.results[0]?.level ?? null,
        legalDraft: text,
        calls: s.calls + 1,
        samples: [...s.samples, r.meta].slice(-400),
        error: null,
      }));
    } catch (err) {
      setG((s) => ({ ...s, error: err instanceof Dm1Error ? `${err.code}: ${err.message}` : String(err) }));
    }
  }, []);

  useEffect(() => {
    if (suspended) { pending.current = true; dirty.current = false; return; }
    if (!draft.trim()) {
      dirty.current = false;
      pending.current = false;
      // The error goes with the draft: a one-off 429 must not leave a red line under an empty
      // composer for the rest of the session.
      setG((s) => ({ ...EMPTY, calls: s.calls, samples: s.samples }));
      return;
    }
    pending.current = true;
    const pause = setTimeout(() => {
      pending.current = false;
      void judge(draft, channel);
    }, PAUSE_MS);
    const settle = setTimeout(() => void rateLegal(draft, channel), SETTLE_MS);
    return () => {
      clearTimeout(pause);
      clearTimeout(settle);
    };
  }, [draft, channel, judge, rateLegal, suspended]);

  return g;
}

interface Row {
  title: string;
  channel: string;
  expect: Verdict;
  guard: Verdict;
  reason: string;
  ms: number;
}

export default function Demo() {
  const [channelId, setChannelId] = useState(CHANNELS[0].id);
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState<Record<string, Message[]>>(SEED);
  const [replaying, setReplaying] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const stopReplay = useRef(false);

  const channel = useMemo(() => CHANNELS.find((c) => c.id === channelId) ?? CHANNELS[0], [channelId]);
  const [typingStock, setTypingStock] = useState(false);
  const [stockPaused, setStockPaused] = useState(false);
  const g = useGuard(draft, channel, typingStock);
  const gRef = useRef(g);
  gRef.current = g;

  const empty = draft.trim().length === 0;
  const liveSpans = useMemo(() => findSpans(draft), [draft]);
  const fresh = g.judgedDraft === draft && g.judgedChannel === channel.id;
  const hasAnswers = fresh && g.verdict !== null;
  const rated = g.legalDraft === draft;
  const decision = useMemo(
    () => decide(
      {
        p: g.p,
        verdict: g.verdict,
        verdictScore: g.verdictScores?.[g.verdict ?? "send"] ?? 0,
        legal: rated ? g.legal : null,
      },
      channel.audience,
      g.spans,
      draft,
    ),
    [g.p, g.verdict, g.verdictScores, g.legal, rated, draft, channel.audience, g.spans],
  );

  // A settled error is a finished judgment, not a pending one: the call came back, it just
  // came back a failure. Leaving `awaiting` true here would park the Send button on "Judging…"
  // for the whole outage — which on a shared 200/min key is the likeliest thing to happen.
  const failed = g.error !== null && !g.inflight;
  // The underline always draws on the live spans, so it cannot drift: g.spans carries offsets
  // measured at judge time, and typing anywhere before a flagged fragment moves the text but
  // not those offsets. The model's verdict is carried across by the fragment text instead.
  const liveFlagged = useMemo(() => {
    const culpritTexts = new Set(g.spans.filter((s) => decision.culpritSpanIds.includes(s.id)).map((s) => s.text));
    return new Set(liveSpans.filter((s) => culpritTexts.has(s.text)).map((s) => s.id));
  }, [g.spans, decision.culpritSpanIds, liveSpans]);

  const shown = failed ? { verdict: "warn" as Verdict, reason: "couldn't reach the judge — send at your own risk" }
      : hasAnswers ? decision
        : { verdict: "send" as Verdict, reason: "" };
  const buttonVerdict: Verdict = empty ? "send" : shown.verdict;
  const awaiting = !empty && !failed && (!fresh || g.inflight || !hasAnswers);
  const canSend = !empty && buttonVerdict !== "block" && !awaiting;

  const send = () => {
    if (!canSend) return;
    setHistory((h) => ({ ...h, [channel.id]: [...(h[channel.id] ?? []), { id: `s${Date.now()}`, author: "me", time: now(), text: draft.trim() }] }));
    setDraft("");
  };

  const replay = useCallback(async () => {
    if (replaying) {
      stopReplay.current = true;
      return;
    }
    stopReplay.current = false;
    setReplaying(true);
    setRows([]);
    setStockPaused(false);
    let interrupted = false;
    const deadline = performance.now() + REPLAY_MAX_MS;
    for (const sc of SCENARIOS) {
      if (stopReplay.current || performance.now() > deadline) break;
      setTypingStock(true);
      setChannelId(sc.channelId);
      setDraft("");
      await sleep(300);
      let typed = "";
      for (const ch of sc.draft) {
        if (stopReplay.current || performance.now() > deadline) break;
        typed += ch;
        setDraft(typed);
        // Preserve the typing animation; only the completed stock draft is judged.
        await typeWait(/[.!?]/.test(ch) ? PAUSE_MS + 120 : /[,;:—]/.test(ch) ? 150 : TYPE_MS);
      }
      setTypingStock(false);
      // A deadline trip inside the character loop must end the replay here, not after another
      // judge wait and sleep — otherwise the 60 s the page advertises overruns by ~5.7 s.
      if (stopReplay.current || performance.now() > deadline) { interrupted = true; break; }
      // Wait for the settle reading too, or the replayed rows run a weaker policy than the page
      // describes: the judge wait alone clears ~1.0-1.4 s after the last keystroke, before the
      // 1.5 s /rate has even fired, so `legal` was always null in this table.
      const wait = performance.now() + 5000;
      while (
        performance.now() < wait &&
        (gRef.current.judgedDraft !== sc.draft || gRef.current.inflight || gRef.current.legalDraft !== sc.draft)
      ) await sleep(40);
      const cur = gRef.current;
      const ch = CHANNELS.find((c) => c.id === sc.channelId) ?? CHANNELS[0];
      const settled = cur.legalDraft === sc.draft;
      const d = decide(
        {
          p: cur.p,
          verdict: cur.verdict,
          verdictScore: cur.verdictScores?.[cur.verdict ?? "send"] ?? 0,
          legal: settled ? cur.legal : null,
        },
        ch.audience,
        cur.spans,
        sc.draft,
      );
      setRows((r) => [...r, { title: sc.title, channel: ch.name, expect: sc.expect, guard: d.verdict, reason: d.reason, ms: cur.lastMs }]);
      await sleep(700);
    }
    setTypingStock(interrupted);
    setStockPaused(interrupted);
    setReplaying(false);
  }, [replaying]);

  useEffect(() => () => void (stopReplay.current = true), []);

  // The real bodies, for the draft the guard last judged — the demo's job is to sell the API,
  // so the request is on the page rather than described on it. Falls back to the live draft
  // until the first answer lands, which is what the next pause will send.
  const bodies = useMemo(() => {
    const judged = g.judgedDraft || draft;
    const text = judgeText(channel, judged);
    const spans = g.judgedDraft ? g.spans : liveSpans;
    const show = (route: string, body: unknown) =>
      `POST https://api.milliseconds.ai/v1/decision-machine-1/${route}\n${JSON.stringify(body, null, 2)}`;
    return [
      show("yes-no", { text, statements: [...CORE_STATEMENTS.map((s) => s.text), ...spans.map(spanStatement)] }),
      show("classify", { text, labels: VERDICT_LABELS }),
      show("rate", { texts: [text], scale: LEGAL_SCALE }),
    ].join("\n\n");
  }, [channel, draft, g.judgedDraft, g.spans, liveSpans]);

  return (
    <div className="d-send-guard">
      <p className="muted sg-intro">Draft a message and see whether it is safe for the selected audience. Sensitive details are highlighted before you send. Messages stay inside this demo.</p>

      {g.error && <p className="error sg-error">{g.error} · the draft and the last verdict are still here; keep typing to retry.</p>}

      <div className="sg-shell panel">
        <nav className="sg-rail" aria-label="Channels">
          <p className="panel-title">Northwind</p>
          <ul>
            {CHANNELS.map((c) => (
              <li key={c.id}>
                <button
                  className={`sg-chan ${c.id === channel.id ? "on" : ""}`}
                  disabled={replaying}
                  onClick={() => {
                    setDraft("");
                    setChannelId(c.id);
                  }}
                >
                  <span className="sg-chan-name">{c.kind === "dm" ? `● ${c.label}` : c.label}</span>
                  <span className={`tag sg-aud sg-aud-${c.audience}`}>{AUDIENCE_TAG[c.audience]}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="sg-rail-note muted">The audience of the selected channel goes into every request as the first line of the text.</p>
        </nav>

        <main className="sg-main">
          <header className="sg-head">
            <h3>{channel.name}</h3>
            <p className="muted">{channel.topic || `${channel.members} members`}{channel.shared ? " · Slack Connect" : ""}</p>
          </header>

          <ol className="sg-msgs">
            {(history[channel.id] ?? []).map((m) => {
              const who = PEOPLE[m.author];
              return (
                <li key={m.id}>
                  <span className="sg-av" style={{ background: who.color }}>{who.initials}</span>
                  <div>
                    <p className="sg-msg-meta">
                      <b>{who.name}</b>
                      {who.external && <span className="tag sg-ext">external</span>}
                      <span className="muted">{m.time}</span>
                    </p>
                    <p className="sg-msg-text">{m.text}</p>
                    {m.reactions && (
                      <p className="sg-reacts">
                        {m.reactions.map((r) => <span key={r.emoji}>{r.emoji} {r.count}</span>)}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          <Composer
            value={draft}
            onChange={(value) => { setStockPaused(false); setTypingStock(false); setDraft(value); }}
            onSend={send}
            spans={liveSpans}
            flagged={liveFlagged}
            disabled={replaying}
            placeholder={`Message ${channel.kind === "dm" ? channel.label : channel.name}`}
            verdict={buttonVerdict}
            awaiting={awaiting}
            canSend={canSend}
            reason={shown.reason}
            empty={empty}
          />
          <p className="sg-hint muted">
            <span>{channel.audience === "internal" ? "Internal channel." : channel.audience === "public" ? "Public channel — anyone on the internet can read this." : "People outside Northwind can read this."}</span>
            <span>Return to send · Shift + Return for a new line</span>
          </p>
        </main>

        <aside className="sg-guard">
          <p className="panel-title">Send guard</p>

          <div className="sg-cards">
            <div className={`sg-card v-${empty ? "none" : failed ? "warn" : !hasAnswers ? "none" : decision.verdict} lead`}>
              <span className="sg-card-label">Message safety</span>
              <b>{stockPaused ? "Replay paused" : typingStock ? "Typing example…" : empty ? "Ready to check" : failed ? "Check unavailable" : !hasAnswers ? "Checking…" : VERDICT_TEXT[decision.verdict]}</b>
              <span className="sg-card-why">{stockPaused ? "Edit the draft to check it with your key, or start the stock replay again." : typingStock ? "The completed example will be checked next." : empty ? "Start typing a draft below." : failed ? "The API could not check this draft. Review it before sending." : hasAnswers ? decision.reason : "Reading the current draft…"}</span>
            </div>
          </div>

          <p className="panel-title sg-sub">Judgments <span className="muted">one /yes-no call · {CORE_STATEMENTS.length + g.spans.length} statements</span></p>
          <div className={`sg-chips ${g.inflight ? "busy" : ""}`}>
            {/* The three tone statements have their own chip below, which reads the level. */}
            {CORE_STATEMENTS.filter((s) => !s.key.startsWith("tone")).map((s) => {
              const v = hasAnswers ? g.p[s.key] ?? 0 : null;
              const hit = THRESHOLDS.yes;
              // "fits audience" is the inverse of the statement we actually send.
              const shownPct = v === null ? null : s.key === "misfit" ? 1 - v : v;
              const state = v === null ? "idle" : v >= hit ? (RED_KEYS.has(s.key) ? "bad" : "warn") : "ok";
              return (
                <span key={s.key} className={`sg-chip c-${state}`} title={s.text}>
                  <i />{s.label}<b>{shownPct === null ? "—" : `${Math.round(shownPct * 100)}%`}</b>
                </span>
              );
            })}
            {/* Code answers this one, like the author's-own-contact carve-out: whether a sentence
                has ended is a fact about the characters, and the statement that used to ask it
                read 0-3% on drafts that plainly stop mid-clause. */}
            <span className={`sg-chip c-${empty ? "idle" : looksIncomplete(draft) ? "warn" : "ok"}`} title="Answered in code by looksIncomplete(): an unfilled TODO or [name] marker, or a draft that does not end on a finished sentence.">
              <i />incomplete <em className="sg-by">code</em><b>{empty ? "—" : looksIncomplete(draft) ? "yes" : "no"}</b>
            </span>
            <span
              className={`sg-chip c-${!hasAnswers ? "idle" : toneLevel(g.p) >= 3 ? "bad" : toneLevel(g.p) >= 2 ? "warn" : "ok"}`}
              title="Three escalating yes/no statements in call A: warm, then curt, then blaming or belittling. /rate was measured on this and compressed the whole range into curt — see the notes."
            >
              <i />tone <em className="sg-by">yes/no</em><b>{hasAnswers ? TONE_LEVELS[toneLevel(g.p)] : "—"}</b>
            </span>
            {/* Amber at level 2, red at level 3 — the same bars decide() gates on, so the chip
                never paints amber next to a verdict of "Looks good". Level 2 is the original
                policy's legalWarn rule, back now that the scale separates (see THRESHOLDS). */}
            <span className={`sg-chip c-${g.legal === null || !rated ? "idle" : g.legal >= THRESHOLDS.legalBlock ? "bad" : g.legal >= THRESHOLDS.legalWarn ? "warn" : "ok"}`} title={`/rate on a four-level scale, sent when the draft stops moving for ${SETTLE_MS} ms. Level 2 warns, level 3 blocks.`}>
              <i />legal risk<b>{g.legal !== null && rated ? LEGAL_LEVELS[g.legal] : "—"}</b>
            </span>
            <span className={`sg-chip c-${!hasAnswers ? "idle" : g.verdict === "block" ? "bad" : g.verdict === "warn" ? "warn" : "ok"}`} title="/classify with three described labels.">
              <i />verdict<b>{hasAnswers ? g.verdict : "—"}</b>
            </span>
          </div>

          <p className="panel-title sg-sub">Sensitive details <span className="muted">highlighted fragments and their risk probability</span></p>
          <ul className="sg-spans">
            {g.spans.length === 0 && <li className="muted">no keys, emails, amounts or dates in the draft</li>}
            {g.spans.map((s) => {
              const v = g.p[s.id];
              return (
                <li key={s.id} className={decision.culpritSpanIds.includes(s.id) ? "bad" : ""}>
                  <span className="tag">{s.kind}</span>
                  <code>{s.text.length > 34 ? `${s.text.slice(0, 34)}…` : s.text}</code>
                  <span className="mono">{v === undefined ? "…" : `${Math.round(v * 100)}%`}</span>
                </li>
              );
            })}
          </ul>

          {!empty && (
            <details className="sg-bodies">
              <summary>What went over the wire</summary>
              <pre className="mono">{bodies}</pre>
            </details>
          )}

          <div className="sg-replay-head">
            <p className="panel-title sg-sub">Replay {SCENARIOS.length} drafts</p>
            <button className={`btn ${replaying ? "" : "primary"}`} onClick={() => void replay()}>
              {replaying ? "Stop" : "Start replay"}
            </button>
          </div>
          {rows.length === 0 ? (
            <p className="muted sg-small">Types {SCENARIOS.length} real drafts hands-free: a pasted key, a guaranteed date, a hostile reply, a pricing leak, a customer's contact details. Stops after the last one, or after {REPLAY_MAX_MS / 1000} s.</p>
          ) : (
            <>
              <table className="sg-rows">
                <thead><tr><th>Draft</th><th>Decision</th><th>Expected</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.title}>
                      <td title={`${r.channel} · expected ${r.expect}`}>{r.title}</td>
                      <td><span className={`sg-pill p-${r.guard} ${r.guard === r.expect ? "" : "miss"}`} title={r.reason}>{r.guard}</span></td>
                      <td>{r.expect}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="muted sg-small">
                {rows.filter((r) => r.guard === r.expect).length} of {rows.length} decisions match the expected outcome
              </p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

const VERDICT_TEXT: Record<Verdict, string> = { send: "Looks good", warn: "Heads up", block: "Blocked" };
const RED_KEYS = new Set(["secret", "pii", "confidential", "confidentialPeople"]);

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  spans: Span[];
  flagged: Set<string>;
  disabled: boolean;
  placeholder: string;
  verdict: Verdict;
  awaiting: boolean;
  canSend: boolean;
  reason: string;
  empty: boolean;
}

/** Textarea with a mirrored layer behind it that underlines the spans the model flagged. */
function Composer(p: ComposerProps) {
  const mirror = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  const parts: Array<{ text: string; span?: Span }> = [];
  let cursor = 0;
  for (const s of p.spans) {
    if (s.start > cursor) parts.push({ text: p.value.slice(cursor, s.start) });
    parts.push({ text: p.value.slice(s.start, s.end), span: s });
    cursor = s.end;
  }
  if (cursor < p.value.length) parts.push({ text: p.value.slice(cursor) });

  const state = p.empty ? "empty" : p.awaiting ? "pending" : p.verdict;
  const label = p.awaiting ? "Judging…" : p.verdict === "block" ? "Blocked" : p.verdict === "warn" ? "Send anyway" : "Send";

  return (
    <div className={`sg-composer s-${state}`}>
      <div className="sg-editor">
        <div className="sg-mirror" ref={mirror} aria-hidden="true">
          {parts.map((part, i) =>
            part.span ? (
              <mark key={i} className={p.flagged.has(part.span.id) ? "bad" : ""} title={`${part.span.kind}: ${part.span.text}`}>{part.text}</mark>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
          {"\n"}
        </div>
        <textarea
          ref={ta}
          className="sg-ta"
          value={p.value}
          onChange={(e) => p.onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              p.onSend();
            }
          }}
          onScroll={() => {
            if (mirror.current && ta.current) mirror.current.scrollTop = ta.current.scrollTop;
          }}
          spellCheck={false}
          disabled={p.disabled}
          placeholder={p.placeholder}
          aria-label="Message draft"
          rows={3}
        />
      </div>
      <div className="sg-actions">
        <span className={`sg-reason r-${state}`}>{p.empty ? "" : p.awaiting ? "reading the current draft…" : p.reason}</span>
        <button className={`sg-send v-${state}`} disabled={!p.canSend} onClick={p.onSend} title={p.reason}>{label}</button>
      </div>
    </div>
  );
}
