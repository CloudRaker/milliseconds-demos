import type { DemoMeta } from "../meta";

export default {
  slug: "jev-lint",
  title: "Semantic Linter",
  summary: "Spot potential injections and secrets in sample code.",
  instruction: "Pick a file and hit Scan file.",
  routes: ["yes-no", "classify"],
  origin: "jev-lint",
  category: "Developer & interactive",
  order: 20,
} satisfies DemoMeta;
