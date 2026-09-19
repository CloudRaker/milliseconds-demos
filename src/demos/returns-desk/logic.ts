export const LABELS = {
  return_or_exchange: "return a purchase, refund a product, exchange for another size",
  delivery_status: "parcel tracking, when will my order arrive",
  other: "unrelated or unclear customer request",
};
export const QUESTIONS = ["What is the order number?"];
export type Intent = keyof typeof LABELS;
export type Evidence = { answer: string; start: number; end: number };
export type Reading = { intent: Intent; probability: number; order: Evidence | null; warnings: string[] };
export type Order = { id: string; delivered: string; requested: string; amount: string; condition: string; finalSale: string };
export type Policy = { days: string; ceiling: string; unusedOnly: boolean };
export type Check = { name: string; detail: string; state: "pass" | "missing" | "review" };
export type Decision = { route: "Standard handling" | "Missing information" | "Exception review"; next: string; checks: Check[]; elapsed: number | null };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The API returned an unreadable result. Try again.");
  return value as Record<string, unknown>;
}
function span(value: unknown, text: string, warnings: string[], name: string): Evidence | null {
  const result = object(value);
  if (result.answer === null) return null;
  if (typeof result.answer !== "string" || !result.answer.trim() || !Number.isInteger(result.start) || !Number.isInteger(result.end) || (result.start as number) < 0 || (result.end as number) <= (result.start as number) || (result.end as number) > text.length) {
    warnings.push(`${name}: returned evidence did not match the source and was discarded.`);
    return null;
  }
  let start = result.start as number, end = result.end as number;
  if (text.slice(start, end) !== result.answer) {
    // The API can count Unicode code points; the browser indexes UTF-16 units.
    const points = Array.from(text);
    if (points.slice(start, end).join("") !== result.answer) {
      warnings.push(`${name}: returned evidence did not match the source and was discarded.`);
      return null;
    }
    start = points.slice(0, start).join("").length;
    end = start + result.answer.length;
  }
  return { answer: result.answer, start, end };
}
export function readResponses(classification: unknown, answers: unknown, text: string): Reading {
  const c = object(classification), a = object(answers);
  if (typeof c.label !== "string" || !Object.hasOwn(LABELS, c.label) || typeof c.probability !== "number" || !Number.isFinite(c.probability) || c.probability < 0 || c.probability > 1 || !Array.isArray(a.results) || a.results.length !== 1) throw new Error("The API returned an unexpected result. No route was created. Try again.");
  const warnings: string[] = [];
  const order = span(a.results[0], text, warnings, "Order number");
  return { intent: c.label as Intent, probability: c.probability, order, warnings };
}
export function day(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const n = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value ? n / 86400000 : null;
}
function money(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const n = Number(value) * 100;
  return Number.isSafeInteger(Math.round(n)) ? Math.round(n) : null;
}
export function routeReturn(order: Order, policy: Policy, reading: Reading): Decision {
  const checks: Check[] = [];
  const add = (name: string, state: Check["state"], detail: string) => checks.push({ name, state, detail });
  if (reading.intent !== "return_or_exchange") add("Customer intent", "review", reading.intent === "delivery_status" ? "This is a delivery question. Send to delivery support." : "The request needs a person to identify the next step.");
  else if (reading.probability < 0.8) add("Customer intent", "review", "The model's return/exchange score is below this demo's 0.80 review threshold. Confirm the intent.");
  else add("Customer intent", "pass", "The model reads this as a return or exchange request.");
  if (!order.id.trim() || !reading.order) add("Order match", "missing", "Supply the order ID and a request that names it. The model must find its source evidence.");
  else if (order.id.trim().toLowerCase() !== reading.order.answer.trim().toLowerCase()) add("Order match", "review", `Request names ${reading.order.answer}; supplied order is ${order.id}. Resolve the mismatch.`);
  else add("Order match", "pass", `${order.id} matches the order number found in the request.`);
  const delivered = day(order.delivered), requested = day(order.requested);
  const days = /^\d+$/.test(policy.days) ? Number(policy.days) : NaN;
  const elapsed = delivered !== null && requested !== null ? requested - delivered : null;
  if (!Number.isSafeInteger(days) || days < 0 || days > 365) add("Return window", "missing", "Set a whole-number return window from 0 to 365 days.");
  else if (elapsed === null) add("Return window", "missing", "Provide valid delivery and request dates.");
  else if (elapsed < 0) add("Return window", "review", "The request date is before delivery. Check the dates.");
  else if (elapsed > days) add("Return window", "review", `${elapsed} days after delivery; the policy allows up to ${days} days, inclusive.`);
  else add("Return window", "pass", `${elapsed} days after delivery; within the ${days}-day inclusive window.`);
  const amount = money(order.amount), ceiling = money(policy.ceiling);
  if (amount === null || ceiling === null) add("Value review", "missing", "Provide a valid non-negative order value and review ceiling, with at most two decimal places.");
  else if (amount > ceiling) add("Value review", "review", `Order value $${(amount / 100).toFixed(2)} exceeds the $${(ceiling / 100).toFixed(2)} standard-handling ceiling.`);
  else add("Value review", "pass", `$${(amount / 100).toFixed(2)} is within the $${(ceiling / 100).toFixed(2)} standard-handling ceiling.`);
  if (!["unused", "used", "damaged"].includes(order.condition)) add("Item condition", "missing", "Confirm the item's condition in the supplied order facts.");
  else if (order.condition === "damaged" || (policy.unusedOnly && order.condition !== "unused")) add("Item condition", "review", order.condition === "damaged" ? "Damaged items need an exception review." : "The policy requires an unused item.");
  else add("Item condition", "pass", `Supplied condition: ${order.condition}. Meets the stated policy.`);
  if (!["yes", "no"].includes(order.finalSale)) add("Final-sale status", "missing", "Confirm whether this item was marked final sale.");
  else add("Final-sale status", order.finalSale === "yes" ? "review" : "pass", order.finalSale === "yes" ? "Final-sale items need an exception review." : "The supplied order is not marked final sale.");
  for (const warning of reading.warnings) add("Source evidence", "review", warning);
  // Missing facts take precedence; existing exceptions remain visible in the checklist.
  const route = checks.some(c => c.state === "missing") ? "Missing information" : checks.some(c => c.state === "review") ? "Exception review" : "Standard handling";
  const next = route === "Standard handling" ? "Prepare a return for staff review. This draft does not authorize a refund." : route === "Missing information" ? "Collect the missing facts below before deciding how to handle the request." : "Send this case to a person with the flagged policy checks below.";
  return { route, next, checks, elapsed };
}

export const intentRequest = (text: string) => ({ text, labels: LABELS });
export const evidenceRequest = (text: string) => ({ text, questions: QUESTIONS });
