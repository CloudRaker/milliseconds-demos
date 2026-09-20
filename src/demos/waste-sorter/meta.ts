import type { DemoMeta } from '../meta';
export default {
  slug: 'waste-sorter', title: 'Waste Sorter',
  summary: 'Sort real waste photos into glass, paper, cardboard, plastic, metal and other waste.',
  instruction: 'Choose a TrashNet photo, run the classifier, then compare it with the dataset label.',
  routes: ['classify'], category: 'Documents & operations', modality: 'image',
} satisfies DemoMeta;
