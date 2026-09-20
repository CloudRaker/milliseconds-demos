import type { DemoMeta } from "../meta";

export default {
  slug: "modstream",
  title: "ModStream",
  summary: "Let the chat flow. Hold the messages that need review.",
  instruction: "Start the stream, then open a held message.",
  routes: ["yes-no", "classify", "rate"],
  origin: "modstream",
  category: "Customer experience",
  order: 10,
} satisfies DemoMeta;
