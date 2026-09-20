import type { DemoMeta } from '../meta';
export default {
  slug: 'roast-check', title: 'Roast Check',
  summary: 'Sort coffee beans into four roast levels using eight real, labeled photographs.',
  instruction: 'Classify a dataset photo free, then try a bean photo of your own.',
  routes: ['classify'], category: 'Sales & commerce', modality: 'image',
} satisfies DemoMeta;
