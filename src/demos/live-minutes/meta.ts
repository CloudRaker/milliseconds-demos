import type { DemoMeta } from "../meta";

export default {
  slug: "live-minutes",
  title: "Live Minutes",
  summary: "Turn a meeting transcript into action items, decisions, open questions and risks as the conversation unfolds.",
  instruction: "Select Start meeting, then follow the notes as each part of the transcript arrives.",
  routes: ["classify", "yes-no"],
  origin: "live-minutes",
  category: "Documents & operations",
  order: 30,
} satisfies DemoMeta;
