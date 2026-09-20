import type { DemoMeta } from "../meta";

export default {
  slug: "dispatch",
  title: "Dispatch Console",
  summary: "Route incidents and response units across a simulated city.",
  instruction: "Run the stream, then select an incident.",
  routes: ["classify", "rate", "yes-no"],
  origin: "jev-dispatch",
  category: "Documents & operations",
  order: 10,
} satisfies DemoMeta;
