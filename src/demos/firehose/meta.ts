import type { DemoMeta } from "../meta";

export default {
  slug: "firehose",
  title: "Chat Firehose",
  summary: "Find messages that need a moderator’s attention in a fast-moving chat stream.",
  instruction: "Start the stream, then inspect a flagged message or adjust a moderation threshold.",
  routes: ["classify", "rate"],
  origin: "jev-firehose",
  category: "Customer experience",
  order: 20,
} satisfies DemoMeta;
