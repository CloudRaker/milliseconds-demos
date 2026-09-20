import type { StockExample } from '../lib/example-contract.ts';
import { imageClassifyRequest } from '../lib/image-demo.ts';
import { config } from '../demos/produce-check/config.ts';

const examples: StockExample[] = config.samples.map(sample => ({
  demo: config.slug,
  scenario: sample.id,
  route: 'classify',
  body: imageClassifyRequest(config, sample.dataUrl),
}));
export default examples;
