import type { DemoMeta } from "../meta";

export default {
  slug: "turbo-rerank",
  title: "Document Reranker",
  summary: "A question in. The relevant docs up top.",
  instruction: "Pick a question and hit Rerank.",
  routes: ["yes-no"],
  origin: "turbo-rerank",
  category: "Documents & operations",
  order: 30,
} satisfies DemoMeta;
