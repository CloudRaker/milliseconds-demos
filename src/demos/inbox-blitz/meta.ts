import type { DemoMeta } from "../meta";

export default {
  slug: "inbox-blitz",
  title: "Inbox Triage",
  summary: "Organize support emails by urgency and intent, then find messages that match a label you describe.",
  instruction: "Select Triage inbox, then open a message in Priority or Needs review.",
  routes: ["classify", "yes-no", "rate"],
  origin: "inbox-blitz",
  category: "Customer experience",
  order: 20,
} satisfies DemoMeta;
