import type { DemoMeta } from "../meta";

export default {
  slug: "send-guard",
  title: "Send Guard",
  summary: "Check a message for exposed secrets, personal data, risky commitments and tone before sending it.",
  instruction: "Write a message or select Start replay, then inspect the Send verdict and highlighted text.",
  routes: ["yes-no", "classify", "rate"],
  origin: "send-guard",
  category: "Customer experience",
  order: 10,
} satisfies DemoMeta;
