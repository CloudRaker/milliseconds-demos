import type { StockExample } from '../lib/example-contract.ts';
import { SAMPLES as invoices, invoice } from '../demos/invoice-desk/data.ts';
import { extractionRequest, evidenceRequest as invoiceEvidence, totalRequest } from '../demos/invoice-desk/logic.ts';
import { SAMPLES as messages } from '../demos/sales-intake/fixtures.ts';
import { DEFAULT_CRITERIA, intentRequest as salesIntent, factsRequest, fitRequest } from '../demos/sales-intake/logic.ts';
import { SAMPLE as listings } from '../demos/catalog-studio/fixtures.ts';
import { categoryRequest, attributesRequest } from '../demos/catalog-studio/logic.ts';
import { sampleSource, sampleValues, fields, verificationRequest } from '../demos/evidence-check/logic.ts';
import { SAMPLE as transcript, detectionRequest } from '../demos/private-share/logic.ts';
import { EXAMPLES as returns } from '../demos/returns-desk/data.ts';
import { intentRequest as returnIntent, evidenceRequest as returnEvidence } from '../demos/returns-desk/logic.ts';

const texts = messages.map(message => message.text);
const examples: StockExample[] = [
  ...invoices.flatMap((sample, index): StockExample[] => {
    const text = invoice(sample.draft), scenario = ['complete-invoice', 'missing-po', 'amount-discrepancy'][index];
    return [
      { demo: 'invoice-desk', scenario, route: 'extract', body: extractionRequest(text) },
      { demo: 'invoice-desk', scenario, route: 'answer', body: invoiceEvidence(text) },
      { demo: 'invoice-desk', scenario, route: 'verify', body: totalRequest(text, sample.draft.total) },
    ];
  }),
  { demo: 'sales-intake', scenario: 'sample-inbox', route: 'yes-no', body: salesIntent(texts) },
  { demo: 'sales-intake', scenario: 'sample-inbox', route: 'extract', body: factsRequest(texts) },
  ...DEFAULT_CRITERIA.map((criterion): StockExample => ({ demo: 'sales-intake', scenario: 'sample-inbox', route: 'classify', body: fitRequest(texts, criterion) })),
  { demo: 'catalog-studio', scenario: 'sample-listings', route: 'classify', body: categoryRequest(listings) },
  { demo: 'catalog-studio', scenario: 'sample-listings', route: 'extract', body: attributesRequest(listings) },
  ...fields.map((field, index): StockExample => ({ demo: 'evidence-check', scenario: 'service-agreement', route: 'verify', body: verificationRequest(sampleSource, field, sampleValues[index]) })),
  { demo: 'private-share', scenario: 'support-transcript', route: 'entities', body: detectionRequest(transcript) },
  ...returns.flatMap((sample, index): StockExample[] => {
    const scenario = ['routine-return', 'outside-window', 'missing-facts', 'order-mismatch'][index];
    return [
      { demo: 'returns-desk', scenario, route: 'classify', body: returnIntent(sample.text) },
      { demo: 'returns-desk', scenario, route: 'answer', body: returnEvidence(sample.text) },
    ];
  }),
];
export default examples;
