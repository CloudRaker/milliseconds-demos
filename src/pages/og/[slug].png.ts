import type { APIRoute } from 'astro';
import { readFileSync } from 'node:fs';
import type { DemoMeta } from '../../demos/meta';
import { render, type OgCard } from '../../lib/og';

const modules = import.meta.glob<{ default: DemoMeta }>('../../demos/*/meta.ts', { eager: true });
const outputs: Record<string, string> = {
  'yes-no': 'true', classify: 'LABEL', 'classify-free': 'LABEL', 'classify-tree': 'CATEGORY',
  extract: 'FIELDS', entities: 'ENTITIES', verify: 'true', rate: 'SCORE', answer: 'ANSWER',
};
const visuals: Record<string, OgCard['visual']> = {
  'invoice-desk': { input: 'Invoice NB-1042\nNorthstar Studio', label: 'Total extracted', value: '$2,520' },
  'sales-intake': { input: '“Can we book a demo?”', label: 'Route to', value: 'SALES' },
  'returns-desk': { input: '“The shirt is too small.”', label: 'Policy result', value: 'RETURN' },
  'catalog-studio': { input: '“Green cotton tee, medium.”', label: 'Fields extracted', value: '3 FIELDS' },
};

export function getStaticPaths() {
  return Object.values(modules).map(({ default: meta }) => ({ params: { slug: meta.slug }, props: { meta } }));
}

export const GET: APIRoute<{ meta: DemoMeta }> = async ({ props: { meta } }) => {
  const visual = meta.slug === 'hot-dog'
    ? { image: `data:image/png;base64,${readFileSync('public/images/hotdog-cutout.png', 'base64')}`, label: 'The important question', value: 'HOT DOG?' }
    : visuals[meta.slug] ?? { input: meta.modality === 'image' ? 'An image.\nA simple question.' : 'Your input.\nOne API call.', label: 'Output', value: outputs[meta.routes[0]] || 'DECISION' };
  return new Response(Buffer.from(await render({
    eyebrow: meta.modality === 'image' ? 'Image demo' : 'Interactive demo',
    title: meta.title.replace(' / ', ' /\n'), description: meta.summary, footer: 'Free examples. No key needed.', action: 'Try the demos', visual,
  })), { headers: { 'content-type': 'image/png' } });
};
