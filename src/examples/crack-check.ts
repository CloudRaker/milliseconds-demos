import type { StockExample } from '../lib/example-contract.ts';
import { imageClassifyRequest } from '../lib/image-demo.ts';
import { config } from '../demos/crack-check/config.ts';

export default config.samples.map(sample => ({
  demo: config.slug, scenario: sample.id, route: 'classify',
  body: imageClassifyRequest(config, sample.dataUrl),
})) satisfies StockExample[];
