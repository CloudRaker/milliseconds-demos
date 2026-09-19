import type { DemoMeta } from "../meta";
export default {
  slug: "evidence-check",
  title: "Evidence Check",
  summary: "Check a proposed record against its source. Spot different values, missing evidence and uncertain matches before reuse.",
  instruction: "Check the stock record free, inspect its evidence, then use your key for custom source text or values.",
  routes: ["verify"],
  category: "Documents & operations",
  order: 4,
} satisfies DemoMeta;
