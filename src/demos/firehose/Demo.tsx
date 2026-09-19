import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dm1Error, type ClassifyResult, type Meta, type RateResult } from "../../lib/dm1";
import {
  CATEGORY_LABELS,
  LANGUAGE_LABELS,
  LANG_TAG,
  SEVERITY_SCALE,
  AIMED_AT_A_PERSON,
  FLAG_AT,
  DEFAULT_TH,
  createDemoGenerator,
  STOCK_TEXTS,
  detectLang,
  inModQueue,
  modReason,
  heuristicJudgment,
  ruleBreakOf,
  streamContext,
  zeroScores,
  type Category,
  type ChatMessage,
  type Generator,
  type Judgment,
  type Lang,
  type Thresholds,
  type Scores,
} from "./data";
import "./demo.css";
import { stockBatch } from "../../lib/stock-batch";

// One page-wide budget: dm1 queues every call at 2/s. A batch is one /classify
// over up to 32 messages; only the messages that classifier flags go on to
// /rate. Policy is applied in the browser, so the sliders cost nothing.
//
// FLAG_AT is 0.20, not the 0.60 this shipped with: the English insults the nine-way softmax
// scatters land at rule break 0.20-0.38, and /rate is the only route that sees them (see
// inModQueue in data.ts). That rates 54 of every 96 generated messages instead of 20, which at
// 32 texts a call is 0.56 /rate calls per /classify call against the old 0.42 - still cheaper
// than the language call it replaced in the default budget.

const BATCH = 32;
const RATE_BATCH = 32; // the API's own limit for `texts`, same as /classify
const RUN_MS = 45_000; // a visitor cannot drain the shared quota: the loop stops itself
const MAX_MESSAGES = 1500;
const SHED_AFTER_MS = 4000;
const MAX_BACKLOG = 400;
const KEEP_ROWS = 1200;
const SHOW = 24; // rows rendered per column; the headers report the real total
const LANG_MAX_RATE = 32; // the brief: the language call is a second request, off above this rate
const FEED_RATE_AT = 0.2; // question score that also earns a /rate, below any useful slider position

interface Row {
  msg: ChatMessage;
  j?: Judgment;
  queuedAt: number;
  e2eMs?: number;
  action?: "timeout" | "delete" | "ignore";
}

// The nine labels compete for one probability mass, so "kys, and also what mouse do you use?" keeps
// only `question` (0.60) and its harassment score collapses to 0.00 - the harassment guard below is
// blind to it, exactly as the Jev original's `harassment < 0.50` guard would be. /rate is what sees
// it: every feed candidate is rated alongside the flagged rows, and the severity scale puts both
// "kys, and also what mouse do you use?" (level 3) and "are you always this bad or just today? what
// sens are you on?" (level 2) at AIMED_AT_A_PERSON while a real question sits at level 0.
// The level here, and the score in inModQueue, because neither is right about both jobs: this one
// rates 1.76/3 and plain corpus questions run as high as 2.00, so no score threshold separates them,
// while the queue cannot use the level because "will you play Zelda with viewers?" scores 1.49 and
// still comes back level 2. The guard costs one of the 14 corpus questions that clear the slider.
const isStreamerQuestion = (j: Judgment, t: Thresholds) =>
  j.scores.question >= t.question &&
  j.scores.harassment < t.harass &&
  Math.max(j.scores.scam, j.scores.spam) < 0.5 &&
  (j.severityLevel ?? 0) < AIMED_AT_A_PERSON;
const isSpoiler = (j: Judgment, t: Thresholds) => j.scores.spoiler >= t.spoiler;

const REASON_LABEL: Record<string, string> = {
  harassment: "harassment",
  scam: "scam",
  selfpromo: "self-promo",
  spoiler: "spoiler",
  spam: "flooding",
  review: "review",
};

const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");

/** Rows whose text matches are collapsed: chat asks the same thing twenty times. */
function collapseDuplicates(rows: Row[]): { row: Row; dupes: number }[] {
  const seen = new Map<string, { row: Row; dupes: number }>();
  for (const row of rows) {
    const key = row.msg.text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const hit = seen.get(key);
    if (hit) hit.dupes++;
    else seen.set(key, { row, dupes: 0 });
  }
  return [...seen.values()];
}

/** The opening screen: 42 unjudged messages, straight from the seeded generator. */
const seedRows = (gen: Generator): Row[] => Array.from({ length: 42 }, () => ({ msg: gen.next(), queuedAt: 0 }));

export default function Demo() {
  const [seed, setSeed] = useState(2024);
  const [rate, setRate] = useState(24);
  const [running, setRunning] = useState(false);
  // Off by default: on the corpus's own non-English lines the free regex detector wins 16/16 against
  // the model's 10/16, so leaving it on would spend a third of the shared quota to make the tag worse.
  // It stays as the toggle that lets you watch that happen.
  const [langModel, setLangModel] = useState(false);
  const [shield, setShield] = useState(true);
  const [th, setTh] = useState(DEFAULT_TH);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("Start the sample chat stream to sort moderation risks from questions worth answering.");
  const [, bump] = useState(0);

  const gen = useRef<Generator>(null);
  const rows = useRef<Row[]>([]);
  const queue = useRef<Row[]>([]);
  const rateQueue = useRef<Row[]>([]);
  const actions = useRef<string[]>([]);
  const inFlight = useRef(0);
  const batchNo = useRef(0);
  // modelJudged, not judged: a shed row costs zero tokens, so dividing by it would make the
  // per-message cost *fall* as shedding rises.
  // classifyCalls, not calls: `calls` also counts /rate (32 texts) and the language /classify, so
  // dividing judgments by it understates what a single classify request carried.
  const stats = useRef({ calls: 0, classifyCalls: 0, tokens: 0, judged: 0, modelJudged: 0, shed: 0, ingested: 42, inference: [] as number[], wall: [] as number[], e2e: [] as number[] });
  const startedAt = useRef(0);
  const live = useRef({ running: false, rate: 24, langModel: false });
  live.current = { running, rate, langModel };

  // Seed data on screen before any request.
  if (!gen.current) {
    gen.current = createDemoGenerator(seed);
    rows.current = seedRows(gen.current);
  }

  const reset = useCallback(
    (nextSeed: number) => {
      setRunning(false);
      gen.current = createDemoGenerator(nextSeed);
      rows.current = seedRows(gen.current);
      queue.current = [];
      rateQueue.current = [];
      actions.current = [];
      stats.current = { calls: 0, classifyCalls: 0, tokens: 0, judged: 0, modelJudged: 0, shed: 0, ingested: 42, inference: [], wall: [], e2e: [] };
      setError(null);
      setNote("Start the sample chat stream to sort moderation risks from questions worth answering.");
      bump((n) => n + 1);
    },
    [],
  );

  const record = useCallback((meta: Meta) => {
    const s = stats.current;
    s.calls++;
    s.tokens += meta.tokens;
    s.inference.push(meta.inferenceMs);
    s.wall.push(meta.wallMs);
  }, []);

  const apply = useCallback((row: Row, j: Judgment) => {
    row.j = j;
    row.e2eMs = row.queuedAt ? Math.round(performance.now() - row.queuedAt) : 0;
    if (row.e2eMs) stats.current.e2e.push(row.e2eMs);
    stats.current.judged++;
  }, []);

  const shed = useCallback(
    (batch: Row[]) => {
      for (const row of batch) {
        apply(row, heuristicJudgment(row.msg.text));
        stats.current.shed++;
      }
    },
    [apply],
  );

  /**
   * The original's seventh question (a choice over nine languages) as a second /classify over the same
   * 32 texts. Off above LANG_MAX_RATE msg/s, and off if it fails: detectLang() is the documented fallback.
   */
  const sendLang = useCallback(
    async (batch: Row[]) => {
      try {
        const r = await stockBatch<{ results: ClassifyResult[] }>("classify", {
          texts: batch.map((x) => x.msg.text),
          labels: LANGUAGE_LABELS,
        }, STOCK_TEXTS);
        record(r.meta);
        batch.forEach((row, i) => {
          const lang = r.data.results[i]?.label as Lang | undefined;
          if (lang && row.j) row.j.lang = lang;
        });
      } catch {
        // keep the regex tag the row already carries
      }
    },
    [record],
  );

  /** One /classify over up to 32 messages, then /rate over whatever it flagged. */
  const sendClassify = useCallback(
    async (batch: Row[]) => {
      inFlight.current++;
      try {
        const r = await stockBatch<{ results: ClassifyResult[] }>("classify", {
          texts: batch.map((x) => x.msg.text),
          labels: CATEGORY_LABELS,
        }, STOCK_TEXTS);
        record(r.meta);
        stats.current.classifyCalls++;
        batch.forEach((row, i) => {
          const res = r.data.results[i];
          if (!res) return apply(row, heuristicJudgment(row.msg.text));
          const scores = { ...zeroScores(), ...(res.scores as Scores) };
          apply(row, {
            scores,
            category: res.label as Category,
            ruleBreak: ruleBreakOf(scores),
            lang: detectLang(row.msg.text),
            source: "model",
          });
          stats.current.modelJudged++;
          if (row.j && (row.j.ruleBreak >= FLAG_AT || row.j.scores.question >= FEED_RATE_AT)) rateQueue.current.push(row);
        });
        setError(null);
        // Every second batch, not every batch: one run is then ~60 calls against the shared
        // 200/min org limit, so two visitors at once still fit.
        batchNo.current++;
        if (live.current.langModel && live.current.rate <= LANG_MAX_RATE && batchNo.current % 2 === 0) await sendLang(batch);
      } catch (e) {
        setError(e instanceof Dm1Error ? `${e.code}: ${e.message}` : String(e));
        shed(batch);
      } finally {
        inFlight.current--;
      }
    },
    [apply, record, sendLang, shed],
  );

  /** The cascade: severity only for messages the classifier already flagged. */
  const sendRate = useCallback(
    async (batch: Row[]) => {
      inFlight.current++;
      try {
        const r = await stockBatch<{ results: RateResult[] }>("rate", {
          texts: batch.map((x) => x.msg.text),
          scale: SEVERITY_SCALE,
        }, STOCK_TEXTS);
        record(r.meta);
        batch.forEach((row, i) => {
          const res = r.data.results[i];
          if (!res || !row.j) return;
          row.j.severity = res.score;
          row.j.severityLevel = res.level;
          row.j.severityConfidence = res.confidence;
        });
      } catch (e) {
        setError(e instanceof Dm1Error ? `${e.code}: ${e.message}` : String(e));
      } finally {
        inFlight.current--;
      }
    },
    [record],
  );

  // Producer: emits `rate` messages per second and stops itself.
  useEffect(() => {
    if (!running) return;
    startedAt.current = performance.now();
    // The 42 seed rows are already on screen; queue the unjudged ones so the first /classify judges
    // the messages the visitor is looking at instead of leaving them pending until they scroll away.
    for (const row of rows.current) {
      if (row.j || row.queuedAt) continue;
      row.queuedAt = performance.now();
      queue.current.push(row);
    }
    let carry = 0;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      carry += (live.current.rate * (now - last)) / 1000;
      last = now;
      const n = Math.floor(carry);
      carry -= n;
      for (let i = 0; i < n; i++) {
        const msg = gen.current!.next();
        const row: Row = { msg, queuedAt: now };
        rows.current.push(row);
        stats.current.ingested++;
        queue.current.push(row);
      }
      if (rows.current.length > KEEP_ROWS) rows.current.splice(0, rows.current.length - KEEP_ROWS);
      if (now - startedAt.current > RUN_MS) {
        setRunning(false);
        setNote(`Finished ${Math.round(RUN_MS / 1000)} seconds of sample chat. Start again to continue.`);
      } else if (stats.current.ingested >= MAX_MESSAGES) {
        setRunning(false);
        setNote(`Stopped at ${fmtInt(MAX_MESSAGES)} messages. Press start again.`);
      }
      bump((x) => x + 1);
    }, 100);
    return () => clearInterval(id);
  }, [running, apply]);

  // Dispatcher: fills batches, sheds anything that waited too long, redraws.
  useEffect(() => {
    const id = setInterval(() => {
      // Idle: no ingest, nothing queued. Without this the whole tree re-rendered 6.6 times a second
      // before the visitor ever pressed Start.
      if (!live.current.running && queue.current.length === 0 && rateQueue.current.length === 0) return;
      const now = performance.now();
      const q = queue.current;
      // shed: too old, or past the backlog cap. NOT "the loop stopped": dropping the tail on stop
      // left the resting screen - the one a visitor reads and screenshots - showing 42 regex rows,
      // which is the opposite of what the demo is about. The tail drains through real /classify
      // calls instead, bounded by the same age rule, the 400-message cap and dm1's 3 calls/s.
      while (q.length > 0 && (now - q[0].queuedAt > SHED_AFTER_MS || q.length > MAX_BACKLOG)) shed([q.shift()!]);
      if (inFlight.current < 2) {
        if (rateQueue.current.length >= RATE_BATCH || (rateQueue.current.length > 0 && !live.current.running)) {
          void sendRate(rateQueue.current.splice(0, RATE_BATCH));
        } else if (q.length >= BATCH || (q.length > 0 && now - q[0].queuedAt > 800)) {
          void sendClassify(q.splice(0, BATCH));
        }
      }
      bump((x) => x + 1);
    }, 150);
    return () => clearInterval(id);
  }, [sendClassify, sendRate, shed]);

  const act = useCallback((row: Row, action: Row["action"]) => {
    row.action = action;
    actions.current.unshift(`${action!.toUpperCase()} @${row.msg.user} — "${row.msg.text.slice(0, 54)}"`);
    actions.current.length = Math.min(actions.current.length, 20);
    bump((x) => x + 1);
  }, []);

  const judged = useMemo(() => rows.current.filter((r) => r.j), [rows.current.length, stats.current.judged]);
  // Filter first, slice second, and report both numbers: the headers used to read the capped length,
  // so dragging the harassment slider from 0.40 to 0.12 left "24 waiting" unchanged - hiding the one
  // effect the slider exists to show.
  const modQueueAll = judged
    .filter((r) => !r.action && inModQueue(r.j!, th))
    .sort((a, b) => (b.j!.severity ?? -1) - (a.j!.severity ?? -1));
  const modQueue = modQueueAll.slice(0, SHOW);
  const streamerFeedAll = collapseDuplicates(judged.filter((r) => isStreamerQuestion(r.j!, th)).reverse());
  const streamerFeed = streamerFeedAll.slice(0, SHOW);
  const firehose = rows.current.slice(-42).reverse();

  // Keyboard: the mod actions of the original console, on the top card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      const top = modQueue[0];
      if (e.key === "t" && top) act(top, "timeout");
      else if (e.key === "d" && top) act(top, "delete");
      else if (e.key === "i" && top) act(top, "ignore");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modQueue, act]);

  const s = stats.current;
  const left = running ? Math.max(0, Math.ceil((RUN_MS - (performance.now() - startedAt.current)) / 1000)) : 0;

  return (
    <div className="d-firehose">
      <div className="fh-bar panel">
        <div className="fh-run">
          <button
            className="btn primary"
            onClick={() => {
              setRunning((r) => {
                setNote(r ? "Stopped. The last batch still in flight finishes, then the console rests." : "Running. The loop stops itself after 45 s.");
                return !r;
              });
            }}
          >
            {running ? "Stop" : "Start"}
          </button>
          <span className="fh-live" data-on={running} />
          <span className="mono muted">
            {running ? `${left}s left` : "idle"} · {streamContext.streamer} · {streamContext.game}
          </span>
        </div>
        <label className="fh-slider">
          <span>chat rate <b className="mono">{rate}</b>/s</span>
          <input type="range" min={2} max={64} step={2} value={rate} onChange={(e) => setRate(Number(e.target.value))} />
        </label>
        <label className="fh-toggle" title={`A second /classify on every second batch. Skipped above ${LANG_MAX_RATE} msg/s; the regex detector tags instead.`}>
          <input type="checkbox" checked={langModel} onChange={(e) => setLangModel(e.target.checked)} /> Detect language with model
          {langModel && rate > LANG_MAX_RATE && <span className="muted"> (off at {rate}/s)</span>}
        </label>
        <label className="fh-toggle">
          <input type="checkbox" checked={shield} onChange={(e) => setShield(e.target.checked)} /> spoiler shield
        </label>
        <label className="fh-seed">
          Sample seed
          <input className="input mono" type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
        </label>
        <button className="btn" onClick={() => reset(seed)}>
          Reset
        </button>
      </div>

      <div className="metrics fh-metrics" aria-label="Chat moderation outcomes">
        <span>Messages received <b>{fmtInt(s.ingested)}</b></span>
        <span>Analyzed by model <b>{fmtInt(s.modelJudged)}</b></span>
        <span>Waiting for analysis <b>{fmtInt(queue.current.length)}</b></span>
        <span title="Fallback rules handle messages when requests fail or the queue is overloaded.">Fallback decisions <b className={s.shed ? "warn" : undefined}>{fmtInt(s.shed)}</b></span>
      </div>
      {error && <p className="error fh-error">{error} — affected messages used fallback rules.</p>}
      <p className="fh-note muted">{note} Seed 2024 repeats a free stock loop. Other seeds may require your key. Analysis uses fixed sample groups, so recorded usage includes the full group.</p>

      <div className="fh-cols">
        <section className="panel fh-col">
          <p className="panel-title">
            Incoming chat <span className="fh-count">{fmtInt(s.ingested)} in</span>
          </p>
          <Slider label="spoiler ≥" value={th.spoiler} onChange={(v) => setTh({ ...th, spoiler: v })} />
          <ul className="fh-feed">
            {firehose.map((r) => (
              <li key={r.msg.id} className={r.j && shield && isSpoiler(r.j, th) ? "fh-row blur" : "fh-row"} data-pending={!r.j}>
                <Pips j={r.j} th={th} />
                <span className="fh-user">{r.msg.user}</span>
                <span className="fh-text">{r.msg.text}</span>
                {r.j?.source === "heuristic" && <span className="fh-src">fallback</span>}
                {r.j && <span className="fh-lang">{LANG_TAG[r.j.lang]}</span>}
              </li>
            ))}
          </ul>
        </section>

        <section className="panel fh-col">
          <p className="panel-title">
            Moderation queue <span className="fh-count">{modQueueAll.length > SHOW ? `showing ${SHOW} of ${fmtInt(modQueueAll.length)}` : `${modQueueAll.length} waiting`}</span>
          </p>
          <Slider label="rule break ≥" value={th.mod} onChange={(v) => setTh({ ...th, mod: v })} />
          <Slider label="harassment ≥" value={th.harass} onChange={(v) => setTh({ ...th, harass: v })} />
          <ul className="fh-feed">
            {modQueue.map((r) => {
              const j = r.j!;
              const reason = modReason(j, th);
              return (
                <li key={r.msg.id} className="fh-card">
                  <div className="fh-card-head">
                    <span className={`tag ${reason === "harassment" ? "hot" : reason === "review" ? "" : "warn"}`}>{REASON_LABEL[reason]}</span>
                    {j.severity != null && <span className="tag purple">severity {j.severity.toFixed(1)}/3</span>}
                    <span className="fh-lang">{LANG_TAG[j.lang]}</span>
                    {j.source === "heuristic" && <span className="tag">fallback</span>}
                    <span className="fh-user">{r.msg.user}</span>
                  </div>
                  <p className="fh-card-text">{r.msg.text}</p>
                  <div className="fh-bars">
                    <Bar label="harassment" v={j.scores.harassment} />
                    <Bar label="scam" v={j.scores.scam} />
                    <Bar label="self-promo" v={j.scores.selfpromo} />
                    <Bar label="spoiler" v={j.scores.spoiler} />
                    <Bar label="rule break" v={j.ruleBreak} />
                  </div>
                  <div className="fh-actions">
                    <button className="btn" onClick={() => act(r, "timeout")}>
                      Timeout <kbd>t</kbd>
                    </button>
                    <button className="btn" onClick={() => act(r, "delete")}>
                      Delete <kbd>d</kbd>
                    </button>
                    <button className="btn" onClick={() => act(r, "ignore")}>
                      Ignore <kbd>i</kbd>
                    </button>
                  </div>
                </li>
              );
            })}
            {modQueue.length === 0 && <li className="muted fh-empty">Nothing over the threshold yet.</li>}
          </ul>
        </section>

        <section className="panel fh-col">
          <p className="panel-title">
            Questions for the streamer <span className="fh-count">{streamerFeedAll.length > SHOW ? `showing ${SHOW} of ${fmtInt(streamerFeedAll.length)}` : `${streamerFeedAll.length} questions`}</span>
          </p>
          <Slider label="question ≥" value={th.question} onChange={(v) => setTh({ ...th, question: v })} />
          <ul className="fh-feed">
            {streamerFeed.map(({ row: r, dupes }) => (
              <li key={r.msg.id} className="fh-q">
                <span className="fh-prob mono">{Math.round(r.j!.scores.question * 100)}%</span>
                <div>
                  <div className="fh-card-head">
                    <span className="fh-user">{r.msg.user}</span>
                    <span className="fh-lang">{LANG_TAG[r.j!.lang]}</span>
                    {dupes > 0 && <span className="tag">+{dupes} asked the same</span>}
                  </div>
                  <p className="fh-card-text">{r.msg.text}</p>
                </div>
              </li>
            ))}
            {streamerFeed.length === 0 && <li className="muted fh-empty">No questions over the threshold yet.</li>}
          </ul>
        </section>
      </div>

      <div className="fh-ticker mono muted">
        {actions.current.length === 0 && <p>Mod actions appear here. Keys: t timeout, d delete, i ignore.</p>}
        {actions.current.slice(0, 5).map((a, i) => (
          <p key={`${a}-${i}`} data-age={i}>
            {a}
          </p>
        ))}
      </div>
    </div>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="fh-th">
      <span>
        {label} <b className="mono">{`${Math.round(value * 100)}%`}</b>
      </span>
      <input type="range" min={0} max={1} step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Bar({ label, v }: { label: string; v: number }) {
  return (
    <div className="fh-bar-row">
      <span>{label}</span>
      <span className="bar">
        <i style={{ width: `${Math.round(v * 100)}%` }} />
      </span>
      <em className="mono">{`${Math.round(v * 100)}%`}</em>
    </div>
  );
}

function Pips({ j, th }: { j?: Judgment; th: Thresholds }) {
  if (!j) return <span className="fh-pips pending">·····</span>;
  return (
    <span className="fh-pips">
      <i className={j.scores.harassment >= th.harass ? "on hot" : ""} title="harassment">H</i>
      <i className={Math.max(j.scores.scam, j.scores.spam) >= 0.5 ? "on warn" : ""} title="spam or scam">S</i>
      <i className={j.scores.spoiler >= th.spoiler ? "on purple" : ""} title="spoiler">P</i>
      <i className={j.scores.question >= th.question ? "on blue" : ""} title="question for the streamer">Q</i>
      <i className={j.scores.hype >= 0.5 ? "on good" : ""} title="hype">+</i>
    </span>
  );
}
