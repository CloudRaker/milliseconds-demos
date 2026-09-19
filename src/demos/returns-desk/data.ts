import type { Order, Policy, Reading } from "./logic.ts";
export const DEFAULT_POLICY: Policy = { days: "30", ceiling: "150", unusedOnly: true };
const base: Order = { id: "RD-1042", delivered: "2026-09-05", requested: "2026-09-19", amount: "89.00", condition: "unused", finalSale: "no" };
export const EXAMPLES = [
  { name: "Routine return", text: "Hello, I would like to return order RD-1042. The jacket is too small. It is unworn with its tags attached.", order: base, intent: "return_or_exchange", id: "RD-1042" },
  { name: "Outside the window", text: "I would like to return order RD-2088. The shoes are too small and have not been worn.", order: { ...base, id: "RD-2088", delivered: "2026-08-01", amount: "120.00" }, intent: "return_or_exchange", id: "RD-2088" },
  { name: "Missing facts", text: "Can I return the lamp I bought? It does not fit my desk.", order: { ...base, id: "", delivered: "", amount: "", condition: "unknown", finalSale: "unknown" }, intent: "return_or_exchange", id: "" },
  { name: "Order mismatch", text: "Please return order RD-3001. The coat is too large. It is unused.", order: { ...base, id: "RD-3002" }, intent: "return_or_exchange", id: "RD-3001" },
] as const;
export function preview(index: number): Reading {
  const example = EXAMPLES[index];
  const evidence = (answer: string) => answer ? { answer, start: example.text.indexOf(answer), end: example.text.indexOf(answer) + answer.length } : null;
  return { intent: example.intent, probability: 1, order: evidence(example.id), warnings: [] };
}
