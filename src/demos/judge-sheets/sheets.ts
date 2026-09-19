/**
 * The workbook the page opens with: two sheets of seeded rows, summary formulas
 * that recalculate as judgments land, and two columns that already hold
 * =RATE / =PICK formulas. Nothing is fetched until the visitor presses Run.
 * Ported from the Jev experiment's src/data/workbook.ts.
 */
import { Workbook } from "./engine/workbook.ts";
import { generateLeads, generateReviews } from "./data.ts";
import { formulaFor, schemaById, type Schema } from "./predict.ts";

export const ROWS = 340;
export const COLS = 14;
export const REVIEW_COUNT = 300;
export const LEAD_COUNT = 150;

export type SeedPrediction = { sheet: string; col: number; textCol: number; header: string; schema: Schema; rows: number };

export const SEED_PREDICTIONS: SeedPrediction[] = [
  { sheet: "Reviews", col: 3, textCol: 2, header: "Sentiment", schema: schemaById("sentiment")!, rows: REVIEW_COUNT },
  { sheet: "Leads", col: 4, textCol: 3, header: "Intent", schema: schemaById("intent")!, rows: LEAD_COUNT },
];

const set = (wb: Workbook, sheet: string, cell: string, raw: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(cell)!;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  wb.setCell(sheet, Number(m[2]) - 1, col - 1, raw);
};

export function buildWorkbook(): Workbook {
  const wb = new Workbook();

  // --------------------------------------------------------------- Reviews
  const reviews = wb.addSheet("Reviews", ROWS, COLS);
  reviews.colWidths.set(0, 62);
  reviews.colWidths.set(1, 178);
  reviews.colWidths.set(2, 520);
  reviews.colWidths.set(3, 172);
  reviews.colWidths.set(4, 172);
  reviews.colWidths.set(5, 36);
  reviews.colWidths.set(6, 186);
  reviews.colWidths.set(7, 78);
  reviews.colWidths.set(8, 66);

  ["ID", "Product", "Review"].forEach((h, c) => wb.setCell("Reviews", 0, c, h));
  generateReviews(REVIEW_COUNT).forEach((r, i) => {
    wb.setCell("Reviews", i + 1, 0, r.id);
    wb.setCell("Reviews", i + 1, 1, r.product);
    wb.setCell("Reviews", i + 1, 2, r.text);
  });

  const last = REVIEW_COUNT + 1;
  set(wb, "Reviews", "G1", "Summary");
  set(wb, "Reviews", "G2", "Rows judged");
  set(wb, "Reviews", "H2", `=COUNT(D2:D${last})`);
  set(wb, "Reviews", "G3", "Average score (0-4)");
  set(wb, "Reviews", "H3", `=IF(H2>0,ROUND(AVERAGE(D2:D${last}),2),"—")`);
  set(wb, "Reviews", "G4", "Low (score < 1.5)");
  set(wb, "Reviews", "H4", `=COUNTIF(D2:D${last},"<1.5")`);
  set(wb, "Reviews", "I4", '=IF(H2>0,ROUND(100*H4/H2,0)&"%","")');
  set(wb, "Reviews", "G5", "High (score >= 2.5)");
  set(wb, "Reviews", "H5", `=COUNTIF(D2:D${last},">=2.5")`);
  set(wb, "Reviews", "I5", '=IF(H2>0,ROUND(100*H5/H2,0)&"%","")');

  // ----------------------------------------------------------------- Leads
  const leads = wb.addSheet("Leads", ROWS, COLS);
  leads.colWidths.set(0, 62);
  leads.colWidths.set(1, 168);
  leads.colWidths.set(2, 84);
  leads.colWidths.set(3, 500);
  leads.colWidths.set(4, 162);
  leads.colWidths.set(5, 172);
  leads.colWidths.set(6, 36);
  leads.colWidths.set(7, 186);
  leads.colWidths.set(8, 66);

  ["ID", "Company", "Channel", "Message"].forEach((h, c) => wb.setCell("Leads", 0, c, h));
  generateLeads(LEAD_COUNT).forEach((l, i) => {
    wb.setCell("Leads", i + 1, 0, l.id);
    wb.setCell("Leads", i + 1, 1, l.company);
    wb.setCell("Leads", i + 1, 2, l.channel);
    wb.setCell("Leads", i + 1, 3, l.text);
  });

  const lastLead = LEAD_COUNT + 1;
  set(wb, "Leads", "H1", "Summary");
  set(wb, "Leads", "H2", "Rows judged");
  set(wb, "Leads", "I2", `=COUNTA(E2:E${lastLead})`);
  set(wb, "Leads", "H3", "Pricing or demo");
  set(wb, "Leads", "I3", `=COUNTIF(E2:E${lastLead},"pricing")+COUNTIF(E2:E${lastLead},"demo request")`);
  set(wb, "Leads", "H4", "Support");
  set(wb, "Leads", "I4", `=COUNTIF(E2:E${lastLead},"support")`);
  set(wb, "Leads", "H5", "Spam");
  set(wb, "Leads", "I5", `=COUNTIF(E2:E${lastLead},"spam")`);

  return wb;
}

/**
 * Put the formulas of a sheet's seeded column in place. Called for the sheet on
 * screen only, so opening the page queues 300 judgments (10 calls) instead of
 * 450, and the Leads column is queued the first time that tab is opened.
 */
export function applySeed(wb: Workbook, sheet: string): SeedPrediction | undefined {
  const p = SEED_PREDICTIONS.find((s) => s.sheet === sheet);
  if (!p || wb.getRaw(sheet, 1, p.col)) return undefined;
  wb.setCell(sheet, 0, p.col, p.header);
  for (let r = 1; r <= p.rows; r++) wb.setCell(sheet, r, p.col, formulaFor(p.schema, p.header, p.textCol, r));
  return p;
}
