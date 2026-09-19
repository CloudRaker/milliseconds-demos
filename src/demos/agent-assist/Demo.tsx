// Agent Assist: eight scripted support chats, one copilot panel refreshed after every
// customer message. The Jev original asked one model nine questions per message; here the
// same nine answers come from five dm1 calls, and every chat whose message lands in the same
// grid slot travels inside those same five calls as one `texts` batch.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Dm1Error, type ClassifyResult, type Meta, type RateResult } from "../../lib/dm1";
import {
  AUTO_FILL_CONFIDENCE,
  BATCH_WINDOW_MS,
  AUTO_SEND_DELAY_MS,
  CHURN_ALERT,
  CLOSING,
  FRUSTRATION_ALERT,
  CLOSING_YES,
  CHURN_SCALE,
  FRUSTRATION_SCALE,
  GRID_MS,
  INTENT_LABELS,
  MACROS,
  MACRO_LABELS,
  RUN_CAP_MS,
  SCRIPTS,
  SIGNALS,
  STATEMENTS,
  TOTAL_MESSAGES,
  YES,
  fillMacro,
  lastCustomerText,
  macroById,
  refundEligibleByPolicy,
  toSignals,
  transcript,
  type ChatScript,
  type CustomerProfile,
  type Message,
  type Signals,
} from "./data";
import "./demo.css";
import { stockBatch } from "../../lib/stock-batch";
import { STOCK_TRANSCRIPTS, STOCK_LATEST } from "./data";

// ---------------------------------------------------------------- state

interface Answers {
  macro: ClassifyResult;
  intent: ClassifyResult;
  churn: RateResult;
  frustration: RateResult;
  signals: Signals;
  /** Statement CLOSING: above CLOSING_YES the latest message only closes the chat. */
  closing: number;
}
interface Judgment {
  answers: Answers;
  /** Model time of the slowest call in the batch. */
  inferenceMs: number;
  /** Message on screen to panel refreshed, including the client-side queue wait. */
  panelMs: number;
  arrivedAt: number;
}
interface Chat {
  id: string;
  label: string;
  customer: CustomerProfile;
  messages: Message[];
  delivered: number;
  scriptLength: number;
  playing: boolean;
  pending: boolean;
  judgment: Judgment | null;
  draft: string;
  draftSource: "auto" | "manual" | null;
  error: string | null;
}
interface State {
  chats: Chat[];
  activeId: string;
  panelMs: number[];
}
type Action =
  | { type: "customer_message"; chatId: string; text: string }
  | { type: "agent_message"; chatId: string; text: string }
  | { type: "judging"; chatId: string }
  | { type: "judged"; chatId: string; judgment: Judgment; draft: string | null }
  | { type: "judge_failed"; chatId: string; error: string }
  | { type: "cancel_pending"; chatIds: string[] }
  | { type: "set_draft"; chatId: string; draft: string; source: "auto" | "manual" | null }
  | { type: "set_playing"; chatIds: string[]; playing: boolean }
  | { type: "select"; chatId: string }
  | { type: "reset" };

function initialState(scripts: ChatScript[]): State {
  return {
    chats: scripts.map((s) => ({
      id: s.id,
      label: s.label,
      customer: s.customer,
      messages: [],
      delivered: 0,
      scriptLength: s.messages.length,
      playing: false,
      pending: false,
      judgment: null,
      draft: "",
      draftSource: null,
      error: null,
    })),
    activeId: scripts[0]?.id ?? "",
    panelMs: [],
  };
}

const withChat = (state: State, chatId: string, fn: (c: Chat) => Chat): State => ({
  ...state,
  chats: state.chats.map((c) => (c.id === chatId ? fn(c) : c)),
});

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "customer_message":
      return withChat(state, action.chatId, (c) => ({
        ...c,
        messages: [...c.messages, { role: "customer", text: action.text }],
        delivered: c.delivered + 1,
        error: null,
      }));
    case "agent_message":
      return withChat(state, action.chatId, (c) => ({
        ...c,
        messages: [...c.messages, { role: "agent", text: action.text }],
        draft: "",
        draftSource: null,
      }));
    case "judging":
      return withChat(state, action.chatId, (c) => ({ ...c, pending: true }));
    case "judged": {
      const next = withChat(state, action.chatId, (c) => ({
        ...c,
        pending: false,
        error: null,
        judgment: action.judgment,
        draft: action.draft ?? (c.draftSource === "auto" ? "" : c.draft),
        draftSource: action.draft ? "auto" : c.draftSource === "auto" ? null : c.draftSource,
      }));
      return { ...next, panelMs: [...next.panelMs, action.judgment.panelMs] };
    }
    case "judge_failed":
      return withChat(state, action.chatId, (c) => ({ ...c, pending: false, error: action.error }));
    case "cancel_pending":
      return {
        ...state,
        chats: state.chats.map((c) => (action.chatIds.includes(c.id) ? { ...c, pending: false } : c)),
      };
    case "set_draft":
      return withChat(state, action.chatId, (c) => ({ ...c, draft: action.draft, draftSource: action.source }));
    case "set_playing":
      return {
        ...state,
        chats: state.chats.map((c) => (action.chatIds.includes(c.id) ? { ...c, playing: action.playing } : c)),
      };
    case "select":
      return { ...state, activeId: action.chatId };
    case "reset":
      return initialState(SCRIPTS);
  }
}

// ---------------------------------------------------------------- helpers (ported from engine.ts)

const pct = (p: number) => `${Math.round(p * 100)}%`;

interface Ranked {
  id: string;
  probability: number;
}
type Gate =
  | { kind: "auto"; macroId: string; confidence: number; top: Ranked[] }
  | { kind: "options"; confidence: number; top: Ranked[] }
  | { kind: "none"; confidence: number; top: Ranked[] };

function gateMacro({ macro: r, closing }: Answers): Gate {
  const top = Object.entries(r.scores)
    .map(([id, probability]) => ({ id, probability }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 3);
  // A pure thank-you or sign-off beats the classifier: no macro should auto-send on it.
  if (r.label === "none" || closing >= CLOSING_YES) return { kind: "none", confidence: r.confidence, top };
  if (r.confidence >= AUTO_FILL_CONFIDENCE) return { kind: "auto", macroId: r.label, confidence: r.confidence, top };
  return { kind: "options", confidence: r.confidence, top: top.filter((o) => o.id !== "none") };
}

const queuePriority = (j: Judgment | null) =>
  j ? (j.answers.signals.escalate >= YES ? 100 : 0) + (j.answers.signals.regulatory >= YES ? 20 : 0) + j.answers.churn.score * 10 + j.answers.frustration.score : 0;

const macroTitle = (id: string) => (id === "none" ? "No macro" : (macroById(id)?.title ?? id));

// ---------------------------------------------------------------- island

interface Batch {
  chatId: string;
  messages: Message[];
  customer: CustomerProfile;
  handsFree: boolean;
  queuedAt: number;
}

export default function Demo() {
  const [state, dispatch] = useReducer(reducer, SCRIPTS, initialState);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const queue = useRef<Batch[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumped by Reset; a flush that resolves with a stale generation is discarded. */
  const generation = useRef(0);

  const setTimer = (key: string, ms: number, fn: () => void) => {
    clearTimeout(timers.current.get(key));
    timers.current.set(
      key,
      setTimeout(() => {
        timers.current.delete(key);
        fn();
      }, ms),
    );
  };

  const flush = useCallback(async () => {
    flushTimer.current = null;
    const batch = queue.current.splice(0, 32);
    if (batch.length === 0) return;
    const era = generation.current;
    const texts = batch.map((b) => transcript(b.messages, b.customer));
    const latest = batch.map((b) => lastCustomerText(b.messages));
    try {
      const [macro, intent, churn, frustration, flags] = await Promise.all([
        stockBatch<{results: ClassifyResult[]}>("classify", { texts, labels: MACRO_LABELS }, STOCK_TRANSCRIPTS),
        stockBatch<{results: ClassifyResult[]}>("classify", { texts, labels: INTENT_LABELS }, STOCK_TRANSCRIPTS),
        stockBatch<{results: RateResult[]}>("rate", { texts, scale: CHURN_SCALE }, STOCK_TRANSCRIPTS),
        stockBatch<{results: RateResult[]}>("rate", { texts: latest, scale: FRUSTRATION_SCALE }, STOCK_LATEST),
        stockBatch<{ results: { results: { probability: number }[] }[] }>("yes-no", { texts, statements: STATEMENTS }, STOCK_TRANSCRIPTS),
      ]);
      if (era !== generation.current) return; // reset while in flight: keep the fresh UI clean
      const metas: Meta[] = [macro.meta, intent.meta, churn.meta, frustration.meta, flags.meta];
      setError(null);
      const now = performance.now();
      batch.forEach((b, i) => {
        const probabilities = flags.data.results[i]!.results.map((r) => r.probability);
        const answers: Answers = {
          macro: macro.data.results[i]!,
          intent: intent.data.results[i]!,
          churn: churn.data.results[i]!,
          frustration: frustration.data.results[i]!,
          signals: toSignals(probabilities),
          closing: probabilities[CLOSING] ?? 0,
        };
        const gate = gateMacro(answers);
        const m = gate.kind === "auto" ? macroById(gate.macroId) : undefined;
        const draft = m ? fillMacro(m, b.customer.name) : null;
        dispatch({
          type: "judged",
          chatId: b.chatId,
          judgment: {
            answers,
            inferenceMs: Math.max(...metas.map((x) => x.inferenceMs)),
            panelMs: now - b.queuedAt,
            arrivedAt: now,
          },
          draft,
        });
        if (b.handsFree && draft) {
          setTimer(`${b.chatId}:send`, AUTO_SEND_DELAY_MS, () => {
            const current = stateRef.current.chats.find((c) => c.id === b.chatId);
            if (current?.draftSource === "auto" && current.draft === draft) {
              dispatch({ type: "agent_message", chatId: b.chatId, text: draft });
            }
          });
        }
      });
    } catch (err) {
      if (era !== generation.current) return;
      const message = err instanceof Dm1Error ? `${err.code} (${err.status}): ${err.message}` : String(err);
      setError(message);
      for (const b of batch) dispatch({ type: "judge_failed", chatId: b.chatId, error: message });
    } finally {
      if (queue.current.length > 0 && flushTimer.current === null) flushTimer.current = setTimeout(flush, 0);
    }
  }, []);

  /** Queue one judgment. Everything queued inside the window leaves in the same five calls. */
  const judge = useCallback(
    (chat: Chat, messages: Message[], handsFree: boolean) => {
      dispatch({ type: "judging", chatId: chat.id });
      queue.current.push({ chatId: chat.id, messages, customer: chat.customer, handsFree, queuedAt: performance.now() });
      if (flushTimer.current === null) flushTimer.current = setTimeout(flush, BATCH_WINDOW_MS);
    },
    [flush],
  );

  const deliver = useCallback(
    (chatId: string, handsFree: boolean) => {
      const chat = stateRef.current.chats.find((c) => c.id === chatId);
      const script = SCRIPTS.find((s) => s.id === chatId);
      const next = chat && script ? script.messages[chat.delivered] : undefined;
      if (!chat || !next) return;
      dispatch({ type: "customer_message", chatId, text: next.text });
      judge(chat, [...chat.messages, { role: "customer", text: next.text }], handsFree);
    },
    [judge],
  );

  /** Pause one chat: drop only its timers. */
  const pause = useCallback((chatId: string) => {
    for (const [key, t] of timers.current) {
      if (key.startsWith(`${chatId}:`)) {
        clearTimeout(t);
        timers.current.delete(key);
      }
    }
    dispatch({ type: "set_playing", chatIds: [chatId], playing: false });
  }, []);

  const stop = useCallback(() => {
    for (const t of timers.current.values()) clearTimeout(t);
    timers.current.clear();
    // Drop anything still queued so a stopped run cannot spend another call.
    const dropped = queue.current.splice(0).map((b) => b.chatId);
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    if (dropped.length > 0) dispatch({ type: "cancel_pending", chatIds: dropped });
    dispatch({ type: "set_playing", chatIds: SCRIPTS.map((s) => s.id), playing: false });
  }, []);

  /** Reset also invalidates in-flight batches, so a late flush cannot repaint a cleared board. */
  const resetRun = useCallback(() => {
    stop();
    generation.current++;
    dispatch({ type: "reset" });
    setError(null);
  }, [stop]);

  /** Schedule the rest of a chat on its grid, then stop by itself. The cap is a hard backstop. */
  const play = useCallback(
    (chatIds: string[]) => {
      dispatch({ type: "set_playing", chatIds, playing: true });
      for (const id of chatIds) {
        const chat = stateRef.current.chats.find((c) => c.id === id);
        const script = SCRIPTS.find((s) => s.id === id);
        if (!chat || !script) continue;
        const base = chat.delivered > 0 ? script.at[chat.delivered - 1]! : 0;
        for (let i = chat.delivered; i < script.messages.length; i++) {
          const last = i === script.messages.length - 1;
          setTimer(`${id}:${i}`, Math.max(i === 0 ? 0 : GRID_MS, script.at[i]! - base), () => {
            if (!stateRef.current.chats.find((c) => c.id === id)?.playing) return;
            deliver(id, true);
            if (last) dispatch({ type: "set_playing", chatIds: [id], playing: false });
          });
        }
      }
      setTimer("cap", RUN_CAP_MS, stop);
    },
    [deliver, stop],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
      if (flushTimer.current) clearTimeout(flushTimer.current);
    };
  }, []);

  const active = state.chats.find((c) => c.id === state.activeId) ?? state.chats[0]!;
  const anyPlaying = state.chats.some((c) => c.playing);
  const remaining = state.chats.reduce((n, c) => n + (c.scriptLength - c.delivered), 0);
  const judged = state.panelMs.length;

  const rows = useMemo(
    () => [...state.chats].sort((a, b) => queuePriority(b.judgment) - queuePriority(a.judgment)),
    [state.chats],
  );

  return (
    <div className="d-agent-assist">
      <div className="aa-bar panel">
        <div className="aa-controls">
          {anyPlaying ? (
            <button className="btn" onClick={stop}>
              Stop
            </button>
          ) : (
            <button className="btn primary" onClick={() => play(state.chats.map((c) => c.id))} disabled={remaining === 0}>
              Run all 8 chats
            </button>
          )}
          <button className="btn" onClick={resetRun}>
            Reset
          </button>
        </div>
        <p className="muted aa-summary" role="status"><b>{judged}</b> of {TOTAL_MESSAGES} customer messages analyzed · signals use customer messages only · select a chat to review its suggested reply.</p>
      </div>

      {error && <p className="error aa-error">Batch failed: {error} — the last judgment stays on screen; press Run again.</p>}

      <div className="aa-columns">
        <aside className="panel aa-queue">
          <p className="panel-title">
            Queue <span className="muted">sorted by risk</span>
          </p>
          <ul>
            {rows.map((chat) => {
              const s = chat.judgment?.answers.signals;
              const churn = chat.judgment?.answers.churn.score ?? 0;
              const frustration = chat.judgment?.answers.frustration.score ?? 0;
              const hot = (s?.escalate ?? 0) >= YES;
              const last = chat.messages[chat.messages.length - 1];
              const preview = last?.text ?? SCRIPTS.find((x) => x.id === chat.id)!.messages[0]!.text;
              return (
                <li key={chat.id}>
                  <button
                    className={`aa-row ${chat.id === active.id ? "active" : ""} ${hot ? "hot" : ""}`}
                    onClick={() => dispatch({ type: "select", chatId: chat.id })}
                  >
                    <span className="aa-row-head">
                      <span className="aa-name">{chat.customer.name}</span>
                      {chat.pending && <span className="aa-dot pending" title="judging" />}
                      {!chat.pending && chat.playing && <span className="aa-dot live" title="script playing" />}
                      <span className="aa-row-meta">
                        {`${chat.delivered}/${chat.scriptLength} messages`}
                      </span>
                    </span>
                    <span className={`aa-row-last ${last ? "" : "muted"}`}>{last ? preview : `${chat.label}: ${preview}`}</span>
                    {s && (
                      <span className="aa-badges">
                        {hot && <span className="tag hot">escalate</span>}
                        {churn >= CHURN_ALERT && <span className="tag warn">churn {churn.toFixed(1)}</span>}
                        {frustration >= FRUSTRATION_ALERT && <span className="tag warn">frustrated</span>}
                        {s.regulatory >= YES && <span className="tag purple">regulatory</span>}
                        {s.refundRequested >= YES && <span className="tag">refund</span>}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <Conversation
          chat={active}
          onDraft={(draft) => dispatch({ type: "set_draft", chatId: active.id, draft, source: draft ? "manual" : null })}
          onSend={() => active.draft.trim() && dispatch({ type: "agent_message", chatId: active.id, text: active.draft.trim() })}
          onNext={() => deliver(active.id, false)}
          onPlay={() => play([active.id])}
          onPause={() => pause(active.id)}
        />

        <Copilot
          chat={active}
          onInsertMacro={(id) => {
            const m = macroById(id);
            if (m) dispatch({ type: "set_draft", chatId: active.id, draft: fillMacro(m, active.customer.name), source: "manual" });
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- panels

function Conversation({
  chat,
  onDraft,
  onSend,
  onNext,
  onPlay,
  onPause,
}: {
  chat: Chat;
  onDraft: (d: string) => void;
  onSend: () => void;
  onNext: () => void;
  onPlay: () => void;
  onPause: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [chat.messages.length, chat.id]);
  const done = chat.delivered >= chat.scriptLength;
  const upcoming = SCRIPTS.find((s) => s.id === chat.id)!.messages.slice(chat.delivered, chat.delivered + 2);

  return (
    <section className="panel aa-conversation">
      <div className="panel-title aa-conv-head">
        <span>
          <span className="aa-name">{chat.customer.name}</span>{" "}
          <span className="muted">
            {chat.customer.plan} · {chat.customer.tenure_months} mo · {chat.customer.prior_tickets} prior tickets
          </span>
        </span>
        <span className="aa-conv-controls">
          <button className="btn small" onClick={onNext} disabled={done || chat.playing} title="Deliver the next scripted customer message">
            Next message
          </button>
          {chat.playing ? (
            <button className="btn small" onClick={onPause}>
              Pause
            </button>
          ) : (
            <button className="btn small" onClick={onPlay} disabled={done}>
              Play chat
            </button>
          )}
        </span>
      </div>
      <div className="aa-messages" ref={scroller}>
        {chat.messages.map((m, i) => (
          <div key={i} className={`aa-msg ${m.role}`}>
            <div className="aa-who">{m.role === "customer" ? chat.customer.name : "You"}</div>
            <div className="aa-bubble">{m.text}</div>
          </div>
        ))}
        {chat.pending && <div className="aa-typing">judging…</div>}
        {upcoming.length > 0 && (
          <div className="aa-upcoming">
            <span className="tag">scripted next</span>
            {upcoming.map((m, i) => (
              <p key={i}>{m.text}</p>
            ))}
          </div>
        )}
      </div>
      <div className="aa-composer">
        <textarea
          className="textarea"
          aria-label="Reply to customer"
          value={chat.draft}
          onChange={(e) => onDraft(e.target.value)}
          placeholder="Reply… auto-filled when the copilot is confident"
          rows={3}
        />
        <div className="aa-composer-foot">
          <span className="muted">
            {chat.draftSource === "auto" ? "Auto-filled from macro, sending in 1.5 s" : chat.draftSource === "manual" ? "Draft" : ""}
          </span>
          <button className="btn primary small" onClick={onSend} disabled={!chat.draft.trim()}>
            Send
          </button>
        </div>
      </div>
    </section>
  );
}

function Copilot({ chat, onInsertMacro }: { chat: Chat; onInsertMacro: (id: string) => void }) {
  const j = chat.judgment;
  const refundOk = refundEligibleByPolicy(chat.customer);
  const fired = j ? SIGNALS.filter((s) => j.answers.signals[s.key] >= YES) : [];
  const quiet = j ? SIGNALS.filter((s) => j.answers.signals[s.key] < YES) : [];

  return (
    <aside className="panel aa-copilot">
      <p className="panel-title aa-conv-head">
        <span>Copilot</span>
      </p>

      {chat.error && <p className="error">Judgment failed: {chat.error}</p>}

      {!j && (
        <div className="aa-catalog">
          <p className="muted">
            {chat.pending ? "Judging…" : "Start a chat to see customer intent, risk signals and a suggested reply."}
          </p>
          <p className="panel-title">Macro catalog · 12 canned replies</p>
          <ul>
            {MACROS.map((m) => (
              <li key={m.id}>
                <button className="aa-catalog-row" onClick={() => onInsertMacro(m.id)} title={m.summary}>
                  {m.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {j && (
        <div className="aa-copilot-body">
          <div>
            <p className="panel-title">Intent</p>
            <p className="aa-intent">
              {j.answers.intent.label.replace(/_/g, " ")} <span className="muted">{pct(j.answers.intent.confidence)}</span>
            </p>
          </div>

          <div className="aa-gauges">
            <Gauge title="Churn risk" score={j.answers.churn.score} scale={CHURN_SCALE} warn={CHURN_ALERT} />
            <Gauge title="Frustration" score={j.answers.frustration.score} scale={FRUSTRATION_SCALE} warn={FRUSTRATION_ALERT} />
          </div>

          <div>
            <p className="panel-title">Signals</p>
            <div className="aa-chips">
              {fired.map((s) => (
                <span key={s.key} className={`tag ${s.tone === "good" ? "good" : "hot"}`} title={`${pct(j.answers.signals[s.key])} yes · ${STATEMENTS[s.from[0]!]}`}>
                  {s.label}
                </span>
              ))}
              <span className={`tag ${refundOk ? "good" : ""}`} title={`Policy in code, not in the model: ${chat.customer.plan} plan, ${chat.customer.tenure_months} months`}>
                Refund eligible {refundOk ? "yes" : "no"}
              </span>
            </div>
            {quiet.length > 0 && <p className="aa-quiet muted">Not flagged: {quiet.map((s) => s.label.toLowerCase()).join(", ")}</p>}
          </div>

          <MacroSection chat={chat} onInsertMacro={onInsertMacro} />
        </div>
      )}
    </aside>
  );
}

function Gauge({ title, score, scale, warn = 1.5 }: { title: string; score: number; scale: string[]; warn?: number }) {
  const level = Math.min(scale.length - 1, Math.round(score));
  const tone = score >= 2.5 ? "bad" : score >= warn ? "warn" : "calm";
  return (
    <div className={`aa-gauge ${tone}`}>
      <p className="panel-title">{title}</p>
      <p className="aa-gauge-value">
        {score.toFixed(1)}
        <span className="muted"> / 3</span>
      </p>
      <div className="aa-gauge-bar">
        {scale.map((_, i) => (
          <span key={i} className={i <= Math.round(score) ? "on" : ""} />
        ))}
      </div>
      <p className="aa-gauge-label">{scale[level]!.split(/[:,]/)[0]}</p>
    </div>
  );
}

function MacroSection({ chat, onInsertMacro }: { chat: Chat; onInsertMacro: (id: string) => void }) {
  const gate = gateMacro(chat.judgment!.answers);
  return (
    <div>
      <p className="panel-title">
        Suggested reply <span className="muted">{pct(gate.confidence)} confident</span>
      </p>
      {gate.kind === "auto" && (
        <div className="aa-macro auto">
          <b>{macroTitle(gate.macroId)}</b>
          <p className="muted">Auto-filled into the reply box.</p>
        </div>
      )}
      {gate.kind === "none" && <p className="aa-macro muted">No macro fits — reply freehand.</p>}
      {gate.kind === "options" && (
        <div className="aa-options">
          <p className="muted">Below {pct(AUTO_FILL_CONFIDENCE)} — the agent picks:</p>
          {gate.top.map((o) => (
            <button key={o.id} className="aa-option" onClick={() => onInsertMacro(o.id)}>
              <span>{macroTitle(o.id)}</span>
              <span className="mono">{pct(o.probability)}</span>
            </button>
          ))}
        </div>
      )}
      {gate.kind !== "options" && (
        <div className="aa-top3">
          {gate.top.map((o) => (
            <div key={o.id} className="aa-top3-row">
              <span>{macroTitle(o.id)}</span>
              <span className="bar">
                <i style={{ width: `${Math.round(o.probability * 100)}%` }} />
              </span>
              <span className="mono">{pct(o.probability)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
