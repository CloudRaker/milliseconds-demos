import type { DemoMeta } from "../meta";

export default {
  slug: "inbox-blitz",
  title: "Inbox Triage",
  summary: "Find the urgent emails hiding in your inbox.",
  instruction: "Triage the inbox, then open a priority message.",
  routes: ["classify", "yes-no", "rate"],
  origin: "inbox-blitz",
  category: "Customer experience",
  order: 20,
} satisfies DemoMeta;
