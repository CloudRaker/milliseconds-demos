import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Use the bundler already shipped with our Worker toolchain to load the TS request builders.
const { build } = createRequire(import.meta.resolve('wrangler'))('esbuild');
const root = resolve(import.meta.dirname, '..');
const modules = (await readdir(`${root}/src/examples`)).filter(name => name.endsWith('.ts')).sort();
await mkdir(`${root}/.astro`, { recursive: true });
const bundle = `${root}/.astro/example-catalog.mjs`;
await build({ stdin: { contents: modules.map((name, i) => `import group${i} from './src/examples/${name}';`).join('\n') + `\nexport const entries = [${modules.map((_, i) => `...group${i}`).join(',')}];\nexport {requestDigest,EXAMPLE_VERSION} from './src/lib/example-contract.ts';`, resolveDir: root }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: bundle, logLevel: 'error' });
const { entries, requestDigest, EXAMPLE_VERSION } = await import(pathToFileURL(bundle).href + `?build=${Date.now()}`);
const catalog = {}, manifests = {}, coverage = {};
for (const raw of entries) {
  const entry = JSON.parse(JSON.stringify(raw));
  assert.match(entry.demo, /^[a-z][a-z0-9-]+$/);
  assert.ok(typeof entry.scenario === 'string' && entry.scenario.length > 0);
  assert.ok(['yes-no','classify','classify-tree','rate','answer','entities','extract','verify'].includes(entry.route));
  assert.ok(entry.body && typeof entry.body === 'object' && !Array.isArray(entry.body));
  const digest = await requestDigest(entry.route, entry.body);
  const id = `${entry.demo}/${EXAMPLE_VERSION}/${digest}`;
  if (catalog[id]?.recorded && entry.recorded) assert.deepEqual(catalog[id].recorded, entry.recorded, `Conflicting recorded results: ${id}`);
  catalog[id] ??= entry;
  const manifest = manifests[entry.demo] ??= { version: EXAMPLE_VERSION, requests: {} };
  manifest.requests[digest] = id;
  const scenarios = coverage[entry.demo] ??= {};
  const steps = scenarios[entry.scenario] ??= [];
  if (!steps.includes(id)) steps.push(id);
}
const demos = (await readdir(`${root}/src/demos`, { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name).sort();
assert.deepEqual(Object.keys(manifests).sort(), demos, 'Every demo must publish its stock requests');
async function save(path, value) {
  const next = JSON.stringify(value, null, 2) + '\n';
  if (await readFile(path, 'utf8').catch(() => '') !== next) await writeFile(path, next);
}
await mkdir(`${root}/public/examples`, { recursive: true });
await mkdir(`${root}/src/generated`, { recursive: true });
await save(`${root}/src/generated/examples.json`, catalog);
for (const [demo, manifest] of Object.entries(manifests)) await save(`${root}/public/examples/${demo}.json`, manifest);
await save(`${root}/docs/stock-example-coverage.json`, { version: EXAMPLE_VERSION, demos: coverage });
console.log(`Stock catalog: ${Object.keys(manifests).length} demos, ${Object.keys(catalog).length} unique requests, ${Object.values(coverage).reduce((n, item) => n + Object.keys(item).length, 0)} scenarios.`);
