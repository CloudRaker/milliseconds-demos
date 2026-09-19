import assert from 'node:assert/strict';
import { assess, parseVerify, sampleSource, sampleValues, sampleResults } from './logic.ts';
const cases = [
  ['exact grounded', 'Customer: Northstar.', 'Northstar', {matches:true, probability:.99, found:['Northstar']}, 'supported'],
  ['decimal mismatch', 'Annual fee: USD 18.00.', 'USD 1800', {matches:true, probability:.99, found:['USD 18.00']}, 'review'],
  ['wrong amount', 'Annual fee: USD 18,000.', 'USD 24,000', {matches:false, probability:0, found:['USD 18,000']}, 'different'],
  ['missing field', 'A workshop booking.', '60 days', {matches:false, probability:0, found:[]}, 'missing'],
  ['weak span', 'Customer: Northstar.', 'Northstar', {matches:true, probability:.6, found:['Northstar']}, 'review'],
  ['numeric containment', 'Code: 4471.', '471', {matches:true, probability:.99, found:['4471']}, 'review'],
  ['unlocated evidence', 'Customer: Northstar.', 'Northstar', {matches:true, probability:.99, found:['North Star']}, 'review'],
  ['blank proposed value', 'Customer: Northstar.', '', {matches:false, probability:0, found:[]}, 'empty'],
  ['inconsistent match flag', 'Customer: Northstar.', 'Northstar', {matches:false, probability:0, found:['Northstar']}, 'review'],
  ['unicode source', '🧾 Client: Société Élan.', 'Société Élan', {matches:true, probability:.99, found:['Société Élan']}, 'supported'],
  ['multiple competing spans', 'Renewal: March. Expiry: April.', 'March', {matches:true, probability:.99, found:['March','April']}, 'supported'],
];
for (const [name, source, value, response, expected] of cases) {
  const result = assess(source, value, response);
  assert.equal(result.verdict, expected, name);
  for (const span of result.evidence) assert.equal(source.slice(span.start, span.end), span.text, name);
}
for (const value of [null, {}, {matches:true, probability:NaN, found:[]}, {matches:false, probability:0, found:[42]}, {matches:true, probability:2, found:[]}]) assert.throws(() => parseVerify(value));
assert.deepEqual(sampleResults.map((r,i) => assess(sampleSource,sampleValues[i],r).verdict), ['supported','different','different','missing']);
console.log('Evidence Check: 11 verdict cases, 5 malformed responses, and sample provenance checks passed.');
