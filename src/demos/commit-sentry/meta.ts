import type { DemoMeta } from "../meta";

export default {
  slug: "commit-sentry",
  title: "Commit Sentry",
  summary: "Catch exposed secrets and risky edits before a commit.",
  instruction: "Run check, then open a finding.",
  routes: ["yes-no", "classify", "rate"],
  origin: "commit-sentry",
  category: "Developer & interactive",
  order: 10,
} satisfies DemoMeta;
