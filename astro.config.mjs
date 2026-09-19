// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// Static build served by Cloudflare Workers Static Assets; src/worker.ts only handles /api/*.
export default defineConfig({
  site: 'https://demo.milliseconds.ai',
  output: 'static',
  integrations: [react()],
});
