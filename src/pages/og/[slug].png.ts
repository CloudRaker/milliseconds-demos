import type { APIRoute } from 'astro';
import type { DemoMeta } from '../../demos/meta';
import { render } from '../../lib/og';

// One social card per demo, rendered at build time from its meta.ts.
const modules = import.meta.glob<{ default: DemoMeta }>('../../demos/*/meta.ts', { eager: true });

export function getStaticPaths() {
  return Object.values(modules).map(({ default: meta }) => ({ params: { slug: meta.slug }, props: { meta } }));
}

export const GET: APIRoute<{ meta: DemoMeta }> = async ({ props: { meta } }) =>
  new Response(Buffer.from(await render({ eyebrow: `Demo · ${meta.routes.map((r) => `/${r}`).join(' ')}`, title: meta.title, description: meta.summary })), {
    headers: { 'content-type': 'image/png' },
  });
