import type { DemoMeta } from "../meta";

export default {
  slug: "nl-palette",
  title: "Natural Language Commands",
  summary: "Tell the editor what to do. In your own words.",
  instruction: "Open the palette and describe a change.",
  routes: ["classify-tree", "classify", "rate", "yes-no"],
  origin: "nl-palette",
  category: "Developer & interactive",
  order: 40,
} satisfies DemoMeta;
