// node --experimental-strip-types src/demos/hot-dog/check.mjs — no credentials or network.
import assert from 'node:assert/strict';
import { agreement, classifyRequest, DETAIL, isHotDog, LABELS, parseVerdict } from './logic.ts';
import { SAMPLES } from './samples.ts';
import { CREDITS } from './credits.ts';
import { decodedBytes, imageProblem, imageTokens } from '../../lib/image.ts';

// The grid holds enough subjects to be a test set, and both answers are represented.
assert.ok(SAMPLES.length >= 12 && SAMPLES.length <= 16, `14 photos expected, found ${SAMPLES.length}`);
assert.equal(new Set(SAMPLES.map(sample => sample.id)).size, SAMPLES.length, 'ids are unique');
assert.ok(SAMPLES.filter(sample => sample.expected === 'hot dog').length >= 5, 'enough hot dogs');
assert.ok(SAMPLES.filter(sample => sample.expected === 'not hot dog').length >= 5, 'enough near misses');

// Every photo is a real, accepted JPEG, small enough to ship in the catalog and no larger than the tier reads.
for (const sample of SAMPLES) {
  assert.equal(imageProblem(sample.dataUrl), null, sample.id);
  assert.ok(sample.dataUrl.startsWith('data:image/jpeg;base64,'), `${sample.id} is a JPEG data URL`);
  const bytes = decodedBytes(sample.dataUrl.slice(sample.dataUrl.indexOf(',') + 1));
  assert.ok(bytes < 60_000, `${sample.id} is ${bytes} bytes, over the 60 kB budget`);
  assert.equal(Math.max(sample.width, sample.height), 512, `${sample.id} longest edge`);
  assert.ok(sample.alt.length > 20 && sample.caption.length > 2, `${sample.id} is described`);
}

// Every photo carries its source, author and licence.
assert.deepEqual(CREDITS.map(credit => credit.id).sort(), SAMPLES.map(sample => sample.id).sort());
for (const credit of CREDITS) {
  assert.ok(credit.page.startsWith('https://commons.wikimedia.org/wiki/File:'), credit.id);
  assert.ok(credit.author.length > 0 && credit.license.length > 0, credit.id);
  assert.ok(credit.license === 'Public domain' || credit.license === 'CC0' || credit.licenseUrl.startsWith('http'), `${credit.id} needs a licence link`);
}

// A hot dog needs no resolution: the cheapest tier, and classify bills the tier itself.
assert.equal(DETAIL, 'low');
assert.equal(imageTokens('classify', 'low'), 1000);
assert.equal(1000 * 1000 * 0.04 / 1_000_000, 0.04, '1,000 photos cost $0.04 at $0.04 per million tokens');

// The request carries the photo, the tier and the two labels, never a URL and never text.
const request = classifyRequest(SAMPLES[0].dataUrl);
assert.deepEqual(Object.keys(request).sort(), ['detail', 'image', 'labels']);
assert.equal(request.detail, 'low');
assert.deepEqual(Object.keys(request.labels), ['hot dog', 'not hot dog']);
assert.deepEqual(request.labels, LABELS);

// A verdict is the label above 0.5, read from the distribution, not from the model's own pick.
const hot = parseVerdict({ label: 'hot dog', probability: 0.97, confidence: 0.9, scores: { 'hot dog': 0.97, 'not hot dog': 0.03 } });
assert.equal(isHotDog(hot), true);
assert.equal(hot.probability, 0.97);
const cold = parseVerdict({ label: 'not hot dog', probability: 0.88, scores: { 'hot dog': 0.12, 'not hot dog': 0.88 } });
assert.equal(isHotDog(cold), false);
assert.equal(isHotDog({ label: 'hot dog', probability: 0.5, scores: { 'hot dog': 0.5, 'not hot dog': 0.5 } }), true, 'the line is at 0.5 inclusive');

for (const bad of [null, 'text', [], {}, { label: 'sandwich', probability: 0.9, scores: {} },
  { label: 'hot dog', probability: 2, scores: { 'hot dog': 1, 'not hot dog': 0 } },
  { label: 'hot dog', probability: 0.9, scores: { 'hot dog': 0.9 } },
  { label: 'hot dog', probability: 0.9, scores: [0.9, 0.1] }])
  assert.throws(() => parseVerdict(bad), JSON.stringify(bad));

// Agreement counts only the photos that carry a caption and a verdict.
const results = new Map([[SAMPLES[0].id, hot], ['your-photo', hot]]);
assert.equal(agreement(results, SAMPLES), SAMPLES[0].expected === 'hot dog' ? 1 : 0);
assert.equal(agreement(new Map(), SAMPLES), 0);

console.log(`Hot Dog / Not Hot Dog: ${SAMPLES.length} photos, image limits, low-tier billing and the 0.5 rule passed.`);
