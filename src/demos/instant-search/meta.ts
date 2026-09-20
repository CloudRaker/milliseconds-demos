import type { DemoMeta } from "../meta";

export default {
  slug: "instant-search",
  title: "Product Search",
  summary: "Find the product they’re describing.",
  instruction: "Pick a request and hit Search with AI.",
  routes: ["yes-no", "classify"],
  origin: "jev-instant-search",
  category: "Sales & commerce",
  order: 20,
} satisfies DemoMeta;
