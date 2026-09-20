import type { StockExample } from '../lib/example-contract.ts';
import { classifyRequest, DETAIL } from '../demos/hot-dog/logic.ts';
import { SAMPLES } from '../demos/hot-dog/samples.ts';

// One sponsored request per stock photo, all at the cheapest detail tier. Another tier or an
// uploaded photo is a custom request and uses the visitor's own key.
const examples: StockExample[] = SAMPLES.map(sample => ({
  demo: 'hot-dog',
  scenario: sample.id,
  route: 'classify',
  body: classifyRequest(sample.dataUrl, DETAIL),
}));
export default examples;
