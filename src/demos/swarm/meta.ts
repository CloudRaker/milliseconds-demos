import type { DemoMeta } from "../meta";

export default {
  slug: "swarm",
  title: "Agent Swarm",
  summary: "Watch up to 32 agents decide when to flee, chase food or spend a speed boost in a shared arena.",
  instruction: "Select Run the swarm, then follow the latest decisions beside the arena.",
  routes: ["yes-no"],
  origin: "jev-swarm",
  category: "Developer & interactive",
  order: 40,
} satisfies DemoMeta;
