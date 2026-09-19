import type { DemoMeta } from "../meta";

export default {
  slug: "agent-assist",
  title: "Agent Assist",
  summary: "Spot customer intent, frustration and churn risk across eight support chats, with a suggested reply for each conversation.",
  instruction: "Select Run all 8 chats, then open a conversation to inspect its signals and suggested reply.",
  routes: ["classify", "rate", "yes-no"],
  origin: "agent-assist",
  category: "Customer experience",
  order: 20,
} satisfies DemoMeta;
