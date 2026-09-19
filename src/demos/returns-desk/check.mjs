import assert from "node:assert/strict";
import { day, readResponses, routeReturn } from "./logic.ts";
import { DEFAULT_POLICY, EXAMPLES, preview } from "./data.ts";
const order = { ...EXAMPLES[0].order }, reading = preview(0);
const fixture = (name, changes, expected, policy = DEFAULT_POLICY, model = reading) => ({ name, changes, expected, policy, model });
const fixtures = [
  fixture("routine return", {}, "Standard handling"),
  fixture("last inclusive day", { delivered: "2026-08-20" }, "Standard handling"),
  fixture("one day late", { delivered: "2026-08-19" }, "Exception review"),
  fixture("missing delivery date", { delivered: "" }, "Missing information"),
  fixture("invalid calendar date", { delivered: "2026-02-30" }, "Missing information"),
  fixture("request before delivery", { requested: "2026-09-04" }, "Exception review"),
  fixture("ceiling inclusive", { amount: "150.00" }, "Standard handling"),
  fixture("one cent over", { amount: "150.01" }, "Exception review"),
  fixture("missing value is not zero", { amount: "" }, "Missing information"),
  fixture("three decimal places", { amount: "89.001" }, "Missing information"),
  fixture("negative value", { amount: "-1" }, "Missing information"),
  fixture("unknown condition", { condition: "unknown" }, "Missing information"),
  fixture("used item", { condition: "used" }, "Exception review"),
  fixture("used allowed", { condition: "used" }, "Standard handling", { ...DEFAULT_POLICY, unusedOnly: false }),
  fixture("damaged always review", { condition: "damaged" }, "Exception review", { ...DEFAULT_POLICY, unusedOnly: false }),
  fixture("final sale", { finalSale: "yes" }, "Exception review"),
  fixture("final sale unknown", { finalSale: "unknown" }, "Missing information"),
  fixture("order mismatch", { id: "RD-OTHER" }, "Exception review"),
  fixture("absent source order", {}, "Missing information", DEFAULT_POLICY, { ...reading, order: null }),
  fixture("ambiguous intent", {}, "Exception review", DEFAULT_POLICY, { ...reading, probability: .4 }),
  fixture("delivery request", {}, "Exception review", DEFAULT_POLICY, { ...reading, intent: "delivery_status" }),
  fixture("invalid policy", {}, "Missing information", { ...DEFAULT_POLICY, days: "-1" }),
  fixture("missing plus exception", { id: "RD-WRONG", delivered: "" }, "Missing information"),
];
for (const f of fixtures) assert.equal(routeReturn({ ...order, ...f.changes }, f.policy, f.model).route, f.expected, f.name);
assert.equal(day("2024-03-11") - day("2024-03-09"), 2, "UTC day math ignores DST");
assert.equal(day("2024-02-29") + 1, day("2024-03-01"));
assert.equal(day("2025-02-29"), null);
const c = { label: "return_or_exchange", probability: .99 };
const response = (answer, start, end) => ({ results: [{ answer, start, end }] });
assert.deepEqual(readResponses(c, response("RD-1", 2, 6), "📦 RD-1").order, { answer: "RD-1", start: 3, end: 7 }, "code-point offsets normalize to UTF-16");
assert.equal(readResponses(c, response("RD-2", 0, 4), "RD-1").order, null, "invented evidence discarded");
assert.equal(readResponses(c, response(null, null, null), "No ID").order, null);
assert.throws(() => readResponses({ label: "made_up", probability: .99 }, response(null, null, null), "text"));
assert.throws(() => readResponses(c, { results: [] }, "text"));
assert.throws(() => readResponses({ ...c, probability: NaN }, response(null, null, null), "text"));
for (let i = 0; i < EXAMPLES.length; i++) {
  const p = preview(i); if (p.order) assert.equal(EXAMPLES[i].text.slice(p.order.start, p.order.end), p.order.answer);
}
console.log(`${fixtures.length} routing fixtures + calendar, response-shape and source-offset checks passed.`);
