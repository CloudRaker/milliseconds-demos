/**
 * Predictive columns. The visitor types a column header ("Urgency", "Refund
 * risk?"); one /classify call over 14 described label reads what kind of
 * judgment that header asks for, and the column fills with the matching
 * JUDGE / PICK / RATE formula for every row of the text column.
 *
 * Each schema carries both what the formula shows (short option labels) and
 * what we send to decision-machine-1 (a statement with hints, described labels,
 * or a low-to-high scale). Ported from the Jev experiment's src/lib/predict.ts;
 * the Jev question types map to routes as judge -> /yes-no, pick -> /classify,
 * rate -> /rate. Everything here is pure, so smoke.mjs sends the same bodies
 * the page does; the calls themselves live in runner.ts.
 */
import type { Route } from "../../lib/dm1.ts";
import { colToName } from "./engine/refs.ts";
import type { JevSpec } from "./engine/jev.ts";
import type { JevKind } from "./engine/values.ts";

export type Schema = {
  id: string;
  /** Short name, shown in the header chip, the card and the classify labels. */
  label: string;
  /** How the label is described to /classify when it reads the header. */
  describe: string;
  kind: JevKind;
  /** Goes into the formula. For `judge` this is the statement we send verbatim. */
  instructions: string;
  /** Short labels shown in the cells; also the /classify label keys. */
  options: string[];
  /** yes-no hints, same length on both sides. */
  hints?: { when_true: string; when_false: string };
  /** /classify label descriptions, keyed by the short option. */
  described?: Record<string, string>;
  /** /rate scale: one described level per option, low to high. */
  scale?: string[];
};

/** Prefix that marks a free-form scale, so the runner can recover the header from it. */
export const FREE_SCALE_PREFIX = "Rate this text for: ";

export const SCHEMAS: Schema[] = [
  {
    id: "sentiment",
    label: "Sentiment",
    describe: "sentiment, how positive or negative the text is",
    kind: "rate",
    instructions: "Overall sentiment of this text",
    options: ["very negative", "negative", "neutral", "positive", "very positive"],
    scale: [
      "very negative, furious or telling others to avoid it",
      "negative, disappointed or would not buy again",
      "neutral, mixed or indifferent",
      "positive, happy and would recommend",
      "very positive, delighted and enthusiastic",
    ],
  },
  {
    id: "urgency",
    label: "Urgency",
    describe: "urgency, how quickly someone needs to follow up",
    kind: "rate",
    instructions: "How urgent is it for our team to follow up with this person?",
    options: ["no follow-up", "low", "medium", "high", "urgent"],
    // Framed on the writer, not on "our team": a scale written from the team's
    // point of view scored happy reviews as urgent (see smoke.mjs).
    scale: [
      "the writer is happy and needs nothing",
      "the writer has a small complaint",
      "the writer has a real complaint and wants an answer",
      "the writer is angry or blocked and wants an answer now",
      "the writer is furious, is returning the product or reports something dangerous",
    ],
  },
  {
    id: "topic",
    label: "Topic",
    describe: "which part of the purchase the review is about: shipping, quality, price or support",
    kind: "pick",
    instructions: "What is the main topic of this text?",
    options: ["shipping", "quality", "price", "support", "other"],
    described: {
      shipping: "delivery speed, tracking, packaging or damage in transit",
      quality: "build quality, materials, durability or defects",
      price: "cost, value for money or price changes",
      support: "customer service, replacements or help desk experience",
      other: "color, size, instructions, companion app or anything else",
    },
  },
  {
    id: "intent",
    label: "Intent",
    describe: "intent of an inbound message, what the sender wants",
    kind: "pick",
    instructions: "This is an inbound message to a B2B software company. What does the sender want?",
    options: ["pricing", "demo request", "support", "partnership", "job inquiry", "spam"],
    described: {
      pricing: "a potential customer asks what our product costs: a quote, a tier price or a discount",
      "demo request": "asks for a demo, walkthrough or product session",
      support: "an existing customer with a bug, login or account problem",
      partnership: "proposes a reseller, integration or co-marketing partnership",
      "job inquiry": "asks about hiring, internships or open roles",
      spam: "unsolicited SEO, backlinks, traffic, offshore development, domain or agency offers sent to us",
    },
  },
  {
    id: "buying",
    label: "Buying intent",
    describe: "buying intent, how likely the sender is to purchase",
    kind: "rate",
    instructions: "How strong is the sender's intent to purchase our product?",
    options: ["no interest", "curious", "evaluating", "ready to buy"],
    scale: ["not a sales enquiry at all", "a curious question, no plan to buy", "evaluating or comparing vendors", "ready to buy now"],
  },
  {
    id: "tone",
    label: "Tone",
    describe: "emotional tone, mood or attitude of the writer",
    kind: "pick",
    instructions: "What is the emotional tone of the writer?",
    options: ["angry", "disappointed", "neutral", "happy", "delighted"],
    described: {
      angry: "furious, hostile or demanding",
      disappointed: "let down, underwhelmed or regretful",
      neutral: "matter of fact, no strong emotion",
      happy: "pleased and satisfied",
      delighted: "thrilled, enthusiastic, exceeded expectations",
    },
  },
  {
    id: "priority",
    label: "Priority",
    describe: "priority or severity for a support or ops team",
    kind: "rate",
    instructions: "How severe is the problem described, from a support team's point of view?",
    options: ["none", "low", "medium", "high", "critical"],
    scale: [
      "no problem described",
      "low severity, a minor annoyance or cosmetic issue",
      "medium severity, a feature that partly fails",
      "high severity, the product cannot be used as intended",
      "critical, safety risk, data loss or an outage for an existing customer",
    ],
  },
  {
    id: "stars",
    label: "Star rating",
    describe: "star rating the author would give, 1 to 5",
    kind: "rate",
    instructions: "How many stars out of five would the author give?",
    options: ["1 star", "2 stars", "3 stars", "4 stars", "5 stars"],
    scale: [
      "1 star, terrible, returning it",
      "2 stars, disappointed",
      "3 stars, fine, average",
      "4 stars, good, would recommend",
      "5 stars, outstanding, love it",
    ],
  },
  {
    id: "defect",
    label: "Defect?",
    describe: "whether the text reports a defect, damage or malfunction",
    kind: "judge",
    instructions: "The product itself is broken, damaged or does not work.",
    options: [],
    // Naming the writer in both hints is what pulled this from 46/64 to 59/64
    // against the fixtures: "reports a defect" alone scored a late delivery and
    // a price complaint as Yes, and the statement alone scored praise as Yes.
    hints: {
      when_true: "The writer names a part that broke, cracked, leaks, stopped working, shuts off or arrived damaged.",
      when_false: "The writer names no broken part: the complaint is about delivery, price, support, colour or size.",
    },
  },
  {
    id: "recommend",
    label: "Recommends?",
    describe: "whether the author would recommend the product",
    kind: "judge",
    instructions: "The author would recommend the product to others.",
    options: [],
    hints: {
      when_true: "Says would recommend, would buy again, or is clearly happy with it.",
      when_false: "Says avoid, save your money, returning it, or is clearly disappointed.",
    },
  },
  {
    id: "refund",
    label: "Refund risk?",
    describe: "whether the author is likely to return the product or ask for a refund",
    kind: "judge",
    instructions: "The author is likely to return the product or ask for a refund.",
    options: [],
    hints: {
      when_true: "Mentions returning it, wanting money back, or a serious defect with anger.",
      when_false: "Is satisfied, or only mentions a minor gripe that is not a deal-breaker.",
    },
  },
  {
    id: "spam",
    label: "Spam?",
    describe: "the message is unsolicited junk sent to us, a scam, or an advert for services we did not ask for",
    kind: "judge",
    // The direction matters more than the word "unsolicited": hints that only
    // list SEO and traffic pulled every message that mentions a price over the
    // line. Selling *to us* versus asking about *our product* scores 64/64.
    instructions: "The sender is selling a service to us, rather than asking about our product.",
    options: [],
    hints: {
      when_true: "The sender offers us SEO, backlinks, web traffic, offshore developers, a domain or a listing.",
      when_false: "The sender asks about our product: what it costs, a demo, a bug, a partnership or a job.",
    },
  },
  {
    id: "yesno",
    label: "Yes / no",
    describe: 'the header is itself a question answered yes or no for each row, such as "Mentions a competitor?" or "Asks for a discount?"',
    kind: "judge",
    // {header} becomes a declarative statement; no hints, the statement is all we know.
    instructions: "{header}",
    options: [],
  },
  {
    id: "scale",
    label: "Low / high",
    describe: 'the header is a single quality to score from low to high for each row, such as "Enthusiasm", "Clarity", "Politeness" or "Detail"',
    kind: "rate",
    instructions: `${FREE_SCALE_PREFIX}{header}`,
    options: ["none", "low", "medium", "high", "very high"],
  },
];

export const schemaById = (id: string): Schema | undefined => SCHEMAS.find((s) => s.id === id);

const VERB_START =
  /^(is|are|was|were|has|have|had|does|do|did|can|could|will|would|should|mentions?|asks?|wants?|needs?|contains?|includes?|refers?|describes?|reports?|complains?|requests?|shows?|sounds?|looks?|seems?|talks?|threatens?|promises?)\b/i;

/**
 * Turn a header question into a declarative statement for /yes-no.
 * "Mentions a competitor?" -> "The text mentions a competitor."
 * "Competitor mention" -> "The text is about competitor mention."
 */
export function statementFor(header: string): string {
  let h = header.trim().replace(/\s*\?+\s*$/, "").trim();
  if (!h) return "";
  const body = VERB_START.test(h)
    ? `The text ${h.charAt(0).toLowerCase()}${h.slice(1)}`
    : `The text is about ${h.charAt(0).toLowerCase()}${h.slice(1)}`;
  return body.endsWith(".") ? body : `${body}.`;
}

/** The instructions string the formula carries for a header. */
export function instructionsFor(schema: Schema, header: string): string {
  const h = header.trim();
  if (schema.id === "yesno") return statementFor(h);
  return schema.instructions.replace("{header}", h);
}

/** The formula a predicted cell holds, e.g. =RATE($C2,"Overall sentiment…","very negative|…"). */
export function formulaFor(schema: Schema, header: string, textCol: number, row: number, override?: string): string {
  const ref = `$${colToName(textCol)}${row + 1}`;
  const q = JSON.stringify(override ?? instructionsFor(schema, header));
  if (schema.kind === "judge") return `=JUDGE(${ref},${q})`;
  const fn = schema.kind === "pick" ? "PICK" : "RATE";
  return `=${fn}(${ref},${q},"${schema.options.join("|")}")`;
}

const byInstructions = new Map(SCHEMAS.filter((s) => !s.instructions.includes("{header}")).map((s) => [s.instructions, s]));

/** Described levels for a free-form scale: header "Enthusiasm" -> "no enthusiasm at all", … */
export function freeScale(header: string): string[] {
  const h = header.trim().toLowerCase() || "this quality";
  return [`no ${h} at all`, `low ${h}`, `medium ${h}`, `high ${h}`, `very high ${h}`];
}

/** The exact request body a pending judgment turns into (minus `texts`). */
export function bodyFor(spec: JevSpec): { route: Route; body: Record<string, unknown> } {
  const known = byInstructions.get(spec.instructions);
  if (spec.kind === "judge") {
    return { route: "yes-no", body: { statement: spec.instructions, ...(known?.hints ?? {}) } };
  }
  if (spec.kind === "pick") {
    return { route: "classify", body: { labels: known?.described ?? spec.options } };
  }
  const header = spec.instructions.startsWith(FREE_SCALE_PREFIX) ? spec.instructions.slice(FREE_SCALE_PREFIX.length) : "";
  return { route: "rate", body: { scale: known?.scale ?? (header ? freeScale(header) : spec.options) } };
}

/** Groups judgments into one request: same route, same question, different texts. */
export const questionKey = (spec: JevSpec): string => {
  const { route, body } = bodyFor(spec);
  return JSON.stringify([route, body, spec.options]);
};

// ------------------------------------------------------------ header intent

export type Intent = {
  header: string;
  schema: Schema;
  confidence: number;
  scores: Record<string, number>;
  /** True when the schema came from the header's shape, not from the classifier. */
  fallback: boolean;
  /** True when the header names a schema outright, so no call went out. */
  exact: boolean;
  ms: number;
  inferenceMs: number;
};

/** Headers that name a schema in other words. Keys are lower case, "?" stripped. */
const ALIASES: Record<string, string> = {
  "needs a refund": "Refund risk?",
  stars: "Star rating",
  star: "Star rating",
  rating: "Star rating",
  severity: "Priority",
  "emotional tone": "Tone",
  mood: "Tone",
  category: "Topic",
  "buying signal": "Buying intent",
};

const bare = (s: string): string => s.trim().toLowerCase().replace(/\s*\?+$/, "");

/**
 * A header that already names a schema needs no call at all. "Tone" and
 * "Priority" each lost to a greedier label description before this existed,
 * and a wrong schema at 47% reads exactly like a right one.
 */
export function exactSchema(header: string): Schema | undefined {
  const h = bare(header);
  if (!h) return undefined;
  const direct = SCHEMAS.find((s) => bare(s.label) === h);
  if (direct) return direct;
  const alias = ALIASES[h];
  return alias ? SCHEMAS.find((s) => s.label === alias) : undefined;
}

export const INTENT_LABELS: Record<string, string> = Object.fromEntries(SCHEMAS.map((s) => [s.label, s.describe]));

/**
 * What /classify reads. The task sentence has to sit in the text (classify has
 * no instructions field), the header comes before the samples and the samples
 * are clipped short — without all three the samples outvote the header and
 * every review column comes back as "Recommends?".
 */
export function intentText(header: string, samples: string[]): string {
  const h = header.trim();
  const lines = samples.slice(0, 3).map((s) => `- ${s.length > 90 ? s.slice(0, 89) + "…" : s}`);
  return (
    `A spreadsheet user typed the column header "${h}" above a column of free text. ` +
    "Which kind of prediction do they want in that column?\n\n" +
    `Column header: "${h}"\n\nSample rows of the text column next to it:\n${lines.join("\n")}`
  );
}

/**
 * Below this the classifier is guessing: a single-word header it has no schema
 * for ("Enthusiasm", "Clarity") spreads its mass over every specific label, and
 * the winner is noise. The header's own shape is the better answer, and the
 * chip says so.
 */
export const INTENT_FLOOR = 0.35;

export function pickSchema(label: string, probability: number, header: string): { schema: Schema; fallback: boolean } {
  if (probability >= INTENT_FLOOR) return { schema: schemaByLabel(label), fallback: false };
  return { schema: schemaById(header.trim().endsWith("?") ? "yesno" : "scale")!, fallback: true };
}

export const schemaByLabel = (label: string): Schema => SCHEMAS.find((s) => s.label === label) ?? SCHEMAS[0];
