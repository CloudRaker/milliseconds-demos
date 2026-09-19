import assert from 'node:assert/strict';
import examples from './business.ts';
import { canonical } from '../lib/example-contract.ts';
import { SAMPLES as invoices, invoice, unexpectedStockTotal } from '../demos/invoice-desk/data.ts';
import { extractionRequest, evidenceRequest as invoiceEvidence, totalRequest } from '../demos/invoice-desk/logic.ts';
import { SAMPLES as messages } from '../demos/sales-intake/fixtures.ts';
import { DEFAULT_CRITERIA, intentRequest as salesIntent, factsRequest, fitRequest } from '../demos/sales-intake/logic.ts';
import { SAMPLE as listings } from '../demos/catalog-studio/fixtures.ts';
import { categoryRequest, attributesRequest } from '../demos/catalog-studio/logic.ts';
import { sampleSource, sampleValues, fields, verificationRequest } from '../demos/evidence-check/logic.ts';
import { SAMPLE as transcript, detectionRequest } from '../demos/private-share/logic.ts';
import { EXAMPLES as returns } from '../demos/returns-desk/data.ts';
import { intentRequest as returnIntent, evidenceRequest as returnEvidence } from '../demos/returns-desk/logic.ts';

const registered = (demo, route, body) => examples.some(example => example.demo === demo && example.route === route && canonical(example.body) === canonical(body));
assert.equal(examples.length, 29);
assert.equal(new Set(examples.map(e => `${e.demo}/${e.scenario}`)).size, 11);
assert.equal(new Set(examples.map(e => canonical({ demo: e.demo, route: e.route, body: e.body }))).size, examples.length);
for (const sample of invoices) {
  const source = invoice(sample.draft);
  assert(registered('invoice-desk', 'extract', extractionRequest(source)));
  assert(registered('invoice-desk', 'answer', invoiceEvidence(source)));
  assert(registered('invoice-desk', 'verify', totalRequest(source, sample.draft.total)));
  assert(registered('invoice-desk', 'verify', totalRequest(source, String(Number(sample.draft.total)))));
  assert(!registered('invoice-desk', 'verify', totalRequest(source, '999.42')));
  assert.equal(unexpectedStockTotal(source, sample.draft.total), false);
  assert.equal(unexpectedStockTotal(source, '999.42'), true);
  assert.equal(unexpectedStockTotal(source + '\nMy own invoice', '999.42'), false, 'Custom source must still use the visitor key');
}
const texts = messages.map(message => message.text);
assert(registered('sales-intake', 'yes-no', salesIntent(texts)));
assert(registered('sales-intake', 'extract', factsRequest(texts)));
for (const criterion of DEFAULT_CRITERIA) assert(registered('sales-intake', 'classify', fitRequest(texts, criterion)));
assert(!registered('sales-intake', 'classify', fitRequest(texts, 'A custom criterion')));
assert(registered('catalog-studio', 'classify', categoryRequest(listings)));
assert(registered('catalog-studio', 'extract', attributesRequest(listings)));
for (const [index, field] of fields.entries()) {
  assert(registered('evidence-check', 'verify', verificationRequest(sampleSource, field, sampleValues[index])));
  assert(!registered('evidence-check', 'verify', verificationRequest(sampleSource, field, 'A custom proposed value')));
}
assert(registered('private-share', 'entities', detectionRequest(transcript)));
for (const sample of returns) {
  assert(registered('returns-desk', 'classify', returnIntent(sample.text)));
  assert(registered('returns-desk', 'answer', returnEvidence(sample.text)));
}
// Text changes, schema changes and added parameters never select sponsored requests.
for (const example of examples) {
  const body = example.body;
  const edited = typeof body.text === 'string' ? { ...body, text: body.text + '\nCustom content' } : { ...body, texts: [...body.texts, 'Custom content'] };
  assert(!registered(example.demo, example.route, edited));
  assert(!registered(example.demo, example.route, { ...body, extra: true }));
}
assert.deepEqual(totalRequest('x', 'USD 2,520.00'), totalRequest('x', '2520'));
assert.equal(totalRequest('x', '-0.01').value, '-0.01');
assert.equal(totalRequest('x', 'unknown').value, 'unknown');
console.log('Business stock checks passed: 6 demos, 11 scenarios, 29 exact requests; custom text, criteria, values and parameters excluded.');
