import { FIELDS, amount, type Draft, type Evidence, type Reference } from './logic.ts';
export const BASE: Draft = { invoice_number:'NB-1042', vendor:'Northstar Studio', customer:'Harbor Works', date:'2026-09-12', po:'PO-208', currency:'USD', subtotal:'2400.00', tax:'120.00', total:'2520.00', terms:'Net 30' };
export const REFERENCE: Reference = { po:'PO-208', total:'2520.00', currency:'USD', priorInvoice:'NB-1038', priorVendor:'Northstar Studio' };
export function invoice(d: Draft): string { return `INVOICE\n\n${FIELDS.filter(f=>d[f.key]).map(f=>`${f.label}: ${d[f.key]}`).join('\n')}\n\nServices: Brand identity design\nThank you for your business.`; }
export const SAMPLES = [
  { name:'Complete invoice', detail:'All headers supplied', draft:BASE },
  { name:'Missing PO', detail:'An incomplete record', draft:{...BASE,invoice_number:'NB-1043',po:''} },
  { name:'Amount discrepancy', detail:'Total differs from the PO', draft:{...BASE,invoice_number:'NB-1044',total:'2820.00'} },
];
export function previewEvidence(d: Draft, source: string): Evidence {
  return Object.fromEntries(FIELDS.filter(f=>d[f.key]).map(f=> { const value=d[f.key]; const start=source.indexOf(`${f.label}: `)+f.label.length+2; return [f.key,{ answer:value,start,end:start+value.length,probability:1 }]; }));
}

export function unexpectedStockTotal(source: string, value: string): boolean {
  const stock = SAMPLES.find(sample => invoice(sample.draft) === source);
  return !!stock && amount(value) !== amount(stock.draft.total);
}
