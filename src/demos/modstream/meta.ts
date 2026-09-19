import type { DemoMeta } from "../meta";

export default {
  slug: "modstream",
  title: "ModStream",
  summary: "Review live-chat messages before release and route risky content to moderation or care.",
  instruction: "Select Start chat stream, then open a held message to inspect its signals and moderation decision.",
  routes: ["yes-no", "classify", "rate"],
  origin: "modstream",
  category: "Customer experience",
  order: 10,
} satisfies DemoMeta;
