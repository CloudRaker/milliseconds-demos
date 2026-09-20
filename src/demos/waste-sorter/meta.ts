import type { DemoMeta } from '../meta';
export default {
  slug: 'waste-sorter', title: 'Waste Sorter',
  summary: "Glass, paper, plastic. Put a label on the rubbish.",
  instruction: "Pick a photo and classify it.",
  routes: ['classify'], category: 'Documents & operations', modality: 'image',
} satisfies DemoMeta;
