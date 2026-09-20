import type { DemoMeta } from "../meta";

export default {
  slug: "log-sentinel",
  title: "Log Sentinel",
  summary: "Find the incident in a wall of logs.",
  instruction: "Start the stream, then hit Inject storm.",
  routes: ["yes-no", "rate", "classify"],
  origin: "log-sentinel",
  category: "Developer & interactive",
  order: 20,
} satisfies DemoMeta;
