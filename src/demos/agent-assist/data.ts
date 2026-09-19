// Seed data for the agent-assist demo: the eight scripted chats and the twelve macros are
// copied verbatim from the Jev experiment (src/data/scripts.ts, src/data/macros.ts).
// The label sets, scales and statements below are the dm1 form of the nine Jev questions.

export type Role = "customer" | "agent";
export interface Message {
  role: Role;
  text: string;
}
export interface CustomerProfile {
  name: string;
  plan: "free" | "starter" | "pro" | "business";
  tenure_months: number;
  prior_tickets: number;
}
export interface ScriptedMessage {
  text: string;
  /** Milliseconds after the previous customer message in the same chat. */
  delayMs: number;
}
export interface ChatScript {
  id: string;
  label: string;
  customer: CustomerProfile;
  messages: ScriptedMessage[];
  /** Absolute delivery times from run start, snapped to GRID_MS so concurrent chats batch. */
  at: number[];
}

/** Messages land on a shared grid: chats that fire in the same slot travel as one `texts` batch. */
export const GRID_MS = 3000;
/** The whole run stops here even if timers misbehave; one visitor must not drain the shared quota. */
export const RUN_CAP_MS = 60_000;
/** Simulated delay of a typical prompt-and-parse LLM copilot. Artificial, and labelled as such. */
export const LLM_BASELINE_MS = 4000;
/** Batch window: judgments pending within it are sent as one call per route. */
export const BATCH_WINDOW_MS = 120;
export const CONVERSATION_WINDOW = 6;
export const AUTO_FILL_CONFIDENCE = 0.6;
export const AUTO_SEND_DELAY_MS = 1500;
export const YES = 0.5;
/** Badge and gauge thresholds, set from the measured seed answers, not from round numbers. */
export const CHURN_ALERT = 1.9;
export const FRUSTRATION_ALERT = 1.8;

const RAW: Omit<ChatScript, "at">[] = [
  {
    id: "c1",
    label: "Billing dispute",
    customer: { name: "Marisol Ibarra", plan: "pro", tenure_months: 14, prior_tickets: 2 },
    messages: [
      { text: "Hi, I was charged twice this month — two $49 charges on the 3rd and again on the 4th.", delayMs: 800 },
      { text: "I only have one workspace, so there's no reason for a second charge. I've got the bank statement in front of me.", delayMs: 7000 },
      { text: "This is the second time this has happened, honestly. Last time it took two weeks to sort out.", delayMs: 8000 },
      { text: "I'd like the duplicate refunded to my card please, not as account credit.", delayMs: 8500 },
      { text: "How long will the refund take to show up?", delayMs: 8000 },
    ],
  },
  {
    id: "c2",
    label: "Locked account",
    customer: { name: "Devraj Nair", plan: "starter", tenure_months: 3, prior_tickets: 0 },
    messages: [
      { text: "I can't log in — it says my account is locked after too many attempts.", delayMs: 2200 },
      { text: "I tried the reset password link but it had expired by the time I opened it.", delayMs: 7500 },
      { text: "Also my 2FA is on my old phone which I don't have anymore.", delayMs: 8000 },
      { text: "Got the new link and I'm in now, thanks.", delayMs: 9000 },
      { text: "Can I add a backup email so this doesn't happen again?", delayMs: 7000 },
    ],
  },
  {
    id: "c3",
    label: "Churn threat",
    customer: { name: "Tobias Reinholt", plan: "business", tenure_months: 26, prior_tickets: 6 },
    messages: [
      { text: "Your API has been down three times this month. We are losing customers over this.", delayMs: 3600 },
      { text: "I've opened SIX tickets this year and every single time I get the same copy-paste apology.", delayMs: 7000 },
      { text: "If I don't hear from someone who can actually make decisions, I'm moving my whole team to a competitor on Friday.", delayMs: 7500 },
      { text: "I want a manager. Not a macro.", delayMs: 6500 },
      { text: "Fine. What is the SLA credit for this month then?", delayMs: 9000 },
    ],
  },
  {
    id: "c4",
    label: "Feature question",
    customer: { name: "Priya Venkatesan", plan: "free", tenure_months: 1, prior_tickets: 0 },
    messages: [
      { text: "Hey! Does the free plan support exporting boards to CSV?", delayMs: 5000 },
      { text: "Cool — and can I schedule the export to run weekly?", delayMs: 8000 },
      { text: "Is that on the roadmap or would I need Pro for it?", delayMs: 7000 },
      { text: "Got it, thanks! One more: is there a Zapier integration?", delayMs: 8500 },
      { text: "Perfect, that's all I needed 🙂", delayMs: 8000 },
    ],
  },
  {
    id: "c5",
    label: "GDPR deletion",
    customer: { name: "Anneliese Vogt", plan: "starter", tenure_months: 9, prior_tickets: 1 },
    messages: [
      { text: "Hello. Under GDPR Article 17 I am requesting the erasure of all personal data you hold about me.", delayMs: 6400 },
      { text: "Before deletion I also want a copy of the data you hold, under Article 15.", delayMs: 7500 },
      { text: "What is the legal timeline for you to complete this?", delayMs: 8000 },
      { text: "Please confirm in writing when it is done.", delayMs: 7500 },
      { text: "Thank you.", delayMs: 8500 },
    ],
  },
  {
    id: "c6",
    label: "Shipping delay",
    customer: { name: "Marcus Oyelaran", plan: "pro", tenure_months: 5, prior_tickets: 1 },
    messages: [
      { text: "My hardware key order #48213 was due Monday and the tracking hasn't moved since Thursday.", delayMs: 7800 },
      { text: "The carrier site just says 'in transit'. No other details.", delayMs: 7000 },
      { text: "I need it before I fly out on Saturday — is there anything you can do?", delayMs: 8000 },
      { text: "Can you just ship a replacement overnight?", delayMs: 8500 },
      { text: "Okay. If the first one shows up I'll send it back.", delayMs: 7000 },
    ],
  },
  {
    id: "c7",
    label: "Bug report + logs",
    customer: { name: "Chen Weiling", plan: "business", tenure_months: 18, prior_tickets: 3 },
    messages: [
      {
        text: "Webhook deliveries are failing with 502 since your 3.4.1 deploy. Log line: 2026-09-17T09:12:03Z POST /hooks/order.created -> 502 upstream timeout (retry 3/3)",
        delayMs: 9200,
      },
      { text: "All retries fail with the same upstream timeout. Our endpoint returns 200 in 40 ms when I curl it directly.", delayMs: 7500 },
      { text: "It's roughly 30% of deliveries. Started 09:05 UTC.", delayMs: 7000 },
      { text: "Can you replay the failed deliveries once it's fixed?", delayMs: 8000 },
      { text: "Thanks — please link the incident page when you have one.", delayMs: 7500 },
    ],
  },
  {
    id: "c8",
    label: "Confused user",
    customer: { name: "Harold Pemberton", plan: "free", tenure_months: 2, prior_tickets: 2 },
    messages: [
      { text: "Hello, my grandson set this up for me and now the screen is all different, I can't find my photos.", delayMs: 10600 },
      { text: "There's a little picture of a house at the top, is that it?", delayMs: 7500 },
      { text: "I clicked it and now it asks me to sign in again but I don't know the password, my grandson has it.", delayMs: 8000 },
      { text: "I'm sorry to be a bother, I'm not very good with these things.", delayMs: 7000 },
      { text: "Oh, I found it! Thank you dear, you've been very patient.", delayMs: 8500 },
    ],
  },
];

/** Snap each arrival to the grid, keeping order, so the eight chats collide on purpose. */
function schedule(messages: ScriptedMessage[]): number[] {
  let cum = 0;
  // Start one slot in the past so the first message can land on slot 0 and the page reacts at once.
  let prev = -GRID_MS;
  return messages.map((m) => {
    cum += m.delayMs;
    const at = Math.max(prev + GRID_MS, Math.round(cum / GRID_MS) * GRID_MS);
    prev = at;
    return at;
  });
}

export const SCRIPTS: ChatScript[] = RAW.map((s) => ({ ...s, at: schedule(s.messages) }));
export const TOTAL_MESSAGES = SCRIPTS.reduce((n, s) => n + s.messages.length, 0);

export interface Macro {
  id: string;
  title: string;
  summary: string;
  /** Reply template; `{name}` is replaced with the customer's first name. */
  body: string;
}

export const MACROS: Macro[] = [
  {
    id: "duplicate_charge_refund",
    title: "Duplicate charge — refund",
    summary:
      "Apologize for a duplicate or incorrect charge and confirm the extra amount will be refunded to the original payment method within 5–10 business days.",
    body: "I'm sorry about the duplicate charge, {name} — that's on us. I've issued a refund for the extra payment to your original payment method; it typically appears within 5–10 business days depending on your bank. I'll send you a confirmation with the reference number in a moment.",
  },
  {
    id: "account_unlock_reset",
    title: "Account locked — reset link",
    summary: "Unlock a locked account and send a fresh password-reset link; explain the link expires in 30 minutes.",
    body: "Thanks for letting me know, {name}. I've unlocked your account and sent a fresh password-reset link to the email on file — it's valid for 30 minutes, so please use it right away. Let me know once you're back in.",
  },
  {
    id: "two_factor_recovery",
    title: "2FA recovery — verify identity",
    summary: "Customer lost their 2FA device; explain the identity-verification steps needed before 2FA can be reset.",
    body: "No problem, {name} — we can recover access without the old phone. For security I need to verify your identity first: please reply with the last four digits of the card on file and the approximate date of your last invoice. Once verified I'll disable the old authenticator so you can enrol a new one.",
  },
  {
    id: "escalate_to_supervisor",
    title: "Escalate to supervisor",
    summary:
      "Customer demands a manager or is at serious risk of leaving; acknowledge the severity, escalate to a supervisor and commit to a callback within one hour.",
    body: "I hear you, {name}, and I'm not going to send you another template. I'm escalating this to my supervisor right now with the full history of your tickets; you'll get a personal call within the next hour from someone who can make decisions about your account.",
  },
  {
    id: "sla_credit",
    title: "SLA credit for outage",
    summary:
      "Customer asks about compensation for downtime; explain how SLA credits are calculated and that finance applies them to the next invoice.",
    body: "You're entitled to an SLA credit for this month's downtime, {name}. Credits are calculated from the incident timeline (10% of the monthly fee per breached hour, capped at 50%) and applied to your next invoice. I've opened the credit request and will confirm the exact amount by email today.",
  },
  {
    id: "feature_availability_by_plan",
    title: "Feature availability by plan",
    summary: "Answer whether a feature exists and which plan includes it, and link to the plan comparison page.",
    body: "Good question, {name}! That feature is available, but it depends on your plan — I've linked the plan comparison page so you can see exactly what's included at each level. Happy to walk you through the difference if it helps.",
  },
  {
    id: "feature_request_logged",
    title: "Not available — request logged",
    summary: "The requested capability does not exist yet; log a feature request and explain that the roadmap is public.",
    body: "That's not something we support today, {name}, but I've logged it as a feature request with your account attached so the product team can see the demand. You can follow progress on our public roadmap.",
  },
  {
    id: "privacy_data_request",
    title: "GDPR/CCPA data request",
    summary:
      "Acknowledge a data access or erasure request, explain identity verification, commit to the 30-day statutory timeline and written confirmation.",
    body: "Thank you, {name}. I've registered your data request with our privacy team. We'll verify your identity by email first, then complete the request within the 30-day statutory period, and you'll receive written confirmation when it's done.",
  },
  {
    id: "shipping_tracking_update",
    title: "Shipping — tracking check",
    summary: "Physical order is late; apologize, open a trace with the carrier and promise an update within 24 hours.",
    body: "I'm sorry your order is running late, {name}. I've opened a trace with the carrier on your tracking number; they usually respond within 24 hours and I'll update you as soon as I hear back.",
  },
  {
    id: "shipping_replacement",
    title: "Shipping — send replacement",
    summary:
      "Customer needs the item urgently or it is lost; ship a replacement with expedited delivery and provide return instructions for the original.",
    body: "Let's not make you wait on the carrier, {name}. I've arranged a replacement with overnight delivery — you'll get a new tracking number shortly. If the original turns up, you can send it back with the prepaid label I'll include.",
  },
  {
    id: "bug_acknowledged_engineering",
    title: "Bug — forwarded to engineering",
    summary:
      "Customer reports a bug with technical details; thank them for the logs, confirm it has been reproduced or filed with engineering and share how they will be updated.",
    body: "Thanks for the detailed logs, {name} — that helps a lot. I've filed this with engineering with your timestamps attached and flagged it as a regression. I'll keep you posted on this thread and link the incident page as soon as one is up.",
  },
  {
    id: "guided_walkthrough",
    title: "Patient step-by-step walkthrough",
    summary: "Customer is confused by the interface; give a reassuring, plain-language, one-step-at-a-time walkthrough.",
    body: "You're not a bother at all, {name} — happy to help. Let's go one step at a time: look at the very top of the screen for the small picture of a house. Tap it once, and tell me what you see next.",
  },
];

export function macroById(id: string): Macro | undefined {
  return MACROS.find((m) => m.id === id);
}
export function fillMacro(macro: Macro, customerName: string): string {
  return macro.body.replaceAll("{name}", customerName.split(" ")[0] ?? customerName);
}

/** /classify labels for best_macro: `${title}: ${summary}` per macro, plus the escape hatch. */
export const MACRO_LABELS: Record<string, string> = {
  ...Object.fromEntries(MACROS.map((m) => [m.id, `${m.title}: ${m.summary}`])),
  none: "No canned reply fits the latest customer message; the agent should write a custom reply, for example the customer is only saying thanks, confirming the problem is solved, or asking a follow-up the macros above do not cover.",
};

/** /classify labels for intent, from the Jev INTENTS map. */
export const INTENT_LABELS: Record<string, string> = {
  billing_dispute: "A charge, invoice, duplicate payment or refund problem",
  account_access: "Cannot log in, locked out, password or 2FA problems",
  cancellation_threat: "Customer says or implies they will leave, cancel or switch to a competitor",
  feature_question: "Asking whether something is possible, supported, or on the roadmap",
  data_privacy_request: "Requests about personal data: erasure, export, GDPR, CCPA or legal demands",
  shipping_delay: "A physical order is late, lost or stuck in transit",
  bug_report: "Software is malfunctioning and the customer describes errors, logs or failure rates",
  general_help: "Needs guidance using the product or is confused by the interface; nothing is technically broken",
  gratitude_or_closing: "Thanking the agent, confirming the problem is solved, or ending the chat",
  other: "None of the above",
};

/** /rate scales, low to high, from the Jev score legends. `score` comes back as 0..3. */
export const CHURN_SCALE = [
  "The customer is satisfied, neutral, or only asking a question",
  "Mildly dissatisfied about one thing, with no mention of leaving",
  "Repeated failures or a comparison with a competitor; leaving is plausible",
  "Says outright they will cancel, switch provider or leave",
];
/**
 * Short anchors beat long ones here: the wordier drafts collapsed every problem report onto 2.0.
 * Level 1 has to name "reports a problem" outright, or a calm bug report reads as annoyance.
 */
export const FRUSTRATION_SCALE = [
  "No complaint: a greeting, a question, thanks, or a plain factual report",
  "Reports a problem or makes a small complaint, with no emotive words",
  "Openly frustrated: emphatic words, repeated complaints",
  "Furious: ultimatums, insults, threats or CAPITALS",
];

/**
 * The Jev noul questions as one batched /yes-no call, plus two arms Jev asked for in prose:
 * the fourth escalation arm and the closing detector that keeps the `none` macro gate alive. A batch shares its when_true and when_false hints, so each
 * statement carries its own criteria and stays literal: the model answers what the transcript
 * says, not what an agent could hypothetically do. Order matters — SIGNALS and CLOSING index it.
 */
export const STATEMENTS = [
  "The customer asks for a manager, a supervisor or a human decision maker.",
  "The customer says they will cancel, leave or switch to a competitor.",
  "The customer makes a demand under a law or regulation, such as GDPR, CCPA, erasure or data access.",
  "The customer asks for money back: a refund, chargeback, reimbursement or account credit.",
  "Something on the company's side went wrong for this customer, rather than a neutral question, a user-side issue, or the customer thanking us.",
  "The customer's request is a simple question or a standard account action.",
  "The issue is beyond what a front-line agent can settle alone, or the customer is too angry to close the chat today.",
  "The chat is over: the line marked LATEST Customer is the customer's goodbye or thank-you. Whatever they asked for earlier does not count here — judge that one line alone.",
];

/**
 * Index of the closing statement: above CLOSING_YES no macro fits, so the gate shows `none`.
 * 0.47 is measured, not round. On the seed the four closing turns score 0.49–0.82 and the
 * nearest live request scores 0.45, so the band is narrow: re-measure whenever a statement,
 * a macro or a script changes. Widening it needs the last line judged on its own, which costs
 * a sixth call per batch — not worth it while the seed separates.
 */
export const CLOSING = 7;
export const CLOSING_YES = 0.47;

/** The five chips. `from` indexes STATEMENTS; escalation is the strongest of its four arms. */
export const SIGNALS = [
  { key: "escalate", label: "Needs supervisor", tone: "bad", from: [0, 1, 2, 6] },
  { key: "regulatory", label: "Regulatory / legal", tone: "bad", from: [2] },
  { key: "refundRequested", label: "Requests refund", tone: "bad", from: [3] },
  { key: "apologize", label: "Apologize first", tone: "bad", from: [4] },
  { key: "resolvable", label: "Resolvable now", tone: "good", from: [5] },
] as const;

export type SignalKey = (typeof SIGNALS)[number]["key"];
export type Signals = Record<SignalKey, number>;

/** Collapse the six statement probabilities into the five displayed signals. */
export function toSignals(probabilities: number[]): Signals {
  const out = {} as Signals;
  for (const s of SIGNALS) out[s.key] = Math.max(...s.from.map((i) => probabilities[i] ?? 0));
  return out;
}

/** Refund policy lives in code, not in the model: pro/business, or any plan after 12 months. */
export function refundEligibleByPolicy(c: Pick<CustomerProfile, "plan" | "tenure_months">): boolean {
  return c.plan === "pro" || c.plan === "business" || c.tenure_months >= 12;
}

/**
 * The text every route sees: a profile line, then the last six messages, with the newest
 * customer line marked so the label and statement wording can point at it.
 */
export function transcript(messages: Message[], customer: CustomerProfile): string {
  // Copilot signals describe customer messages; suggested replies never become model input.
  const window = messages.filter((message) => message.role === "customer").slice(-CONVERSATION_WINDOW);
  let lastCustomer = -1;
  window.forEach((m, i) => {
    if (m.role === "customer") lastCustomer = i;
  });
  const lines = window.map((m, i) =>
    m.role === "agent" ? `Agent: ${m.text}` : `${i === lastCustomer ? "LATEST Customer" : "Customer"}: ${m.text}`,
  );
  return [
    `Profile: ${customer.plan} plan, ${customer.tenure_months} months, ${customer.prior_tickets} prior tickets.`,
    ...lines,
  ].join("\n");
}

export function lastCustomerText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === "customer") return messages[i]!.text;
  return "";
}

// Finite customer transcript prefixes, shared by the UI and the public catalog.
export const STOCK_TRANSCRIPTS = SCRIPTS.flatMap(script => script.messages.map((_, i) => transcript(script.messages.slice(0, i + 1).map(message => ({ role: "customer" as const, text: message.text })), script.customer)));
export const STOCK_LATEST = SCRIPTS.flatMap(script => script.messages.map(message => message.text));
