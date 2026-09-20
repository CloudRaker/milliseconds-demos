import type { StockExample } from '../lib/example-contract.ts';
import { extractionRequest } from '../demos/receipt-boxes/logic.ts';
import { RECEIPT } from '../demos/receipt-boxes/receipt.ts';

// One sponsored image request. Other detail tiers and uploaded images use the visitor's own key:
// each tier is a separate cached entry, and the image bytes travel in every sponsored fill.
const examples: StockExample[] = [
  { demo: 'receipt-boxes', scenario: 'bakery-receipt', route: 'extract', body: extractionRequest(RECEIPT.dataUrl, 'medium') },
];
export default examples;
