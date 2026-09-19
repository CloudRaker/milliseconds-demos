import type { DemoMeta } from "../meta";

export default {
  slug: "commit-sentry",
  title: "Commit Sentry",
  summary: "Review a staged code change for exposed secrets, risky edits and a misleading commit message.",
  instruction: "Select Run check, then open a file or finding to see the affected lines.",
  routes: ["yes-no", "classify", "rate"],
  origin: "commit-sentry",
  category: "Developer & interactive",
  order: 10,
} satisfies DemoMeta;
