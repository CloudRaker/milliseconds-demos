import type { DemoMeta } from "../meta";

export default {
  slug: "voice-turn",
  title: "Voice Turn",
  summary: "Know when to answer. Know when to stop talking.",
  instruction: "Start a session and follow the turn decisions.",
  routes: ["classify", "yes-no"],
  origin: "jev-voice-turn",
  category: "Customer experience",
  order: 20,
} satisfies DemoMeta;
