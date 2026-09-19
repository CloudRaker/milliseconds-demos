import type { DemoMeta } from "../meta";

export default {
  slug: "judge-sheets",
  title: "Judge Sheets",
  summary: "Add a plain-English column to a spreadsheet and fill its rows with labels, scores or yes/no judgments.",
  instruction: "Enter a column instruction such as Sentiment, select Fill column, then confirm the proposed formula.",
  routes: ["classify", "yes-no", "rate"],
  origin: "judge-sheets",
  category: "Documents & operations",
  order: 10,
} satisfies DemoMeta;
