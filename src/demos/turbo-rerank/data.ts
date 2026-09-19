/**
 * Seed data for the turbo-rerank demo, copied from the Jev experiment: the deterministic
 * 598-passage Northwind corpus, the in-browser BM25 index, and the 40 hand-labelled
 * benchmark queries. Nothing here touches the network.
 */
import { Bm25Index } from "./bm25.ts";
import { buildCorpus } from "./corpus/build.ts";
import type { BenchQuery, DocKind } from "./types.ts";

export const PASSAGES = buildCorpus();
export const BY_ID = new Map(PASSAGES.map((p) => [p.id, p]));

let index: Bm25Index | null = null;
/** Built on first search so the page paints before the 598 passages are indexed. */
export function bm25(): Bm25Index {
  index ??= new Bm25Index(PASSAGES);
  return index;
}

export const KINDS: Record<DocKind, string> = {
  handbook: "Engineering handbook",
  hr: "People & policies",
  api: "API reference",
  runbook: "Runbooks",
  architecture: "Architecture",
};

/**
 * The judgment. One short declarative naming the query; the passage is the text.
 * /rate and /classify both read the passage on its own and ignore a query pasted above it,
 * so the query has to live in the statement. See the notes on the page.
 */
export function statementFor(query: string): string {
  return `This passage answers the question: ${query}`;
}

export const hints = {
  when_true: "The passage states the specific information the question asks for.",
  when_false: "The passage is about something else, or only shares words with the question.",
};

/**
 * Below this the top candidate is not treated as an answer and the page says so.
 * Measured on the 40-query benchmark: a correct reranked #1 never falls below 0.09, and a
 * question the corpus cannot answer tops out at 0.002.
 */
export const NO_ANSWER = 0.02;

/**
 * The original's four relevance levels, kept as bands over the answer probability, with the
 * boundaries set from the same 40-query run: correct #1 hits land at 0.09, 0.14, 0.15, 0.30,
 * 0.49 and then 0.75 upwards. A low probability means low confidence, not "off topic", so the
 * third band says so instead of calling a correct hit tangential.
 */
export const BANDS = [
  { min: 0.7, label: "answers it", tone: "good" },
  { min: 0.25, label: "partly answers", tone: "purple" },
  { min: NO_ANSWER, label: "weak signal", tone: "warn" },
  { min: 0, label: "off topic", tone: "" },
] as const;

export function band(p: number) {
  return BANDS.find((b) => p >= b.min) ?? BANDS[BANDS.length - 1];
}

export const EXAMPLES = [
  { label: "Taking parental leave", query: "having a baby soon, how many weeks can I take off" },
  { label: "Log retention", query: "how long do we keep logs" },
  { label: "On-call compensation", query: "on-call pay" },
  { label: "Authentication failures", query: "spike in 401s from the auth gateway" },
  { label: "Production access", query: "how do I get production access" },
  { label: "The office Wi-Fi password", query: "what is the office wifi password" },
];

/**
 * Hand-labelled query to target-passage pairs, written the way people type into a docs search
 * box. `paraphrase` marks the ones that share almost no content words with the target.
 */
export const BENCH_QUERIES: BenchQuery[] = [
  { query: "how much parental leave do I get", target: "hr/parental/entitlement" },
  { query: "having a baby soon, how many weeks can I take off", target: "hr/parental/entitlement", paraphrase: true },
  { query: "how far ahead do I need to book time off", target: "hr/time-off/requesting", paraphrase: true },
  { query: "working from abroad", target: "hr/remote/policy", paraphrase: true },
  { query: "can I expense drinks at a team dinner", target: "hr/expenses/per-diem", paraphrase: true },
  { query: "when does my first chunk of stock vest", target: "hr/compensation/equity", paraphrase: true },
  { query: "what do I get paid when I leave", target: "hr/leaving/final-pay", paraphrase: true },
  { query: "money for courses and conferences each year", target: "hr/performance/learning-budget", paraphrase: true },
  { query: "does the company match retirement contributions", target: "hr/compensation/retirement", paraphrase: true },
  { query: "bonus for recommending a friend who gets hired", target: "hr/compensation/referral", paraphrase: true },
  { query: "how many days off when a family member dies", target: "hr/time-off/bereavement", paraphrase: true },
  { query: "receipt threshold for expenses", target: "hr/expenses/reimbursement" },
  { query: "extended paid break after five years", target: "hr/sabbatical/sabbatical", paraphrase: true },
  { query: "paid leave to be a witness in court", target: "hr/time-off/jury-duty", paraphrase: true },
  { query: "undo a bad production release", target: "handbook/deploys/rollback", paraphrase: true },
  { query: "can we deploy during the holidays", target: "handbook/deploys/freeze", paraphrase: true },
  { query: "deploying after 5pm", target: "handbook/deploys/windows", paraphrase: true },
  { query: "what happens if the canary aborts", target: "handbook/deploys/canary" },
  { query: "how quickly must on-call acknowledge a page", target: "handbook/on-call/response-times" },
  { query: "how do I get production access", target: "handbook/access/requests" },
  { query: "accidentally pushed a credential to github", target: "handbook/secrets/leak", paraphrase: true },
  { query: "how often are database passwords rotated", target: "handbook/secrets/rotation", paraphrase: true },
  { query: "my phone was stolen", target: "handbook/laptops/lost-device" },
  { query: "test passes when I rerun it", target: "handbook/ci/flaky-tests", paraphrase: true },
  { query: "how long do we keep logs", target: "handbook/observability/log-retention", paraphrase: true },
  { query: "trace sampling rate in production", target: "handbook/observability/tracing" },
  { query: "how long are idempotency keys stored", target: "handbook/api-design/idempotency" },
  { query: "how many reviewers does a PR need", target: "handbook/code-review/approvals", paraphrase: true },
  { query: "which migrations need a schema review", target: "handbook/databases/schema-review" },
  { query: "how far back can we restore the ledger database", target: "handbook/databases/backups", paraphrase: true },
  { query: "adding an index to a huge table without locking it", target: "handbook/databases/locking", paraphrase: true },
  { query: "who owns a service", target: "handbook/architecture/service-ownership" },
  { query: "what makes an incident SEV1", target: "handbook/incidents/severity" },
  { query: "on-call pay", target: "handbook/on-call/compensation", paraphrase: true },
  { query: "removing old feature flags", target: "handbook/feature-flags/cleanup" },
  { query: "sudden surge in text message spend", target: "notify-hub/runbook/notify-hub-sms-cost-spike", paraphrase: true },
  { query: "ledger entries falling behind", target: "ledger-api/runbook/ledger-entry-lag-high" },
  { query: "a product shows negative stock", target: "inventory-service/runbook/inventory-oversell", paraphrase: true },
  { query: "spike in 401s from the auth gateway", target: "auth-gateway/runbook/auth-gateway401spike" },
  { query: "ledger api requests per minute limit", target: "ledger-api/api/rate-limits" },
];

/** Keep request chunks identical for the demo and server-owned examples. */
export function rerankBodies(query: string, rows: { text: string }[]) {
  const bodies = [];
  for (let i = 0; i < rows.length; i += 32) {
    bodies.push({ texts: rows.slice(i, i + 32).map((row) => row.text), statement: statementFor(query), ...hints });
  }
  return bodies;
}
