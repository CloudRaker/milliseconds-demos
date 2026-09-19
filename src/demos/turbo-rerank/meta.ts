import type { DemoMeta } from "../meta";

export default {
  slug: "turbo-rerank",
  title: "Document Reranker",
  summary: "Find the documentation passages most likely to answer a question written in your own words.",
  instruction: "Choose an example question or enter your own, then select Rerank.",
  routes: ["yes-no"],
  origin: "turbo-rerank",
  category: "Documents & operations",
  order: 30,
} satisfies DemoMeta;
