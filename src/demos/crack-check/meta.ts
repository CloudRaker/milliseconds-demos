import type { DemoMeta } from '../meta';
export default {
  slug: 'crack-check', title: 'Crack Check',
  summary: 'Screen concrete inspection photos for visible cracks using a real civil-engineering image dataset.',
  instruction: 'Choose a concrete photo and compare the visual screen with its source label.',
  routes: ['classify'], category: 'Documents & operations', modality: 'image',
} satisfies DemoMeta;
