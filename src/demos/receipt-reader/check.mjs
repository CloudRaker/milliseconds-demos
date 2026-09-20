// node --experimental-strip-types src/demos/receipt-reader/check.mjs — no credentials or network.
import assert from 'node:assert/strict';
import { extractionRequest, parseReceipt, FIELDS } from './logic.ts';
import { RECEIPT } from './receipt.ts';
import { decodedBytes, imageProblem, imageTokens, MAX_IMAGE_BYTES } from '../../lib/image.ts';

const base64 = RECEIPT.dataUrl.slice(RECEIPT.dataUrl.indexOf(',') + 1);

// The stock image is a real, accepted, small PNG.
assert.equal(imageProblem(RECEIPT.dataUrl), null);
assert.equal(imageProblem(base64), null);
assert.ok(decodedBytes(base64) < 200_000, 'the stock receipt stays small enough to ship in the catalog');
for (const [value, code] of [
  ['https://example.com/receipt.png', 'invalid_image'],
  ['data:application/pdf;base64,AAAA', 'invalid_image'],
  ['data:image/png;base64,not base64!', 'invalid_image'],
  ['', 'invalid_image'],
  [null, 'invalid_image'],
  [`data:image/jpeg;base64,${'A'.repeat(4 * Math.ceil((MAX_IMAGE_BYTES + 1024) / 3))}`, 'image_too_large'],
]) assert.equal(imageProblem(value), code, String(value).slice(0, 40));

// Generative image extraction bills twice the tier.
assert.deepEqual(['low', 'medium', 'high'].map(detail => imageTokens('extract', detail)), [2000, 4000, 8000]);
assert.equal(imageTokens('classify', 'medium'), 2000);

// The request carries the image and the tier, never a URL.
const request = extractionRequest(RECEIPT.dataUrl, 'medium');
assert.equal(request.image, RECEIPT.dataUrl);
assert.equal(request.detail, 'medium');
assert.equal(request.schema.properties.items.type, 'array');
// The public extract request has no free-text instructions field; the schema carries the guidance.
assert.deepEqual(Object.keys(request).sort(), ['detail', 'image', 'schema']);
assert.match(request.schema.description, /exactly as printed/);
// The API counts nested leaves, including each property of an array item once.
const fieldCount = schema => schema.type === 'object'
  ? Object.values(schema.properties).reduce((n, child) => n + fieldCount(child), 0)
  : schema.type === 'array' && schema.items.type === 'object' ? fieldCount(schema.items) : 1;
assert.equal(fieldCount(request.schema), 5, 'image extraction allows at most five fields');
assert.deepEqual(FIELDS.map(field => field.key), ['merchant', 'date', 'total']);

// Every schema field becomes a row, and line items expand into a name and a price each.
const parsed = parseReceipt({
  data: { merchant: 'Harbor Lane Bakery', date: '2026-09-18', total: 25.76, items: [{ name: 'Flat white', price: 9 }, { name: 'Oat milk 1L', price: 3.1 }] },
});
assert.equal(parsed.rows.length, FIELDS.length + 4, 'every field plus a name and a price per line item');
assert.deepEqual(parsed.rows.map(row => row.path).slice(-4), ['items[0].name', 'items[0].price', 'items[1].name', 'items[1].price']);
assert.deepEqual(parsed.rows.map(row => row.label).slice(0, 2), ['Merchant', 'Date']);
assert.equal(parsed.rows.find(row => row.path === 'merchant').value, 'Harbor Lane Bakery');
assert.equal(parsed.rows.find(row => row.path === 'total').value, '25.76');
assert.equal(parsed.rows.find(row => row.path === 'items[1].price').value, '3.1');
assert.deepEqual(Object.keys(parsed.rows[0]).sort(), ['label', 'path', 'value'], 'a row carries no coordinates');

// Missing values render empty.
const sparse = parseReceipt({ data: { merchant: 'Harbor Lane Bakery', total: null } });
assert.equal(sparse.rows.find(row => row.path === 'date').value, '');
assert.equal(sparse.rows.find(row => row.path === 'total').value, '');

for (const bad of [null, 'text', [], {}, { data: [] }, { data: { merchant: { nested: true } } }, { data: { items: [{ name: ['a'] }] } }])
  assert.throws(() => parseReceipt(bad), JSON.stringify(bad));

console.log('Receipt Reader: image limits, tier billing and record flattening passed.');
