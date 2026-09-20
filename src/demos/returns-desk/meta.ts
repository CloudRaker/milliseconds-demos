import type { DemoMeta } from "../meta";
export default {
  slug: "returns-desk",
  title: "Returns Desk",
  summary: "Read the request. Apply your return policy.",
  instruction: "Check a request, then change the policy and try again.",
  routes: ["classify", "answer"],
  category: "Customer experience",
  order: 6,
} satisfies DemoMeta;
