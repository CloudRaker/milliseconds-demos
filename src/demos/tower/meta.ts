import type { DemoMeta } from "../meta";

export default {
  slug: "tower",
  title: "Air Traffic Tower",
  summary: "Keep simulated aircraft out of each other’s way.",
  instruction: "Hit Run and follow the radar.",
  routes: ["classify", "rate", "yes-no"],
  origin: "jev-tower",
  category: "Developer & interactive",
  order: 40,
} satisfies DemoMeta;
