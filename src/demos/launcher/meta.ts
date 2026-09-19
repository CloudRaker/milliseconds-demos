import type { DemoMeta } from "../meta";

export default {
  slug: "launcher",
  title: "Intent Launcher",
  summary: "Find the file, app or command you mean from a plain-English request.",
  instruction: "Enter a request or choose an example, then select Find best action.",
  routes: ["classify", "yes-no"],
  origin: "jev-launcher",
  category: "Developer & interactive",
  order: 10,
} satisfies DemoMeta;
