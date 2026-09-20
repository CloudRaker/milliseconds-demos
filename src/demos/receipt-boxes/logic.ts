import type { Detail } from '../../lib/image.ts';

export type Box = [number, number, number, number];
export interface Size { width: number; height: number }
export interface Row { path: string; label: string; value: string; box: Box | null }

export const FIELDS = [
  { key: 'merchant', label: 'Merchant', type: 'string', description: 'business name printed at the top of the receipt' },
  { key: 'date', label: 'Date', type: 'string', description: 'date of purchase as printed' },
  { key: 'receipt_number', label: 'Receipt number', type: 'string', description: 'receipt or transaction number' },
  { key: 'subtotal', label: 'Subtotal', type: 'number', description: 'subtotal before tax' },
  { key: 'tax', label: 'Tax', type: 'number', description: 'tax amount charged' },
  { key: 'total', label: 'Total', type: 'number', description: 'final total amount paid' },
  { key: 'currency', label: 'Currency', type: 'string', description: 'three letter currency code, empty when not printed' },
  { key: 'card_last4', label: 'Card last 4', type: 'string', description: 'last four digits of the payment card' },
] as const;

export const schema = {
  type: 'object',
  title: 'receipt',
  properties: {
    ...Object.fromEntries(FIELDS.map(field => [field.key, { type: field.type, description: field.description }])),
    items: {
      type: 'array',
      description: 'line items purchased, in printed order',
      items: { type: 'object', properties: { name: { type: 'string', description: 'item name as printed' }, price: { type: 'number', description: 'price charged for this line' } } },
    },
  },
};
export const instructions = 'Read the printed receipt. Copy amounts exactly as printed and leave a field empty when it is not on the receipt.';

/** One extract call over one image. `boxes` come back in the uploaded image's own pixels. */
export const extractionRequest = (image: string, detail: Detail) => ({ image, detail, schema, instructions });

const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown) => value === null || value === undefined || typeof value === 'string' || number(value);
const show = (value: unknown) => (value === null || value === undefined ? '' : String(value));

/** A box is usable only when it is four integers inside the image and not inverted. */
export function parseBox(value: unknown, size: Size): Box | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(n => Number.isInteger(n))) return null;
  const [x1, y1, x2, y2] = value as Box;
  if (x2 <= x1 || y2 <= y1) return null;
  if (x1 < 0 || y1 < 0 || x2 > size.width || y2 > size.height) return null;
  return [x1, y1, x2, y2];
}

/** Flatten the extracted record into display rows, each carrying its box when the model returned one. */
export function parseReceipt(raw: unknown, size: Size): { rows: Row[]; data: Record<string, unknown>; boxed: number } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The extraction did not return a receipt. Try again.');
  const body = raw as { data?: unknown; boxes?: unknown };
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new Error('The extraction did not return a receipt. Try again.');
  const data = body.data as Record<string, unknown>;
  // `boxes` is optional: text extractions have none, and an image extraction may return an empty map.
  const boxes = (body.boxes && typeof body.boxes === 'object' && !Array.isArray(body.boxes) ? body.boxes : {}) as Record<string, unknown>;
  const rows: Row[] = [];
  const add = (path: string, label: string, value: unknown) => {
    if (!text(value)) throw new Error(`Unexpected value for ${label}. Try again.`);
    rows.push({ path, label, value: show(value), box: parseBox(boxes[path], size) });
  };
  for (const field of FIELDS) add(field.key, field.label, data[field.key]);
  const items = Array.isArray(data.items) ? data.items : [];
  items.forEach((item, index) => {
    const line = (item ?? {}) as Record<string, unknown>;
    if (typeof line !== 'object' || Array.isArray(line)) throw new Error('Unexpected line item. Try again.');
    add(`items[${index}].name`, `Item ${index + 1}`, line.name);
    add(`items[${index}].price`, `Item ${index + 1} price`, line.price);
  });
  return { rows, data, boxed: rows.filter(row => row.box).length };
}

/** Box in image pixels to a percentage rectangle, so the overlay follows any rendered width. */
export function rect(box: Box, size: Size) {
  const [x1, y1, x2, y2] = box;
  return { left: `${(x1 / size.width) * 100}%`, top: `${(y1 / size.height) * 100}%`, width: `${((x2 - x1) / size.width) * 100}%`, height: `${((y2 - y1) / size.height) * 100}%` };
}
