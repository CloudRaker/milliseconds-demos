import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { classify, dm1, Dm1Error, yesNo, type YesNoResult } from "../../lib/dm1";
import { EXAMPLES, generateCatalog, type Product } from "./data";
import {
  combine,
  createIndex,
  DEFAULT_WEIGHTS,
  heuristicJudgment,
  lexicalOnly,
  parseAnswers,
  search,
  searchRequestBodies,
  type Answers,
  type LexicalHit,
  type RankedItem,
  type Ranking,
  type Weights,
} from "./engine";
import "./demo.css";

const SHOW = 8;
const SETTLE_MS = 500;
/** Live mode is a loop, so it is bounded twice over: wall clock and dispatches. */
const LIVE_MAX_MS = 60_000;
const LIVE_MAX_DISPATCHES = 12;
const TYPE_MS = 70;


interface Painted {
  seq: number;
  query: string;
  hits: LexicalHit[];
  answers: Answers;
  source: "model" | "fallback";
}

export default function Demo() {
  const catalog = useMemo(() => generateCatalog(), []);
  const index = useMemo(() => createIndex(catalog), [catalog]);
  const byId = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);

  const [query, setQuery] = useState(EXAMPLES[0]);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [painted, setPainted] = useState<Painted | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [liveLeft, setLiveLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [typingExample, setTypingExample] = useState(false);

  const seqRef = useRef({ next: 0, painted: -1, stale: 0 });
  const counts = useRef({ dispatches: 0 });
  const cache = useRef(new Map<string, Answers>());
  const typer = useRef<number | null>(null);
  const settle = useRef<number | null>(null);

  const hits = useMemo(() => search(index, byId, query), [index, byId, query]);

  const dispatch = useCallback(
    async (q: string, found: LexicalHit[]) => {
      const seq = seqRef.current.next++;
      const key = q.trim().toLowerCase();
      if (!key || found.length === 0) return;

      const paint = (answers: Answers, source: Painted["source"]) => {
        if (seq <= seqRef.current.painted) {
          seqRef.current.stale++;
          return;
        }
        seqRef.current.painted = seq;
        setPainted({ seq, query: q, hits: found, answers, source });
      };


      setBusy(true);
      setError(null);
      try {
        const hit = cache.current.get(key);
        if (hit) {
          return paint(hit, "model");
        }
        counts.current.dispatches++;
        // One call for all 30 candidates, one for the four query flags, one for the department.
        // The candidate call is many texts x many statements, which dm1.ts's yesNo() helper
        // does not cover, so it goes through the same queue via dm1() directly.
        const bodies = searchRequestBodies(q, found);
        const [rel, flags, dept] = await Promise.all([
          dm1<{ results: { results: YesNoResult[] }[] }>("yes-no", bodies.relevance),
          yesNo(bodies.intent.text, bodies.intent.statements, bodies.intent),
          classify(bodies.department.text, bodies.department.labels),
        ]);
        const answers = parseAnswers(found, rel.data.results, flags.results, dept.result);
        cache.current.set(key, answers);
        paint(answers, "model");
      } catch (e) {
        setError(e instanceof Dm1Error ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));
        paint({ relevance: new Map(), query: heuristicJudgment(q) }, "fallback");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // Live mode only: trailing debounce on the query. Nothing fires until the visitor starts it.
  useEffect(() => {
    if (!live || typingExample) return;
    if (settle.current) window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => void dispatch(query, hits), SETTLE_MS);
    return () => {
      if (settle.current) window.clearTimeout(settle.current);
    };
  }, [live, query, hits, dispatch, typingExample]);

  // …and it stops itself: 60 s, or 12 dispatches, whichever comes first.
  useEffect(() => {
    if (!live) return setLiveLeft(0);
    const startedAt = performance.now();
    const startedDispatches = counts.current.dispatches;
    const tick = window.setInterval(() => {
      const left = Math.ceil((LIVE_MAX_MS - (performance.now() - startedAt)) / 1000);
      setLiveLeft(Math.max(0, left));
      if (left <= 0 || counts.current.dispatches - startedDispatches >= LIVE_MAX_DISPATCHES) setLive(false);
    }, 250);
    return () => window.clearInterval(tick);
  }, [live]);

  const stopTyping = () => {
    if (typer.current) window.clearInterval(typer.current);
    typer.current = null;
    setTypingExample(false);
  };
  useEffect(() => stopTyping, []);

  /** Chips type at 70 ms/char like the original, then fire exactly one dispatch group. */
  const typeExample = (text: string) => {
    stopTyping();
    setTypingExample(true);
    setQuery("");
    let i = 0;
    typer.current = window.setInterval(() => {
      setQuery(text.slice(0, ++i));
      if (i >= text.length) {
        stopTyping();
        if (!live) void dispatch(text, search(index, byId, text));
      }
    }, TYPE_MS);
  };

  const left = useMemo<Ranking>(() => lexicalOnly(hits), [hits]);
  const right = useMemo<Ranking | null>(() => (painted ? combine(painted.hits, painted.answers, weights) : null), [painted, weights]);
  const stale = painted ? painted.query !== query : false;

  return (
    <div className="d-instant-search">
      <div className="panel is-top">
        <div className="is-controls">
          <div className="is-search">
            <input
              className="input"
              value={query}
              aria-label="Search the catalog"
              placeholder="Search 5,000 products…"
              onChange={(e) => {
                stopTyping();
                setQuery(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !typingExample) void dispatch(query, hits);
              }}
            />
            <span className={`is-seq ${stale ? "pending" : ""}`}>{busy ? "Ranking results…" : stale ? "Query changed · search again" : painted ? "Results ready" : "Local matches"}</span>
          </div>
          <button className="btn primary" onClick={() => void dispatch(query, hits)} disabled={busy || typingExample || !query.trim()}>
            Search with AI
          </button>
          <button className={`btn ${live ? "is-on" : ""}`} onClick={() => setLive((v) => !v)} aria-pressed={live}>
            {live ? `Live · stops in ${liveLeft}s` : "Live as you type"}
          </button>
        </div>

        <div className="is-chips">
          {EXAMPLES.map((e) => (
            <button key={e} className="tag is-chip" onClick={() => typeExample(e)}>
              {e}
            </button>
          ))}
        </div>

        {error && <p className="error">{error} — showing local search results. Retry to use model ranking.</p>}
      </div>

      <div className="is-columns">
        <Column title="Search results" subtitle={right && painted ? judgmentLine(painted, right) : "Local matches · select Search with AI to rank them by meaning"} items={(right ?? left).items.slice(0, SHOW)} leftPos={null} stale={stale} />
      </div>

      <details className="panel is-sliders">
        <summary>Fine-tune result ranking</summary>
        <p className="muted">Adjust these weights locally. No new API requests.</p>
        <div className="is-slider-row">
          <Slider label="Keyword match" v={weights.lexical} max={1} step={0.05} on={(v) => setWeights({ ...weights, lexical: v })} />
          <Slider label="Meaning match" v={weights.relevance} max={2} step={0.05} on={(v) => setWeights({ ...weights, relevance: v })} />
          <Slider label="Department" v={weights.department} max={1} step={0.05} on={(v) => setWeights({ ...weights, department: v })} />
          <Slider label="Price preference" v={weights.price} max={1} step={0.05} on={(v) => setWeights({ ...weights, price: v })} />
          <Slider label="Gift suitability" v={weights.gift} max={1} step={0.05} on={(v) => setWeights({ ...weights, gift: v })} />
          <Slider label="Minimum relevance" v={weights.relevanceFloor} max={1} step={0.05} on={(v) => setWeights({ ...weights, relevanceFloor: v })} />
          <label className="is-toggle">
            <input type="checkbox" checked={weights.applySort} onChange={(e) => setWeights({ ...weights, applySort: e.target.checked })} /> apply inferred sort
          </label>
          <button className="btn" onClick={() => setWeights(DEFAULT_WEIGHTS)}>
            Reset
          </button>
        </div>
      </details>
    </div>
  );
}

function judgmentLine(p: Painted, r: Ranking): string {
  const sortLabels = { relevance: "Best match first", price_low: "Lowest price first", price_high: "Highest price first", rating: "Highest rated first" };
  const parts = [sortLabels[r.appliedSort]];
  if (r.filters.department) parts.push(`Department: ${r.filters.department}`);
  if (r.filters.cheap) parts.push("Budget-friendly preference");
  if (r.filters.premium) parts.push("Premium preference");
  if (r.filters.gift) parts.push("Gift suitability considered");
  if (p.source !== "model") parts.unshift("Local fallback");
  return parts.join(" · ");
}

function Column({ title, subtitle, items, leftPos, stale }: { title: string; subtitle: string; items: RankedItem[]; leftPos: Map<string, number> | null; stale?: boolean }) {
  return (
    <div className={`panel is-column ${stale ? "is-stale" : ""}`}>
      <p className="panel-title">{title}</p>
      <p className="is-colsub mono">{stale ? `${subtitle} · query changed, search again` : subtitle}</p>
      <ol className="is-list">
        {items.length === 0 && <li className="muted is-empty">No candidates yet.</li>}
        {items.map((it, i) => (
          <Row key={it.product.id} item={it} rank={i} from={leftPos ? (leftPos.get(it.product.id) ?? null) : null} />
        ))}
      </ol>
    </div>
  );
}

function Row({ item, rank, from }: { item: RankedItem; rank: number; from: number | null }) {
  const p: Product = item.product;
  const delta = from === null ? null : from - rank;
  return (
    <li className={item.belowFloor ? "is-floor" : ""}>
      <span className="is-rank mono">{rank + 1}</span>
      <div className="is-body">
        <p className="is-title">
          {p.title}
          {delta !== null && delta > 0 && <span className="is-delta up">▲{delta}</span>}
          {delta !== null && delta < 0 && <span className="is-delta down">▼{-delta}</span>}
          {/* Came in from outside the visible top 8, like the original's badge. */}
          {from !== null && from >= SHOW && <span className="is-delta new">was #{from + 1}</span>}
        </p>
        <p className="is-meta mono">
          <span className="tag">{p.category}</span> ${p.price.toFixed(2)} · ★ {p.rating.toFixed(1)}
        </p>
        <p className="is-desc">{p.description}</p>
      </div>
      <div className="is-score">
        {item.relevance ? (
          <>
            <small>Relevance</small>
            <b className="mono">{pct(item.relevance.score)}</b>
            <span className="bar" title={`right kind ${pct(item.relevance.kind)}`}>
              <i style={{ width: `${item.relevance.kind * 100}%` }} />
            </span>
            <span className="bar" title={`does everything asked ${pct(item.relevance.fit)}`}>
              <i style={{ width: `${item.relevance.fit * 100}%` }} />
            </span>
          </>
        ) : (
          <><small>Keyword match</small><b className="mono muted">{pct(item.lexNorm)}</b></>
        )}
      </div>
    </li>
  );
}

function Slider({ label, v, max, step, on }: { label: string; v: number; max: number; step: number; on: (v: number) => void }) {
  return (
    <label className="is-slider">
      <span>{label}</span>
      <input type="range" min={0} max={max} step={step} value={v} onChange={(e) => on(Number(e.target.value))} />
      <b className="mono">{v.toFixed(2)}</b>
    </label>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
