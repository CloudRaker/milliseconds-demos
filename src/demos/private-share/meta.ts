import type { DemoMeta } from "../meta";
export default {
  slug: "private-share",
  title: "Private Share",
  summary: "Keep the story. Lose the names and emails.",
  instruction: "Detect personal details, then choose what to redact.",
  routes: ["entities"],
  category: "Documents & operations",
  order: 5,
} satisfies DemoMeta;
