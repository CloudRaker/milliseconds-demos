import type { DemoMeta } from '../meta';
export default {
  slug: 'produce-check', title: 'Produce Check',
  summary: 'Flag visible deterioration in real produce photos for closer human inspection.',
  instruction: 'Classify a dataset photo free, then try a produce photo of your own.',
  routes: ['classify'], category: 'Sales & commerce', modality: 'image',
} satisfies DemoMeta;
