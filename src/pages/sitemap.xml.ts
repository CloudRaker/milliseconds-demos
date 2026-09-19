import type { APIRoute } from 'astro';
import type { DemoMeta } from '../demos/meta';

const modules = import.meta.glob<{ default: DemoMeta }>('../demos/*/meta.ts', { eager: true });
const urls = ['https://demo.milliseconds.ai/', ...Object.values(modules).map((m) => `https://demo.milliseconds.ai/${m.default.slug}/`)];

export const GET: APIRoute = () =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`,
    { headers: { 'content-type': 'application/xml' } },
  );
