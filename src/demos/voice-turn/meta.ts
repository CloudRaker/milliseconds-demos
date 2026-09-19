import type { DemoMeta } from "../meta";

export default {
  slug: "voice-turn",
  title: "Voice Turn",
  summary: "Watch a voice assistant decide when a request is ready and recognize when the speaker interrupts.",
  instruction: "Select Start session, then follow the transcript, response timing and turn decisions.",
  routes: ["classify", "yes-no"],
  origin: "jev-voice-turn",
  category: "Customer experience",
  order: 20,
} satisfies DemoMeta;
