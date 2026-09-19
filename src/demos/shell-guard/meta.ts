import type { DemoMeta } from '../meta';

export default {
  slug: 'shell-guard',
  title: "Shell Guard",
  summary: "Check a shell command for risk before allowing it, asking for confirmation or blocking it.",
  instruction: "Choose an example command or type one in the terminal, then press Enter.",
  routes: ['yes-no', 'classify'],
  origin: 'jev-shell-guard',
  category: "Developer & interactive",
  order: 30,
} satisfies DemoMeta;
