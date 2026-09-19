import type { DemoMeta } from "../meta";
export default {
  slug: "private-share",
  title: "Private Share",
  summary: "Prepare a support transcript for sharing: find personal details, choose what to remove, and keep the useful context.",
  instruction: "Detect details in the stock transcript free, review redactions, then use your key for your own text.",
  routes: ["entities"],
  category: "Documents & operations",
  order: 5,
} satisfies DemoMeta;
