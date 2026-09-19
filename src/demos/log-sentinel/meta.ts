import type { DemoMeta } from "../meta";

export default {
  slug: "log-sentinel",
  title: "Log Sentinel",
  summary: "Find actionable errors in a stream of service logs and group related events into incidents.",
  instruction: "Select Start log stream, then Inject storm to watch a payments incident develop.",
  routes: ["yes-no", "rate", "classify"],
  origin: "log-sentinel",
  category: "Developer & interactive",
  order: 20,
} satisfies DemoMeta;
