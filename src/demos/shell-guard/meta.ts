import type { DemoMeta } from '../meta';

export default {
  slug: 'shell-guard',
  title: "Shell Guard",
  summary: "Run it, review it, or block it. Check a command’s risk.",
  instruction: "Choose a command and press Enter.",
  routes: ['yes-no', 'classify'],
  origin: 'jev-shell-guard',
  category: "Developer & interactive",
  order: 30,
} satisfies DemoMeta;
