/**
 * Judge Sheets: a spreadsheet whose column headers predict themselves.
 *
 * Type a header above a column of free text ("Urgency", "Refund risk?") and one
 * /classify call reads which of 14 prediction schemas you meant; pressing Enter
 * fills the column with =JUDGE / =PICK / =RATE formulas and the runner batches
 * the judgments, 32 texts per call. Ported from the Jev experiment's App.tsx,
 * Grid.tsx, Chrome.tsx and SmartFill.tsx.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Store } from "./store.ts";
import { SCHEMAS, statementFor, type Intent, type Schema } from "./predict.ts";
import { Grid, normalize, type Anchored, type Editing, type Selection } from "./Grid.tsx";
import { colToName } from "./engine/refs.ts";
import { classifyHeader, MAX_CALLS, MAX_RUN_MS } from "./runner.ts";
import "./demo.css";

const store = new Store();
store.seed("Reviews");
store.tick();

const INTENT_DEBOUNCE_MS = 120;

const describeSchema = (s: Schema) =>
  s.kind === "judge" ? "Yes / No with a probability" : s.kind === "pick" ? s.options.join(" · ") : `${s.options[0]} → ${s.options[s.options.length - 1]}`;

export default function Demo() {
  const version = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  const [sheet, setSheet] = useState("Reviews");
  const [sel, setSel] = useState<Selection>({ ar: 0, ac: 0, fr: 0, fc: 0 });
  const [editing, setEditing] = useState<Editing>(null);
  const [bar, setBar] = useState<{ sheet: string; row: number; col: number; text: string } | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [intentPending, setIntentPending] = useState(false);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [headerDraft, setHeaderDraft] = useState("Urgency");
  const [predicting, setPredicting] = useState(false);
  const formBusy = useRef(false);
  const intentSeq = useRef(0);
  const lastIntent = useRef<Intent | null>(null);

  const sh = store.wb.getSheet(sheet);
  const raw = store.wb.getRaw(sheet, sel.ar, sel.ac);
  const run = store.runner.stats;

  // ------------------------------------------------------- keystroke intent
  const headerEdit = editing && editing.row === 0 && store.isPredictable(sheet, editing.col) ? editing : null;
  const headerText = headerEdit?.text.trim() ?? "";
  const headerCol = headerEdit?.col ?? -1;
  useEffect(() => {
    if (headerCol < 0) {
      setIntent(null);
      setIntentPending(false);
      return;
    }
    if (headerText.length < 2) {
      setIntent(null);
      return;
    }
    const seq = ++intentSeq.current;
    const ctrl = new AbortController();
    setIntentPending(true);
    const id = setTimeout(() => {
      const textCol = store.prediction(sheet, headerCol)?.textCol ?? store.findTextColumn(sheet, headerCol);
      classifyHeader(headerText, store.sampleTexts(sheet, textCol), ctrl.signal)
        .then((it) => {
          if (seq !== intentSeq.current) return;
          lastIntent.current = it;
          setIntent(it);
          setIntentError(null);
          setIntentPending(false);
          if (!it.exact) store.runner.record({ inferenceMs: it.inferenceMs, wallMs: it.ms, tokens: 0 });
        })
        .catch((e: Error) => {
          if (seq !== intentSeq.current || e.name === "AbortError") return;
          setIntentPending(false);
          setIntentError(e.message);
        });
    }, INTENT_DEBOUNCE_MS);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [headerText, headerCol, sheet]);

  const predict = useCallback(
    async (col: number, header: string, schemaId?: string, statement?: string) => {
      setIntentError(null);
      let schema = schemaId ? SCHEMAS.find((s) => s.id === schemaId) : undefined;
      if (!schema) {
        const cached = lastIntent.current;
        if (cached && cached.header === header) schema = cached.schema;
        else {
          const textCol = store.prediction(sheet, col)?.textCol ?? store.findTextColumn(sheet, col);
          try {
            const it = await classifyHeader(header, store.sampleTexts(sheet, textCol));
            if (!it.exact) store.runner.record({ inferenceMs: it.inferenceMs, wallMs: it.ms, tokens: 0 });
            schema = it.schema;
          } catch (e) {
            setIntentError((e as Error).message);
            return;
          }
        }
      }
      setIntentError(null);
      store.setCell(sheet, 0, col, header);
      store.predictColumn(sheet, col, header, schema, statement);
      // The visitor asked for this column, so the batch starts; it stops itself
      // at MAX_CALLS or MAX_RUN_MS and the Stop button is right there.
      await new Promise((resolve) => setTimeout(resolve, 32));
      store.runner.start();
    },
    [sheet],
  );

  const move = useCallback(
    (dr: number, dc: number, extend = false) => {
      const r = Math.max(0, Math.min(sh.rows - 1, (extend ? sel.fr : sel.ar) + dr));
      const c = Math.max(0, Math.min(sh.cols - 1, (extend ? sel.fc : sel.ac) + dc));
      setSel(extend ? { ...sel, fr: r, fc: c } : { ar: r, ac: c, fr: r, fc: c });
    },
    [sel, sh.rows, sh.cols],
  );

  const commitEdit = useCallback(
    (text: string, dir: "down" | "right" | "none") => {
      if (!editing) return;
      const { row, col } = editing;
      const predictable = row === 0 && store.isPredictable(sheet, col);
      const changed = text !== store.wb.getRaw(sheet, row, col);
      store.setCell(sheet, row, col, text);
      setEditing(null);
      setBar(null);
      if (predictable && changed) {
        if (text.trim() === "") store.dismissPrediction(sheet, col);
        else void predict(col, text.trim());
      }
      if (dir === "down") move(1, 0);
      else if (dir === "right") move(0, 1);
    },
    [editing, sheet, move, predict],
  );
  const cancelEdit = useCallback(() => {
    setEditing(null);
    setBar(null);
  }, []);

  const fillSelection = useCallback(() => {
    const n = normalize(sel);
    if (n.r2 === n.r1) return;
    for (let c = n.c1; c <= n.c2; c++) store.fillDown(sheet, n.r1, c, n.r2);
  }, [sel, sheet]);

  const onFill = useCallback(
    (toRow: number) => {
      const n = normalize(sel);
      for (let c = n.c1; c <= n.c2; c++) store.fillDown(sheet, n.r1, c, toRow);
      setSel({ ar: n.r1, ac: n.c1, fr: toRow, fc: n.c2 });
    },
    [sel, sheet],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editing) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        fillSelection();
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        void navigator.clipboard?.writeText(store.wb.getRaw(sheet, sel.ar, sel.ac));
        return;
      }
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          move(mod ? sh.rows : 1, 0, e.shiftKey);
          return;
        case "ArrowUp":
          e.preventDefault();
          move(mod ? -sh.rows : -1, 0, e.shiftKey);
          return;
        case "ArrowLeft":
          e.preventDefault();
          move(0, -1, e.shiftKey);
          return;
        case "ArrowRight":
        case "Tab":
          e.preventDefault();
          move(0, e.shiftKey && e.key === "Tab" ? -1 : 1, e.shiftKey && e.key !== "Tab");
          return;
        case "PageDown":
          e.preventDefault();
          move(20, 0, e.shiftKey);
          return;
        case "PageUp":
          e.preventDefault();
          move(-20, 0, e.shiftKey);
          return;
        case "Enter":
        case "F2":
          e.preventDefault();
          setEditing({ row: sel.ar, col: sel.ac, text: store.wb.getRaw(sheet, sel.ar, sel.ac), caretEnd: true });
          return;
        case "Delete":
        case "Backspace": {
          e.preventDefault();
          const n = normalize(sel);
          for (let r = n.r1; r <= n.r2; r++)
            for (let c = n.c1; c <= n.c2; c++) if (store.wb.getRaw(sheet, r, c)) store.setCell(sheet, r, c, "");
          for (let c = n.c1; c <= n.c2; c++) if (n.r1 === 0 && store.prediction(sheet, c)) store.dismissPrediction(sheet, c);
          return;
        }
        case "Escape":
          setSel({ ar: sel.ar, ac: sel.ac, fr: sel.ar, fc: sel.ac });
          return;
        default:
          if (e.key.length === 1 && !mod && !e.altKey) {
            e.preventDefault();
            setEditing({ row: sel.ar, col: sel.ac, text: e.key, caretEnd: true });
          }
      }
    },
    [editing, sel, sheet, sh.rows, move, fillSelection],
  );

  const barOwnsSel = bar !== null && bar.sheet === sheet && bar.row === sel.ar && bar.col === sel.ac;
  const barValue = editing ? editing.text : barOwnsSel ? bar.text : raw;
  const commitBar = useCallback(() => {
    if (!bar) return;
    if (bar.text !== store.wb.getRaw(bar.sheet, bar.row, bar.col)) {
      store.setCell(bar.sheet, bar.row, bar.col, bar.text);
      if (bar.row === 0 && store.isPredictable(bar.sheet, bar.col) && bar.text.trim()) void predict(bar.col, bar.text.trim());
    }
    setBar(null);
  }, [bar, predict]);

  const n = normalize(sel);
  const rangeName =
    n.r1 === n.r2 && n.c1 === n.c2
      ? `${colToName(sel.ac)}${sel.ar + 1}`
      : `${colToName(n.c1)}${n.r1 + 1}:${colToName(n.c2)}${n.r2 + 1}`;

  // -------------------------------------------------------------- overlays
  const open = store.openPrediction(sheet);
  const ghostCols = new Set<number>();
  for (const p of store.predictions.values()) if (p.sheet === sheet && !p.accepted) ghostCols.add(p.col);
  const anchored: Anchored[] = [];
  if (headerEdit) {
    anchored.push({
      key: "intent",
      row: 0,
      col: headerEdit.col,
      node: <IntentChip intent={intent} pending={intentPending} error={intentError} />,
    });
  }

  const queued = store.runner.pendingCells;
  const stopNote =
    run.stoppedBy === "budget"
      ? `stopped at ${MAX_CALLS} calls — press Run to continue`
      : run.stoppedBy === "time"
        ? `stopped after ${MAX_RUN_MS / 1000} s — press Run to continue`
        : run.stoppedBy === "user"
          ? "stopped"
          : "";

  return (
    <div className="d-judge-sheets">
      <div className="js-app panel">
        <div className="js-toolbar">
          <span className="js-doc">{sheet === "Leads" ? "Inbound leads" : "Customer reviews"}</span>
          <span className="tag purple">{sheet === "Leads" ? "150 messages" : "300 reviews"}</span>
          {run.running ? (
            <button className="btn primary" onClick={() => store.runner.stop()}>
              Stop
            </button>
          ) : (
            <button className="btn primary" disabled={queued === 0} onClick={() => store.runner.start()}>
              {queued > 0 ? `Run ${queued} judgments` : "Nothing queued"}
            </button>
          )}
          <span className="js-queue muted">
            {run.running
              ? `${run.cellsDone} of ${run.cells} cells filled`
              : queued > 0
                ? `${queued} cells waiting`
                : stopNote || "Ready to add a prediction column"}
          </span>
        </div>

        <form className="js-start" onSubmit={async (e) => {
          e.preventDefault();
          if (formBusy.current || run.running) return;
          const col = Array.from({ length: sh.cols }, (_, c) => c).find((c) => store.isPredictable(sheet, c) && !store.wb.getRaw(sheet, 0, c));
          if (col === undefined || !headerDraft.trim()) return;
          formBusy.current = true;
          setPredicting(true);
          try {
            await predict(col, headerDraft.trim());
            setSel({ ar: 0, ac: col, fr: 0, fc: col });
          } finally {
            formBusy.current = false;
            setPredicting(false);
          }
        }}>
          <label htmlFor="js-header">What should this new column tell you?</label>
          <div className="js-start-row">
            <input id="js-header" className="input" value={headerDraft} onChange={(e) => setHeaderDraft(e.target.value)} placeholder="e.g. Sentiment or Needs a refund?" />
            <button className="btn primary" disabled={predicting || run.running || !headerDraft.trim()}>{predicting ? "Reading column…" : "Fill column"}</button>
          </div>
          <p className="muted">Name a column, then fill it with predictions from the text in each row. You can also edit the sheet directly.</p>
        </form>

        {(store.runner.lastError || intentError) && (
          <p className="error js-error">
            {store.runner.lastError ?? intentError} — the sheet still works; press Run to retry the cells that show #API!.
          </p>
        )}

        <div className="js-formulabar">
          <span className="js-namebox mono">{rangeName}</span>
          <span className="js-fx mono">fx</span>
          <input
            className="js-formulainput mono"
            value={barValue}
            spellCheck={false}
            aria-label="Formula bar"
            onFocus={() => setBar({ sheet, row: sel.ar, col: sel.ac, text: raw })}
            onChange={(e) => {
              if (editing) setEditing({ ...editing, text: e.target.value });
              else setBar({ sheet, row: sel.ar, col: sel.ac, text: e.target.value });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (editing) commitEdit(editing.text, "down");
                else commitBar();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                cancelEdit();
                (e.target as HTMLInputElement).blur();
              }
            }}
            onBlur={() => {
              if (!editing) commitBar();
            }}
          />
        </div>

        <Grid
          store={store}
          sheet={sheet}
          sel={sel}
          setSel={setSel}
          editing={editing}
          setEditing={setEditing}
          commitEdit={commitEdit}
          cancelEdit={cancelEdit}
          onKeyDown={onKeyDown}
          onFill={onFill}
          version={version}
          ghostCols={ghostCols}
          anchored={anchored}
        />

        {open && <FillCard pred={open} onKeep={() => store.acceptPrediction(sheet, open.col)} onUndo={() => { store.dismissPrediction(sheet, open.col); store.setCell(sheet, 0, open.col, ""); }} onSchema={(id) => void predict(open.col, open.header, id)} onStatement={(value) => void predict(open.col, open.header, open.schema.id, value)} />}

        <div className="js-tabs">
          {[...store.wb.sheets.keys()].map((s) => (
            <button
              key={s}
              className={`js-tab${s === sheet ? " on" : ""}`}
              onClick={() => {
                store.seed(s);
                setSheet(s);
                setSel({ ar: 0, ac: 0, fr: 0, fc: 0 });
                setEditing(null);
              }}
            >
              {s}
            </button>
          ))}
          <span className="js-status muted mono">
            Scroll across to explore columns. Double-click a cell to edit it.
          </span>
        </div>
      </div>
    </div>
  );
}

function IntentChip({ intent, pending, error }: { intent: Intent | null; pending: boolean; error: string | null }) {
  return (
    <div className={`js-chip${pending ? " pending" : ""}`}>
      {intent ? (
        <>
          <b>{intent.schema.label}</b>
          <span className="muted">{describeSchema(intent.schema)}</span>
          <span className="muted mono">
            {intent.exact
              ? "exact match — no call needed"
              : intent.fallback
                ? "Using your question directly"
                : `${Math.round(intent.confidence * 100)}% confidence`}
          </span>
        </>
      ) : (
        <span className="muted">{error ? error : pending ? "reading your header…" : "Name the column to choose a prediction"}</span>
      )}
    </div>
  );
}

function FillCard({
  pred,
  onKeep,
  onUndo,
  onSchema,
  onStatement,
}: {
  pred: import("./store.ts").Prediction;
  onKeep: () => void;
  onUndo: () => void;
  onSchema: (id: string) => void;
  onStatement: (statement: string) => void;
}) {
  const run = store.runner.stats;
  const [draft, setDraft] = useState(pred.instructions);
  useEffect(() => setDraft(pred.instructions), [pred.instructions]);

  // Every number here counts this column only: a run can be draining another
  // column's chunks at the same time, and run-wide counters read as 100%.
  const done = pred.filled;
  const complete = done >= pred.rows;
  const running = run.running && !complete;
  const pct = pred.rows > 0 ? Math.round((done / pred.rows) * 100) : 0;
  return (
    <div className="js-card">
      <div className="js-cardhead">
        <b>{running ? "Predicting column…" : complete ? "Column predicted" : `Column ${pct}% filled`}</b>
        <button className="js-x" onClick={onUndo} aria-label="Undo">
          ✕
        </button>
      </div>
      <div className="js-cardrow">
        <span className="js-cardheader">“{pred.header}”</span>
        <span className="muted">read as</span>
        <select className="js-select" value={pred.schema.id} onChange={(e) => onSchema(e.target.value)}>
          {SCHEMAS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <p className="js-scale muted">{describeSchema(pred.schema)}</p>
      {pred.schema.id === "yesno" && (
        <label className="js-statement">
          <span className="muted">Question to evaluate</span>
          <input
            className="input mono"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (draft.trim() && draft !== pred.instructions) onStatement(draft.trim());
            }}
          />
        </label>
      )}
      <div className="bar js-bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="js-stats">
        <span>
          <b>{done}</b>
          <small>of {pred.rows} rows</small>
        </span>
      </div>
      <div className="js-cardactions">
        <button className="btn primary" onClick={onKeep}>
          Keep
        </button>
        <button className="btn" onClick={onUndo}>
          Undo
        </button>
      </div>
    </div>
  );
}

// Keep the free-form statement rewrite reachable from the console for debugging.
if (typeof window !== "undefined") Object.assign(window, { judgeSheets: { store, statementFor } });
