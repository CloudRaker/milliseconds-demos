import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const { build } = createRequire(import.meta.resolve('wrangler'))('esbuild');
const root = resolve(import.meta.dirname, '..');
for (const [slug, count] of [['leaf-check', 9], ['land-cover', 10]]) {
  const bundle = await build({ stdin: { contents: `export { config } from './src/demos/${slug}/config.ts'; export { default as examples } from './src/examples/${slug}.ts';`, resolveDir: root }, bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'error' });
  const { config, examples } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  const provenance = JSON.parse(await readFile(`${root}/src/demos/${slug}/provenance.json`, 'utf8'));
  assert.equal(config.samples.length, count);
  assert.equal(new Set(config.samples.map(sample => sample.id)).size, count);
  assert.deepEqual(new Set(config.samples.map(sample => sample.expected)), new Set(Object.keys(config.labels)));
  for (const [i, sample] of config.samples.entries()) {
    assert.equal(sample.id, provenance.files[i].id);
    const bytes = Buffer.from(sample.dataUrl.split(',')[1], 'base64');
    assert.equal(bytes.readUInt16BE(0), 0xffd8, 'Real JPEG bytes required');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), provenance.files[i].embeddedSha256);
    assert.ok(bytes.length < 60_000 && sample.width <= 512 && sample.height <= 512);
    assert.equal(decodeURIComponent(new URL(sample.sourceUrl).hash.slice(1)), provenance.files[i].archivePath);
    assert.deepEqual(examples[i], { demo: slug, scenario: sample.id, route: 'classify', body: { image: sample.dataUrl, detail: 'low', labels: config.labels } });
    if (slug === 'land-cover') {
      assert.equal(sample.width, 64);
      assert.equal(sample.height, 64);
      assert.equal(provenance.files[i].originalSha256, provenance.files[i].embeddedSha256);
    }
  }
  console.log(`${slug}: ${count} sourced images, labels and sponsored request contracts verified`);
}
