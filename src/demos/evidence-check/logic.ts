export interface VerifyResult { matches: boolean; probability: number; found: string[] }
export type Verdict = "supported" | "different" | "missing" | "review" | "empty";
export interface Evidence { text: string; start: number; end: number }
export interface Check { verdict: Verdict; evidence: Evidence[]; result: VerifyResult; reason: string }
export const REVIEW_THRESHOLD = 0.9;
const canonical = (value: string) => value.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
export function parseVerify(value: unknown): VerifyResult {
  const r = value as Partial<VerifyResult> | null;
  if (!r || typeof r.matches !== "boolean" || typeof r.probability !== "number" || !Number.isFinite(r.probability) || r.probability < 0 || r.probability > 1 || !Array.isArray(r.found) || !r.found.every(v => typeof v === "string")) throw new Error("The API returned an invalid field check. Try again.");
  return r as VerifyResult;
}
export function assess(source: string, value: string, raw: unknown): Check {
  const result = parseVerify(raw);
  const evidence = result.found.flatMap(text => {
    const start = text ? source.indexOf(text) : -1;
    return start < 0 ? [] : [{ text, start, end: start + text.length }];
  });
  const finish = (verdict: Verdict, reason: string): Check => ({ verdict, reason, evidence, result });
  if (!value.trim()) return finish("empty", "Enter a proposed value before checking this field.");
  if (!result.found.length) return finish("missing", "The model found no value for this field. This does not prove the source omits it.");
  if (evidence.length !== result.found.length) return finish("review", "Some returned wording could not be located in this source. Inspect the raw response.");
  const exact = evidence.some(e => canonical(e.text) === canonical(value) && canonical(value).length > 0);
  if (result.matches && exact && result.probability >= REVIEW_THRESHOLD) return finish("supported", "The returned wording matches your value and passes this demo’s 0.90 span-confidence rule.");
  if (!result.matches && !exact) return finish("different", "The model returned different wording. Review whether it is the right field; this is not proof of a contradiction.");
  return finish("review", result.matches && !exact ? "The API accepted a partial or formatted match. This demo requires a complete value match; inspect the source." : "The match is uncertain or inconsistent. Inspect the source before using this value.");
}
export const fields = [
  { name: "customer", label: "Customer", description: "The customer company named in the service agreement" },
  { name: "annual_fee", label: "Annual fee", description: "The annual service fee payable, including currency" },
  { name: "renewal_date", label: "Renewal date", description: "The date the agreement renews" },
  { name: "cancellation_notice", label: "Cancellation notice", description: "The number of days of cancellation notice required" },
];
export const sampleSource = "SERVICE AGREEMENT\n\nCustomer: Northstar Design Ltd.\nAnnual fee: USD 18,000.\nRenewal date: 2027-03-01.\n\nServices include hosting and priority support.";
export const sampleValues = ["Northstar Design Ltd.", "USD 24,000", "2027-04-01", "60 days"];
// Curated examples, never counted as API responses or live usage.
export const sampleResults: VerifyResult[] = [
  { matches: true, probability: 1, found: ["Northstar Design Ltd."] },
  { matches: false, probability: 0, found: ["USD 18,000"] },
  { matches: false, probability: 0, found: ["2027-03-01"] },
  { matches: false, probability: 0, found: [] },
];
export const labels: Record<Verdict, string> = { supported: "Supported", different: "Different value", missing: "Not found", review: "Needs review", empty: "Missing value" };

export const verificationRequest = (text: string, field: { name: string; description: string }, value: string) => ({ text, field: { name: field.name, description: field.description }, value });
