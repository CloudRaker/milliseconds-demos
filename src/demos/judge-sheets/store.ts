/**
 * Glue between the pure Workbook, the request runner and React. One recalc per
 * animation frame: evaluate dirty cells, hand the judgments they need to the
 * runner's queue, bump a version so subscribed components re-render.
 * Ported from the Jev experiment's src/lib/store.ts (health checks dropped).
 */
import { cellKey, parseKey } from "./engine/refs.ts";
import { shiftFormula } from "./engine/parser.ts";
import type { Workbook } from "./engine/workbook.ts";
import { applySeed, buildWorkbook } from "./sheets.ts";
import { Runner } from "./runner.ts";
import { formulaFor, instructionsFor, type Schema } from "./predict.ts";

const MIN_PREDICTED_COL_W = 172;

export type Prediction = {
  sheet: string;
  col: number;
  textCol: number;
  header: string;
  schema: Schema;
  /** The statement / instructions actually sent, editable for free-form yes/no. */
  instructions: string;
  rows: number;
  accepted: boolean;
  startedAt: number;
  /** Rows of this column that already hold an answer, and when the last one landed.
   *  Per column, never per run: the run may be filling another column as well. */
  filled: number;
  finishedAt: number;
};

export class Store {
  wb: Workbook;
  runner: Runner;
  version = 0;
  predictions = new Map<string, Prediction>();
  private listeners = new Set<() => void>();
  private scheduled = false;
  /** Next recalc's judgments jump the queue (the visitor just asked for them). */
  private queueFirst = false;

  constructor() {
    this.wb = buildWorkbook();
    this.runner = new Runner(
      (key, value) => {
        this.wb.resolveJev(key, value);
        this.schedule();
      },
      () => this.emit(),
    );
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getVersion = () => this.version;

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Coalesce recalcs. setTimeout, not requestAnimationFrame: rAF never fires in a
   *  background tab, which froze every answer that landed while you looked away. */
  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    setTimeout(() => {
      this.scheduled = false;
      this.tick();
    }, 16);
  }

  /** Recalculate, then queue whatever judgments the sheet is missing. */
  tick() {
    const r = this.wb.recalc();
    if (r.pending.length) this.runner.enqueue(r.pending, r.cacheHits, this.queueFirst);
    this.queueFirst = false;
    for (const p of this.predictions.values()) {
      if (p.accepted && p.filled >= p.rows) continue;
      p.filled = this.filledRows(p);
      if (p.filled >= p.rows && !p.finishedAt) p.finishedAt = performance.now();
    }
    this.emit();
  }

  /** Rows of a predicted column whose judgment has come back. */
  filledRows(p: Prediction): number {
    let n = 0;
    for (let r = 1; r <= p.rows; r++) {
      const cell = this.wb.getCell(p.sheet, r, p.col);
      if (!cell?.jevKeys.size) continue;
      let all = true;
      for (const k of cell.jevKeys) if (!this.wb.cache.has(k)) all = false;
      if (all) n++;
    }
    return n;
  }

  /** Put the seeded column of a sheet in place the first time that sheet is shown. */
  seed(sheet: string) {
    const p = applySeed(this.wb, sheet);
    if (!p) return;
    this.predictions.set(`${p.sheet}:${p.col}`, {
      ...p,
      instructions: instructionsFor(p.schema, p.header),
      accepted: true,
      startedAt: 0,
      filled: 0,
      finishedAt: 0,
    });
    this.schedule();
  }

  prediction(sheet: string, col: number): Prediction | undefined {
    return this.predictions.get(`${sheet}:${col}`);
  }

  /** The newest prediction on a sheet the visitor has not kept or undone yet. */
  openPrediction(sheet: string): Prediction | undefined {
    let best: Prediction | undefined;
    for (const p of this.predictions.values())
      if (p.sheet === sheet && !p.accepted && (!best || p.startedAt > best.startedAt)) best = p;
    return best;
  }

  /**
   * The column of free text a predicted column reads from: the column left of
   * `col` with the longest average text (skipping other predicted columns).
   */
  findTextColumn(sheet: string, col: number): number {
    const sh = this.wb.getSheet(sheet);
    const len = new Map<number, { sum: number; n: number }>();
    for (const [k, cell] of sh.cells) {
      const p = parseKey(k);
      if (p.row === 0 || p.col >= col || cell.raw.startsWith("=")) continue;
      const e = len.get(p.col) ?? { sum: 0, n: 0 };
      e.sum += cell.raw.length;
      e.n++;
      len.set(p.col, e);
    }
    let best = -1;
    let bestAvg = 0;
    for (const [c, e] of len) {
      const avg = e.sum / e.n;
      if (avg > bestAvg) {
        bestAvg = avg;
        best = c;
      }
    }
    return best;
  }

  /** Whether typing a header in row 0 of `col` should predict the column. */
  isPredictable(sheet: string, col: number): boolean {
    if (this.prediction(sheet, col)) return true;
    if (this.findTextColumn(sheet, col) < 0) return false;
    for (const k of this.wb.getSheet(sheet).cells.keys()) {
      const p = parseKey(k);
      if (p.col === col && p.row > 0) return false;
    }
    return true;
  }

  sampleTexts(sheet: string, textCol: number, n = 3): string[] {
    const out: string[] = [];
    for (let r = 1; out.length < n && r < 50; r++) {
      const t = this.wb.getRaw(sheet, r, textCol);
      if (t) out.push(t);
    }
    return out;
  }

  /** Fill `col` with the schema's formula for every row of the text column. */
  predictColumn(sheet: string, col: number, header: string, schema: Schema, override?: string): Prediction {
    const prev = this.prediction(sheet, col);
    const textCol = prev?.textCol ?? this.findTextColumn(sheet, col);
    const last = this.lastUsedRowIn(sheet, textCol);
    for (let r = 1; r <= last; r++) {
      const raw = this.wb.getRaw(sheet, r, textCol) ? formulaFor(schema, header, textCol, r, override) : "";
      if (this.wb.getRaw(sheet, r, col) !== raw) this.wb.setCell(sheet, r, col, raw);
    }
    const pred: Prediction = {
      sheet,
      col,
      textCol,
      header,
      schema,
      instructions: override ?? instructionsFor(schema, header),
      rows: last,
      accepted: false,
      startedAt: performance.now(),
      filled: 0,
      finishedAt: 0,
    };
    const sh = this.wb.getSheet(sheet);
    if ((sh.colWidths.get(col) ?? 0) < MIN_PREDICTED_COL_W) sh.colWidths.set(col, MIN_PREDICTED_COL_W);
    this.predictions.set(`${sheet}:${col}`, pred);
    this.queueFirst = true;
    this.schedule();
    return pred;
  }

  acceptPrediction(sheet: string, col: number) {
    const p = this.prediction(sheet, col);
    if (p) p.accepted = true;
    this.emit();
  }

  dismissPrediction(sheet: string, col: number) {
    const p = this.prediction(sheet, col);
    if (!p) return;
    // Only this column's judgments leave the queue. Clearing the whole queue
    // stranded every other pending cell: a recalc re-queues dirty cells only,
    // so nothing ever asked for them again.
    const keys = new Set<string>();
    for (let r = 1; r <= p.rows; r++) {
      const cell = this.wb.getCell(sheet, r, col);
      if (cell) for (const k of cell.jevKeys) keys.add(k);
      if (this.wb.getRaw(sheet, r, col)) this.wb.setCell(sheet, r, col, "");
    }
    this.predictions.delete(`${sheet}:${col}`);
    // setCell("") unlinked this column, so a key with dependents left is one
    // another cell still waits on. Keep it queued.
    for (const k of [...keys]) if (this.wb.cellsForJev(k).size) keys.delete(k);
    this.runner.drop(keys);
    this.schedule();
  }

  setCell(sheet: string, row: number, col: number, raw: string) {
    this.wb.setCell(sheet, row, col, raw);
    this.schedule();
  }

  /** Copy the formula of (row, col) down through `toRow`, shifting relative refs. */
  fillDown(sheet: string, row: number, col: number, toRow: number) {
    const src = this.wb.getRaw(sheet, row, col);
    for (let r = row + 1; r <= toRow; r++) {
      const raw = src.startsWith("=") ? shiftFormula(src, r - row, 0) : src;
      if (this.wb.getRaw(sheet, r, col) !== raw) this.wb.setCell(sheet, r, col, raw);
    }
    this.schedule();
  }

  /** Last row with content in a specific column. */
  lastUsedRowIn(sheet: string, col: number): number {
    let max = -1;
    for (const k of this.wb.getSheet(sheet).cells.keys()) {
      const p = parseKey(k);
      if (p.col === col && p.row > max) max = p.row;
    }
    return max;
  }

  /** Cells on a sheet that hold a judgment, and how many still wait for one. */
  judgedCount(sheet: string): { total: number; pending: number } {
    let total = 0;
    let pending = 0;
    for (const cell of this.wb.getSheet(sheet).cells.values()) {
      if (!cell.jevKeys.size) continue;
      total++;
      if (!this.wb.cache.has([...cell.jevKeys][0])) pending++;
    }
    return { total, pending };
  }

  setColWidth(sheet: string, col: number, width: number) {
    this.wb.getSheet(sheet).colWidths.set(col, Math.max(40, Math.round(width)));
    this.emit();
  }

  key(sheet: string, row: number, col: number) {
    return cellKey(sheet, row, col);
  }
}
