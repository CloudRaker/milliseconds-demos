import type { Detail } from '../../lib/image.ts';

export interface Row { path: string; label: string; value: string }

export const FIELDS = [
  { key: 'merchant', label: 'Merchant', type: 'string', description: 'business name printed at the top of the receipt' },
  { key: 'date', label: 'Date', type: 'string', description: 'date of purchase as printed' },
  { key: 'total', label: 'Total', type: 'number', description: 'final total amount paid' },
] as const;

export const schema = {
  type: 'object',
  title: 'receipt',
  description: 'A printed receipt. Copy every amount exactly as printed and leave a field empty when it is not on the receipt.',
  properties: {
    ...Object.fromEntries(FIELDS.map(field => [field.key, { type: field.type, description: field.description }])),
    items: {
      type: 'array',
      description: 'line items purchased, in printed order',
      items: { type: 'object', properties: { name: { type: 'string', description: 'item name as printed' }, price: { type: 'number', description: 'price charged for this line' } } },
    },
  },
};
/**
 * One extract call over one image. The public request carries no free-text instructions, so the
 * wording that guides the model lives in the schema's own `title` and field `description`s.
 */
export const extractionRequest = (image: string, detail: Detail) => ({ image, detail, schema });

const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown) => value === null || value === undefined || typeof value === 'string' || number(value);
const show = (value: unknown) => (value === null || value === undefined ? '' : String(value));

/** Flatten the extracted record into display rows. */
export function parseReceipt(raw: unknown): { rows: Row[]; data: Record<string, unknown> } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The extraction did not return a receipt. Try again.');
  const body = raw as { data?: unknown };
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new Error('The extraction did not return a receipt. Try again.');
  const data = body.data as Record<string, unknown>;
  const rows: Row[] = [];
  const add = (path: string, label: string, value: unknown) => {
    if (!text(value)) throw new Error(`Unexpected value for ${label}. Try again.`);
    rows.push({ path, label, value: show(value) });
  };
  for (const field of FIELDS) add(field.key, field.label, data[field.key]);
  const items = Array.isArray(data.items) ? data.items : [];
  items.forEach((item, index) => {
    const line = (item ?? {}) as Record<string, unknown>;
    if (typeof line !== 'object' || Array.isArray(line)) throw new Error('Unexpected line item. Try again.');
    add(`items[${index}].name`, `Item ${index + 1}`, line.name);
    add(`items[${index}].price`, `Item ${index + 1} price`, line.price);
  });
  return { rows, data };
}
