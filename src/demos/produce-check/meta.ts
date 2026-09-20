import type { DemoMeta } from '../meta';
export default {
  slug: 'produce-check', title: 'Produce Check',
  summary: "Flag fruit and vegetables that look past their best.",
  instruction: "Pick a produce photo and classify it.",
  routes: ['classify'], category: 'Sales & commerce', modality: 'image',
} satisfies DemoMeta;
