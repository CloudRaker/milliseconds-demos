// Inbox triage: a 500-email sample inbox with seven judgments per email.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { chunk, classifyMany, dm1, rateMany, Dm1Error, type YesNoResult } from "../../lib/dm1";
import { EMAILS, emailText, SENTIMENT_LEVELS, URGENCY_LEVELS, type Category, type Email, type Judgment } from "./data";
import {
  CATEGORY_LABELS,
  DEFAULT_WEIGHTS,
  HUMAN_CONFIDENCE,
  LABEL_COLORS,
  MAX_INTENT_CHARS,
  SENTIMENT_SCALE,
  STATEMENTS,
  STATEMENT_KEYS,
  SUGGESTED_INTENTS,
  SURE_THRESHOLD,
  URGENCY_SCALE,
  fmtMs,
  intentStatement,
  isMatch,
  intersect,
  labelName,
  pending,
  lane,
  rank,
  sortByMatch,
  summarize,
  toCategory,
  type IntentLabel,
  type Lane,
} from "./logic";
import "./demo.css";
import { RUN_ORDER } from "./data";

/** How many emails one Run touches. Every option stays inside the 60 s budget. */
const SIZES = [32, 128, 256];
/** Hard stop for any loop, so one visitor cannot drain the shared quota. */
const MAX_RUN_MS = 45_000;
const BATCH = 32;
/** Include all hand-written examples before the seeded mail. */


type LaneFilter = Lane | "all" | "archived";

const CATEGORY_LABEL: Record<Category, string> = {
  billing: "Billing",
  bug: "Bug",
  feature_request: "Feature",
  sales_lead: "Sales lead",
  security: "Security",
  legal_privacy: "Legal",
  spam_marketing: "Spam",
  internal: "Internal",
  other: "Other",
};


const NOW = Date.parse("2026-09-17T17:00:00Z");
const yes = (p: number) => p >= 0.5;

/** Fields land call by call; a row counts as judged once the last one (sentiment) is in. */
type PartialJudgment = Partial<Judgment>;
const complete = (j: PartialJudgment | undefined): j is Judgment =>
  j !== undefined && j.category !== undefined && j.needsReply !== undefined && j.urgency !== undefined && j.sentiment !== undefined;

interface Row {
  email: Email;
  partial?: PartialJudgment;
  judgment?: Judgment;
  receivedAt: string;
}


function timeAgo(iso: string): string {
  const mins = Math.round((NOW - Date.parse(iso)) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function clock(iso: string): string {
  const d = new Date(iso);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

export default function Demo() {
  const [judged, setJudged] = useState<Map<string, PartialJudgment>>(() => new Map());
  const [size, setSize] = useState(128);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [progress, setProgress] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState<IntentLabel[]>([]);
  const [labelFilter, setLabelFilter] = useState<string[]>([]);
  const [laneFilter, setLaneFilter] = useState<LaneFilter>("all");
  const [archived, setArchived] = useState<Set<string>>(() => new Set());
  const [replyFlag, setReplyFlag] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState(EMAILS[0].id);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const abort = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);


  const patch = useCallback((emails: Email[], fields: (i: number) => PartialJudgment) => {
    setJudged((prev) => {
      const next = new Map(prev);
      emails.forEach((e, i) => next.set(e.id, { ...next.get(e.id), ...fields(i) }));
      return next;
    });
  }, []);

  const stop = useCallback(() => abort.current?.abort(), []);

  /** Four calls per batch of 32: classify, the four statements together, then the two scales. */
  async function runTriage() {
    if (busy) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    setError(null);
    setPhase("running");
    setProgress(0);
    setTruncated(false);
    setJudged(new Map());
    const deadline = Date.now() + MAX_RUN_MS;
    // A batch is four sequential calls of 2-5 s each, so checking only between batches
    // let a run overshoot the advertised 45 s by a whole batch. Check before every call.
    const inBudget = () => {
      if (Date.now() <= deadline) return true;
      setTruncated(true);
      return false;
    };
    const batches = chunk(RUN_ORDER.slice(0, size), BATCH);
    try {
      for (const emails of batches) {
        if (ctl.signal.aborted || !inBudget()) break;
        const texts = emails.map(emailText);

        const cat = await classifyMany(texts, CATEGORY_LABELS, ctl.signal);
        patch(emails, (i) => ({
          category: toCategory(cat.results[i].label),
          categoryConfidence: cat.results[i].confidence,
          categoryProbabilities: cat.results[i].scores,
        }));

        if (!inBudget()) break;
        const bools = await dm1<{ results: Array<{ results: YesNoResult[] }> }>(
          "yes-no",
          { texts, statements: STATEMENT_KEYS.map((k) => STATEMENTS[k]) },
          ctl.signal,
        );
        patch(emails, (i) => Object.fromEntries(STATEMENT_KEYS.map((k, n) => [k, bools.data.results[i].results[n].probability])));

        if (!inBudget()) break;
        const urg = await rateMany(texts, URGENCY_SCALE, ctl.signal);
        patch(emails, (i) => ({ urgency: urg.results[i].score, urgencyConfidence: urg.results[i].confidence }));

        if (!inBudget()) break;
        const sent = await rateMany(texts, SENTIMENT_SCALE, ctl.signal);
        patch(emails, (i) => ({ sentiment: sent.results[i].score, sentimentConfidence: sent.results[i].confidence }));

        setProgress((p) => p + emails.length);
      }
    } catch (e) {
      if (!ctl.signal.aborted) setError(e instanceof Dm1Error ? `${e.code}: ${e.message}` : String(e));
    } finally {
      abort.current = null;
      setBusy(false);
      setPhase("done");
    }
  }

  /** One /yes-no call per batch carries the intent statement over 32 emails. */
  async function runLabel(intent: string) {
    const clean = intent.trim().slice(0, MAX_INTENT_CHARS);
    if (!clean || busy) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    setError(null);
    setTruncated(false);
    setQuery("");
    const id = `l${Date.now()}`;
    const label: IntentLabel = {
      id,
      intent: clean,
      name: labelName(clean),
      color: LABEL_COLORS[labels.length % LABEL_COLORS.length],
      phase: "running",
      matches: new Map(),
      judged: 0,
      total: size,
      elapsedMs: 0,
    };
    setLabels((ls) => [...ls, label]);
    setLabelFilter([id]);
    setLaneFilter("all");
    const started = performance.now();
    const deadline = Date.now() + MAX_RUN_MS;
    const statement = intentStatement(clean);
    try {
      for (const emails of chunk(RUN_ORDER.slice(0, size), BATCH)) {
        if (ctl.signal.aborted) break;
        if (Date.now() > deadline) {
          setTruncated(true);
          break;
        }
        const r = await dm1<{ results: YesNoResult[] }>("yes-no", { texts: emails.map(emailText), statement }, ctl.signal);
        setLabels((ls) =>
          ls.map((l) => {
            if (l.id !== id) return l;
            const matches = new Map(l.matches);
            emails.forEach((e, i) => matches.set(e.id, { id: e.id, match: r.data.results[i].probability }));
            return { ...l, matches, judged: matches.size, elapsedMs: performance.now() - started };
          }),
        );
      }
      setLabels((ls) => ls.map((l) => (l.id === id ? { ...l, phase: "done" } : l)));
    } catch (e) {
      const message = e instanceof Dm1Error ? `${e.code}: ${e.message}` : String(e);
      if (!ctl.signal.aborted) setError(message);
      setLabels((ls) => ls.map((l) => (l.id === id ? { ...l, phase: ctl.signal.aborted ? "done" : "error", fatal: message } : l)));
    } finally {
      abort.current = null;
      setBusy(false);
    }
  }

  const rows = useMemo<Row[]>(
    () =>
      EMAILS.map((email) => {
        const partial = judged.get(email.id);
        const judgment = complete(partial) ? partial : undefined;
        return { email, partial, judgment, receivedAt: email.receivedAt };
      }),
    [judged],
  );

  const done = phase === "done" && !busy;
  const sorted = useMemo(() => (done ? rank(rows, DEFAULT_WEIGHTS) : rows), [rows, done]);

  const filterLabels = useMemo(
    () => labelFilter.map((id) => labels.find((l) => l.id === id)).filter((l): l is IntentLabel => Boolean(l)),
    [labelFilter, labels],
  );
  const filterDone = filterLabels.length > 0 && filterLabels.every((l) => l.phase === "done");

  const laneCounts = useMemo(() => {
    const c: Record<LaneFilter, number> = { all: 0, priority: 0, human: 0, fyi: 0, spam: 0, archived: 0 };
    for (const r of rows) {
      if (archived.has(r.email.id)) {
        c.archived++;
        continue;
      }
      c.all++;
      if (r.judgment) c[lane(r.judgment)]++;
    }
    return c;
  }, [rows, archived]);

  const visible = useMemo(() => {
    const inLane = sorted.filter((r) => {
      const isArchived = archived.has(r.email.id);
      if (laneFilter === "archived") return isArchived;
      if (isArchived) return false;
      if (laneFilter === "all") return true;
      return r.judgment ? lane(r.judgment) === laneFilter : false;
    });
    if (filterLabels.length === 0) return inLane;
    const ids = inLane.map((r) => r.email.id);
    // While the model is still answering, rows fall out as they are ruled out; once every
    // label is done, the best matches float to the top.
    const keep = new Set(filterDone ? intersect(ids, filterLabels) : pending(ids, filterLabels));
    const matched = inLane.filter((r) => keep.has(r.email.id));
    return filterDone ? sortByMatch(matched.map((r) => ({ id: r.email.id, r })), filterLabels).map((x) => x.r) : matched;
  }, [sorted, laneFilter, archived, filterLabels, filterDone]);

  const selected = rows.find((r) => r.email.id === selectedId) ?? null;

  const move = useCallback(
    (delta: number) => {
      const idx = visible.findIndex((r) => r.email.id === selectedId);
      const next = visible[Math.max(0, Math.min(visible.length - 1, (idx < 0 ? 0 : idx) + delta))];
      if (next) setSelectedId(next.email.id);
    },
    [visible, selectedId],
  );
  const toggleIn = (set: (f: (s: Set<string>) => Set<string>) => void) => {
    set((prev) => {
      const n = new Set(prev);
      if (n.has(selectedId)) n.delete(selectedId);
      else n.add(selectedId);
      return n;
    });
  };
  const archive = useCallback(() => {
    const idx = visible.findIndex((r) => r.email.id === selectedId);
    toggleIn(setArchived);
    const next = visible[idx + 1] ?? visible[idx - 1];
    if (next && laneFilter !== "archived") setSelectedId(next.email.id);
  }, [selectedId, visible, laneFilter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey) return;
      if (e.key === "j" || e.key === "ArrowDown") (e.preventDefault(), move(1));
      else if (e.key === "k" || e.key === "ArrowUp") (e.preventDefault(), move(-1));
      else if (e.key === "e") archive();
      else if (e.key === "r") toggleIn(setReplyFlag);
      else if (e.key === "/") (e.preventDefault(), searchRef.current?.focus());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, archive, selectedId]);

  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-id="${selectedId}"]`);
    if (!list || !row) return;
    const bounds = list.getBoundingClientRect();
    const selected = row.getBoundingClientRect();
    // Keep keyboard selection visible inside the inbox without moving the page.
    if (selected.top < bounds.top) list.scrollTop += selected.top - bounds.top;
    else if (selected.bottom > bounds.bottom) list.scrollTop += selected.bottom - bounds.bottom;
  }, [selectedId]);

  useEffect(() => () => abort.current?.abort(), []);

  const suggestions = SUGGESTED_INTENTS.filter((s) => s.toLowerCase().includes(query.trim().toLowerCase()));
  const pct = phase === "idle" ? 0 : (progress / size) * 100;

  return (
    <div className="d-inbox-blitz">
      <div className="panel ib-controls">
        <div className="ib-run">
          <button className="btn primary" onClick={() => void runTriage()} disabled={busy}>
            {phase === "idle" ? "Triage inbox" : "Re-triage"}
          </button>
          <button className="btn" onClick={stop} disabled={!busy}>
            Stop
          </button>
          <label className="ib-size">
            <span className="muted">run</span>
            <select className="select" value={size} onChange={(e) => setSize(Number(e.target.value))} disabled={busy}>
              {SIZES.map((n) => (
                <option key={n} value={n}>
                  {n} emails
                </option>
              ))}
            </select>
          </label>
          <span className="muted ib-plan">
            Seven checks per email: category, reply, urgency, sentiment, phishing, churn and refund.
          </span>
        </div>
        <p className="muted ib-hint" role="status">
          {phase === "idle" ? "Choose a batch size, then triage emails into priority, review, FYI and spam." : `${progress} of ${size} emails fully triaged`}
          {truncated && " · Paused after 45 seconds. Run again with a smaller batch."}
        </p>
        <div className="bar">
          <i style={{ width: `${pct}%` }} />
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <div className="panel ib-search">
        <p className="panel-title">Find emails by meaning</p>
        <div className="ib-search-row">
          <input
            ref={searchRef}
            className="input"
            value={query}
            aria-label="Describe the emails to find"
            placeholder="e.g. customers threatening to cancel"
            maxLength={MAX_INTENT_CHARS}
            disabled={busy}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runLabel(query);
              if (e.key === "Escape") searchRef.current?.blur();
            }}
          />
          <button className="btn" onClick={() => void runLabel(query)} disabled={busy || !query.trim()}>
            Label
          </button>
        </div>
        <div className="ib-suggest">
          {suggestions.map((s) => (
            <button key={s} className="tag purple" onClick={() => void runLabel(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="ib-app">
        <nav className="panel ib-nav">
          <NavItem id="all" label="Inbox" count={laneCounts.all} active={labelFilter.length ? null : laneFilter} set={setLaneFilter} />
          {phase !== "idle" && (
            <>
              <NavItem id="priority" label="Priority" count={laneCounts.priority} active={laneFilter} set={setLaneFilter} />
              <NavItem id="human" label="Needs review" count={laneCounts.human} active={laneFilter} set={setLaneFilter} />
              <NavItem id="fyi" label="FYI" count={laneCounts.fyi} active={laneFilter} set={setLaneFilter} />
              <NavItem id="spam" label="Spam" count={laneCounts.spam} active={laneFilter} set={setLaneFilter} />
            </>
          )}
          <NavItem id="archived" label="Archived" count={laneCounts.archived} active={laneFilter} set={setLaneFilter} />

          {labels.length > 0 && (
            <div className="ib-nav-section">
              <p className="panel-title">Labels</p>
              {labels.map((l) => {
                const s = summarize(l.matches.values());
                return (
                  <button
                    key={l.id}
                    className={`ib-nav-item ${labelFilter.includes(l.id) ? "active" : ""}`}
                    title={`${l.intent} · ${fmtMs(l.elapsedMs)}`}
                    onClick={() => {
                      setLaneFilter("all");
                      setLabelFilter((p) => (p.includes(l.id) ? p.filter((x) => x !== l.id) : [...p, l.id]));
                    }}
                  >
                    <span className="ib-dot" style={{ background: l.color }} />
                    <span className="ib-nav-label">{l.name}</span>
                    <b>{s.matched}</b>
                  </button>
                );
              })}
            </div>
          )}

          <p className="muted ib-hint ib-keys">
            <kbd>j</kbd>
            <kbd>k</kbd> move · <kbd>e</kbd> archive · <kbd>r</kbd> flag · <kbd>/</kbd> intent
          </p>
        </nav>

        <section className="panel ib-list-panel">
          <p className="panel-title">
            {visible.length.toLocaleString()} of {EMAILS.length} emails
            {filterLabels.length > 0 && <> · {filterLabels.map((l) => `“${l.name}”`).join(" and ")}</>}
          </p>
          <div className="ib-list" ref={listRef}>
            {visible.length === 0 && <p className="muted ib-hint">Nothing in this lane{phase === "idle" ? " — press Triage inbox" : ""}.</p>}
            {visible.map((r) => (
              <EmailRow
                key={r.email.id}
                row={r}
                selected={r.email.id === selectedId}
                onSelect={() => setSelectedId(r.email.id)}
                replyFlag={replyFlag.has(r.email.id)}
                archived={archived.has(r.email.id)}
                labels={labels}
              />
            ))}
          </div>
        </section>

        <section className="panel ib-reader">{selected && <Preview row={selected} replyFlag={replyFlag.has(selected.email.id)} labels={labels} />}</section>
      </div>
    </div>
  );
}

function NavItem({ id, label, count, active, set }: { id: LaneFilter; label: string; count: number; active: LaneFilter | null; set: (l: LaneFilter) => void }) {
  return (
    <button className={`ib-nav-item ${active === id ? "active" : ""}`} onClick={() => set(id)}>
      <span className="ib-nav-label">{label}</span>
      <b>{count ? count.toLocaleString() : ""}</b>
    </button>
  );
}

function Badge({ kind, children, title }: { kind: string; children: ReactNode; title?: string }) {
  return (
    <span className={`ib-badge ${kind}`} title={title}>
      {children}
    </span>
  );
}

function JudgmentBadges({ j, compact }: { j: Judgment; compact?: boolean }) {
  const u = Math.round(j.urgency);
  const s = Math.round(j.sentiment);
  return (
    <>
      <Badge kind={`cat cat-${j.category}`} title={`category · confidence ${j.categoryConfidence.toFixed(2)}`}>
        {CATEGORY_LABEL[j.category]}
        {j.categoryConfidence < HUMAN_CONFIDENCE && <i className="ib-lowconf">?</i>}
      </Badge>
      <Badge kind={`urg urg-${u}`} title={`urgency ${j.urgency.toFixed(2)} / 3`}>
        {URGENCY_LEVELS[u]}
      </Badge>
      {(s >= 2 || !compact) && (
        <Badge kind={`sent sent-${s}`} title={`sentiment ${j.sentiment.toFixed(2)} / 3`}>
          {SENTIMENT_LEVELS[s]}
        </Badge>
      )}
      {yes(j.isPhishingOrScam) && <Badge kind="flag phish" title="advisory only - this judgment misses real scams and flags loud marketing">{`Phishing? ${(j.isPhishingOrScam * 100).toFixed(0)}%`}</Badge>}
      {yes(j.mentionsChurnOrCancel) && <Badge kind="flag churn">Churn</Badge>}
      {yes(j.asksForRefund) && <Badge kind="flag refund">Refund</Badge>}
      {!compact && yes(j.needsReply) && <Badge kind="flag reply">Reply</Badge>}
    </>
  );
}

function EmailRow({
  row,
  selected,
  onSelect,
  replyFlag,
  archived,
  labels,
}: {
  row: Row;
  selected: boolean;
  onSelect: () => void;
  replyFlag: boolean;
  archived: boolean;
  labels: IntentLabel[];
}) {
  const { email, judgment } = row;
  const unread = !judgment || replyFlag || yes(judgment.needsReply);
  return (
    <div
      className={`ib-row ${selected ? "selected" : ""} ${judgment ? "judged" : ""} ${archived ? "archived" : ""} ${unread ? "unread" : ""}`}
      data-id={email.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
      onClick={onSelect}
    >
      <span className="ib-from">{email.from}</span>
      <span className="ib-text">
        <span className="ib-chips">
          {labels.map((l) => {
            const m = l.matches.get(email.id);
            if (!isMatch(m)) return null;
            return (
              <span key={l.id} className={`ib-badge user ${m!.match < SURE_THRESHOLD ? "soft" : ""}`} style={{ borderColor: l.color, color: l.color }} title={`${l.intent} · ${(m!.match * 100).toFixed(0)}%`}>
                {l.name}
              </span>
            );
          })}
          {judgment ? <JudgmentBadges j={judgment} compact /> : row.partial ? <Badge kind="pending">judging…</Badge> : null}
        </span>
        <span className="ib-subj">{email.subject}</span>
        <span className="ib-snip"> — {email.body.replace(/\s+/g, " ").slice(0, 120)}</span>
      </span>
      <span className="ib-date">{clock(email.receivedAt)}</span>
    </div>
  );
}

function Dim({ name, model }: { name: string; model: string }) {
  return (
    <div className="ib-dim">
      <span className="ib-d-name">{name}</span>
      <span className="ib-d-model">{model}</span>
    </div>
  );
}

function Preview({ row, replyFlag, labels }: { row: Row; replyFlag: boolean; labels: IntentLabel[] }) {
  const { email, judgment } = row;
  const judgedLabels = labels.filter((l) => l.matches.has(email.id));
  return (
    <>
      <div className="ib-pv-head">
        <h3>{email.subject}</h3>
        <p className="muted">
          {email.from} &lt;{email.fromEmail}&gt; · {timeAgo(email.receivedAt)} ago{email.threadId && " · thread"}
        </p>
      </div>
      <pre className="ib-body">{email.body}</pre>

      {judgedLabels.length > 0 && (
        <>
          <p className="panel-title">Intent labels</p>
          {judgedLabels.map((l) => {
            const m = l.matches.get(email.id)!;
            return (
              <div key={l.id} className="ib-prob">
                <span>{l.name}</span>
                <div className="bar">
                  <i style={{ width: `${m.match * 100}%`, background: l.color }} />
                </div>
                <b>{(m.match * 100).toFixed(0)}%</b>
              </div>
            );
          })}
        </>
      )}

      <p className="panel-title">Email insights</p>
      {judgment ? (
        <>
          <div className="ib-chips">
            <JudgmentBadges j={judgment} />
            {replyFlag && <Badge kind="flag manual">marked reply (r)</Badge>}
          </div>
          <div className="ib-dims">
            <Dim name="Category" model={`${CATEGORY_LABEL[judgment.category]} · ${(judgment.categoryConfidence * 100).toFixed(0)}% confidence`} />
            <Dim name="Needs reply" model={`${(judgment.needsReply * 100).toFixed(0)}% likelihood`} />
            <Dim name="Urgency" model={`${URGENCY_LEVELS[Math.round(judgment.urgency)]} · ${judgment.urgency.toFixed(1)} / 3`} />
            <Dim name="Sentiment" model={`${SENTIMENT_LEVELS[Math.round(judgment.sentiment)]} · ${judgment.sentiment.toFixed(1)} / 3`} />
            <Dim name="Phishing (advisory)" model={`${(judgment.isPhishingOrScam * 100).toFixed(0)}% likelihood`} />
            <Dim name="Churn / cancel" model={`${(judgment.mentionsChurnOrCancel * 100).toFixed(0)}% likelihood`} />
            <Dim name="Asks refund" model={`${(judgment.asksForRefund * 100).toFixed(0)}% likelihood`} />
          </div>
          <p className="panel-title">Category distribution</p>
          {Object.entries(judgment.categoryProbabilities)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([k, p]) => (
              <div key={k} className="ib-prob">
                <span>{CATEGORY_LABEL[k as Category] ?? k}</span>
                <div className="bar">
                  <i style={{ width: `${p * 100}%` }} />
                </div>
                <b>{(p * 100).toFixed(0)}%</b>
              </div>
            ))}
          <p className="muted ib-hint">Suggested lane: {lane(judgment) === "human" ? "Needs review" : lane(judgment) === "fyi" ? "FYI" : lane(judgment)}. Phishing scores are advisory and may be wrong.</p>
        </>
      ) : (
        <p className="muted ib-hint">Not judged yet.</p>
      )}
    </>
  );
}
