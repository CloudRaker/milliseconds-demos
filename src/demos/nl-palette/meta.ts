import type { DemoMeta } from "../meta";

export default {
  slug: "nl-palette",
  title: "Natural Language Commands",
  summary: "Control a notes editor by describing the change you want in plain English.",
  instruction: "Select Open the palette, type a request such as make the text bigger, then choose a command.",
  routes: ["classify-tree", "classify", "rate", "yes-no"],
  origin: "nl-palette",
  category: "Developer & interactive",
  order: 40,
} satisfies DemoMeta;
