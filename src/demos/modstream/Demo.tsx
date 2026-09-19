// ModStream: every simulated chat message is held, judged by three batched calls
// (one /yes-no with fifteen statements, one /classify, one /rate), then released or
// removed by a pure policy.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dm1Error, type ClassifyResult, type RateResult, type YesNoResult } from "../../lib/dm1";
import {
  ACTION_LABELS,
  STOCK_CHAT,
  STOCK_RAID,
  STOCK_TEXTS,
  CARE_REPLY,
  DEFAULT_THRESHOLDS,
  Rolling,
  SEVERITY_SCALE,
  STATEMENTS,
  decide,
  emptyScore,
  isBlocking,
  makeRng,
  makeUsers,
  percentile,
  scoreVerdict,
  seedMessages,
  type ChatMessage,
  type Decision,
  type Judgment,
  type Thresholds,
} from "./data";
import "./demo.css";
import { stockBatch } from "../../lib/stock-batch";

// Messages kept for the outcomes table. The original experiment also carried archived
// totals for everything that fell out of this window; here the run budget below is 240,
// so nothing ever falls out and the archive would always read zero. Dropped on purpose.
const WINDOW = 500;
const BATCH = 32; // texts per call, the API maximum
const FLUSH_MS = 1200; // a batch leaves when it is full or this old
const MAX_RUN_MS = 60_000; // every loop stops itself: the demo key is shared
const MAX_MESSAGES = 240; // …and so does the message budget
const RAID_COUNT = 96;

type Override = "allow" | "hide" | "handled";
interface Decided {
  msg: ChatMessage;
  decision: Decision;
  reason: string;
  /** Set when a text test, not the model, decided the direction — printed in the row. */
  note: string | undefined;
  override: Override | null;
}

const BADGE: Record<Decision, string> = {
  allow: "Released",
  hide: "Hidden",
  timeout_user: "Timed out",
  care: "Care",
  review: "In review",
};

const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
const pctOf = (a: number, b: number) => (b === 0 ? "—" : `${Math.round((100 * a) / b)}%`);
const clockTime = (ts: number) => new Date(ts).toTimeString().slice(0, 8);

function effective(msg: ChatMessage, t: Thresholds, override: Override | null): { decision: Decision; reason: string; note?: string } {
  const base = decide(msg.judgment, t, msg.text);
  if (msg.judgment === null && msg.error === null) return { decision: "review" as Decision, reason: "sample message, not submitted" };
  if (override === "allow") return { decision: "allow" as Decision, reason: `mod approved (${base.reason})`, note: base.note };
  if (override === "hide") return { decision: "hide" as Decision, reason: `mod rejected (${base.reason})`, note: base.note };
  return base;
}

export default function Demo() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => seedMessages(12));
  const [running, setRunning] = useState(false);
  const [rate, setRate] = useState(5);
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [overrides, setOverrides] = useState<Map<number, Override>>(new Map());
  const [stats, setStats] = useState({ calls: 0, tokens: 0, batches: 0, errors: 0 });
  const [heldCount, setHeldCount] = useState(0);
  const [inFlight, setInFlight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  // A monotonic clock for the rolling figures: setRemaining(0) bails out once the stream
  // stops, which used to freeze msg/s at its last non-zero value.
  const [clockTick, setClockTick] = useState(0);
  const [showPolicy, setShowPolicy] = useState(false);

  const rng = useRef(makeRng(20260919));
  const users = useRef(makeUsers(1000, makeRng(4242)));
  const nextId = useRef(1);
  const stockCursor = useRef({ chat: 0, raid: 0 });
  const held = useRef<Array<ChatMessage & { arrived: number }>>([]);
  const busy = useRef(false);
  // Set when the API says the shared quota is exhausted. It holds the drain clause below
  // shut: without it a paused stream with a non-empty hold buffer re-flushes every 200 ms,
  // three calls an attempt, against a quota that is already gone. Only the visitor clears it.
  const paused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);
  const produced = useRef(0);
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const runningRef = useRef(false);
  const holdMs = useRef(new Rolling(300));
  const inferenceMs = useRef(new Rolling(300));
  const wallMs = useRef(new Rolling(300));
  const releases = useRef<number[]>([]);
  const sentBatches = useRef<number[]>([]);

  const stopStream = useCallback((why: string | null) => {
    runningRef.current = false;
    setRunning(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (why) setNote(why);
  }, []);

  const emit = useCallback((count: number, raid: boolean) => {
    const now = performance.now();
    const batch: Array<ChatMessage & { arrived: number }> = [];
    for (let i = 0; i < count; i++) {
      const pool = raid ? STOCK_RAID : STOCK_CHAT;
      const cursor = raid ? stockCursor.current.raid++ : stockCursor.current.chat++;
      const { text, truth } = pool[cursor % pool.length];
      const user = users.current[Math.floor(rng.current() * users.current.length)];
      batch.push({
        id: nextId.current++,
        user: user.name,
        color: user.color,
        text,
        truth,
        ts: Date.now(),
        raid,
        judgment: null,
        error: null,
        heldMs: null,
        arrived: now,
      });
    }
    held.current.push(...batch);
    setHeldCount(held.current.length);
  }, []);

  // The generator: Poisson gaps at the chosen rate, stopping on its own budget.
  const tick = useCallback(() => {
    if (!runningRef.current) return;
    if (produced.current >= MAX_MESSAGES) return stopStream(`Stopped after ${MAX_MESSAGES} messages. The free sample can be replayed.`);
    if (performance.now() - startedAt.current >= MAX_RUN_MS) return stopStream("Stopped after 60 seconds. The free sample can be replayed.");
    emit(1, false);
    produced.current++;
    const gap = (-Math.log(1 - rng.current()) / Math.max(1, rateRef.current)) * 1000;
    timer.current = setTimeout(tick, Math.max(10, Math.min(2000, gap)));
  }, [emit, stopStream]);

  const start = useCallback(() => {
    if (runningRef.current) return;
    paused.current = false;
    setError(null);
    setNote(null);
    produced.current = 0;
    startedAt.current = performance.now();
    runningRef.current = true;
    setRunning(true);
    tick();
  }, [tick]);

  /** Release a judged (or failed) batch into the window. */
  const release = useCallback((batch: Array<ChatMessage & { arrived: number }>, judgments: Array<Judgment | null>, err: string | null) => {
    const now = performance.now();
    const out = batch.map((m, i) => {
      const heldFor = Math.round(now - m.arrived);
      holdMs.current.push(heldFor);
      releases.current.push(now);
      const { arrived: _drop, ...rest } = m;
      return { ...rest, judgment: judgments[i], error: judgments[i] ? null : err, heldMs: heldFor };
    });
    setMessages((prev) => prev.concat(out).slice(-WINDOW));
  }, []);

  const flush = useCallback(async () => {
    const batch = held.current.splice(0, BATCH);
    if (batch.length === 0) return;
    busy.current = true;
    setHeldCount(held.current.length);
    setInFlight(batch.length);
    const texts = batch.map((m) => m.text);
    try {
      const [yes, cls, rated] = await Promise.all([
        stockBatch<{ results: Array<{ results: YesNoResult[] }> }>("yes-no", { texts, statements: STATEMENTS.map((s) => s.statement) }, STOCK_TEXTS),
        stockBatch<{ results: ClassifyResult[] }>("classify", { texts, labels: ACTION_LABELS }, STOCK_TEXTS),
        stockBatch<{ results: RateResult[] }>("rate", { texts, scale: SEVERITY_SCALE }, STOCK_TEXTS),
      ]);
      const judgments = texts.map((_, i) => {
        const c = cls.data.results[i];
        const r = rated.data.results[i];
        const j = {
          action: c.label,
          actionScores: c.scores,
          actionConfidence: c.confidence,
          severity: r.score,
          severityConfidence: r.confidence,
        } as Judgment;
        yes.data.results[i].results.forEach((x, k) => ((j as unknown as Record<string, number>)[STATEMENTS[k].key] = x.probability));
        return j;
      });
      sentBatches.current.push(performance.now());
      inferenceMs.current.push(Math.max(yes.meta.inferenceMs, cls.meta.inferenceMs, rated.meta.inferenceMs));
      wallMs.current.push(Math.max(yes.meta.wallMs, cls.meta.wallMs, rated.meta.wallMs));
      setStats((s) => ({
        calls: s.calls + 3,
        tokens: s.tokens + yes.meta.tokens + cls.meta.tokens + rated.meta.tokens,
        batches: s.batches + 1,
        errors: s.errors,
      }));
      setError(null);
      release(batch, judgments, null);
    } catch (e) {
      const dm = e instanceof Dm1Error ? e : null;
      const message = dm ? `${dm.code}: ${dm.message}` : e instanceof Error ? e.message : String(e);
      setStats((s) => ({ ...s, calls: s.calls + 3, errors: s.errors + 1 }));
      setError(message);
      if (dm && (dm.status === 429 || dm.status === 503)) {
        // Keep the messages held rather than dropping them, and stop producing more.
        held.current.unshift(...batch);
        setHeldCount(held.current.length);
        paused.current = true;
        stopStream("Paused: the request budget is busy. Press Start chat stream to resume.");
      } else {
        release(batch, batch.map(() => null), message);
      }
    } finally {
      busy.current = false;
      setInFlight(0);
    }
  }, [release, stopStream]);

  // One batch in flight at a time: three calls per batch against a 3 calls/s page budget.
  useEffect(() => {
    const id = setInterval(() => {
      // `paused` has to gate the whole tick, not just the drain clause below. After a 429
      // the failed batch is unshifted back, so held.length is 32 and the oldest message is
      // already older than FLUSH_MS — both of the first two clauses fire on their own, and
      // the page would re-send three calls every 200 ms into a quota that is already gone.
      if (busy.current || paused.current || held.current.length === 0) return;
      const oldest = held.current[0];
      // The last clause drains the final partial batch after a normal stop.
      if (held.current.length >= BATCH || performance.now() - oldest.arrived >= FLUSH_MS || !runningRef.current) void flush();
    }, 200);
    return () => clearInterval(id);
  }, [flush]);

  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(runningRef.current ? Math.max(0, MAX_RUN_MS - (performance.now() - startedAt.current)) : 0);
      setClockTick((n) => n + 1);
      const now = performance.now();
      releases.current = releases.current.filter((t) => now - t <= 3000);
      sentBatches.current = sentBatches.current.filter((t) => now - t <= 10_000);
    }, 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => () => stopStream(null), [stopStream]);

  const decided = useMemo<Decided[]>(
    () =>
      messages.map((msg) => {
        const override = overrides.get(msg.id) ?? null;
        const { decision, reason, note } = effective(msg, thresholds, override);
        return { msg, decision, reason, note, override };
      }),
    [messages, thresholds, overrides],
  );

  const metrics = useMemo(() => {
    const dm = emptyScore();
    const counts: Record<Decision, number> = { allow: 0, hide: 0, timeout_user: 0, care: 0, review: 0 };
    let judgedCount = 0;
    let heldNotJudged = 0;
    for (const d of decided) {
      // A message with no judgment yet is counted as Held, not as In review: the review
      // queue only ever holds judged messages, so counting it there made the strip read
      // "In review 12" next to an empty queue on a page that had not called anything.
      if (!d.msg.judgment && !d.msg.error) {
        heldNotJudged++;
        continue;
      }
      counts[d.decision]++;
      judgedCount++;
      scoreVerdict(dm, d.msg.truth, isBlocking(d.decision));
    }
    const hold = holdMs.current.values();
    return {
      dm,
      counts,
      heldNotJudged,
      judgedCount,
      holdP50: percentile(hold, 50),
      holdP95: percentile(hold, 95),
      holdSamples: hold,
      inferenceP50: percentile(inferenceMs.current.values(), 50),
      wallP50: percentile(wallMs.current.values(), 50),
      msgPerSec: releases.current.length / 3,
      // Three requests leave per batch. The ceiling this page operates under is 3 calls/s,
      // enforced page-wide by the queue in src/lib/dm1.ts.
      reqPerSec: (sentBatches.current.length * 3) / 10,
    };
    // `clockTick` counts up twice a second, which is what refreshes the rolling figures.
  }, [decided, stats, clockTick]);

  const reviewQueue = useMemo(() => decided.filter((d) => d.decision === "review" && d.override === null && d.msg.judgment).slice(-30).reverse(), [decided]);
  const careQueue = useMemo(() => decided.filter((d) => d.decision === "care" && d.override !== "handled").slice(-20).reverse(), [decided]);

  const setOverride = useCallback((id: number, ov: Override) => setOverrides((o) => new Map(o).set(id, ov)), []);

  const reset = () => {
    stopStream(null);
    paused.current = false;
    held.current = [];
    holdMs.current = new Rolling(300);
    inferenceMs.current = new Rolling(300);
    wallMs.current = new Rolling(300);
    releases.current = [];
    rng.current = makeRng(20260919);
    nextId.current = 1;
    stockCursor.current = { chat: 0, raid: 0 };
    produced.current = 0;
    setMessages(seedMessages(12));
    setOverrides(new Map());
    setStats({ calls: 0, tokens: 0, batches: 0, errors: 0 });
    setHeldCount(0);
    setError(null);
    setNote(null);
  };

  const customPolicy = (Object.keys(DEFAULT_THRESHOLDS) as Array<keyof Thresholds>).some((k) => thresholds[k] !== DEFAULT_THRESHOLDS[k]);

  return (
    <div className="d-modstream">
      <div className="ms-toolbar panel">
        <div className="ms-controls">
          <button className="btn primary" onClick={() => (running ? stopStream(null) : start())}>
            {running ? "Pause stream" : "Start chat stream"}
          </button>
          <button
            className="btn"
            onClick={() => {
              // Charged against the same budget as the generator, or one visitor could
              // click this all day and drain your key.
              produced.current += RAID_COUNT;
              emit(RAID_COUNT, true);
            }}
            disabled={!running || produced.current + RAID_COUNT > MAX_MESSAGES}
            title={`Drop ${RAID_COUNT} spam, harassment and slur messages at once`}
          >
            Simulate raid
          </button>
          <label className="ms-slider">
            <span>
              Message rate <b>{rate}/s</b>
            </span>
            <input type="range" min={2} max={16} step={1} value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Message rate" />
          </label>
          <button className="btn" onClick={() => setShowPolicy(true)}>
            Thresholds {customPolicy && <span className="ms-dot" aria-label="custom" />}
          </button>
          <button className="btn" onClick={reset}>
            Reset
          </button>
          <span className={`tag ${running ? "good" : ""}`}>{running ? `simulated · stops in ${Math.ceil(remaining / 1000)}s` : "paused"}</span>
        </div>
      </div>

      {error && <p className="error ms-inline-error">{error}</p>}
      {note && !error && <p className="muted ms-inline-error">{note}</p>}

      <section className="ms-hud" aria-label="Live metrics">
        <div className="panel ms-metric">
          <p className="panel-title">Messages judged / second</p>
          <div className="ms-value">
            {metrics.msgPerSec.toFixed(1)}
            <small>msg/s</small>
          </div>
          <p className="muted">
            {metrics.judgedCount.toLocaleString()} judged · {heldCount} queued · {inFlight} being checked
          </p>
        </div>
        <div className="panel ms-metric">
          <p className="panel-title">Time held before a decision</p>
          <div className="ms-value">
            {metrics.holdSamples.length ? ms(metrics.holdP95) : "—"}
            <Trace samples={metrics.holdSamples} />
          </div>
          <p className="muted">
            95% of messages waited this long or less, including batch collection and API calls.
          </p>
        </div>
        <div className="panel ms-metric">
          <p className="panel-title">Queued for the model</p>
          <div className="ms-value">{heldCount + inFlight}<small>messages</small></div>
          <p className="muted">The free stock stream repeats. Fixed sample groups are analyzed together; recorded usage includes the full group. Initial messages are not submitted.</p>
        </div>
      </section>

      <div className="ms-panes">
        <ChatPane items={decided} />
        <QueuePane review={reviewQueue} care={careQueue} onOverride={setOverride} />
      </div>

      <Outcomes metrics={metrics} customPolicy={customPolicy} />

      {showPolicy && <PolicyDialog thresholds={thresholds} onChange={setThresholds} onClose={() => setShowPolicy(false)} windowSize={metrics.judgedCount} />}
    </div>
  );
}

function Trace({ samples }: { samples: readonly number[] }) {
  if (samples.length < 2) return <span className="ms-trace-empty" />;
  const max = Math.max(1, ...samples);
  const points = samples.map((v, i) => `${(i / (samples.length - 1)) * 140},${32 - (v / max) * 28}`).join(" ");
  return (
    <svg className="ms-trace" viewBox="0 0 140 36" preserveAspectRatio="none" role="img" aria-label={`Hold times for the last ${samples.length} messages`}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function ChatPane({ items }: { items: Decided[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const [filter, setFilter] = useState<"all" | "interventions">("all");
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    return items
      .filter((d) => (filter === "all" || d.decision !== "allow") && (!search || `${d.msg.user} ${d.msg.text}`.toLowerCase().includes(search)))
      .slice(-120);
  }, [items, filter, query]);

  useEffect(() => {
    const el = ref.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [visible, pinned]);

  return (
    <section className="panel ms-chat" aria-label="Live chat">
      <header className="ms-chat-head">
        <p className="panel-title">Live chat · moderator view</p>
        <div className="ms-chat-tools">
          <div className="ms-seg" role="group" aria-label="Filter chat">
            <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
              All
            </button>
            <button aria-pressed={filter === "interventions"} onClick={() => setFilter("interventions")}>
              Interventions
            </button>
          </div>
          <input className="input ms-search" type="search" placeholder="Search chat…" aria-label="Search messages" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </header>
      <div
        className="ms-scroll"
        ref={ref}
        onScroll={() => {
          const el = ref.current;
          if (el) setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
        }}
      >
        {visible.length === 0 && <p className="muted ms-empty">No messages match.</p>}
        {visible.map((d) => {
          const j = d.msg.judgment;
          const waiting = j === null && d.msg.error === null;
          // Only the signals the policy actually reads. The winning /classify label is
          // deliberately not printed: the policy discards it, so showing it would
          // advertise a verdict nothing acts on.
          const detail = j
            ? STATEMENTS.map((s) => `${s.label} ${((j as unknown as Record<string, number>)[s.key] as number).toFixed(2)}`).join(" · ") +
              ` · severity ${j.severity.toFixed(2)}/3 · escalate ${(j.actionScores?.escalate_to_human ?? 0).toFixed(2)}\nfixture label: ${d.msg.truth}`
            : d.msg.error
              ? `error: ${d.msg.error}`
              : "sample message, not submitted";
          return (
            <div key={d.msg.id} className={`ms-row ms-${waiting ? "held" : d.decision} ${d.msg.raid ? "ms-raid" : ""}`} title={`${d.msg.text}\n${d.reason}\n${detail}`}>
              <span className="ms-user" style={{ color: d.msg.color }}>
                {d.msg.user}
              </span>
              <span className="ms-text">
                {d.msg.text}
                {/* The direction tests are text, not inference. A viewer who writes their own
                    distress in the second person is timed out by one of them, so the row that
                    does it says so where the visitor can read it. */}
                {d.note && <em className="ms-note"> {d.note}</em>}
              </span>
              <span className="ms-meta">
                <span className={`tag ms-badge-${waiting ? "held" : d.decision}`}>{waiting ? "Sample · not checked" : BADGE[d.decision]}</span>
                <span className="mono muted">{d.msg.heldMs === null ? "not sent yet" : `${d.msg.heldMs} ms`}</span>
                <span className="mono muted ms-time">{clockTime(d.msg.ts)}</span>
              </span>
            </div>
          );
        })}
      </div>
      <footer className="ms-chat-foot muted">
        <span>
          {visible.length} shown · {items.length} in the policy window
        </span>
        {!pinned && (
          <button className="btn ms-mini" onClick={() => setPinned(true)}>
            Follow live
          </button>
        )}
      </footer>
    </section>
  );
}

function QueuePane({ review, care, onOverride }: { review: Decided[]; care: Decided[]; onOverride: (id: number, ov: Override) => void }) {
  const [tab, setTab] = useState<"review" | "care">("review");
  const list = tab === "review" ? review : care;
  return (
    <aside className="panel ms-queues" aria-label="Moderation inbox">
      <p className="panel-title">Moderation inbox</p>
      <div className="ms-seg" role="group" aria-label="Queue">
        <button aria-pressed={tab === "review"} onClick={() => setTab("review")}>
          Human review <span className="ms-count">{review.length}</span>
        </button>
        <button aria-pressed={tab === "care"} onClick={() => setTab("care")}>
          Care <span className="ms-count">{care.length}</span>
        </button>
      </div>
      <div className="ms-scroll ms-queue-scroll">
        {list.length === 0 && (
          <p className="muted ms-empty">{tab === "review" ? "Nothing waiting for a human." : "Nobody waiting for support. Self-harm goes here, never to a ban."}</p>
        )}
        {list.map((d) => (
          <article key={d.msg.id} className="ms-qitem">
            <header>
              <span className="ms-user" style={{ color: d.msg.color }}>
                {d.msg.user}
              </span>
              <span className="tag">{d.msg.truth.replaceAll("_", " ")}</span>
            </header>
            <p className="ms-qtext">{d.msg.text}</p>
            <p className="muted mono ms-reason">{d.reason}</p>
            {d.note && <p className="ms-note">{d.note}</p>}
            {d.msg.judgment && <Bars j={d.msg.judgment} />}
            {tab === "care" ? (
              <>
                <p className="ms-care-reply">
                  <b>Supportive auto-reply</b> {CARE_REPLY}
                </p>
                <div className="ms-qactions">
                  <button className="btn ms-mini" onClick={() => onOverride(d.msg.id, "handled")}>
                    Mark as contacted
                  </button>
                </div>
              </>
            ) : (
              <div className="ms-qactions">
                <button className="btn ms-mini" onClick={() => onOverride(d.msg.id, "allow")}>
                  Approve
                </button>
                <button className="btn ms-mini" onClick={() => onOverride(d.msg.id, "hide")}>
                  Reject
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </aside>
  );
}

function Bars({ j }: { j: Judgment }) {
  const rows: Array<[string, number]> = [
    ...STATEMENTS.map((s) => [s.label, (j as unknown as Record<string, number>)[s.key] as number] as [string, number]),
    ["Severity", j.severity / 3],
  ];
  return (
    <div className="ms-bars">
      {rows.map(([label, v]) => (
        <div key={label} className="ms-bar-row">
          <span className="muted">{label}</span>
          <span className="bar">
            <i style={{ width: `${Math.round(v * 100)}%` }} />
          </span>
          <span className="mono">{v.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

function Outcomes({ metrics, customPolicy }: { metrics: { dm: ReturnType<typeof emptyScore>; counts: Record<Decision, number>; heldNotJudged: number }; customPolicy: boolean }) {
  const { dm, counts, heldNotJudged } = metrics;
  return (
    <section className="panel ms-comparison" aria-label="Outcomes">
      <p className="panel-title">
        Moderation outcomes {customPolicy && <span className="tag purple">custom thresholds</span>}
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Policy</th>
            <th scope="col">Harmful caught</th>
            <th scope="col">Clean messages blocked</th>
          </tr>
        </thead>
        <tbody>
          <tr className="ms-dm-row">
            <th scope="row">Current policy</th>
            <td>
              <b>{pctOf(dm.caught, dm.harmfulTotal)}</b> <span className="muted mono">{dm.caught}/{dm.harmfulTotal}</span>
            </td>
            <td>
              <b>{pctOf(dm.wronglyBlocked, dm.cleanTotal)}</b> <span className="muted mono">{dm.wronglyBlocked}/{dm.cleanTotal}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="muted ms-counts">
        {heldNotJudged > 0 && (
          <span>
            Unchecked samples <b>{heldNotJudged}</b>
          </span>
        )}
        {(Object.keys(counts) as Decision[]).map((k) => (
          <span key={k}>
            {BADGE[k]} <b>{counts[k]}</b>
          </span>
        ))}
        <span>Measured against the simulated messages’ expected labels. Requests for support are routed to care and excluded from these two counts.</span>
      </p>
    </section>
  );
}

const FIELDS: Array<{ key: keyof Thresholds; label: string; help: string; min: number; max: number; step: number }> = [
  { key: "selfHarm", label: "Self-harm → care", help: "Crisis probability at or above this routes to care — unless the message reads as game hyperbole or a joke, or is aimed at someone else.", min: 0.05, max: 0.9, step: 0.05 },
  { key: "timeout", label: "Timeout user", help: "Harassment or disguised-slur probability at or above this times the user out.", min: 0.2, max: 0.95, step: 0.05 },
  { key: "hide", label: "Hide message", help: "Strongest harm probability at or above this hides the message.", min: 0.1, max: 0.9, step: 0.05 },
  { key: "hideSeverity", label: "Hide at severity ≥", help: "The /rate score (0–3) that hides a message on its own. Severity peaks around 2.7 on this corpus, so at the default this clears about one message in a hundred.", min: 1, max: 3, step: 0.1 },
  { key: "timeoutSeverity", label: "Timeout at severity ≥", help: "The /rate score that times a user out on its own. The scale tops out at 3, so the default of 3.00 means “never, on severity alone”.", min: 1.5, max: 3, step: 0.1 },
  { key: "reviewBand", label: "Review band", help: "A signal this far below the hide line is held for a human instead of released.", min: 0, max: 0.3, step: 0.01 },
];

function PolicyDialog({ thresholds, onChange, onClose, windowSize }: { thresholds: Thresholds; onChange: (t: Thresholds) => void; onClose: () => void; windowSize: number }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog className="ms-dialog" ref={ref} onClose={onClose} onCancel={onClose} aria-labelledby="ms-policy-title">
      <h3 id="ms-policy-title">Policy thresholds</h3>
      <p className="muted">
        The policy is a pure function. Moving a slider re-decides all {windowSize} stored judgments instantly, with <b>no new inference</b>.
      </p>
      {FIELDS.map((f) => (
        <label key={f.key} className="ms-field">
          <span>
            {f.label} <code className="mono">{thresholds[f.key].toFixed(2)}</code>
          </span>
          <input type="range" min={f.min} max={f.max} step={f.step} value={thresholds[f.key]} onChange={(e) => onChange({ ...thresholds, [f.key]: Number(e.target.value) })} />
          <em className="muted">{f.help}</em>
        </label>
      ))}
      <div className="ms-qactions">
        <button className="btn" onClick={() => onChange({ ...DEFAULT_THRESHOLDS })}>
          Reset to defaults
        </button>
        <button className="btn primary" onClick={() => ref.current?.close()}>
          Done
        </button>
      </div>
    </dialog>
  );
}
