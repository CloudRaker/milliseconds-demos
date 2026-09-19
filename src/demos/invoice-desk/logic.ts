export const FIELDS = [
  { key: 'invoice_number', label: 'Invoice number', description: 'invoice number printed on this invoice' },
  { key: 'vendor', label: 'Vendor', description: 'supplier or vendor issuing this invoice, not the company billed' },
  { key: 'customer', label: 'Billed to', description: 'customer or company being billed' },
  { key: 'date', label: 'Invoice date', description: 'date this invoice was issued' },
  { key: 'po', label: 'Purchase order', description: 'purchase order reference number' },
  { key: 'currency', label: 'Currency', description: 'explicit three letter currency code' },
  { key: 'subtotal', label: 'Subtotal', description: 'subtotal before tax', numeric: true },
  { key: 'tax', label: 'Tax', description: 'total tax amount', numeric: true },
  { key: 'total', label: 'Total due', description: 'final total amount due including tax', numeric: true },
  { key: 'terms', label: 'Payment terms', description: 'payment terms printed on the invoice' },
] as const;
export type Field = typeof FIELDS[number]['key'];
export type Draft = Record<Field, string>;
export type Span = { answer: string; start: number; end: number; probability: number };
export type Evidence = Partial<Record<Field, Span>>;
export type Verification = { matches: boolean; probability: number; found: string[]; value: string };
export type Reference = { po: string; total: string; currency: string; priorInvoice: string; priorVendor: string };
export const schema = { type: 'object', title: 'invoice headers', properties: Object.fromEntries(FIELDS.map(f => [f.key, { type: 'numeric' in f ? 'number' : 'string', description: f.description }])) };
export const questions = FIELDS.map(f => `What is the ${f.description}?`);
export function parseDraft(value: unknown): Draft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The extraction did not return an invoice record. Try again.');
  const object = value as Record<string, unknown>;
  return Object.fromEntries(FIELDS.map(f => {
    const v = object[f.key];
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`Invalid number for ${f.label}.`);
    if (v !== null && v !== undefined && typeof v !== 'string' && typeof v !== 'number') throw new Error(`Unexpected value for ${f.label}. Try again.`);
    return [f.key, v == null ? '' : String(v)];
  })) as Draft;
}
export function parseEvidence(value: unknown, source: string): Evidence {
  if (!value || typeof value !== 'object' || !Array.isArray((value as {results?:unknown}).results)) throw new Error('The evidence response was incomplete. Try again.');
  const rows = (value as {results:unknown[]}).results;
  if (rows.length !== FIELDS.length) throw new Error('The evidence response was incomplete. Try again.');
  const output: Evidence = {};
  rows.forEach((raw, i) => {
    const row = raw as Partial<Span> | null;
    if (row && typeof row.answer === 'string' && Number.isInteger(row.start) && Number.isInteger(row.end) && row.start! >= 0 && row.end! > row.start! && row.end! <= source.length && source.slice(row.start, row.end) === row.answer && typeof row.probability === 'number' && row.probability >= 0 && row.probability <= 1) output[FIELDS[i].key] = row as Span;
  });
  return output;
}
export function parseVerification(raw: unknown, value: string, source: string): Verification {
  const r = raw as Partial<Verification> | null;
  if (!r || typeof r.matches !== 'boolean' || typeof r.probability !== 'number' || r.probability < 0 || r.probability > 1 || !Array.isArray(r.found) || !r.found.every(v => typeof v === 'string')) throw new Error('The amount check returned an invalid response. Try again.');
  return { matches: r.matches, probability: r.probability, found: r.found.filter(v => v.trim() && source.includes(v)), value };
}
export function amount(value: string): number | null {
  // ponytail: US decimal formatting only; add locale-aware parsing before accepting other formats.
  const clean = value.trim().replace(/^(?:USD|EUR|GBP|CAD)\s*|\s*(?:USD|EUR|GBP|CAD)$/g, '').replace(/^[$€£]\s*/, '');
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(clean)) return null;
  const n = Number(clean.replaceAll(',', ''));
  return Number.isSafeInteger(Math.round(n * 100)) ? Math.round(n * 100) : null;
}
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
export function evidenceMatches(field: Field, value: string, span?: Span): boolean {
  if (!span || !value.trim()) return false;
  return ['subtotal', 'tax', 'total'].includes(field) ? amount(value) !== null && amount(value) === amount(span.answer) : same(value, span.answer);
}
export type Check = { title: string; detail: string; kind: 'pass' | 'missing' | 'conflict' | 'review'; field?: Field };
export function checks(draft: Draft, evidence: Evidence, verify: Verification | null, reference: Reference): Check[] {
  const result: Check[] = [];
  for (const f of FIELDS) {
    const value = draft[f.key];
    if (!value.trim()) result.push({kind:'missing', title:`${f.label} missing`, detail:'No value is available in the draft. Check the source or request the missing information.', field:f.key});
    else if ('numeric' in f && amount(value) === null) result.push({kind:'review', title:`${f.label} format`, detail:'Use a number with a decimal point and at most two decimal places.', field:f.key});
    else if (!evidenceMatches(f.key,value,evidence[f.key]) || (evidence[f.key]?.probability ?? 0) < .9) result.push({kind:'review', title:`Review ${f.label.toLowerCase()}`, detail:'The draft needs a source check. A matching span alone does not establish the correct field.', field:f.key});
  }
  if (draft.vendor && draft.customer && same(draft.vendor,draft.customer)) result.push({kind:'review',title:'Check vendor and billed company',detail:'Both roles contain the same name. Confirm the supplier and customer separately.',field:'vendor'});
  const subtotal=amount(draft.subtotal), tax=amount(draft.tax), total=amount(draft.total);
  if(subtotal!==null && tax!==null && total!==null) result.push({kind:subtotal+tax===total?'pass':'conflict', title:'Subtotal + tax', detail:`${draft.subtotal} + ${draft.tax} ${subtotal+tax===total?'matches':'does not match'} ${draft.total}.`, field:'total'});
  if (!reference.po.trim() || !reference.total.trim() || !reference.currency.trim()) result.push({kind:'missing',title:'Purchase-order reference incomplete',detail:'Supply the expected PO, amount and currency to compare the draft.'});
  else {
    if(draft.po.trim()) result.push({kind:same(draft.po,reference.po)?'pass':'conflict',title:'Purchase-order number',detail:`Expected ${reference.po}; draft ${draft.po}.`,field:'po'});
    if(total!==null) result.push({kind:amount(reference.total)!==null && total===amount(reference.total)?'pass':'conflict',title:'Purchase-order amount',detail:`Expected ${reference.total} ${reference.currency}; draft ${draft.total} ${draft.currency || '(currency missing)'}.`,field:'total'});
    if(draft.currency.trim()) result.push({kind:same(draft.currency,reference.currency)?'pass':'conflict',title:'Purchase-order currency',detail:`Expected ${reference.currency}; draft ${draft.currency}.`,field:'currency'});
  }
  if (draft.invoice_number && draft.vendor && same(draft.invoice_number,reference.priorInvoice) && same(draft.vendor,reference.priorVendor)) result.push({kind:'conflict', title:'Possible duplicate',detail:'The invoice number and vendor match the supplied prior record.',field:'invoice_number'});
  if(total!==null) {
    const fresh=verify && verify.value===draft.total;
    const exact=fresh && verify.found.some(v=>amount(v)===total);
    result.push({kind:!fresh?'review':!verify.found.length?'review':!exact?'conflict':verify.matches && verify.probability>=.9?'pass':'review',title:'Total against source',detail:!fresh?'Run the amount check for the current draft total.':!verify.found.length?'The model found no source amount. This total is unconfirmed.':!exact?`The model found ${verify.found.join(', ')}, which does not match the draft.`:verify.matches&&verify.probability>=.9?'The model found an exact amount match in the source.':'A matching amount was found, but the model score calls for review.',field:'total'});
  }
  return result;
}

export const extractionRequest = (text: string) => ({ text, schema });
export const evidenceRequest = (text: string) => ({ text, questions });
export function totalRequest(text: string, value: string) {
  const cents = amount(value);
  // Equivalent decimal spellings select one stock request; other values remain custom.
  const normalized = cents === null ? value : `${cents < 0 ? '-' : ''}${Math.trunc(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
  return { text, field: { name: 'total', description: 'final total amount due including tax' }, value: normalized };
}
