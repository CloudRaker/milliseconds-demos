import type { DemoMeta } from "../meta";

export default {
  slug: "send-guard",
  title: "Send Guard",
  summary: "One last check before you hit send.",
  instruction: "Write a message or start the replay.",
  routes: ["yes-no", "classify", "rate"],
  origin: "send-guard",
  category: "Customer experience",
  order: 10,
} satisfies DemoMeta;
