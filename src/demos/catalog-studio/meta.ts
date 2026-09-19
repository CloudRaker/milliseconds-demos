import type { DemoMeta } from '../meta';
export default {
  slug: 'catalog-studio', title: 'Catalog Studio',
  summary: 'Turn inconsistent product descriptions into categorized records, with source-backed attributes and a queue for missing details.',
  instruction: 'Structure the stock catalog free, inspect its source evidence, then use your key for your own listings.',
  routes: ['classify', 'extract'], category: 'Sales & commerce', order: 3,
} satisfies DemoMeta;
