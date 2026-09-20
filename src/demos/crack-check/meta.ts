import type { DemoMeta } from '../meta';
export default {
  slug: 'crack-check', title: 'Crack Check',
  summary: "Spot visible cracks in concrete photos.",
  instruction: "Pick a photo and classify it.",
  routes: ['classify'], category: 'Documents & operations', modality: 'image',
} satisfies DemoMeta;
