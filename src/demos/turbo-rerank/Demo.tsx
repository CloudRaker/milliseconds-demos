import { useEffect, useMemo, useRef, useState } from "react";
import { Dm1Error, dm1, type YesNoResult } from "../../lib/dm1";
import {
  BY_ID,
  EXAMPLES,
  KINDS,
  NO_ANSWER,
  PASSAGES,
  band,
  bm25,
  rerankBodies,
} from "./data.ts";
import type { Passage } from "./types.ts";
import "./demo.css";

interface Row extends Passage {
  bm25Rank: number;
  bm25Score: number;
  /** P(this passage answers the question), from /yes-no. Undefined until judged. */
  p?: number;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function search(query: string, k: number): Row[] {
  return bm25()
    .search(query, k)
    .map((h, i) => ({ ...BY_ID.get(h.id)!, bm25Rank: i + 1, bm25Score: h.score }));
}

/**
 * One judgment per candidate in as few calls as possible: /yes-no takes up to 32 texts against
 * one statement, so 50 candidates is two calls, 32 is one.
 */
async function judge(query: string, rows: Row[], signal: AbortSignal) {
  const bodies = rerankBodies(query, rows);
  const out = await Promise.all(
    bodies.map((body) =>
      dm1<{ results: YesNoResult[] }>("yes-no", body, signal),
    ),
  );
  const probs = out.flatMap((r) => r.data.results.map((x) => x.probability));
  const judged = rows.map((r, i) => ({ ...r, p: probs[i] ?? 0 }));
  return { judged, answerExists: Math.max(0, ...probs) };
}

const byRerank = (a: Row, b: Row) => (b.p ?? -1) - (a.p ?? -1) || a.bm25Rank - b.bm25Rank;

export default function Demo() {
  const [k, setK] = useState(50);
  return <div className="d-turbo-rerank"><p className="muted">Search {PASSAGES.length} sample workplace passages. The model ranks results by how likely they are to answer your question.</p><SearchTab k={k} setK={setK} /></div>;
}

function SearchTab({
  k,
  setK,
}: {
  k: number;
  setK: (n: number) => void;
}) {
  const [query, setQuery] = useState(EXAMPLES[0].query);
  const [rows, setRows] = useState<Row[]>(() => search(EXAMPLES[0].query, 50));
  const [judgedFor, setJudgedFor] = useState<string | null>(null);
  const [answerExists, setAnswerExists] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // BM25 is local and sub-millisecond, so the left column tracks the box with no network at all.
  useEffect(() => {
    // A new query invalidates any rerank still in flight: otherwise its results land on the
    // wrong candidate list and the left column silently shows the previous query's hits.
    abort.current?.abort();
    const q = query.trim();
    if (!q) {
      setRows([]);
      return;
    }
    const hits = search(q, k);
    setRows(hits);
    setJudgedFor(null);
  }, [query, k]);

  useEffect(() => () => abort.current?.abort(), []);

  const run = async () => {
    const q = query.trim();
    if (!q || !rows.length) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setPending(true);
    setError(null);
    try {
      const { judged, answerExists } = await judge(q, rows, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setRows(judged);
      setAnswerExists(answerExists);
      setJudgedFor(q);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(e instanceof Dm1Error ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setPending(false);
    }
  };

  const judgedRows = judgedFor === query.trim();
  const reranked = useMemo(() => (judgedRows ? [...rows].sort(byRerank) : []), [rows, judgedRows]);
  const limit = showAll ? rows.length : 5;

  return (
    <>
      <div className="panel tr-composer">
        <label className="panel-title" htmlFor="tr-q">
          Ask the Northwind documentation
        </label>
        <div className="tr-query">
          <input
            id="tr-q"
            ref={inputRef}
            className="input mono"
            value={query}
            spellCheck={false}
            autoComplete="off"
            placeholder="Ask a question in your own words…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") run();
              if (e.key === "Escape") setQuery("");
            }}
          />
          <button className="btn primary" onClick={run} disabled={pending || !rows.length}>
            {pending ? "Reranking…" : "Rerank"}
          </button>
        </div>
        <div className="tr-controls">
          <span className="muted">
            {rows.length} matching passages · press Enter to rank by relevance
          </span>
          <label className="muted">
            Candidates{" "}
            <select className="select tr-k" value={k} onChange={(e) => setK(Number(e.target.value))}>
              <option value={32}>32 · one call</option>
              <option value={50}>50 · two calls</option>
            </select>
          </label>
        </div>
        <div className="tr-examples">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.query}
              className="tag tr-example"
              title={ex.query}
              onClick={() => {
                setQuery(ex.query);
                inputRef.current?.focus();
              }}
            >
              {ex.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="error tr-banner" role="alert">
          {error} — try again to rank these passages.
        </p>
      )}
      {judgedRows && answerExists < NO_ANSWER && (
        <p className="tr-banner tr-nogood" role="status">
          <strong>No good answer in the corpus.</strong> The best candidate only reaches {pct(answerExists)} answer
          probability. These are the closest passages, shown for inspection.
        </p>
      )}
      {!rows.length && query.trim() && (
        <p className="tr-banner muted" role="status">
          No keyword matches. There is nothing for the model to rerank — try one of the examples.
        </p>
      )}

      <div className="panel-grid tr-columns">
        <Column
          title="Reranked by meaning"
          note={
            judgedRows
              ? `${pct(answerExists)} answer probability`
              : pending
                ? `Judging ${rows.length} passages…`
                : "Press Rerank"
          }
          rows={judgedRows ? reranked.slice(0, limit) : []}
          reranked
          placeholder={
            pending
              ? `Ranking ${rows.length} passages. Waiting for the model…`
              : "Results appear here, ordered by the probability that each passage answers your question."
          }
        />
      </div>
      {judgedRows && rows.length > 5 && (
        <button className="btn tr-more" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show top 5" : `Show all ${rows.length} candidates`}
        </button>
      )}
    </>
  );
}

function Column({
  title,
  note,
  rows,
  reranked = false,
  placeholder,
}: {
  title: string;
  note: string;
  rows: Row[];
  reranked?: boolean;
  placeholder?: string;
}) {
  return (
    <section className={`panel tr-column${reranked ? " tr-column-new" : ""}`}>
      <header className="tr-column-head">
        <h3>{title}</h3>
        <span className="mono muted">{note}</span>
      </header>
      {rows.length === 0 ? (
        <p className="muted tr-placeholder">{placeholder}</p>
      ) : (
        <ol className="tr-list">
          {rows.map((r, i) => {
            const rank = reranked ? i + 1 : r.bm25Rank;
            const b = r.p === undefined ? null : band(r.p);
            return (
              <li key={r.id} className={`tr-hit${reranked && i === 0 && (r.p ?? 0) >= 0.5 ? " tr-winner" : ""}`}>
                <span className="tr-rank mono">{String(rank).padStart(2, "0")}</span>
                <div className="tr-body">
                  <div className="tr-meta">
                    <span className="mono muted">{KINDS[r.kind]}</span>
                    {reranked && b && <span className={`tag ${b.tone}`}>{b.label}</span>}
                  </div>
                  <details className="tr-passage" open={i === 0}>
                    <summary>
                      <b>{r.title}</b>
                      <span className="tr-read tr-read-closed">Read full passage ↓</span>
                      <span className="tr-read tr-read-open">Collapse passage ↑</span>
                      <span className="tr-excerpt muted">{r.text}</span>
                    </summary>
                    <p className="tr-full">{r.text}</p>
                    <p className="mono muted tr-id">
                      Passage {r.id}
                    </p>
                  </details>
                  {reranked && r.p !== undefined && (
                    <div className="tr-score">
                      <div className="bar" title={`P(answers the question) = ${r.p.toFixed(3)}`}>
                        <i style={{ width: `${Math.max(1, r.p * 100)}%` }} />
                      </div>
                      <span className="mono">{pct(r.p)}</span>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
