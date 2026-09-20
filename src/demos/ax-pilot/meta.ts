import type { DemoMeta } from "../meta";

export default {
  slug: "ax-pilot",
  title: "App Pilot",
  summary: "Give an agent a goal. Watch it work through a simulated app.",
  instruction: "Pick a goal and run the example.",
  routes: ["classify", "yes-no"],
  origin: "jev-ax-pilot",
  category: "Developer & interactive",
  order: 8,
} satisfies DemoMeta;
