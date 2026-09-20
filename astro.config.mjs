// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// Static build served by Cloudflare Workers Static Assets; src/worker.ts only handles /api/*.
export default defineConfig({
  site: 'https://demo.milliseconds.ai',
  output: 'static',
  integrations: [react()],
  // Local UI previews use the existing demo API, including its free example cache.
  vite: { server: { proxy: { '/api/': { target: 'https://demo.milliseconds.ai', changeOrigin: true } } } },
});
