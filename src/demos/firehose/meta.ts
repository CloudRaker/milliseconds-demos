import type { DemoMeta } from "../meta";

export default {
  slug: "firehose",
  title: "Chat Firehose",
  summary: "A very busy chat. A much shorter moderation queue.",
  instruction: "Start the stream and inspect a flagged message.",
  routes: ["classify", "rate"],
  origin: "jev-firehose",
  category: "Customer experience",
  order: 20,
} satisfies DemoMeta;
