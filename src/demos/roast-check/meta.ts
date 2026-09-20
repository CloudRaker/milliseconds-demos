import type { DemoMeta } from '../meta';
export default {
  slug: 'roast-check', title: 'Roast Check',
  summary: "Light roast or nearly charcoal? Sort the coffee beans.",
  instruction: "Pick a bean photo and classify it.",
  routes: ['classify'], category: 'Sales & commerce', modality: 'image',
} satisfies DemoMeta;
