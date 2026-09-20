// node --experimental-strip-types src/demos/receipt-boxes/check.mjs — no credentials or network.
import assert from 'node:assert/strict';
import { extractionRequest, parseBox, parseReceipt, rect, FIELDS } from './logic.ts';
import { RECEIPT } from './receipt.ts';
import { decodedBytes, imageProblem, imageTokens, MAX_IMAGE_BYTES } from '../../lib/image.ts';

const size = { width: RECEIPT.width, height: RECEIPT.height };
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

// Provisional generative multiplier: extract bills five times the tier.
assert.deepEqual(['low', 'medium', 'high'].map(detail => imageTokens('extract', detail)), [5000, 10000, 20000]);
assert.equal(imageTokens('classify', 'medium'), 2000);

// The request carries the image and the tier, never a URL.
const request = extractionRequest(RECEIPT.dataUrl, 'medium');
assert.equal(request.image, RECEIPT.dataUrl);
assert.equal(request.detail, 'medium');
assert.equal(request.schema.properties.items.type, 'array');

// Boxes: only four integers inside the image, in order, are usable.
assert.deepEqual(parseBox([10, 20, 30, 40], size), [10, 20, 30, 40]);
for (const bad of [null, [1, 2, 3], [1, 2, 3, 4, 5], [1.5, 2, 3, 4], [30, 20, 10, 40], [10, 40, 30, 20], [-1, 0, 10, 10], [0, 0, size.width + 1, 10], [0, 0, 10, size.height + 1], '10,20,30,40'])
  assert.equal(parseBox(bad, size), null, JSON.stringify(bad));

const response = {
  data: { merchant: 'Harbor Lane Bakery', date: '2026-09-18', receipt_number: 'HLB-40218', subtotal: 23.85, tax: 1.91, total: 25.76, currency: 'USD', card_last4: '4417', items: [{ name: 'Flat white', price: 9 }, { name: 'Oat milk 1L', price: 3.1 }] },
  boxes: { merchant: [28, 26, 300, 52], total: [28, 440, 392, 470], 'items[1].price': [340, 330, 392, 348], 'items[0].name': [0, 0, 0, 0] },
};
const parsed = parseReceipt(response, size);
assert.equal(parsed.rows.length, FIELDS.length + 4, 'every field plus a name and a price per line item');
assert.deepEqual(parsed.rows.map(row => row.path).slice(-4), ['items[0].name', 'items[0].price', 'items[1].name', 'items[1].price']);
assert.equal(parsed.boxed, 3, 'the degenerate box is dropped');
assert.equal(parsed.rows.find(row => row.path === 'total').value, '25.76');
assert.equal(parsed.rows.find(row => row.path === 'items[1].price').value, '3.1');

// Missing values render empty, and a response without boxes still extracts.
const sparse = parseReceipt({ data: { merchant: 'Harbor Lane Bakery', total: null } }, size);
assert.equal(sparse.boxed, 0);
assert.equal(sparse.rows.find(row => row.path === 'tax').value, '');

for (const bad of [null, 'text', [], {}, { data: [] }, { data: { merchant: { nested: true } } }, { data: { items: [{ name: ['a'] }] } }])
  assert.throws(() => parseReceipt(bad, size), JSON.stringify(bad));

// Overlay geometry: percentages of the natural size, so any rendered width lines up.
assert.deepEqual(rect([0, 0, size.width, size.height], size), { left: '0%', top: '0%', width: '100%', height: '100%' });
assert.deepEqual(rect([size.width / 2, 0, size.width, size.height / 2], size), { left: '50%', top: '0%', width: '50%', height: '50%' });

console.log('Receipt Boxes: image limits, tier billing, box validation, record flattening and overlay geometry passed.');
