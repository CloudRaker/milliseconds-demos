import type { DemoMeta } from "../meta";

export default {
  slug: "agent-assist",
  title: "Agent Assist",
  summary: "Spot frustrated customers. Get a suggested reply.",
  instruction: "Run all 8 chats, then open a conversation.",
  routes: ["classify", "rate", "yes-no"],
  origin: "agent-assist",
  category: "Customer experience",
  order: 20,
} satisfies DemoMeta;
