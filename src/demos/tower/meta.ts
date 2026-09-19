import type { DemoMeta } from "../meta";

export default {
  slug: "tower",
  title: "Air Traffic Tower",
  summary: "Watch a controller resolve predicted aircraft conflicts by choosing headings, altitudes and speeds.",
  instruction: "Select Run, then watch the radar and inspect the instructions issued to aircraft.",
  routes: ["classify", "rate", "yes-no"],
  origin: "jev-tower",
  category: "Developer & interactive",
  order: 40,
} satisfies DemoMeta;
