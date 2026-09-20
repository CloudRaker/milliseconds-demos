import type { APIRoute } from 'astro';
import { readFileSync } from 'node:fs';
import { render } from '../lib/og';

export const GET: APIRoute = async () => new Response(Buffer.from(await render({
  eyebrow: 'The playground', title: 'Go on.\nPush a button.',
  description: 'Try AI classification and extraction\non text and images.',
  footer: 'Free examples. No key needed.', action: 'Try the demos',
  visual: {
    image: `data:image/png;base64,${readFileSync('public/images/hotdog-cutout.png', 'base64')}`,
    label: 'Very serious AI', value: 'HOT DOG?',
  },
})), { headers: { 'content-type': 'image/png' } });
