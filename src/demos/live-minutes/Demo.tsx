import { useCallback, useEffect, useRef, useState } from "react";
import { Dm1Error } from "../../lib/dm1";
import { DEMO_LINES, MEETING, MEETING_TITLE, type LabelledUtterance } from "./data";
import {
  bucketFor,
  judgeFromTruth,
  resolveJudgment,
  supersedes,
  windowCalls,
  WINDOW_MAX,
  WINDOW_MS,
  type Bucket,
  type ClassifyRow,
  type Judgment,
  type WindowAnswers,
  type YesNoRow,
} from "./judge";
import "./demo.css";
import { stockBatch } from "../../lib/stock-batch";

/** One visitor plays at most this much of the standup: 40 lines or 60 seconds, whichever comes first.
 * DEMO_LINES holds 37, so the line cap never bites; the 60-second cap does, at 1x. */
const MAX_LINES = 40;
const MAX_RUN_MS = 60_000;
const LINES = DEMO_LINES.slice(0, MAX_LINES);
const STOCK_CALLS = windowCalls(LINES);
const FIRST = (name: string) => name.split(" ")[0];
const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

type Speed = 1 | 4 | "instant";
type Phase = "idle" | "running" | "done";

interface Line {
  u: LabelledUtterance;
  spokenAt: number;
  status: "pending" | "done";
  j?: Judgment;
}

interface Note {
  id: number;
  lineId: number;
  bucket: Bucket;
  text: string;
  speaker: string;
  assignee: string | null;
  uncertain: boolean;
  candidates: { name: string; p: number }[];
  due: string;
  dueDate: string | null;
  blocked: boolean;
  reverses: boolean;
  latencyMs: number;
  supersededBy: number | null;
}

const BUCKET_LABEL: Record<Bucket, string> = { actions: "To do", decisions: "Decided", questions: "Open question", risks: "Risk" };
/**
 * DEMO_LINES ends at 158 s, so a 1× run hits the 60-second cap around line 14 — inside the opening
 * excerpt, before the flip-flop and the blocker. The button says so rather than stopping silently.
 */
const SPEEDS: { sp: Speed; label: string; key: string; hint?: string }[] = [
  { sp: 1, label: "1× (opening only)", key: "1", hint: "real time: the 60-second cap stops the run inside the first excerpt" },
  { sp: 4, label: "4×", key: "4" },
  { sp: "instant", label: "All at once", key: "a" },
];

export default function LiveMinutes() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [speed, setSpeed] = useState<Speed>(4);
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  /** True once a window has fallen back to the transcript's ground truth because the proxy failed. */
  const [mock, setMock] = useState(false);

  const queue = useRef<Line[]>([]);
  const flushing = useRef(false);
  const cursor = useRef(0);
  const started = useRef(0);
  const noteId = useRef(1);
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;

  const stop = useCallback(() => {
    setPhase((p) => (p === "running" ? "done" : p));
  }, []);

  const reset = useCallback(() => {
    queue.current = [];
    cursor.current = 0;
    noteId.current = 1;
    setLines([]);
    setNotes([]);
    setElapsed(0);
    setError(null);
    setMock(false);
    setPhase("idle");
  }, []);

  const start = useCallback(() => {
    queue.current = [];
    cursor.current = 0;
    noteId.current = 1;
    started.current = performance.now();
    setLines([]);
    setNotes([]);
    setElapsed(0);
    setError(null);
    setMock(false);
    setPhase("running");
  }, []);

  /** The meeting clock: speaks each line when its moment arrives, and stops by itself. */
  useEffect(() => {
    if (phase !== "running") return;
    const speak = () => {
      const t = (performance.now() - started.current) / 1000;
      while (cursor.current < LINES.length) {
        const u = LINES[cursor.current];
        if (speed !== "instant" && u.endsAt / speed > t) break;
        cursor.current++;
        const line: Line = { u, spokenAt: performance.now(), status: "pending" };
        queue.current.push(line);
        setLines((xs) => [...xs, line]);
      }
      setElapsed(t);
      if (performance.now() - started.current > MAX_RUN_MS) stop();
      else if (cursor.current >= LINES.length && queue.current.length === 0 && !flushing.current) stop();
    };
    speak();
    const id = window.setInterval(speak, 120);
    return () => window.clearInterval(id);
  }, [phase, speed, stop]);

  /** Marks a window's lines judged and appends whatever notes they produced. Shared by the live
   * path and by the ground-truth fallback, so a failed window still fills the minutes. */
  const commit = useCallback((judged: { line: Line; j: Judgment }[], now: number) => {
    const byId = new Map(judged.map((k) => [k.line.u.id, k.j]));
    setLines((xs) => xs.map((x) => (byId.has(x.u.id) ? { ...x, status: "done" as const, j: byId.get(x.u.id) } : x)));
    setNotes((prev) => {
      let out = prev;
      for (const { line, j } of judged) {
        const bucket = bucketFor(j);
        if (!bucket) continue;
        const note: Note = {
          id: noteId.current++,
          lineId: line.u.id,
          bucket,
          text: line.u.text,
          speaker: line.u.speaker,
          assignee: j.assignee,
          uncertain: j.assigneeUncertain,
          candidates: j.assigneeCandidates,
          due: j.deadline.label,
          dueDate: j.deadline.date,
          blocked: j.blocked,
          reverses: j.reverses,
          latencyMs: now - line.spokenAt,
          supersededBy: null,
        };
        if (bucket === "decisions" && j.reverses) {
          const prevDecision = supersedes(out, line.u.id);
          if (prevDecision) out = out.map((x) => (x.id === prevDecision.id ? { ...x, supersededBy: note.id } : x));
        }
        out = [...out, note];
      }
      return out;
    });
  }, []);

  /** One window of lines, six calls, one round trip's worth of wait. */
  const flush = useCallback(async () => {
    const batch = queue.current.splice(0, 32);
    flushing.current = true;
    try {
      const calls = windowCalls(batch.map((l) => ({ id: l.u.id, speaker: l.u.speaker, text: l.u.text })));
      const results = await Promise.all(calls.map((c) => stockBatch<{ results: ClassifyRow[] | YesNoRow[] }>(c.route, { ...c.body, texts: c.body.texts as string[] }, STOCK_CALLS.find(stock => stock.key === c.key)!.body.texts as string[])));
      const answers = {} as WindowAnswers;
      results.forEach((r, i) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (answers as any)[calls[i].key] = r.data.results;
      });
      const judged = batch.map((l, i) => ({ line: l, j: resolveJudgment(answers, i, l.u.text, MEETING) }));
      const now = performance.now();
      commit(judged, now);
      setError(null);
    } catch (e) {
      // The proxy is down. Rather than leaving the minutes empty, fall back to the transcript's own
      // ground truth for this window and label the metrics strip "mock" so nothing is passed off as live.
      const msg = e instanceof Dm1Error ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
      setError(msg);
      setMock(true);
      commit(batch.map((l) => ({ line: l, j: judgeFromTruth(l.u.truth, l.u.text, MEETING) })), performance.now());
    } finally {
      flushing.current = false;
    }
  }, [commit]);

  /** Windows leave every WINDOW_MS, or as soon as WINDOW_MAX lines are waiting. */
  useEffect(() => {
    if (phase !== "running" && queue.current.length === 0) return;
    const id = window.setInterval(() => {
      if (flushing.current) return;
      if (queue.current.length === 0) {
        // The run is over and the queue has drained: nothing will ever arrive again.
        if (phaseRef.current !== "running") window.clearInterval(id);
        return;
      }
      const waited = performance.now() - queue.current[0].spokenAt;
      if (queue.current.length >= WINDOW_MAX || waited >= WINDOW_MS) void flush();
    }, 100);
    return () => window.clearInterval(id);
  }, [phase, flush]);

  /** s start/stop · x clear · 1 / 4 / a speed, the original's bindings minus the microphone. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const running = phaseRef.current === "running";
      if (e.key === "s") running ? stop() : start();
      else if (e.key === "x" && !running) reset();
      else if (!running && ["1", "4", "a"].includes(e.key)) setSpeed(SPEEDS.find((s) => s.key === e.key)!.sp);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [start, stop, reset]);

  const current = lines.at(-1);
  const judgedCount = lines.filter((l) => l.status === "done").length;
  const attendees = MEETING.attendees;
  const date = new Date(`${MEETING.today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

  return (
    <div className="d-live-minutes" onClick={() => setOpenMenu(null)}>
      <p className="muted">Play the free sample meeting at any speed. Analysis uses fixed transcript groups; recorded usage includes the full group.</p>
      <div className="panel lm-head">
        <div className="lm-head-top">
          <div>
            <p className="panel-title">{date} · {LINES.length} sample transcript lines</p>
            <h2>{MEETING_TITLE}</h2>
            <div className="lm-people">
              {attendees.map((a) => (
                <span key={a.name} className="lm-who" title={`${a.name} — ${a.role}`}>
                  <i className={`lm-av av-${FIRST(a.name).toLowerCase()}`}>{a.name[0]}</i>
                  {FIRST(a.name)}
                </span>
              ))}
            </div>
          </div>
          <div className="lm-controls">
            <span className={`lm-clock ${phase}`}>{phase === "running" && <i className="lm-dot" />}{phase === "idle" ? "not started" : clock(elapsed)}</span>
            <div className="lm-speeds" role="group" aria-label="Replay speed">
              {SPEEDS.map(({ sp, label, key, hint }) => (
                <button type="button" key={label} className={speed === sp ? "on" : ""} disabled={phase === "running"} onClick={() => setSpeed(sp)} title={hint ? `${key} — ${hint}` : key}>
                  {label}
                </button>
              ))}
            </div>
            {phase === "running" ? (
              <button type="button" className="btn primary" onClick={stop}>End meeting</button>
            ) : (
              <button type="button" className="btn primary" onClick={start}>{phase === "done" ? "Play again" : "Start meeting"}</button>
            )}
            {phase === "done" && <button type="button" className="btn" onClick={reset}>Clear</button>}
          </div>
        </div>
        <div className="metrics">
          <span><b>{judgedCount}</b>/{lines.length} lines judged</span>
          <span><b>{mock ? "Includes sample fallback" : judgedCount ? "Model results" : "Not run yet"}</b> source</span>
        </div>
        {error && (
          <p className="error lm-error">
            {error} — Some notes use the transcript’s saved labels because the API was unavailable. These are sample results.
          </p>
        )}
      </div>

      <div className="lm-cols">
        <section className="panel lm-transcript">
          <p className="panel-title">Transcript</p>
          <ol>
            {LINES.map((u) => {
              const line = lines.find((l) => l.u.id === u.id);
              return (
                <li key={u.id} className={`lm-line ${line ? line.status : "future"}${current?.u.id === u.id && phase === "running" ? " now" : ""}`}>
                  <i className={`lm-av av-${FIRST(u.speaker).toLowerCase()}`}>{u.speaker[0]}</i>
                  <span className="lm-said">{u.text}</span>
                  {line?.status === "pending" && <span className="tag">judging</span>}
                  {line?.j && <span className={`tag ${bucketFor(line.j) ? "purple" : ""}`}>{bucketFor(line.j) ? BUCKET_LABEL[bucketFor(line.j)!] : "not noted"}</span>}
                </li>
              );
            })}
          </ol>
        </section>

        <section className="panel lm-notes">
          <p className="panel-title">Minutes · {notes.length} {notes.length === 1 ? "note" : "notes"}</p>
          {notes.length === 0 && (
            <p className="muted lm-empty">
              {phase === "idle"
                ? "Start the meeting to turn spoken lines into action items, decisions, questions, and risks. Owners and due dates appear when stated."
                : "Listening…"}
            </p>
          )}
          {notes.map((n) => (
            <article key={n.id} className={`lm-note ${n.bucket}${n.supersededBy ? " gone" : ""}`}>
              <div className="lm-note-head">
                <span className="tag purple">{n.supersededBy ? "Reversed" : BUCKET_LABEL[n.bucket]}</span>
                {n.reverses && <span className="tag good">Replaces an earlier plan</span>}
                {n.blocked && <span className="tag hot">Blocked</span>}
                {n.due && <span className="tag warn" title={n.dueDate ?? "no date in the line"}>{n.due}</span>}

              </div>
              <p className="lm-note-text">{n.text}</p>
              <div className="lm-note-foot">
                {n.bucket === "actions" ? (
                  <div className="lm-owner-wrap" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className={`lm-owner${n.uncertain ? " unsure" : ""}`} onClick={() => setOpenMenu(openMenu === n.id ? null : n.id)}>
                      {n.uncertain ? <><i className="lm-av av-q">?</i>Who owns this?</> : <><i className={`lm-av av-${(n.assignee ?? "").toLowerCase()}`}>{n.assignee?.[0]}</i>{n.assignee}</>}
                    </button>
                    {openMenu === n.id && (
                      <div className="lm-menu">
                        {attendees.map((a) => {
                          const p = n.candidates.find((c) => c.name === FIRST(a.name))?.p ?? 0;
                          return (
                            <button type="button" key={a.name} onClick={() => { setNotes((xs) => xs.map((x) => (x.id === n.id ? { ...x, assignee: FIRST(a.name), uncertain: false } : x))); setOpenMenu(null); }}>
                              <i className={`lm-av av-${FIRST(a.name).toLowerCase()}`}>{a.name[0]}</i>
                              <span>{FIRST(a.name)}</span>
                              <b>{Math.round(p * 100)}%</b>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="lm-owner flat"><i className={`lm-av av-${FIRST(n.speaker).toLowerCase()}`}>{n.speaker[0]}</i>{FIRST(n.speaker)}</span>
                )}
              </div>
            </article>
          ))}
        </section>
      </div>

      <div className={`lm-caption${phase === "idle" ? " idle" : ""}`}>
        {current ? (
          <>
            <i className={`lm-av av-${FIRST(current.u.speaker).toLowerCase()}`}>{current.u.speaker[0]}</i>
            <span className="lm-caption-text">{current.u.text}</span>
            <span className={`lm-verdict ${current.status}`}>
              {current.status === "pending" && "judging…"}
              {current.status === "done" && (bucketFor(current.j!) ? BUCKET_LABEL[bucketFor(current.j!)!] : "not noted")}
            </span>
          </>
        ) : (
          <span className="muted">s start · x clear · 1 / 4 / a speed. The run stops by itself after {LINES.length} lines or {MAX_RUN_MS / 1000} seconds.</span>
        )}
      </div>
    </div>
  );
}
