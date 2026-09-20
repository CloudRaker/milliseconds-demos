// node --experimental-strip-types scripts/check-image-demo.mjs
import assert from 'node:assert/strict';
import { imageClassifyRequest, parseImageVerdict } from '../src/lib/image-demo.ts';

const labels = { clear: 'a clear surface', damaged: 'visible surface damage', unsure: 'not enough evidence' };
const valid = { label: 'damaged', probability: 0.7, scores: { clear: 0.2, damaged: 0.7, unsure: 0.1 } };
assert.deepEqual(parseImageVerdict(valid, labels), valid);
assert.deepEqual(imageClassifyRequest({ detail: 'low', labels, samples: [{ caption: 'secret ground truth', expected: 'damaged' }] }, 'data:image/jpeg;base64,AA=='), {
  image: 'data:image/jpeg;base64,AA==', detail: 'low', labels,
});
for (const bad of [null, [], 'damaged', {}, { ...valid, label: 'unknown' }, { ...valid, probability: NaN },
  { ...valid, probability: 1.1 }, { ...valid, scores: [] }, { ...valid, scores: { clear: 0.3, damaged: 0.7 } },
  { ...valid, scores: { ...valid.scores, unsure: -0.1 } }, { ...valid, scores: { ...valid.scores, clear: '0.2' } }]) {
  assert.throws(() => parseImageVerdict(bad, labels));
}
console.log('Image demo: multiclass response validation and image-only request boundary passed.');
