import type { DemoMeta } from "../meta";

export default {
  slug: "judge-sheets",
  title: "Judge Sheets",
  summary: "Give your spreadsheet a column that understands words.",
  instruction: "Name a column, hit Fill column, and confirm the formula.",
  routes: ["classify", "yes-no", "rate"],
  origin: "judge-sheets",
  category: "Documents & operations",
  order: 10,
} satisfies DemoMeta;
