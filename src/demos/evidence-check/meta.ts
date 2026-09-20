import type { DemoMeta } from "../meta";
export default {
  slug: "evidence-check",
  title: "Evidence Check",
  summary: "Does the record match the source? Check before you copy.",
  instruction: "Check the record, then open a flagged field.",
  routes: ["verify"],
  category: "Documents & operations",
  order: 4,
} satisfies DemoMeta;
