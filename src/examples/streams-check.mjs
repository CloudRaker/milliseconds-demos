// Offline only: covers exact request catalog, dynamic stream grouping, result identity and trust boundaries.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const astroRequire = createRequire(import.meta.resolve('astro'));
const { build } = await import(createRequire(astroRequire.resolve('vite')).resolve('esbuild'));
const temp = await mkdtemp(join(tmpdir(), 'ms-streams-check-'));
try {
  const bundled = await build({
    stdin: { contents: `
      export {default as catalog} from './src/examples/streams';
      export * from './src/lib/stock-batch';
      export {canonical} from './src/lib/example-contract';
      export * as firehose from './src/demos/firehose/data';
      export * as chat from './src/demos/modstream/data';
      export * as logs from './src/demos/log-sentinel/data';
      export {Generator} from './src/demos/log-sentinel/engine';
      export {DEMO_LINES} from './src/demos/live-minutes/data';
      export {windowCalls} from './src/demos/live-minutes/judge';
      export {RUN_ORDER,emailText} from './src/demos/inbox-blitz/data';
      export * as inbox from './src/demos/inbox-blitz/logic';
    `, resolveDir: resolve('.') }, bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'offline-dm1', setup(build) {
      build.onResolve({ filter: /\/dm1(?:\.ts)?$/ }, () => ({ path: 'dm1', namespace: 'mock' }));
      build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const dm1 = (...args) => globalThis.__send(...args); export class Dm1Error extends Error {};' }));
    } }],
  });
  const file = join(temp, 'check.mjs');
  await writeFile(file, bundled.outputFiles[0].text);
  const x = await import(pathToFileURL(file));
  const { catalog, canonical, stockPlan, stockBatch } = x;
  const entries = new Set(catalog.map(item => canonical({ demo: item.demo, route: item.route, body: item.body })));
  for (const item of catalog) assert(item.body.texts.length > 0 && item.body.texts.length <= 32);
  assert.equal(entries.size, catalog.length, 'No duplicate request catalog entries');
  function covered(demo, route, body, stock) {
    for (const group of stockPlan(body.texts, stock)) assert(entries.has(canonical({ demo, route, body: { ...body, texts: group.texts } })), `${demo}: unregistered ${route} request`);
  }
  // Every start/pause/chunk boundary and model-selected subset maps to exact catalog bodies.
  for (const [demo, stock] of [['firehose', x.firehose.STOCK_TEXTS], ['modstream', x.chat.STOCK_TEXTS], ['log-sentinel', x.logs.STOCK_TEXTS]]) {
    const shapes = catalog.filter(entry => entry.demo === demo).filter((entry, index, all) => all.findIndex(other => canonical({ ...other.body, texts: [] }) === canonical({ ...entry.body, texts: [] }) && other.route === entry.route) === index);
    for (let offset = 0; offset < stock.length; offset++) for (const width of [1, 7, 32]) {
      const texts = Array.from({ length: width }, (_, n) => stock[(offset + n) % stock.length]);
      for (const shape of shapes) covered(demo, shape.route, { ...shape.body, texts }, stock);
    }
  }
  const generator = x.firehose.createDemoGenerator(2024);
  for (let i = 0; i < 3000; i++) assert(x.firehose.STOCK_TEXTS.includes(generator.next().text));
  for (const message of [...x.chat.STOCK_CHAT, ...x.chat.STOCK_RAID]) assert(x.chat.STOCK_TEXTS.includes(message.text));
  // Raw log templates, stack grouping, repeated storms and different wall clocks stay finite.
  const logs = new x.Generator();
  let emitted = 0;
  for (let i = 0; i < 3000; i++) {
    const now = 1900000000000 + i * 211;
    if (i % 100 === 0) logs.injectStorm(now);
    for (const event of [...logs.tick(now), ...logs.flush(now)]) {
      assert(x.logs.STOCK_TEXTS.includes(x.logs.forModel(event)), `Unknown log: ${event.line}`);
      emitted++;
    }
  }
  assert(emitted >= 3000);
  const stockCalls = x.windowCalls(x.DEMO_LINES);
  for (let offset = 0; offset < x.DEMO_LINES.length; offset++) for (const width of [1, 12, 32]) {
    for (const call of x.windowCalls(x.DEMO_LINES.slice(offset, offset + width))) {
      covered('live-minutes', call.route, call.body, stockCalls.find(stock => stock.key === call.key).body.texts);
    }
  }
  for (const size of [32, 128, 256]) for (let offset = 0; offset < size; offset += 32) {
    const texts = x.RUN_ORDER.slice(offset, offset + 32).map(x.emailText);
    const shapes = [
      ['classify', { texts, labels: x.inbox.CATEGORY_LABELS }],
      ['yes-no', { texts, statements: x.inbox.STATEMENT_KEYS.map(key => x.inbox.STATEMENTS[key]) }],
      ['rate', { texts, scale: x.inbox.URGENCY_SCALE }], ['rate', { texts, scale: x.inbox.SENTIMENT_SCALE }],
      ...x.inbox.SUGGESTED_INTENTS.map(intent => ['yes-no', { texts, statement: x.inbox.intentStatement(intent) }]),
    ];
    for (const [route, body] of shapes) assert(entries.has(canonical({ demo: 'inbox-blitz', route, body })));
  }
  const stock = Array.from({ length: 70 }, (_, i) => `Sample ${i}`);
  const requested = [stock[69], stock[4], stock[32], stock[4]];
  const calls = [];
  globalThis.__send = async (route, body, signal) => {
    if (signal?.aborted) throw signal.reason;
    calls.push({ route, body });
    return { data: { results: body.texts.map(text => ({ source: text })) }, meta: { tokens: body.texts.length * 10, inferenceMs: 5, wallMs: 1 } };
  };
  const result = await stockBatch('classify', { texts: requested, labels: ['A', 'B'] }, stock);
  assert.deepEqual(result.data.results.map(row => row.source), requested, 'Reordered and duplicate rows map to original results');
  assert.equal(result.meta.tokens, 700, 'Whole-cohort usage must be retained');
  assert.equal(result.meta.inferenceMs, 15);
  assert.equal(calls.length, 3);
  calls.length = 0;
  const custom = { texts: [stock[4], 'visitor secret'], labels: ['Custom'] };
  await stockBatch('classify', custom, stock);
  assert.deepEqual(calls, [{ route: 'classify', body: custom }], 'A mixed/custom body must remain exactly intact');
  const altered = { texts: [stock[4]], labels: ['not a registered label'] };
  await stockBatch('classify', altered, stock);
  assert.equal(calls.at(-1).body.labels[0], altered.labels[0], 'No overriding custom inference criteria');
  globalThis.__send = async () => ({ data: { results: [] }, meta: { tokens: 0, inferenceMs: 0, wallMs: 0 } });
  await assert.rejects(stockBatch('classify', { texts: [stock[4]] }, stock), /incomplete/);
  globalThis.__send = async (_route, _body, signal) => { throw signal.reason; };
  const ctl = new AbortController(); ctl.abort(new Error('cancelled'));
  await assert.rejects(stockBatch('classify', { texts: [stock[4]] }, stock, ctl.signal), /cancelled/);
  const counts = Object.fromEntries([...new Set(catalog.map(row => row.demo))].map(demo => [demo, catalog.filter(row => row.demo === demo).length]));
  console.log('Stream stock checks passed:', JSON.stringify(counts), `${catalog.length} exact requests; cohorts, variants, remapping, usage, custom input, malformed output and cancellation.`);
} finally {
  delete globalThis.__send;
  await rm(temp, { recursive: true, force: true });
}
