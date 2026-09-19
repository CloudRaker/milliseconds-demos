// Score sample phrases against expected editor commands.
// Five requests: one /classify-tree with all
// BENCHMARK_CASES texts (32, the batch cap), then one call per argument slot.
import { useEffect, useRef, useState } from "react";
import { classifyMany, dm1, Dm1Error, rateMany } from "../../lib/dm1.ts";
import { ARG_LABELS, ARG_SCALES, BENCHMARK_CASES, benchmarkTexts, COMMAND_BY_ID, COMMAND_TREE, GROUP_BY_KEY, type ArgSlot, type BenchmarkCase } from "./data.ts";
import { previewLabel } from "./resolve.ts";

interface TreeLevel {
  label: string;
  probability: number;
  scores: Record<string, number>;
}
interface TreeResult {
  path: string[];
  label: string;
  probability: number;
  confidence: number;
  levels: TreeLevel[];
}

interface Row {
  c: BenchmarkCase;
  group?: string;
  top?: string;
  label?: string;
  arg?: string;
  ok?: boolean;
  argOk?: boolean;
  probability?: number;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

export function Benchmark() {
  const [rows, setRows] = useState<Row[]>(() => BENCHMARK_CASES.map((c): Row => ({ c })));
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function start() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    // Bounded by construction: BENCHMARK_CASES is fixed, at most 5 calls, and a 60 s stop.
    const guard = setTimeout(() => controller.abort(), 60_000);
    setRunning(true);
    setRan(true);
    setError(null);
    let next = BENCHMARK_CASES.map((c): Row => ({ c }));
    setRows(next);

    try {
      const texts = benchmarkTexts();
      const tree = await dm1<{ results: TreeResult[] }>("classify-tree", { texts, tree: COMMAND_TREE }, controller.signal);
      next = next.map((row, i) => {
        const r = tree.data.results[i];
        const command = COMMAND_BY_ID.get(r.label);
        return {
          ...row,
          group: r.levels[0].label,
          top: r.label,
          label: command ? previewLabel({ command }) : r.label,
          ok: r.label === row.c.expected,
          probability: r.probability,
        };
      });
      setRows(next);

      // One batched argument call per slot, for the cases whose winner takes an argument.
      const bySlot = new Map<ArgSlot, number[]>();
      next.forEach((row, i) => {
        const slot = row.top ? COMMAND_BY_ID.get(row.top)?.arg : undefined;
        if (slot) bySlot.set(slot, [...(bySlot.get(slot) ?? []), i]);
      });
      for (const [slot, indexes] of bySlot) {
        const steps = ARG_SCALES[slot];
        // Fixed full batches keep every stock request finite, independent of model predictions.
        const slotTexts = texts;
        // Ordinal slots are a scale, so they go to /rate; the named ones to /classify.
        const { values } = steps
          ? await rateMany(slotTexts, steps.map((x) => x.description), controller.signal).then((r) => ({
              values: r.results.map((x) => steps[x.level].value),
              meta: r.meta,
            }))
          : await classifyMany(slotTexts, ARG_LABELS[slot]!, controller.signal).then((r) => ({
              values: r.results.map((x) => x.label),
              meta: r.meta,
            }));
        next = next.map((row, i) => {
          const at = indexes.indexOf(i);
          if (at < 0) return row;
          const arg = values[i];
          const command = COMMAND_BY_ID.get(row.top!)!;
          return {
            ...row,
            arg,
            label: previewLabel({ command, arg }),
            argOk: row.c.expectedArg === undefined ? undefined : arg === row.c.expectedArg,
          };
        });
        setRows(next);
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Dm1Error ? `${err.code}: ${err.message}` : String(err));
    } finally {
      clearTimeout(guard);
      setRunning(false);
    }
  }

  const n = BENCHMARK_CASES.length;
  const done = rows.filter((r) => r.ok !== undefined);
  const hits = done.filter((r) => r.ok).length;
  const argRows = rows.filter((r) => r.argOk !== undefined);
  const argHits = argRows.filter((r) => r.argOk).length;

  return (
    <section className="panel bench">
      <div className="bench-head">
        <div>
          <p className="panel-title">Test {n} example commands</p>
          <p className="muted bench-lede">
            Test {n} sample requests against their expected editor commands. Results come from your current run.
          </p>
        </div>
        <div className="bench-actions">
          <button className="btn primary" onClick={start} disabled={running} type="button">
            {running ? "Running…" : ran ? "Run again" : "Test examples"}
          </button>
          <button className="btn" onClick={() => abort.current?.abort()} disabled={!running} type="button">
            Stop
          </button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="bench-score">
        <div className="score">
          <span className="panel-title">Correct commands</span>
          <b className="score-big">{done.length ? pct(hits / done.length) : "—"}</b>
          <span className="muted mono">
            {hits}/{done.length} commands correct · arguments {argRows.length ? `${argHits}/${argRows.length}` : "—"}
          </span>
        </div>
        <div className="score">
          <span className="panel-title">Progress</span>
          <b className="score-big">
            {done.length}
            <small>/{n}</small>
          </b>
          <span className="bar">
            <i style={{ width: `${(done.length / n) * 100}%` }} />
          </span>
          <span className="muted mono">
            {running ? "Testing…" : ran ? "Test finished" : "Ready to test"}
          </span>
        </div>
      </div>

      <div className="bench-table-wrap">
        <table className="bench-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Phrasing</th>
              <th>Expected</th>
              <th>Chosen command</th>
              <th>Match probability</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.c.query}>
                <td className="muted">{i + 1}</td>
                <td>“{r.c.query}”</td>
                <td className="mono muted">
                  {COMMAND_BY_ID.get(r.c.expected)?.title}
                  {r.c.expectedArg ? ` · ${r.c.expectedArg}` : ""}
                </td>
                <td className={r.ok === undefined ? "muted" : r.ok && r.argOk !== false ? "hit" : "miss"}>
                  {r.ok === undefined ? (running ? "…" : "") : r.label}
                  {r.group ? <span className="muted mono"> ({GROUP_BY_KEY[r.group] ?? r.group})</span> : null}
                </td>
                <td className="mono muted">{r.probability !== undefined ? pct(r.probability) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
