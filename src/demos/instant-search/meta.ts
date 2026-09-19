import type { DemoMeta } from "../meta";

export default {
  slug: "instant-search",
  title: "Product Search",
  summary: "Find products that match what a shopper means, including preferences such as price, size and suitability.",
  instruction: "Choose an example or enter a product request, then select Search with AI.",
  routes: ["yes-no", "classify"],
  origin: "jev-instant-search",
  category: "Sales & commerce",
  order: 20,
} satisfies DemoMeta;
