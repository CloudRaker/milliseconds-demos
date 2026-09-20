import type { DemoMeta } from "../meta";

export default {
  slug: "live-minutes",
  title: "Live Minutes",
  summary: "The meeting keeps talking. The action items write themselves.",
  instruction: "Start the meeting and follow the notes.",
  routes: ["classify", "yes-no"],
  origin: "live-minutes",
  category: "Documents & operations",
  order: 30,
} satisfies DemoMeta;
