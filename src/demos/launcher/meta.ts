import type { DemoMeta } from "../meta";

export default {
  slug: "launcher",
  title: "Intent Launcher",
  summary: "Find the file, app, or command you meant.",
  instruction: "Describe what you need, then select Find best action.",
  routes: ["classify", "yes-no"],
  origin: "jev-launcher",
  category: "Developer & interactive",
  order: 10,
} satisfies DemoMeta;
