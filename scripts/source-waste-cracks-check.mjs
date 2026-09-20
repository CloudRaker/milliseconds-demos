import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { imageClassifyRequest } from '../src/lib/image-demo.ts';

for (const [slug, count, classes] of [['waste-sorter', 12, 6], ['crack-check', 8, 2]]) {
  const { config } = await import(`../src/demos/${slug}/config.ts`);
  const { default: examples } = await import(`../src/examples/${slug}.ts`);
  const provenance = JSON.parse(await readFile(new URL(`../src/demos/${slug}/provenance.json`, import.meta.url)));
  assert.equal(config.slug, slug);
  assert.equal(config.samples.length, count);
  assert.equal(new Set(config.samples.map(sample => sample.id)).size, count);
  assert.equal(new Set(config.samples.map(sample => sample.expected)).size, classes);
  assert.equal(provenance.length, count);
  assert.equal(examples.length, count);
  for (const [index, sample] of config.samples.entries()) {
    const original = provenance.find(item => item.id === sample.id);
    assert.ok(original, `${slug}/${sample.id}: missing provenance`);
    assert.ok(Object.hasOwn(config.labels, sample.expected));
    assert.ok(sample.sourceUrl.endsWith(`#${original.originalPath}`));
    assert.match(sample.dataUrl, /^data:image\/jpeg;base64,/);
    const bytes = Buffer.from(sample.dataUrl.split(',')[1], 'base64');
    assert.equal(bytes.subarray(0, 2).toString('hex'), 'ffd8');
    assert.equal(bytes.length, original.bytes);
    assert.ok(bytes.length < 60000);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), original.sha256);
    assert.ok(sample.width <= 512 && sample.height <= 512);
    assert.deepEqual(examples[index], {
      demo: slug, scenario: sample.id, route: 'classify',
      body: imageClassifyRequest(config, sample.dataUrl),
    });
    const sourceClass = original.originalPath.split('/')[slug === 'waste-sorter' ? 1 : 0];
    assert.equal(sample.expected, slug === 'waste-sorter' ? sourceClass : sourceClass === 'Positive' ? 'crack' : 'no_crack');
  }
  console.log(`${slug}: ${count} source-labeled JPEGs and sponsored request contracts verified`);
}
