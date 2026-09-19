// Opt-in evaluation: MS_API_KEY=... node --experimental-strip-types src/demos/catalog-studio/probe.mjs
import fs from 'node:fs';
import { FIXTURES } from './fixtures.ts';
import { LABELS, SCHEMA, parseBatch } from './logic.ts';
const key = process.env.MS_API_KEY;
if (!key) throw new Error('Set MS_API_KEY to run the optional live evaluation.');
const texts = FIXTURES.map(f => f.text);
const captured = [];
for (const [route, body] of [['classify', { texts, labels: LABELS }], ['extract', { texts, schema: SCHEMA }]]) {
  const started = Date.now();
  const response = await fetch(`https://api.milliseconds.ai/v1/decision-machine-1/${route}`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Probe failed with HTTP ${response.status}; rerun after the rate limit clears.`);
  captured.push({ route, elapsedMs: Date.now() - started, tokens: response.headers.get('x-input-tokens'), data: await response.json() });
  await new Promise(resolve => setTimeout(resolve, 3100));
}
const records = parseBatch(texts, captured[0].data, captured[1].data);
const results = FIXTURES.map((fixture, index) => ({ ...fixture, actual: records[index], categoryCorrect: fixture.category === records[index].category, missingFieldsPreserved: fixture.missing.every(field => !records[index].attributes[field]) }));
const report = { evaluatedAt: new Date().toISOString(), scope: '30 fictional listings; ten held out. Checks category labels and expected missing fields, not complete field accuracy.', requests: captured.map(({ data, ...request }) => request), categoryCorrect: results.filter(r => r.categoryCorrect).length, missingFieldsPreserved: results.filter(r => r.missingFieldsPreserved).length, results };
fs.writeFileSync(new URL('./probe-results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ categoryCorrect: report.categoryCorrect, missingFieldsPreserved: report.missingFieldsPreserved, failures: results.filter(r => !r.categoryCorrect || !r.missingFieldsPreserved) }, null, 2));
