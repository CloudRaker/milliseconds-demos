// Voice turn: the assistant answers as soon as the request is actionable instead of waiting out a
// fixed silence timeout, and stops talking when the speaker interrupts.
//
// Session state lives in a ref and is stepped by one requestAnimationFrame loop (the Swift original
// used a 30 Hz Timer); React repaints the panels a few times a second from that ref.
import { useCallback, useEffect, useRef, useState } from "react";
import { classify, Dm1Error, type Meta } from "../../lib/dm1";
import {
  BARGE_IN,
  bargeInText,
  INTENT_LABELS,
  SCRIPT,
  type Intent,
} from "./data";
import {
  baselineFireTime,
  comparison,
  composeReply,
  DEFAULT_POLICY,
  fmtMs,
  intentTitle,
  isBargeIn,
  isReady,
  judgeDelayMs,
  mergeWords,
  probabilityPath,
  sameWords,
  slotQuestion,
  verdict,
  type DecisionSample,
  type FireSource,
  type Policy,
  type TranscriptWord,
  type TurnRecord,
} from "./engine";
import "./demo.css";
import { stockBatch } from "../../lib/stock-batch";
import { STOCK_SEGMENTS, slotLabels } from "./stock";
import type { ClassifyResult, YesNoResult } from "../../lib/dm1";

type Phase = "idle" | "listening" | "speaking";

/** One visitor shares a 200 req/min key with everyone else, so the session is bounded twice. */
const MAX_SECONDS = 60;
const MAX_REQUESTS = 80;
/** Coalescing: at most one call in flight, and never two closer together than this. */
const MIN_DISPATCH_GAP_MS = 420;
const WINDOW_SECONDS = 10;
const HISTORY_SECONDS = 40;
const FIRST_UTTERANCE_S = 0.8;
const GAP_AFTER_REPLY_S = 0.65;
const SPEAK_MS_PER_CHAR = 48;

interface Level {
  time: number;
  level: number;
}
interface Marker {
  time: number;
  kind: "judge" | "fallback" | "baseline" | "barge";
}
interface Session {
  t: number;
  startedAt: number;
  phase: Phase;
  words: TranscriptWord[];
  wordHistory: TranscriptWord[];
  levels: Level[];
  samples: DecisionSample[];
  markers: Marker[];
  turns: TurnRecord[];
  latest: DecisionSample | null;
  /** The last intent the model gave for this turn, kept when a newer partial clears `latest`. */
  lastIntent: Intent | null;
  lastVoiced: number;
  reply: string | null;
  replyIntent: Intent | null;
  speakingFrom: number;
  speakingUntil: number;
  requestsThisTurn: number;
  baselineFiredAt: number | null;
  ignorePartialsUntil: number;
  seq: number;
  appliedSeq: number;
  inflight: number;
  pending: boolean;
  lastDispatch: number;
  rateLimitedUntil: number;
  calls: number;
  stale: number;
  failed: number;
  tokens: number;
  inference: number[];
  wall: number[];
  error: string | null;
  finished: string | null;
  // simulated microphone
  utterance: number;
  uttStart: number | null;
  wordIndex: number;
  spoken: string[];
  nextUtteranceAt: number;
}

const blank = (): Session => ({
  t: 0,
  startedAt: 0,
  phase: "idle",
  words: [],
  wordHistory: [],
  levels: [],
  samples: [],
  markers: [],
  turns: [],
  latest: null,
  lastIntent: null,
  lastVoiced: 0,
  reply: null,
  replyIntent: null,
  speakingFrom: 0,
  speakingUntil: 0,
  requestsThisTurn: 0,
  baselineFiredAt: null,
  ignorePartialsUntil: 0,
  seq: 0,
  appliedSeq: 0,
  inflight: 0,
  pending: false,
  lastDispatch: -1,
  rateLimitedUntil: 0,
  calls: 0,
  stale: 0,
  failed: 0,
  tokens: 0,
  inference: [],
  wall: [],
  error: null,
  finished: null,
  utterance: 0,
  uttStart: null,
  wordIndex: 0,
  spoken: [],
  nextUtteranceAt: FIRST_UTTERANCE_S,
});

const pauseMs = (s: Session) =>
  s.words.length ? Math.max(0, s.t - Math.max(s.words.at(-1)!.time, s.lastVoiced)) * 1000 : 0;
const transcriptOf = (s: Session) => s.words.map((w) => w.text).join(" ");

export default function Demo() {
  const ref = useRef<Session>(blank());
  const canvas = useRef<HTMLCanvasElement>(null);
  const runningRef = useRef(false);
  const [running, setRunning] = useState(false);
  const [policy, setPolicy] = useState<Policy>(DEFAULT_POLICY);
  const [voice, setVoice] = useState(true);
  const [, repaint] = useState(0);
  const policyRef = useRef(policy);
  policyRef.current = policy;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const hush = useCallback(() => {
    try {
      globalThis.speechSynthesis?.cancel();
    } catch {
      /* speech is decoration; the phase timer drives the demo */
    }
  }, []);
  const speak = useCallback(
    (text: string) => {
      if (!voiceRef.current || typeof speechSynthesis === "undefined") return;
      try {
        speechSynthesis.cancel();
        speechSynthesis.speak(new SpeechSynthesisUtterance(text));
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const stop = useCallback(
    (note: string | null) => {
      runningRef.current = false;
      const s = ref.current;
      s.phase = "idle";
      if (note) s.finished = note;
      hush();
      setRunning(false);
      repaint((n) => n + 1);
    },
    [hush],
  );

  const record = useCallback((meta: Meta) => {
    const s = ref.current;
    s.calls++;
    s.tokens += meta.tokens;
    s.inference.push(meta.inferenceMs);
    s.wall.push(meta.wallMs);
  }, []);

  const onError = useCallback((e: unknown) => {
    const s = ref.current;
    s.failed++;
    if (e instanceof Dm1Error) {
      s.error = `${e.code}: ${e.message}`;
      if (e.status === 429) {
        s.rateLimitedUntil = s.t + 2;
        s.pending = false;
      }
    } else s.error = String((e as Error)?.message ?? e);
  }, []);

  /** The assistant is cut off: stop the speech, drop the interruption, keep listening. */
  const bargeIn = useCallback(() => {
    const s = ref.current;
    hush();
    s.markers.push({ time: s.t, kind: "barge" });
    if (s.turns.length) s.turns.at(-1)!.bargedIn = true;
    s.phase = "listening";
    s.speakingUntil = 0;
    s.words = [];
    s.latest = null;
    s.lastIntent = null;
    s.requestsThisTurn = 0;
    s.baselineFiredAt = null;
    s.spoken = [];
    s.nextUtteranceAt = s.t + GAP_AFTER_REPLY_S;
    // ponytail: the original re-asked the fan-out to see whether the interruption carried a new
    // request. Here a stop is just a stop, which saves a call and a branch.
    s.ignorePartialsUntil = s.t + 0.7;
  }, [hush]);

  /** One call per coalesced partial: the intent while listening, barge-in while speaking. */
  const dispatch = useCallback(() => {
    const s = ref.current;
    if (!runningRef.current || !s.words.length) return;
    if (s.inflight > 0 || s.t - s.lastDispatch < MIN_DISPATCH_GAP_MS / 1000) {
      s.pending = true;
      return;
    }
    if (s.t < s.rateLimitedUntil || s.calls >= MAX_REQUESTS) return;
    const text = transcriptOf(s);
    const saying = s.phase === "speaking" ? s.reply : null;
    const mySeq = ++s.seq;
    s.inflight++;
    s.requestsThisTurn++;
    s.lastDispatch = s.t;

    const call: Promise<Omit<DecisionSample, "seq" | "time">> = saying
      ? stockBatch<{results: {results: YesNoResult[]}[]}>("yes-no", { texts: [bargeInText(saying, text)], statements: [BARGE_IN.statement], when_true: BARGE_IN.when_true, when_false: BARGE_IN.when_false }, STOCK_SEGMENTS.map(segment => bargeInText("", segment))).then(({ data, meta }) => {
          record(meta);
          return {
            intent: s.latest?.intent ?? "incomplete",
            probability: 0,
            ready: false,
            bargeIn: data.results[0].results[0].probability,
          };
        })
      : stockBatch<{results: ClassifyResult[]}>("classify", { texts: [text], labels: INTENT_LABELS }, STOCK_SEGMENTS).then(({ data, meta }) => {
          const result = data.results[0];
          record(meta);
          const intent = (result.label in INTENT_LABELS ? result.label : "incomplete") as Intent;
          return { intent, probability: result.probability, ready: isReady(intent, text) };
        });

    call
      .then((answer) => {
        s.inflight--;
        if (mySeq <= s.appliedSeq) {
          s.stale++;
          return;
        }
        s.appliedSeq = mySeq;
        const sample: DecisionSample = { seq: mySeq, time: s.t, ...answer };
        s.samples.push(sample);
        if (!runningRef.current || transcriptOf(s) !== text) return;
        s.latest = sample;
        if (!saying) s.lastIntent = answer.intent;
        if (s.phase === "speaking" && isBargeIn(policyRef.current, sample)) bargeIn();
      })
      .catch((e) => {
        s.inflight--;
        onError(e);
      })
      .finally(() => {
        if (!s.pending) return;
        s.pending = false;
        dispatch();
      });
  }, [bargeIn, onError, record]);

  const handlePartial = useCallback(
    (text: string) => {
      const s = ref.current;
      if (!runningRef.current || s.t < s.ignorePartialsUntil) return;
      const merged = mergeWords(s.words, text, s.t);
      if (sameWords(merged, s.words)) return;
      if (merged.length > s.words.length) s.wordHistory.push(...merged.slice(s.words.length));
      s.words = merged;
      s.latest = null;
      dispatch();
    },
    [dispatch],
  );

  /** At fire time only: the model picks the slot value out of the regex candidates. */
  const resolveSlot = useCallback(
    async (intent: Intent, text: string): Promise<string | null> => {
      const q = slotQuestion(intent, text);
      if (!q?.candidates.length) return null;
      const s = ref.current;
      if (s.calls >= MAX_REQUESTS) return q.candidates[0];
      const labels = slotLabels(intent, text)!;
      s.requestsThisTurn++;
      const { result, meta } = await classify(text, labels);
      record(meta);
      return result.label === "none" ? null : result.label;
    },
    [record],
  );

  const fire = useCallback(
    (source: FireSource) => {
      const s = ref.current;
      const last = s.words.at(-1);
      if (!last) return;
      const text = transcriptOf(s);
      const known = s.latest?.intent ?? s.lastIntent;
      const intent: Intent = known ?? "incomplete";
      const baseline = baselineFireTime(policyRef.current, last.time);
      const turn: TurnRecord = {
        index: s.turns.length + 1,
        transcript: text,
        intent,
        slot: null,
        reply: "…",
        lastWordTime: last.time,
        fireTime: s.t,
        fireSource: source,
        baselineFireTime: baseline,
        fireProbability: s.latest?.ready ? s.latest.probability : 0,
        requests: s.requestsThisTurn,
        bargedIn: false,
        baselineCutOffEarly: (s.baselineFiredAt ?? Infinity) < last.time,
      };
      s.turns.push(turn);
      if (source !== "judge" && s.baselineFiredAt !== null) {
        const dup = s.markers.findIndex((m) => m.kind === "baseline" && m.time === s.baselineFiredAt);
        if (dup >= 0) s.markers.splice(dup, 1);
      }
      s.markers.push({ time: s.t, kind: source === "judge" ? "judge" : "fallback" });
      if (s.baselineFiredAt === null) s.markers.push({ time: baseline, kind: "baseline" });

      s.words = [];
      s.latest = null;
      s.lastIntent = null;
      s.requestsThisTurn = 0;
      s.baselineFiredAt = null;
      s.spoken = [];
      s.phase = "speaking";
      s.speakingFrom = s.t;
      s.speakingUntil = s.t + 1.2;
      s.reply = "…";
      s.replyIntent = intent;

      resolveSlot(intent, text)
        .catch((e) => {
          onError(e);
          return null;
        })
        .then((slot) => {
          const reply = known ? composeReply(intent, slot, text) : "Okay, on it.";
          turn.slot = slot;
          turn.reply = reply;
          if (!runningRef.current || s.phase !== "speaking") return;
          s.reply = reply;
          s.speakingUntil = Math.max(
            s.speakingUntil,
            s.t + Math.min(2.6, Math.max(1.1, (reply.length * SPEAK_MS_PER_CHAR) / 1000)),
          );
          speak(reply);
        });
    },
    [onError, resolveSlot, speak],
  );

  /** The scripted microphone, stepped by the same clock as the policy. */
  const micStep = useCallback(() => {
    const s = ref.current;
    const u = SCRIPT[s.utterance];
    if (!u) {
      if (!s.finished) s.finished = "Script finished.";
      return;
    }
    if (s.uttStart === null) {
      if (u.bargeIn) {
        const overdue = s.t > s.nextUtteranceAt + 2.5; // the reply ended before the interruption
        if (!overdue && (s.phase !== "speaking" || s.t < s.speakingFrom + u.bargeInDelayMs / 1000))
          return;
      } else if (s.phase === "speaking" || s.t < s.nextUtteranceAt) return;
      s.uttStart = s.t;
      s.wordIndex = 0;
      s.spoken = [];
    }
    let offset = 0;
    for (let i = 0; i < u.words.length; i++) {
      offset += (u.words[i].gapBeforeMs + u.words[i].durationMs) / 1000;
      if (i < s.wordIndex) continue;
      if (s.t < s.uttStart + offset) break;
      s.wordIndex = i + 1;
      s.spoken.push(u.words[i].text);
      handlePartial(s.spoken.join(" "));
    }
    // synthetic level: a sine envelope inside each word, near silence between them
    const local = s.t - s.uttStart;
    let acc = 0;
    let level = 0;
    for (const w of u.words) {
      const from = acc + w.gapBeforeMs / 1000;
      const to = from + w.durationMs / 1000;
      if (local >= from && local <= to) {
        level = 0.25 + 0.6 * Math.sin((Math.PI * (local - from)) / (to - from)) * (0.6 + 0.4 * Math.random());
        break;
      }
      acc = to;
    }
    s.levels.push({ time: s.t, level });
    if (level > 0.05) s.lastVoiced = s.t;
    // the utterance is done once every word is out and the turn it produced has been consumed
    if (s.wordIndex >= u.words.length && !s.words.length) {
      s.utterance++;
      s.uttStart = null;
    }
  }, [handlePartial]);

  const start = useCallback(() => {
    ref.current = blank();
    ref.current.startedAt = performance.now();
    ref.current.phase = "listening";
    runningRef.current = true;
    setRunning(true);
  }, []);

  useEffect(() => {
    let raf = 0;
    let lastPaint = 0;
    const tick = () => {
      const s = ref.current;
      if (s.pending && s.inflight === 0) {
        s.pending = false;
        dispatch();
      }
      if (!s.words.length) return;
      const p = policyRef.current;
      const pause = pauseMs(s);
      if (s.baselineFiredAt === null && pause >= p.silenceTimeoutMs) {
        s.baselineFiredAt = s.t;
        s.markers.push({ time: s.t, kind: "baseline" });
      }
      const v = verdict(p, s.latest, pause, true);
      if (v) fire(v);
    };
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const s = ref.current;
      if (runningRef.current) {
        s.t = (performance.now() - s.startedAt) / 1000;
        if (s.t >= MAX_SECONDS) {
          stop("Session limit reached: 60 seconds per visitor.");
        } else {
          if (s.calls >= MAX_REQUESTS && !s.finished)
            s.finished = "Request budget spent: the silence timeout is doing the rest.";
          if (s.phase === "speaking" && s.t >= s.speakingUntil) {
            s.phase = "listening";
            s.nextUtteranceAt = s.t + GAP_AFTER_REPLY_S;
          }
          micStep();
          tick();
          trim(s);
          if (s.finished && s.phase !== "speaking" && !s.words.length && s.inflight === 0)
            stop(null);
        }
      }
      draw(canvas.current, ref.current, policyRef.current);
      if (performance.now() - lastPaint > 160) {
        lastPaint = performance.now();
        repaint((n) => n + 1);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [dispatch, fire, micStep, stop]);

  useEffect(() => hush, [hush]);

  const s = ref.current;
  const c = comparison(s.turns);
  const transcript = transcriptOf(s);
  const last = s.turns.at(-1);

  return (
    <div className="d-voice-turn">
      <div className="vt-bar">
        <button className="btn primary" onClick={() => (running ? stop(null) : start())}>
          {running ? "Stop" : "Start session"}
        </button>
        <span className={`vt-phase vt-ph-${s.phase}`}>{s.phase.toUpperCase()}</span>
        <label className="vt-check">
          <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} />
          Speak the replies
        </label>
        <span className="muted vt-note">
          Simulated microphone: a scripted transcript with realistic word timings. Nothing is
          recorded; only transcript text is sent. The session stops itself after 60 seconds.
        </span>
      </div>

      {s.t < s.rateLimitedUntil && <p className="warn">Rate limited — the silence fallback is active.</p>}
      {s.error && <p className="error">{s.error}</p>}
      {s.finished && <p className="muted vt-finished">{s.finished}</p>}

      <div className="vt-columns">
        <div className="vt-main">
          <section className="panel">
            <p className="panel-title">Live transcript</p>
            <div className="vt-live">
              <div>
                <p className="vt-transcript">{transcript || "…"}</p>
                <div className="vt-figures">
                  <Figure label="intent" value={s.latest ? intentTitle(s.latest.intent) : "--"} />
                  <Figure
                    label="Intent confidence"
                    value={s.latest && !s.latest.bargeIn ? s.latest.probability.toFixed(2) : "--"}
                    tone="accent"
                  />
                  <Figure
                    label="Required detail heard"
                    value={s.latest ? (s.latest.ready ? "yes" : "not yet") : "--"}
                    tone={s.latest && !s.latest.ready ? "base" : undefined}
                  />
                  <Figure label="pause" value={s.words.length ? fmtMs(pauseMs(s)) : "--"} />
                  {s.latest?.bargeIn !== undefined && (
                    <Figure label="Interruption probability" value={s.latest.bargeIn.toFixed(2)} tone="barge" />
                  )}
                </div>
              </div>
              <div className={`vt-reply ${s.phase === "speaking" ? "vt-on" : ""}`}>
                <p className="panel-title">
                  Assistant{" "}
                  {s.replyIntent && <span className="tag good">{intentTitle(s.replyIntent)}</span>}
                </p>
                <p className="vt-reply-text">{s.reply ?? "Waiting for a complete request…"}</p>
                {last && (
                  <p className="vt-reply-meta mono">
                    {last.fireSource === "judge"
                      ? `Answered ${fmtMs(judgeDelayMs(last))} after the last word`
                      : `silence fallback at ${fmtMs(judgeDelayMs(last))}`}
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="panel">
            <p className="panel-title">
              Timeline <span className="muted">level · words · intent probability · fires</span>
            </p>
            <canvas ref={canvas} className="vt-canvas" />
            <div className="vt-legend">
              <Key color="var(--purple-on-dark)" text="intent probability, zero until the detail is said" />
              <Key color="var(--vt-judge)" text="answered" />
              <Key color="var(--vt-barge)" text="barge-in" />
              <Key color="var(--vt-wave)" text="simulated level" />
            </div>
          </section>

          <section className="panel">
            <p className="panel-title">
              Turns <span className="muted">{s.turns.length} completed</span>
            </p>
            <div className="vt-turns">
              {!s.turns.length && <p className="muted">No turn yet. Press Start session.</p>}
              {[...s.turns].reverse().map((t) => (
                <div className="vt-turn" key={t.index}>
                  <span className="mono muted">#{t.index}</span>
                  <span className="vt-turn-text">{t.transcript}</span>
                  <span className="vt-turn-intent">
                    {intentTitle(t.intent)}
                    {t.slot ? ` · ${t.slot}` : ""}
                  </span>
                  <span className="mono muted">p={t.fireProbability.toFixed(2)}</span>
                  <span className={`mono vt-fg-${t.fireSource === "judge" ? "judge" : "base"}`}>
                    {fmtMs(judgeDelayMs(t))}
                  </span>
                  <span className={`mono vt-fg-${t.fireSource === "judge" ? "judge" : "base"}`}>
                    {t.fireSource === "judge" ? "Model decision" : "Silence fallback"}
                  </span>
                  {t.bargedIn && <span className="tag hot">Barged</span>}
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="vt-side">
          <section className="panel">
            <p className="panel-title">Conversation outcomes</p>
            <div className="vt-outcomes">
              <Stat label="Average pause before reply" value={c.turns ? fmtMs(c.meanJudgeDelayMs) : "—"} tone="judge" />
              <Stat label="Replies from model decisions" value={String(c.judgeFires)} tone="judge" />
              <Stat label="Replies from silence fallback" value={String(c.fallbackFires)} tone="base" />
              <Stat label="Speaker interruptions" value={String(c.bargeIns)} tone="barge" />
            </div>
          </section>

          <section className="panel">
            <p className="panel-title">
              When to reply
            </p>
            <Slider
              label="Answer at probability"
              value={policy.fireThreshold}
              min={0.5}
              max={0.99}
              step={0.01}
              fmt={(v) => v.toFixed(2)}
              onChange={(v) => setPolicy({ ...policy, fireThreshold: v })}
            />
            <Slider
              label="Barge-in threshold"
              value={policy.bargeInThreshold}
              min={0.5}
              max={0.99}
              step={0.01}
              fmt={(v) => v.toFixed(2)}
              onChange={(v) => setPolicy({ ...policy, bargeInThreshold: v })}
            />
            <Slider
              label="Min pause before acting"
              value={policy.minPauseMs}
              min={0}
              max={600}
              step={10}
              fmt={(v) => `${v} ms`}
              onChange={(v) => setPolicy({ ...policy, minPauseMs: v })}
            />
            <Slider
              label="Silence fallback delay"
              value={policy.silenceTimeoutMs}
              min={500}
              max={2000}
              step={50}
              fmt={(v) => `${v} ms`}
              onChange={(v) => setPolicy({ ...policy, silenceTimeoutMs: v })}
            />
            <p className="muted vt-small">
              The model never sees these numbers. It answers what the speaker wants; these rules
              decide when to act, and stretch the timeout to {policy.silenceTimeoutMs * 2.5} ms while
              a needed detail is still missing.
            </p>
          </section>

          <section className="panel">
            <p className="panel-title">
              Script <span className="muted">{SCRIPT.length} utterances</span>
            </p>
            <ol className="vt-script">
              {SCRIPT.map((u, i) => (
                <li key={u.text + i} className={running && i === s.utterance ? "vt-now" : ""}>
                  <span className="mono muted">{String(i + 1).padStart(2, "0")}</span> {u.text}
                  {u.bargeIn && <span className="tag hot">interrupts</span>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="vt-figure">
      <span>{label}</span>
      <b className={tone ? `vt-fg-${tone}` : ""}>{value}</b>
    </div>
  );
}
function Stat({
  label,
  value,
  tone,
  small,
}: {
  label: string;
  value: string;
  tone?: string;
  small?: boolean;
}) {
  return (
    <div className={`vt-stat ${small ? "vt-stat-s" : ""}`}>
      <span>{label}</span>
      <b className={tone ? `vt-fg-${tone}` : ""}>{value}</b>
    </div>
  );
}
function Key({ color, text }: { color: string; text: string }) {
  return (
    <span className="vt-key">
      <i style={{ background: color }} />
      {text}
    </span>
  );
}
function Slider({
  label,
  value,
  min,
  max,
  step,
  fmt,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="vt-slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <b className="mono">{fmt(value)}</b>
    </label>
  );
}

function trim(s: Session) {
  const cutoff = s.t - HISTORY_SECONDS;
  while (s.levels.length && s.levels[0].time < cutoff) s.levels.shift();
  while (s.wordHistory.length && s.wordHistory[0].time < cutoff) s.wordHistory.shift();
  while (s.samples.length && s.samples[0].time < cutoff) s.samples.shift();
  while (s.markers.length && s.markers[0].time < cutoff) s.markers.shift();
}

/** The scrolling strip, ported from TimelineView.swift. */
function draw(el: HTMLCanvasElement | null, s: Session, p: Policy) {
  if (!el) return;
  const w = el.clientWidth;
  const h = el.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
  }
  const g = el.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const end = s.t + 1.6;
  const from = end - WINDOW_SECONDS;
  const x = (t: number) => ((t - from) / WINDOW_SECONDS) * w;
  const top = 26;
  const bottom = h * 0.56;
  const y = (v: number) => bottom - v * (bottom - top);
  const waveMid = h * 0.84;
  const waveAmp = h * 0.12;

  const css = getComputedStyle(el);
  const col = (n: string, fallback: string) => css.getPropertyValue(n).trim() || fallback;
  const JUDGE = col("--vt-judge", "#6fdc8c");
  const BASE = col("--vt-base", "#f0b35a");
  const BARGE = col("--vt-barge", "#ff8a8a");
  const WAVE = col("--vt-wave", "#5d6a80");
  const ACCENT = col("--purple-on-dark", "#6d4aff");
  const mono = col("--mono", "monospace");
  const sans = col("--sans", "sans-serif");

  g.font = `10px ${mono}`;
  g.textAlign = "left";
  for (let sec = Math.ceil(from); sec <= end; sec++) {
    g.strokeStyle = "rgba(255,255,255,0.05)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x(sec), 0);
    g.lineTo(x(sec), h);
    g.stroke();
    g.fillStyle = "rgba(255,255,255,0.3)";
    g.fillText(`${sec}s`, x(sec) + 3, h - 5);
  }
  g.fillStyle = "rgba(255,255,255,0.03)";
  g.fillRect(x(s.t), 0, w - x(s.t), h);

  g.strokeStyle = WAVE;
  g.lineWidth = 1.5;
  g.beginPath();
  for (const l of s.levels) {
    if (l.time < from) continue;
    const a = Math.max(1, l.level * waveAmp);
    g.moveTo(x(l.time), waveMid - a);
    g.lineTo(x(l.time), waveMid + a);
  }
  g.stroke();

  const markers = s.markers.filter((m) => m.kind !== "baseline").sort((a, b) => a.time - b.time);
  g.strokeStyle = JUDGE;
  g.globalAlpha = 0.5;
  g.setLineDash([4, 4]);
  g.beginPath();
  g.moveTo(0, y(p.fireThreshold));
  g.lineTo(w, y(p.fireThreshold));
  g.stroke();
  g.setLineDash([]);
  g.globalAlpha = 1;
  g.fillStyle = JUDGE;
  g.fillText(`answer at ${p.fireThreshold.toFixed(2)}`, 6, y(p.fireThreshold) - 5);

  const fires = markers.filter((m) => m.kind === "judge" || m.kind === "fallback").map((m) => m.time);
  let segment: DecisionSample[] = [];
  const flush = (until: number) => {
    const pts = probabilityPath(segment, until);
    if (pts.length > 1) {
      g.strokeStyle = ACCENT;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x(pts[0][0]), y(pts[0][1]));
      for (const [t, v] of pts.slice(1)) g.lineTo(x(t), y(v));
      g.stroke();
      g.fillStyle = ACCENT;
      for (const smp of segment) {
        g.beginPath();
        g.arc(x(smp.time), y(smp.ready ? smp.probability : 0), 2.5, 0, Math.PI * 2);
        g.fill();
      }
    }
    segment = [];
  };
  let fi = 0;
  for (const smp of s.samples) {
    if (smp.bargeIn !== undefined) continue;
    while (fi < fires.length && fires[fi] < smp.time) flush(fires[fi++]);
    segment.push(smp);
  }
  flush(fi < fires.length ? fires[fi] : s.t);

  g.font = `11px ${sans}`;
  g.strokeStyle = "rgba(244,241,237,0.55)";
  g.fillStyle = "rgba(244,241,237,0.9)";
  g.lineWidth = 1;
  for (const word of s.wordHistory) {
    if (word.time < from) continue;
    g.beginPath();
    g.moveTo(x(word.time), bottom + 4);
    g.lineTo(x(word.time), bottom + 12);
    g.stroke();
    g.fillText(word.text, x(word.time) + 2, bottom + 24);
  }

  g.font = `10px ${mono}`;
  for (const m of markers) {
    const [color, label, dash]: [string, string, number[]] =
      m.kind === "judge"
        ? [JUDGE, "ANSWERED", []]
        : m.kind === "fallback"
          ? [BASE, "SILENCE FALLBACK", []]
          : [BARGE, "BARGE-IN", []];
    g.strokeStyle = color;
    g.setLineDash(dash);
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x(m.time), 12);
    g.lineTo(x(m.time), h - 14);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = color;
    const leading = m.kind === "barge";
    g.textAlign = leading ? "left" : "right";
    g.fillText(label, x(m.time) + (leading ? 4 : -4), m.kind === "barge" ? 24 : 10);
    g.textAlign = "left";
  }

  g.strokeStyle = "rgba(255,255,255,0.5)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x(s.t), 0);
  g.lineTo(x(s.t), h);
  g.stroke();
}
