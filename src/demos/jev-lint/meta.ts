import type { DemoMeta } from "../meta";

export default {
  slug: "jev-lint",
  title: "Semantic Linter",
  summary: "Find potential injections and hardcoded secrets in sample code, with findings linked to the affected lines.",
  instruction: "Choose a sample file and select Scan file, then open a finding to inspect it.",
  routes: ["yes-no", "classify"],
  origin: "jev-lint",
  category: "Developer & interactive",
  order: 20,
} satisfies DemoMeta;
