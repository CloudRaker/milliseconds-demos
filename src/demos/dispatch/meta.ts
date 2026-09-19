import type { DemoMeta } from "../meta";

export default {
  slug: "dispatch",
  title: "Dispatch Console",
  summary: "Turn incoming emergency reports into prioritized incidents and send available response units across a simulated city.",
  instruction: "Select Run 60s stream, then open an incident to inspect its priority and assigned units.",
  routes: ["classify", "rate", "yes-no"],
  origin: "jev-dispatch",
  category: "Documents & operations",
  order: 10,
} satisfies DemoMeta;
