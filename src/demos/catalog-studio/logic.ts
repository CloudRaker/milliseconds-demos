export const LABELS = {
  apparel: 'Clothing, shirts, tops and wearable garments',
  furniture: 'Home furniture, tables, chairs, shelves',
  audio: 'Audio electronics, headphones, speakers, microphones',
  other: 'Unrelated text, services, or products outside clothing, furniture and audio electronics',
};
export type Category = keyof typeof LABELS;
export const PATHS: Record<Category, string> = { apparel: 'Apparel / Clothing', furniture: 'Home / Furniture', audio: 'Electronics / Audio', other: 'Category needs review' };
export const FIELDS = { brand: 'explicit product brand name, not the seller or model', material: 'explicit physical material the product is made of', size: 'explicit clothing size', dimensions: 'explicit physical product dimensions including units', color: 'explicit product color', connectivity: 'explicit audio connection type such as Bluetooth, USB or wired' };
export type Field = keyof typeof FIELDS;
export const SCHEMA = { type: 'object', properties: Object.fromEntries(Object.entries(FIELDS).map(([key, description]) => [key, { type: 'string', description }])) };
export const REQUIRED: Record<Category, Field[]> = { apparel: ['material', 'size', 'color'], furniture: ['material', 'dimensions'], audio: ['brand', 'connectivity'], other: [] };
export type Attribute = { value: string; start: number; end: number; normalized?: string };
export type RecordResult = { category: Category; probability: number; attributes: Partial<Record<Field, Attribute>>; issues: string[] };
export const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export function normalizeDimensions(value: string): string | undefined {
  const match = value.trim().match(/^(\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?){0,2})\s*(cm|mm|in|inches)$/i);
  if (!match) return;
  const unit = match[2].toLowerCase();
  if (unit === 'cm') return;
  const factor = unit === 'mm' ? 0.1 : 2.54;
  return match[1].split(/[x×]/).map(n => Number((Number(n.trim()) * factor).toFixed(3))).join(' × ') + ' cm';
}
export function recordFrom(source: string, classification: unknown, extraction: unknown): RecordResult {
  if (!object(classification) || typeof classification.label !== 'string' || !Object.hasOwn(LABELS, classification.label) || typeof classification.probability !== 'number' || !Number.isFinite(classification.probability) || classification.probability < 0 || classification.probability > 1 || !object(extraction) || !object(extraction.data)) throw new Error('The API returned an unexpected record. Retry the batch.');
  const category = classification.label as Category;
  const attributes: RecordResult['attributes'] = {};
  const issues: string[] = [];
  for (const field of Object.keys(FIELDS) as Field[]) {
    const raw = extraction.data[field];
    if (raw == null || raw === '') continue;
    if (typeof raw !== 'string') { issues.push(`${field}: unexpected value type`); continue; }
    const value = raw.trim();
    if (!value) continue;
    const exact = source.indexOf(value);
    const start = exact >= 0 ? exact : source.toLowerCase().indexOf(value.toLowerCase());
    if (start < 0 || source.slice(start, start + value.length).toLowerCase() !== value.toLowerCase()) { issues.push(`${field}: no matching source wording`); continue; }
    // Use the original source spelling; no inferred attributes enter the export.
    attributes[field] = { value: source.slice(start, start + value.length), start, end: start + value.length, ...(field === 'dimensions' ? { normalized: normalizeDimensions(value) } : {}) };
  }
  if (category === 'other') issues.push('No supported category selected; check the listing and taxonomy');
  else {
    if (classification.probability < 0.75) issues.push('Category score below the demo review threshold (75%)');
    for (const field of REQUIRED[category]) if (!attributes[field]) issues.push(`Missing ${field}`);
  }
  return { category, probability: classification.probability, attributes, issues };
}
export function parseBatch(sources: string[], classifications: unknown, extractions: unknown) {
  if (!object(classifications) || !Array.isArray(classifications.results) || !object(extractions) || !Array.isArray(extractions.results) || classifications.results.length !== sources.length || extractions.results.length !== sources.length) throw new Error('The API returned an incomplete batch. Retry to rebuild all records.');
  const categories = classifications.results; const values = extractions.results;
  return sources.map((source, index) => recordFrom(source, categories[index], values[index]));
}
export function exportRecords(sources: string[], results: RecordResult[], preview: boolean) {
  return sources.map((source, index) => ({ listing: index + 1, provenance: preview ? 'sample preview' : 'model draft', source, category: PATHS[results[index].category], review: results[index].issues.join('; ') || 'Required fields present; human review still required', ...Object.fromEntries(Object.keys(FIELDS).map(field => [field, results[index].attributes[field as Field]?.value ?? null])), dimensions_cm: results[index].attributes.dimensions?.normalized ?? null }));
}
export function csv(rows: Record<string, unknown>[]) {
  const cell = (value: unknown) => { let text = value == null ? '' : String(value); if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
  const keys = Object.keys(rows[0] ?? {});
  return [keys.map(cell).join(','), ...rows.map(row => keys.map(key => cell(row[key])).join(','))].join('\r\n');
}

export const categoryRequest = (texts: string[]) => ({ texts, labels: LABELS });
export const attributesRequest = (texts: string[]) => ({ texts, schema: SCHEMA });
