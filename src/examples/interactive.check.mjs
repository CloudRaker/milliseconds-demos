// node src/examples/interactive.check.mjs — no network or model key.
import assert from 'node:assert/strict';
import examples from './interactive.ts';
import { canonical } from '../lib/example-contract.ts';
import { EXAMPLES as searches, generateCatalog } from '../demos/instant-search/data.ts';
import { createIndex, search, searchRequestBodies } from '../demos/instant-search/engine.ts';
import { EXAMPLES as launcherQueries, INDEX } from '../demos/launcher/data.ts';
import { prefilter, targetBody } from '../demos/launcher/engine.ts';
import { ARG_SLOTS, BENCHMARK_CASES, STOCK_QUERIES, argumentRequest, benchmarkTexts, destructiveBody, treeBody } from '../demos/nl-palette/data.ts';
import { BY_ID, EXAMPLES as rerankQueries, bm25, rerankBodies } from '../demos/turbo-rerank/data.ts';

const registered = (demo, route, body) => examples.some(example => example.demo === demo && example.route === route && canonical(example.body) === canonical(body));
assert.deepEqual(Object.fromEntries(['instant-search', 'launcher', 'nl-palette', 'turbo-rerank'].map(demo => [demo, examples.filter(example => example.demo === demo).length])), {
  'instant-search': 15, launcher: 16, 'nl-palette': 209, 'turbo-rerank': 17,
});
for (const example of examples) {
  assert.ok(!example.body.texts || example.body.texts.length <= 32, `${example.demo}: oversized text batch`);
  assert.ok(!example.body.statements || example.body.statements.length <= 32, `${example.demo}: oversized statement batch`);
  assert.equal(example.recorded, undefined, 'No invented model responses in the request catalog');
}

const catalog = generateCatalog();
const index = createIndex(catalog);
const byId = new Map(catalog.map(product => [product.id, product]));
for (const query of searches) {
  const bodies = searchRequestBodies(query, search(index, byId, query));
  assert.ok(registered('instant-search', 'yes-no', bodies.relevance));
  assert.ok(registered('instant-search', 'yes-no', bodies.intent));
  assert.ok(registered('instant-search', 'classify', bodies.department));
  assert.ok(!registered('instant-search', 'classify', { ...bodies.department, text: query + ' custom' }));
}
for (const query of launcherQueries) {
  const { text, labels } = targetBody(query, prefilter(query, INDEX).candidates);
  assert.ok(registered('launcher', 'classify', { text, labels }));
  assert.ok(!registered('launcher', 'classify', { text, labels: { ...labels, injected: 'different command' } }));
}
for (const query of STOCK_QUERIES) {
  assert.ok(registered('nl-palette', 'classify-tree', treeBody(query)));
  assert.ok(registered('nl-palette', 'yes-no', destructiveBody(query)));
  for (const slot of ARG_SLOTS) {
    const { route, body } = argumentRequest(slot, [treeBody(query).text]);
    assert.ok(registered('nl-palette', route, body), `Missing model-dependent ${slot} branch for ${query}`);
  }
}
assert.ok(!registered('nl-palette', 'classify-tree', treeBody('a visitor-defined command')));
const longQuery = 'visitor input '.repeat(40);
assert.ok(treeBody(longQuery).text.includes(longQuery), 'Custom input must not be silently truncated before the allowlist check');
for (const slot of ARG_SLOTS) {
  const { route, body } = argumentRequest(slot, benchmarkTexts(), true);
  assert.equal(body.texts.length, BENCHMARK_CASES.length);
  assert.ok(registered('nl-palette', route, body));
}
for (const { query } of rerankQueries) {
  for (const count of [32, 50]) {
    const rows = bm25().search(query, count).map(hit => BY_ID.get(hit.id));
    const bodies = rerankBodies(query, rows);
    assert.deepEqual(bodies.flatMap(body => body.texts), rows.map(row => row.text), 'Chunking preserves retrieved passage order');
    assert.ok(bodies.every(body => registered('turbo-rerank', 'yes-no', body)));
    assert.ok(bodies.every(body => !registered('turbo-rerank', 'yes-no', { ...body, statement: body.statement + ' custom' })));
  }
}
console.log(`Interactive catalog: ${examples.length} fixed requests, all variants and argument branches covered.`);
