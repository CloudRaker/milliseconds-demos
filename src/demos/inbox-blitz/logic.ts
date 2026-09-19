// Pure triage logic, copied unchanged from the Jev experiment's src/lib/{priority,rules,labels}.ts.
// Nothing here calls the network: priority scoring, lane routing, the keyword-rule
// baseline and the intent-label set operations all run in the browser.
import type { Category, Email, Judgment } from "./data";

/** One email judged against a free-text intent ("customers threatening to cancel"). */
export interface MatchResult {
  id: string;
  /** Probability that the email fits the intent, 0..1. */
  match: number;
}

/** Slider-driven weights. All ranking is plain arithmetic over the raw judgments. */
export interface Weights {
  urgency: number;
  sentiment: number;
  churn: number;
  refund: number;
  phishing: number;
  needsReply: number;
  spamPenalty: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  urgency: 40,
  sentiment: 20,
  churn: 25,
  refund: 10,
  phishing: 30,
  needsReply: 15,
  spamPenalty: 40,
};

export const WEIGHT_LABELS: Record<keyof Weights, string> = {
  urgency: "Urgency",
  sentiment: "Anger",
  churn: "Churn risk",
  refund: "Refund ask",
  phishing: "Phishing",
  needsReply: "Needs reply",
  spamPenalty: "Spam penalty",
};

/** Below this the category is not trusted; the email goes to the human lane. */
export const HUMAN_CONFIDENCE = 0.7;

/**
 * Priority in [0, ~100]. Urgency/sentiment are 0..3 scores, normalised to 0..1;
 * the nouls are already 0..1 probabilities.
 */
export function priority(j: Judgment, w: Weights): number {
  const isSpam = j.category === "spam_marketing" ? 1 : 0;
  return (
    (j.urgency / 3) * w.urgency +
    (j.sentiment / 3) * w.sentiment +
    j.mentionsChurnOrCancel * w.churn +
    j.asksForRefund * w.refund +
    j.isPhishingOrScam * w.phishing +
    j.needsReply * w.needsReply -
    isSpam * (1 - j.isPhishingOrScam) * w.spamPenalty
  );
}

export function needsHuman(j: Judgment): boolean {
  return j.categoryConfidence < HUMAN_CONFIDENCE;
}

export type Lane = "priority" | "human" | "spam" | "fyi";

/** Which lane an email lands in once judged. Pure policy, easy to change. */
export function lane(j: Judgment): Lane {
  // ponytail: the phishing probability does NOT route. On this model build it reads
  // the gift-card CEO scam (m293) at 6% and a loud marketing blast (m300) at 76%,
  // so routing on it hijacked the Priority lane with false positives. It stays an
  // advisory number on the row. Re-add the route only if a build separates them.
  if (needsHuman(j)) return "human";
  if (j.category === "spam_marketing") return "spam";
  if (j.needsReply < 0.5 && j.urgency < 1) return "fyi";
  return "priority";
}

export function rank<T extends { judgment?: Judgment; receivedAt: string }>(items: T[], w: Weights): T[] {
  return [...items].sort((a, b) => {
    const pa = a.judgment ? priority(a.judgment, w) : -Infinity;
    const pb = b.judgment ? priority(b.judgment, w) : -Infinity;
    if (pb !== pa) return pb - pa;
    return b.receivedAt.localeCompare(a.receivedAt);
  });
}
/**
 * The "old way": a reasonable, hand-tuned keyword/regex classifier of the kind
 * most support inboxes actually run. It is deterministic and instantaneous, and
 * it is wrong in exactly the ways you would expect (sarcasm, negation, quoted
 * history, marketing copy that borrows urgent words).
 */
export interface RuleVerdict {
  category: Category;
  needsReply: boolean;
  urgency: number; // 0..3
  sentiment: number; // 0..3
  isPhishingOrScam: boolean;
  mentionsChurnOrCancel: boolean;
  asksForRefund: boolean;
}

const CATEGORY_RULES: Array<[Category, RegExp]> = [
  ["security", /\b(hacked|compromised|breach|vulnerab|2fa|two-factor|suspicious (login|sign-?in)|unusual activity|cve|malware|phish)/i],
  ["legal_privacy", /\b(gdpr|ccpa|subpoena|legal (team|counsel|notice)|attorney|lawyer|data (deletion|erasure|request)|delete (my|all my) data|dpa\b|terms of service|privacy)/i],
  ["billing", /\b(invoice|charge[ds]?|billing|payment|refund|receipt|subscription|pric(e|ing)|vat|credit card|overcharg)/i],
  ["bug", /\b(bug|broken|error|crash|not (working|loading|syncing)|doesn'?t work|500|502|503|timeout|down\b|fails?|blank (page|screen)|locked out|can'?t (log ?in|access))/i],
  ["sales_lead", /\b(quote|pricing for|demo|upgrade|enterprise plan|seats|procurement|contract|evaluat)/i],
  ["feature_request", /\b(feature request|would (love|be great)|any plans|roadmap|suggestion|please add|shortcut)/i],
  ["spam_marketing", /\b(unsubscribe|% off|coupon|flash sale|webinar|register (free|now)|limited (time|slots)|exclusive|seo|10x|book a (call|meeting)|our team of|newsletter|this week:)/i],
  ["internal", /\b(standup|1:1|offsite|payroll|expense report|all-hands|hr\b|laptop|rota|team,)/i],
];

export function classifyRules(email: Email): RuleVerdict {
  const text = `${email.subject}\n${email.body}`;
  const fromOurDomain = /@(updates\.|monitor\.)?northwind\.cloud$/i.test(email.fromEmail);

  let category: Category = fromOurDomain ? "internal" : "other";
  if (!fromOurDomain) {
    for (const [cat, re] of CATEGORY_RULES) {
      if (re.test(text)) {
        category = cat;
        break;
      }
    }
  }

  const urgentWords = (text.match(/\b(urgent|asap|immediately|right now|critical|emergency|p1|outage|down\b|today|deadline|now!)/gi) ?? []).length;
  const caps = (text.match(/\b[A-Z]{4,}\b/g) ?? []).length;
  const bangs = (text.match(/!/g) ?? []).length;
  let urgency = 0;
  if (/\bnot urgent\b|no rush|whenever you have a moment|not important|low priority/i.test(text)) urgency = 0;
  else if (urgentWords >= 2 || /\b(urgent|asap|emergency|p1|right now)\b/i.test(text)) urgency = 3;
  else if (urgentWords === 1 || /\btoday\b/i.test(text)) urgency = 2;
  else if (/\bthis week|by friday|soon\b/i.test(text)) urgency = 1;

  const angryWords = (text.match(/\b(unacceptable|ridiculous|furious|disgusted|terrible|worst|useless|incompetent|pathetic|joke|angry|frustrat|disappoint|not good enough)/gi) ?? []).length;
  const niceWords = (text.match(/\b(thanks?|thank you|great|love|wonderful|appreciate|awesome|fantastic|kudos)/gi) ?? []).length;
  let sentiment = 1;
  if (angryWords >= 2 || (angryWords >= 1 && (caps >= 2 || bangs >= 2))) sentiment = 3;
  else if (angryWords >= 1 || caps >= 3 || bangs >= 3) sentiment = 2;
  else if (niceWords >= 1) sentiment = 0;

  const isPhishingOrScam =
    /\b(verify your (account|mailbox|identity)|password|click (here|the link)|suspended|gift ?cards?|wire transfer|bank details|redelivery fee|sign in to (view|continue)|update your (billing|payment))/i.test(text) ||
    /(paypa1|amaz0n|micros0ft|netfIix|-secure|-verify|-alerts?)\./i.test(email.fromEmail);

  const mentionsChurnOrCancel = /\b(cancel|churn|switch(ing)? to|leaving|competitor|terminate|close (my|our) account)/i.test(text);
  const asksForRefund = /\brefund|money back|charge ?back|reimburse/i.test(text);

  const needsReply = !/\b(unsubscribe|no[- ]reply|automated message|do not reply|this week:)/i.test(text) && !/^(no-?reply|noreply|alerts|changelog|promo|hello|events|tracking|service)@/i.test(email.fromEmail) && category !== "spam_marketing";

  return { category, needsReply, urgency, sentiment, isPhishingOrScam, mentionsChurnOrCancel, asksForRefund };
}

export type Dimension = "category" | "needsReply" | "urgency" | "sentiment" | "isPhishingOrScam" | "mentionsChurnOrCancel" | "asksForRefund";
export const DIMENSIONS: Dimension[] = ["category", "needsReply", "urgency", "sentiment", "isPhishingOrScam", "mentionsChurnOrCancel", "asksForRefund"];

/** Which dimensions the rules disagree with Jev on. Score dimensions count as a disagreement when off by ≥ 1 level. */
export function disagreements(rule: RuleVerdict, j: Judgment): Dimension[] {
  const out: Dimension[] = [];
  if (rule.category !== j.category) out.push("category");
  if (rule.needsReply !== j.needsReply >= 0.5) out.push("needsReply");
  if (Math.abs(rule.urgency - j.urgency) >= 1) out.push("urgency");
  if (Math.abs(rule.sentiment - j.sentiment) >= 1) out.push("sentiment");
  if (rule.isPhishingOrScam !== j.isPhishingOrScam >= 0.5) out.push("isPhishingOrScam");
  if (rule.mentionsChurnOrCancel !== j.mentionsChurnOrCancel >= 0.5) out.push("mentionsChurnOrCancel");
  if (rule.asksForRefund !== j.asksForRefund >= 0.5) out.push("asksForRefund");
  return out;
}

export interface Agreement {
  compared: number;
  perDimension: Record<Dimension, number>; // fraction agreeing, 0..1
  overall: number; // fraction of (email, dimension) pairs agreeing
  fullyAgree: number; // emails where all 7 agree
}

export function agreement(pairs: Array<{ rule: RuleVerdict; judgment: Judgment }>): Agreement {
  const perDimension = Object.fromEntries(DIMENSIONS.map((d) => [d, 0])) as Record<Dimension, number>;
  let agreeCells = 0;
  let fullyAgree = 0;
  for (const { rule, judgment } of pairs) {
    const dis = disagreements(rule, judgment);
    if (dis.length === 0) fullyAgree++;
    for (const d of DIMENSIONS) {
      if (!dis.includes(d)) {
        perDimension[d]++;
        agreeCells++;
      }
    }
  }
  const n = pairs.length;
  for (const d of DIMENSIONS) perDimension[d] = n ? perDimension[d] / n : 0;
  return { compared: n, perDimension, overall: n ? agreeCells / (n * DIMENSIONS.length) : 0, fullyAgree };
}

/** An email is labelled when Jev's match probability is at least this. */
export const MATCH_THRESHOLD = 0.5;
/** Matches below this are shown as "borderline" so an operator can eyeball them. */
export const SURE_THRESHOLD = 0.8;
export const MAX_INTENT_CHARS = 200;

export type LabelPhase = "queued" | "running" | "done" | "error";

/** A user-defined label: a free-text intent plus every email's judgment against it. */
export interface IntentLabel {
  id: string;
  /** What the operator typed, e.g. "customers threatening to cancel". */
  intent: string;
  /** Short display name derived from the intent. */
  name: string;
  color: string;
  phase: LabelPhase;
  matches: Map<string, MatchResult>;
  judged: number;
  total: number;
  elapsedMs: number;
  fatal?: string;
}

/** Label palette, restyled for the dark surface. */
export const LABEL_COLORS = ["#6d4aff", "#37b7c3", "#e2a33c", "#e0657f", "#5fb87a", "#b07ae8", "#d97a4a", "#4a86e8"];

export function pickColor(index: number): string {
  return LABEL_COLORS[index % LABEL_COLORS.length];
}

const FILLER = /^(emails?|messages?|mail|anything|anyone|everything|everyone|all|any|show|find|filter|label|people|customers?|senders?|someone|somebody|that|who|which|where|from|are|is|about|me)\s+/i;

/** "Emails from customers who are threatening to cancel" → "Threatening to cancel". */
export function labelName(intent: string, max = 40): string {
  let s = intent.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "");
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(FILLER, "");
  }
  if (!s) s = intent.trim().replace(/[.!?]+$/, "");
  s = s ? s[0].toUpperCase() + s.slice(1) : intent.trim();
  if (s.length > max) {
    const cut = s.slice(0, max);
    s = (cut.includes(" ") ? cut.slice(0, cut.lastIndexOf(" ")) : cut) + "…";
  }
  return s;
}

export function isMatch(r: MatchResult | undefined, threshold = MATCH_THRESHOLD): boolean {
  return r !== undefined && r.match >= threshold;
}

export interface LabelSummary {
  judged: number;
  matched: number;
  sure: number;
  borderline: number;
  rejected: number;
  /** Ten equal-width buckets of the match probability, 0.0–0.1 … 0.9–1.0. */
  histogram: number[];
}

export function summarize(matches: Iterable<MatchResult>): LabelSummary {
  const s: LabelSummary = { judged: 0, matched: 0, sure: 0, borderline: 0, rejected: 0, histogram: Array<number>(10).fill(0) };
  for (const r of matches) {
    s.judged++;
    s.histogram[Math.min(9, Math.floor(r.match * 10))]++;
    if (r.match >= SURE_THRESHOLD) {
      s.matched++;
      s.sure++;
    } else if (r.match >= MATCH_THRESHOLD) {
      s.matched++;
      s.borderline++;
    } else s.rejected++;
  }
  return s;
}

/** Ids that match every one of the given labels (AND). Unjudged emails never match. */
export function intersect(ids: readonly string[], labels: readonly IntentLabel[], threshold = MATCH_THRESHOLD): string[] {
  if (labels.length === 0) return [...ids];
  return ids.filter((id) => labels.every((l) => isMatch(l.matches.get(id), threshold)));
}

/** Ids not yet ruled out: every label either still has to judge the email or matched it. */
export function pending(ids: readonly string[], labels: readonly IntentLabel[], threshold = MATCH_THRESHOLD): string[] {
  return ids.filter((id) =>
    labels.every((l) => {
      const r = l.matches.get(id);
      return r === undefined || r.match >= threshold;
    }),
  );
}

/** Highest combined match first (product of probabilities), ties keep input order. */
export function sortByMatch<T extends { id: string }>(rows: readonly T[], labels: readonly IntentLabel[]): T[] {
  if (labels.length === 0) return [...rows];
  const score = (id: string) => labels.reduce((acc, l) => acc * (l.matches.get(id)?.match ?? 0), 1);
  return rows
    .map((r, i) => ({ r, i, s: score(r.id) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.r);
}

export const SUGGESTED_INTENTS = [
  "customers threatening to cancel",
  "someone asking for a refund",
  "production is down or broken for them",
  "sales leads asking for pricing or a demo",
  "phishing or a scam",
  "GDPR or data deletion requests",
  "sarcastic or passive-aggressive tone",
  "legitimate security alerts from a vendor",
  "a coworker asking me to do something",
  "newsletters I can ignore",
];


// ---------------------------------------------------------------------------
// The API mapping. The Jev experiment asked one model seven questions about one
// email in one request. decision-machine-1 turns that inside out: each call
// carries 32 emails, and the seven questions become four calls per batch.
//
// Every statement, label and scale level below was tuned against the 20 trap
// fixtures with src/demos/inbox-blitz/smoke.mjs, which scores the category answer
// against the original experiment's own recorded answers. Findings that drove it:
//  * `when_true` / `when_false` hints on /yes-no push almost every email to
//    true on this model build, so the statements run bare and the wording
//    carries the nuance instead. The bare score separates cleanly (a refund ask
//    reads 0.99, a refund named in a newsletter reads 0.12).
//  * /classify and /rate answer well when each description names the case in
//    plain words and no description is a catch-all list of nouns.
// ---------------------------------------------------------------------------

/**
 * /classify labels, scored against the original experiment's recorded answers on all
 * 20 traps with smoke.mjs. Three things moved the score from 5/20 to 12/20:
 *  * The label NAME is a phrase describing the sender, not the enum key. Naming the
 *    nine labels `billing`…`other` scores 5/20; `internal` then acts as a catch-all
 *    and swallows every external sender (the CEO scam m293 landed there at 97%).
 *  * Each description says what the SENDER wants, not which nouns the email contains.
 *  * The ORDER is load-bearing on this model build: whichever label sits second to
 *    last absorbs the mail the model cannot place. `other` is parked there on purpose,
 *    so a miss lands in the honest residual with low confidence and the Needs-review
 *    lane picks it up. Moving `internal` or `spam_marketing` into that slot costs
 *    2-6 traps and turns quiet misses into confident ones. Re-measure after any edit.
 */
const CATEGORY_LABEL_SPEC: Array<[Category, string, string]> = [
  ["billing", "A question about our invoice", "They ask about or dispute money we charged: an invoice, a duplicate charge, a price change, a receipt or a refund"],
  ["bug", "A customer reports our product misbehaving", "It is broken, erroring, down or slow for them, a page will not load, an export comes back empty, or their records vanished"],
  ["feature_request", "A customer wants a capability we lack", "They ask us to add something our product cannot do yet"],
  ["sales_lead", "A prospect wants to buy", "They ask for a price, a quote, a demo, an upgrade or the right person to talk to"],
  ["security", "Someone broke into an account", "A password was stolen, or someone signed in to their account who should not have"],
  ["legal_privacy", "A legal or privacy demand", "They invoke a right: erase everything you hold on me, GDPR, CCPA, a subpoena or a lawyer"],
  ["spam_marketing", "Bulk mail nobody asked for", "A stranger pitching their own product, a stranger warning about a problem in order to sell the fix, a weekly digest or product-update blast, or a scam impersonating a person or a brand"],
  ["other", "None of the above", "A thank-you with nothing to do, a thread already resolved, an escalation about how we handled a ticket, or mail sent to the wrong address"],
  ["internal", "One employee writing to another", "Both the writer and the reader are on our own staff, and the subject is a meeting, payroll, hiring or office logistics"],
];

/** What goes on the wire: {label name: description}. Order is preserved and matters. */
export const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(CATEGORY_LABEL_SPEC.map(([, name, desc]) => [name, desc]));

const LABEL_TO_CATEGORY = Object.fromEntries(CATEGORY_LABEL_SPEC.map(([cat, name]) => [name, cat])) as Record<string, Category>;

/** Map the label the API returns back to the Category the rest of the demo speaks. */
export function toCategory(label: string): Category {
  return LABEL_TO_CATEGORY[label] ?? "other";
}

/** The four boolean questions, sent as one /yes-no call: 32 texts x 4 statements. */
export const STATEMENTS = {
  needsReply: "This email needs a reply from a person.",
  isPhishingOrScam: "The sender wants the reader to click a link, pay an invoice or hand over a login.",
  mentionsChurnOrCancel: "The sender is cancelling or moving to another vendor.",
  asksForRefund: "The sender asks us to refund money they paid.",
} satisfies Record<string, string>;

export const STATEMENT_KEYS = Object.keys(STATEMENTS) as Array<keyof typeof STATEMENTS>;

/** /rate scales, low to high. results[i].score is already 0..3, so priority.ts needs no change. */
export const URGENCY_SCALE = [
  "Marketing, a newsletter, or a suggestion nobody is waiting on",
  "A real request from a customer to answer within a few days",
  "The sender is blocked today, or money is at stake today",
  "The sender's system is down, their data is lost or their account is breached",
];

export const SENTIMENT_SCALE = [
  "The sender is happy with us and says thank you",
  "The sender reports something plainly, with no feeling either way",
  "The sender is annoyed, disappointed or sarcastic about a mistake we made",
  "The sender is furious: insults, threats to escalate, or a demand for a manager",
];

/** Hand-written declaratives for the suggested intents; free text falls back to the template. */
export const INTENT_STATEMENTS: Record<string, string> = {
  "customers threatening to cancel": "The sender is cancelling or moving to another vendor.",
  "someone asking for a refund": "The sender asks us to refund money they paid.",
  "production is down or broken for them": "The sender reports that the product is down or broken for them.",
  "sales leads asking for pricing or a demo": "The sender asks for pricing, a quote or a demo.",
  "phishing or a scam": "The sender wants the reader to click a link, pay an invoice or hand over a login.",
  "gdpr or data deletion requests": "The sender asks us to delete their data.",
  "sarcastic or passive-aggressive tone": "The sender is being sarcastic.",
  "legitimate security alerts from a vendor": "A software vendor reports a security problem in their own product.",
  "a coworker asking me to do something": "A colleague at our own company asks the reader to do something.",
  "newsletters i can ignore": "This is a newsletter or a marketing blast.",
};

/** The statement one intent becomes. Free text is wrapped, and the 200-char cap stays. */
export function intentStatement(intent: string): string {
  const clean = intent.trim().slice(0, MAX_INTENT_CHARS);
  return INTENT_STATEMENTS[clean.toLowerCase()] ?? `This email matches the description: ${clean}.`;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

export function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

/** milliseconds.ai list price: $0.04 per million input tokens, output tokens free. */
export const USD_PER_INPUT_TOKEN = 0.04 / 1_000_000;

export function fmtUsd(usd: number): string {
  if (usd === 0) return "$0";
  return usd < 0.01 ? `$${usd.toFixed(5)}` : `$${usd.toFixed(2)}`;
}
