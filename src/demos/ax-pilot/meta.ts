import type { DemoMeta } from "../meta";

export default {
  slug: "ax-pilot",
  title: "App Pilot",
  summary: "Watch an agent complete a task in a simulated app by reading its buttons, fields and menus.",
  instruction: "Choose a stock goal and run its free recorded example, or use your API key for a custom goal.",
  routes: ["classify", "yes-no"],
  origin: "jev-ax-pilot",
  category: "Developer & interactive",
  order: 8,
} satisfies DemoMeta;
