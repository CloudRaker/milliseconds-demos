// Seed fixtures, span regexes and the exact prompt text the demo sends.
// Fixtures are copied from the jev-experiments/send-guard originals (lib/channels.ts,
// lib/seed.ts, lib/scenarios.ts, lib/spans.ts, lib/stats.ts). Everything here is invented.
// smoke.mjs imports the prompt constants from this file, so there is one copy of them.

export type Audience = "external_customer" | "internal" | "public";
export type Verdict = "send" | "warn" | "block";
export type SpanKind = "email" | "phone" | "key" | "money" | "date" | "url";

export interface Channel {
  id: string;
  name: string;
  label: string;
  audience: Audience;
  description: string;
  kind: "channel" | "dm";
  shared?: boolean;
  private?: boolean;
  members: number;
  topic: string;
}

export interface Span {
  id: string;
  kind: SpanKind;
  text: string;
  start: number;
  end: number;
}

/* ---------------------------------------------------------------- channels */

export const CHANNELS: Channel[] = [
  {
    id: "acme",
    name: "#customer-acme",
    label: "#customer-acme",
    audience: "external_customer",
    description: "a Slack Connect channel shared with Acme Corp, a paying customer",
    kind: "channel",
    shared: true,
    members: 14,
    topic: "Shared with Acme Corp · SSO rollout + webhook migration",
  },
  {
    id: "eng",
    name: "#eng-internal",
    label: "#eng-internal",
    audience: "internal",
    description: "a private engineering channel, employees only",
    kind: "channel",
    private: true,
    members: 42,
    topic: "On-call: @priya · deploys freeze Fri 4pm",
  },
  {
    id: "dm",
    name: "DM with Jordan Lee (Acme, customer)",
    label: "Jordan Lee",
    audience: "external_customer",
    description: "a one-to-one conversation with a customer who opened a support ticket",
    kind: "dm",
    members: 2,
    topic: "",
  },
  {
    id: "community",
    name: "#public-community",
    label: "#public-community",
    audience: "public",
    description: "a public community Slack; anyone on the internet can join and read",
    kind: "channel",
    members: 3812,
    topic: "Community help · be kind · no support tickets here",
  },
  {
    id: "general",
    name: "#general",
    label: "#general",
    audience: "internal",
    description: "company-wide announcements",
    kind: "channel",
    members: 212,
    topic: "Company-wide · announcements only",
  },
  {
    id: "random",
    name: "#random",
    label: "#random",
    audience: "internal",
    description: "the company watercooler channel, employees only",
    kind: "channel",
    members: 198,
    topic: "",
  },
  {
    id: "support-escalations",
    name: "#support-escalations",
    label: "#support-escalations",
    audience: "internal",
    description: "a private internal channel for support escalations, employees only",
    kind: "channel",
    private: true,
    members: 23,
    topic: "SEV tickets only",
  },
];

export const AUDIENCE_TAG: Record<Audience, string> = {
  external_customer: "external",
  internal: "internal",
  public: "public",
};

/* ------------------------------------------------------------ seed history */

export interface Person {
  name: string;
  initials: string;
  color: string;
  external?: boolean;
}
export interface Message {
  id: string;
  author: string;
  time: string;
  text: string;
  reactions?: Array<{ emoji: string; count: number }>;
}

export const PEOPLE: Record<string, Person> = {
  me: { name: "Sam Rivera", initials: "SR", color: "#6d4aff" },
  priya: { name: "Priya Natarajan", initials: "PN", color: "#e0a33a" },
  marcus: { name: "Marcus Hale", initials: "MH", color: "#2d9cdb" },
  jordan: { name: "Jordan Lee", initials: "JL", color: "#0b8a6f", external: true },
  wei: { name: "Wei Zhang", initials: "WZ", color: "#8e5cd9", external: true },
  dana: { name: "Dana Okafor", initials: "DO", color: "#e0567a" },
  ravi: { name: "Ravi Menon", initials: "RM", color: "#5c7cfa" },
  lena: { name: "Lena Fischer", initials: "LF", color: "#f2761e" },
  tomas: { name: "tomas_dev", initials: "TD", color: "#7c8b9a", external: true },
};

export const SEED: Record<string, Message[]> = {
  acme: [
    { id: "a1", author: "wei", time: "9:12 AM", text: "Morning! We flipped SSO on for the pilot group (30 users) last night. So far so good." },
    { id: "a2", author: "priya", time: "9:15 AM", text: "Great to hear. Keep an eye on the audit log for saml_assertion_expired — that's the one thing we saw in staging.", reactions: [{ emoji: "👀", count: 2 }] },
    { id: "a3", author: "jordan", time: "9:41 AM", text: "One issue: two users get bounced back to the login page after the IdP redirect. Both are on the new group. Screens attached in the ticket (#4821)." },
    { id: "a4", author: "me", time: "9:44 AM", text: "Thanks Jordan — looking now. Can you confirm whether those two have the department attribute set in Okta?" },
    { id: "a5", author: "jordan", time: "9:52 AM", text: "Checked — they don't. Everyone else does. Is that the cause?", reactions: [{ emoji: "🙏", count: 1 }] },
  ],
  eng: [
    { id: "e1", author: "priya", time: "8:03 AM", text: "Deploy freeze starts Friday 4pm. Anything for 2.3.1 needs to be in review by Thursday noon." },
    { id: "e2", author: "ravi", time: "8:20 AM", text: "webhook-relay is at 3% 5xx since the 02:00 deploy. Rolling back to 2.3.0 while I look.", reactions: [{ emoji: "🔥", count: 3 }, { emoji: "👍", count: 4 }] },
    { id: "e3", author: "dana", time: "8:31 AM", text: "Acme is asking about the missing department attribute mapping in the SSO flow — is that on us or on them?" },
    { id: "e4", author: "priya", time: "8:34 AM", text: "On us. We require it but never documented it. PR up in 20 min to make it optional." },
    { id: "e5", author: "ravi", time: "8:58 AM", text: "Rollback done. 5xx back to 0.1%. Root cause looks like the new signature verification rejecting v1 payloads." },
  ],
  dm: [
    { id: "d1", author: "jordan", time: "Yesterday 4:48 PM", text: "Hey Sam — our trial ends tomorrow and finance hasn't approved the PO yet. Any chance of another extension?" },
    { id: "d2", author: "me", time: "Yesterday 5:02 PM", text: "Hi Jordan, let me check what's possible on our side and get back to you first thing." },
    { id: "d3", author: "jordan", time: "8:15 AM", text: "Morning! Any news? The team is a bit nervous about losing the workspace data." },
    { id: "d4", author: "jordan", time: "8:16 AM", text: "Also the two-step setup guide is still confusing to our IT folks, honestly. Third time I've had to walk someone through it." },
  ],
  community: [
    { id: "c1", author: "tomas", time: "7:40 AM", text: "Is anyone else seeing invalid signature on webhooks since this morning? Nothing changed on my end." },
    { id: "c2", author: "lena", time: "7:55 AM", text: "Hi Tomas 👋 yes — we've heard from a few people. The team is looking at it; I'll post here as soon as I know more." },
    { id: "c3", author: "tomas", time: "8:02 AM", text: "Thanks! For now I've disabled verification, which I know is not great 😅", reactions: [{ emoji: "😅", count: 5 }] },
    { id: "c4", author: "lena", time: "8:30 AM", text: "Update: it was a change in the relay that rejected older payload versions. It's been rolled back — signatures should validate again." },
  ],
  general: [
    { id: "g1", author: "dana", time: "9:00 AM", text: "Reminder: all-hands is at 11 today. Agenda in the calendar invite." },
    { id: "g2", author: "marcus", time: "9:05 AM", text: "Support is at 14 open tickets, down from 31 on Monday. Nice work everyone 🎉", reactions: [{ emoji: "🎉", count: 12 }] },
  ],
  random: [],
  "support-escalations": [],
};

/* --------------------------------------------------------------- scenarios */

export interface Scenario {
  title: string;
  channelId: string;
  draft: string;
  expect: Verdict;
}

export const SCENARIOS: Scenario[] = [
  {
    title: "Pasted a live API key",
    channelId: "eng",
    draft: "hey can someone check why the webhook is 500ing? use this to repro: sk-live-4f9a2c7e1b8d6a3f0c5e9b2d7a1f4c8e",
    expect: "block",
  },
  {
    title: "Guaranteed ship date to a customer",
    channelId: "acme",
    draft: "Thanks for flagging! The SSO fix is already in review — we'll ship it by Friday, guaranteed, and you'll get a $2,000 credit for the trouble.",
    expect: "warn",
  },
  {
    title: "Polite refusal",
    channelId: "dm",
    draft: "I completely understand the frustration. Unfortunately we can't extend the trial a second time, but I'm happy to walk you through the Starter plan so you keep your data. Would Tuesday or Wednesday work for a quick call?",
    expect: "send",
  },
  {
    title: "Hostile reply",
    channelId: "dm",
    draft: "Honestly this is the third time you've asked. Read the docs. It's not our problem that your team can't follow a two-step setup guide.",
    expect: "block",
  },
  {
    title: "Internal pricing leak in the external channel",
    channelId: "acme",
    draft: "Quick heads up: our cost per seat is about $4 so there's plenty of margin — we're also killing the Team tier in Q3 and moving everyone to Enterprise pricing before the announcement.",
    expect: "block",
  },
  {
    title: "Benign status update",
    channelId: "community",
    draft: "Good news — v2.3 is out! Release notes are on the blog, and the migration guide covers the new webhook signatures. Ping me here if anything looks off.",
    expect: "send",
  },
  {
    title: "Customer's contact details in the public channel",
    channelId: "community",
    draft: "Reposting the bug report from our user so everyone can see it: Jordan Lee, jordan.lee@acmecorp.com, 415-555-0132, says the webhook retries never stop.",
    expect: "block",
  },
];

/**
 * Not replayed in the UI — these are the regression cases smoke.mjs checks after SCENARIOS.
 * The first three are the case the original Jev question carved out by name: the author hands
 * out their *own* work email and desk phone in an external channel, which must not be blocked.
 * The last three are ordinary drafts that must not trip "doesn't fit this audience".
 */
export const TUNING_DRAFTS: Scenario[] = [
  {
    title: "Author's own contact details, external",
    channelId: "acme",
    draft: "Happy to keep this moving over Slack, but if it's easier feel free to email me directly at sam.rivera@northwind.io or call my desk on 415-555-0100 and I'll pick it up.",
    expect: "send",
  },
  {
    title: "Author's own contact details, second phrasing",
    channelId: "acme",
    draft: "I'm out Thursday afternoon. If anything urgent comes up while I'm away, my mobile is 415-555-0100 and sam.rivera@northwind.io reaches me faster than this channel.",
    expect: "send",
  },
  {
    // warn, not send: /classify reads a bare signature block in a customer channel at 0.90
    // warn on its own. The point of the case is that it must never reach block — the author's
    // own details are carved out in code, so Send stays clickable as "Send anyway".
    title: "Plain signature block",
    channelId: "acme",
    draft: "That all sounds right — I'll confirm once the fix lands.\n\nSam Rivera\nSupport Engineering, Northwind\nsam.rivera@northwind.io · 415-555-0100",
    expect: "warn",
  },
  {
    // warn, not send: /classify says block 0.73 on any draft with a key-shaped token in it.
    // The span read clears the key at 0.10, so THRESHOLDS.quiet talks the block down to a warn
    // — the escape hatch the page documents. Regex-only DLP blocks this outright.
    title: "Placeholder key mentioned internally",
    channelId: "eng",
    draft: "For the docs page let's use an obviously fake placeholder key so nobody copies a real one: sk-live-000000000000000000000000. I'll update the quickstart.",
    expect: "warn",
  },
  {
    title: "Ordinary internal note",
    channelId: "eng",
    draft: "Rebased the webhook branch on main and the signature tests pass again. I'll leave it in review until Priya has had a look at the v1 payload path.",
    expect: "send",
  },
  {
    title: "Ordinary company-wide note",
    channelId: "general",
    draft: "The office is closed Monday for the holiday. Support coverage is unchanged — Marcus is on rotation and the on-call page still works as usual.",
    expect: "send",
  },
  {
    // The three cases that keep looksIncomplete() honest: a draft cut off mid-clause, a draft
    // with an unfilled placeholder, and a short draft that is simply finished.
    title: "Cut off mid-clause",
    channelId: "eng",
    draft: "Rolled back the relay because the signature check was rejecting v1 payloads and the",
    expect: "warn",
  },
  {
    title: "Unfilled TODO marker",
    channelId: "eng",
    draft: "Writing the incident note now. The root cause is TODO — I'll fill this in once Priya confirms the payload path.",
    expect: "warn",
  },
  {
    title: "Short but complete",
    channelId: "eng",
    draft: "Rollback is done, 5xx back to 0.1%.",
    expect: "send",
  },
];

/* ------------------------------------------------------------------- spans */

const PATTERNS: Array<[SpanKind, RegExp]> = [
  ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  ["url", /https?:\/\/[^\s)]+/g],
  [
    "key",
    // The named prefixes first, then a catch-all for a long opaque token: an unknown key
    // format, a base64 blob or a rotated prefix still gets located, so the span read is not
    // hostage to the vendor list. English words never run 28 characters without a break.
    /\b(?:sk|pk|rk)[-_](?:live|test|prod)?[-_]?[A-Za-z0-9_-]{12,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b|\bxox[bap]-[A-Za-z0-9-]{10,}|\b(?:eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})|(?:password|passwd|pwd|secret|token)\s*[:=]\s*\S{6,}|\b[A-Za-z0-9+/_-]{28,}={0,2}(?![A-Za-z0-9+/_=-])/gi,
  ],
  ["phone", /(?:\+?\d{1,2}[\s.-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g],
  // No bare percentages: an error rate is not an amount, and the model plays along when asked.
  // "Rollback is done, 5xx back to 0.1%." read 0.88 on "the author commits their company to the
  // amount 0.1%", which put a red underline on a metric. A promised discount is still caught —
  // by the `commitment` statement, which is where that judgment belongs.
  ["money", /(?:\$|€|£|USD\s?)\s?\d[\d,]*(?:\.\d{1,2})?(?:\s?[kKmM]\b)?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:dollars|USD)\b/g],
  [
    "date",
    /\b(?:by|on|before|until|this|next|every)\s+(?:end of\s+)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|tomorrow|tonight|week|month|quarter|EOD|EOW|Q[1-4](?:\s?\d{4})?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/gi,
  ],
];

export const MAX_SPANS = 8;

/** Code locates the candidate fragments; the API only decides which ones are the problem. */
export function findSpans(draft: string): Span[] {
  const spans: Span[] = [];
  for (const [kind, re] of PATTERNS) {
    re.lastIndex = 0;
    for (const m of draft.matchAll(re)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (spans.some((s) => start < s.end && end > s.start)) continue;
      spans.push({ id: "", kind, text: m[0], start, end });
    }
  }
  spans.sort((a, b) => a.start - b.start);
  return spans.slice(0, MAX_SPANS).map((s, i) => ({ ...s, id: `span_${i}` }));
}

/** What a classic regex-only DLP rule would flag: key-like tokens, emails and phone numbers. */
export const regexOnlyFlags = (spans: Span[]): Span[] =>
  spans.filter((s) => s.kind === "key" || s.kind === "email" || s.kind === "phone");

/* ----------------------------------------------------------------- prompts */

const AUDIENCE_LINE: Record<Audience, (c: Channel) => string> = {
  external_customer: (c) => `external customer (${c.description})`,
  internal: () => "internal only (employees of the author's company)",
  public: (c) => `public (${c.description}; anyone on the internet can read it)`,
};

/** DM1 has no `state` field, so the channel premise Jev read from state lives in the text. */
export function judgeText(channel: Channel, draft: string): string {
  return `Channel: ${channel.name}. Audience: ${AUDIENCE_LINE[channel.audience](channel)}.\n\nDraft message:\n${draft}`;
}

/**
 * Who is typing — and the one question the app answers itself.
 *
 * The original Jev question carved out the author's own details by name ("false: no personal
 * data, or only the author's own company contact details"). Every attempt to put that carve-out
 * in a statement failed, measured: four span wordings and four PII wordings, on a customer's
 * details against the author's own, in the same batch. "The fragment X is a customer's or end
 * user's contact detail, not the author's own" read the customer's email at 0.46 and the
 * author's at 0.70 — inverted. "reaches a customer or end user, not the author" read 0.24 and
 * 0.82 — inverted harder. Naming the author in the text does not rescue it: at 38 ms a call
 * this model matches meaning, it does not chase attribution across a header.
 *
 * So the app answers it. Whose address this is is the one fact the page actually knows, the
 * same way it already knows the channel's audience. The model judges what a fragment is; code
 * decides whether it is the author's own. Classic regex DLP has no such notion, which is the
 * demo's point: with the toggle on, the author's own signature block still trips "contact
 * detail".
 *
 * ponytail: literal match on one seeded identity, which is all a demo has. A real deployment
 * reads the signed-in user's directory record here.
 */
export const AUTHOR = {
  name: "Sam Rivera",
  email: "sam.rivera@northwind.io",
  phone: "415-555-0100",
  company: "Northwind",
};

const digits = (s: string) => s.replace(/\D/g, "");
const AUTHOR_PHONE = digits(AUTHOR.phone);

/** True when this located fragment is a contact detail the author hands out for themselves. */
export const isAuthorContact = (s: Span): boolean =>
  s.kind === "email" ? s.text.toLowerCase() === AUTHOR.email
    : s.kind === "phone" ? digits(s.text).endsWith(AUTHOR_PHONE)
      : false;

/**
 * The second question the app answers itself: is the draft finished?
 *
 * It used to be a statement — "The author stopped writing mid-thought, or left a TODO or [name]
 * marker unfilled." — and it was dead. Measured four ways on a draft that literally stops
 * mid-clause ("...the signature check was rejecting v1 payloads and the"): batched 1%, solo 1%,
 * draft-only with no channel header 0%, three alternative wordings 2-11%. On a draft holding a
 * live "TODO" it reached 33-44%, still under the 0.6 bar. Hints do not rescue it either: the
 * brief's own hint pair saturates to 93-98% on finished drafts too.
 *
 * That is the right answer from the model, not a failure of it: whether a sentence has ended is
 * a fact about the characters, not a judgment about meaning. So code answers it, the same way
 * code answers whose contact detail a fragment is. The statement is gone from call A.
 *
 * ponytail: syntactic. A finished thought with no full stop ("Sam Rivera / Support Engineering /
 * 415-555-0100") reads unfinished, which costs an amber on a signature block. Upgrade path is a
 * last-line signature carve-out; the demo prefers the false amber to a dead chip.
 */
export const looksIncomplete = (draft: string): boolean => {
  const d = draft.trim();
  return d.length > 0 && (/\b(?:TODO|FIXME|TBD|XXX)\b|\[[a-z][a-z ]{1,19}\]/i.test(d) || !/[.!?"')\]]$/.test(d));
};

/**
 * Call A statements, in the order they are sent. Keys index the results array.
 *
 * No when_true/when_false hints: one shared hint pair has to cover eleven unrelated
 * statements, and every pair tried on the six seed drafts (see smoke.mjs) dragged the
 * whole batch toward "yes" — "the draft contains a credential" went from 6% to 94% on a
 * benign release note. Un-hinted, the model separates cleanly. Per-statement hints would
 * mean one call per statement, which the your key's quota cannot pay for.
 */
export type CoreKey =
  | "secret"
  | "pii"
  | "commitment"
  | "confidential"
  | "confidentialPeople"
  | "misfit"
  | "hedging"
  | "toneWarm"
  | "toneCurt"
  | "toneHostile";

export const CORE_STATEMENTS: Array<{ key: CoreKey; label: string; text: string }> = [
  // Measured, batched, on the seed drafts: 0.32 on the pasted key, 0.01 on the key the draft
  // itself calls a fake example, 0.24 on the benign release note. The model will not read a
  // demo-shaped key as live from the whole draft — the span statement below is the sharp one.
  { key: "secret", label: "secret / credential", text: "The key or token in this message is a real one taken from a running system." },
  // Naming the pairing is what makes it fire: 0.95 on a customer's name beside their email and
  // phone, 0.43 on a draft with no contact details in it, 0.13 on a release note; the "a named
  // person's ... health details" enumeration it replaced read 0.03 on the same draft. It also
  // reads 0.88-0.96 when the author hands out their *own* work email and desk phone, and no
  // wording tried moves that — see AUTHOR above, where code takes the carve-out instead.
  { key: "pii", label: "customer PII", text: "This draft repeats a real person's name together with their email address or phone number." },
  { key: "commitment", label: "binding commitment", text: "The author promises a refund, a specific delivery or fix date, a discount or price, or that a feature will definitely ship." },
  // One 212-character statement with a five-item parenthetical, split in two short ones.
  { key: "confidential", label: "roadmap / margin leak", text: "The draft tells outsiders about the unannounced roadmap, internal costs or margins." },
  { key: "confidentialPeople", label: "deals / staffing leak", text: "The draft tells outsiders about other customers' deals, staffing or internal legal matters." },
  // Narrowed from "inappropriate for this channel's audience in content, confidentiality or
  // professionalism", which was a mood ring: it read 0.57-0.64 on a polite refusal and on the
  // author giving out their own desk number, against 0.63-0.79 on a genuine pricing leak and a
  // hostile reply — overlapping populations, so the 0.70 bar put an amber "doesn't fit this
  // audience" on ordinary messages. Five wordings were measured on seven drafts; none of them
  // separated. This one at least errs quiet: 0.02-0.14 across all thirteen smoke drafts, so it
  // has not fired once. The audience judgment is really carried by `confidential`, `pii` and
  // the audience clause in the text; this chip is the reading, not the gate.
  //
  // Still measurably weak, and the page says so rather than hiding it. An adversarial draft —
  // "Jordan from Acme is escalating ticket 4821 again and frankly their IT team cannot follow a
  // two-step guide" posted to #public-community — reads 0.03 here. The replacement pair the
  // review proposed was measured on nine drafts and separates no better: "This draft names a
  // specific customer or their support case" reads 0.54 on that draft and 0.71-0.80 on the
  // polite refusal and the ship-date draft, and "…in a channel that is not that customer's
  // channel" reads 0.67 against 0.71 on the polite refusal inside the customer's own DM. So the
  // chip stays the reading and never the gate, and the audience judgment stays with
  // `confidential`, `confidentialPeople`, `pii` and the audience clause in the text.
  { key: "misfit", label: "fits audience", text: "The author would be embarrassed if this channel's audience read this draft." },
  { key: "hedging", label: "undermining hedge", text: "The author hedges in a way that undermines their own message, such as 'I think maybe', 'not sure but' or apologising for asking." },
  { key: "toneWarm", label: "warm tone", text: "The tone toward the reader is warm and appreciative." },
  { key: "toneCurt", label: "curt tone", text: "The tone toward the reader is curt, dismissive or impatient." },
  { key: "toneHostile", label: "hostile tone", text: "The draft blames, belittles or talks down to the reader." },
];

/**
 * One statement per located span, appended to the same call. The fragment is quoted
 * verbatim and truncated to 60 chars so a pasted key cannot inflate the token count.
 *
 * Each kind asks about the nature of the fragment, never about the consequence of sending
 * it. "Sending this key would cause a problem" reads the author's intent instead of the
 * fragment: the same key scored 0.98 after "use this to repro" and 0.06 after "here's the
 * staging key if you want to test". Asking whether it is a live credential scores 0.92 and
 * 0.79 on those, and 0.03 on a key the draft calls a fake example.
 */
export function spanStatement(s: Span): string {
  const t = s.text.slice(0, 60);
  switch (s.kind) {
    case "key":
      // 0.59 on the pasted key, 0.06 on the key the draft calls a fake example. "is a live
      // credential, not a placeholder or an example value" read the same pair at 0.48 / 0.05 —
      // same call, three times the headroom over THRESHOLDS.span.
      return `The fragment "${t}" is a real credential taken from a running system, not an illustration.`;
    case "email":
    case "phone":
      // Whose detail this is, code decides (see AUTHOR); the model is asked only what the
      // fragment is, the same shape as the key statement. That keeps the read honest about an
      // example address or a shared support alias, which the regex cannot tell apart.
      return `The fragment "${t}" is one individual's own contact detail, not a shared support address or an example value.`;
    case "money":
      return `The author commits their company to the amount "${t}" in this draft.`;
    case "date":
      return `The author commits their company to the deadline "${t}" in this draft.`;
    default:
      return `The fragment "${t}" points somewhere that should not be shared with this audience.`;
  }
}

/** Call B: the overall verdict, one /classify with described labels. */
export const VERDICT_LABELS: Record<Verdict, string> = {
  send: "Nothing in the draft is a problem for this audience.",
  warn: "The draft has something the author should double-check: a promise, a sharp tone, or unfinished text.",
  block: "The draft would do real harm here: a leaked credential, personal data, confidential information, or an abusive message.",
};

/**
 * Call C, sent once the draft settles: the ordinal legal-exposure reading, low to high.
 *
 * Level 0 names the ordinary case in concrete terms ("a status update, a question, scheduling,
 * an engineering note") and that is what makes the scale work. The wording it replaced opened
 * with a bare "None: ordinary business communication." and, measured on twelve drafts, put
 * *severe* on a benign one-line status update ("Rollback is done, 5xx back to 0.1%." — level 3,
 * score 2.50, the highest reading of the twelve) and *material* on every plainly routine note.
 * A short draft gives /rate little to weigh, and an abstract level 0 is easy to slide off.
 *
 * With this wording, measured on the same twelve: routine notes 0.34-0.73, the pricing leak and
 * the two sharp-tone drafts 1.22-1.39, a customer's contact details 1.62, the guaranteed ship
 * date 1.93. That is a usable order, so the level-2 warn rule the original policy.ts had
 * (legalWarn) is back. Level 3 was not reached by any of the sixteen smoke drafts; the block
 * rule stays wired for a draft that does earn it, and the page says it has not fired.
 */
export const LEGAL_SCALE = [
  "No legal exposure: routine work talk - a status update, a question, scheduling, an engineering note.",
  "Low: informal wording a lawyer would tighten, but no promise, no private data and no secret.",
  "Moderate: the message makes a promise the company must keep, admits fault, or passes on one person's private contact details.",
  "High: the message exposes a working credential, or puts a named person's private details where strangers can read them, or defames someone.",
];
export const LEGAL_LEVELS = ["none", "low", "moderate", "high"];

export const TONE_LEVELS = ["warm", "neutral", "curt", "hostile"];

/* ------------------------------------------------------------------ policy */

/** Everything the policy reads. `p` holds a probability per core key and per span id. */
export interface Judgments {
  p: Record<string, number>;
  /** /classify label from call B, with its own score. Null until the answer lands. */
  verdict: Verdict | null;
  verdictScore: number;
  /** /rate level 0..3 from call C. Null until the draft settles. */
  legal: number | null;
}

/**
 * Thresholds tuned against the six seed drafts with smoke.mjs; the numbers in the
 * comments are the measured probabilities on those drafts.
 */
export const THRESHOLDS = {
  /** the risk statements sit at 0.01-0.33 on drafts that are fine and 0.74-0.96 when they fire. */
  yes: 0.6,
  /** span culprit: 0.48-0.92 on live credentials and committed amounts, 0.03-0.16 otherwise. */
  span: 0.45,
  /**
   * Contact spans need their own bar. Even with the carve-out in the statement, the author's
   * own work email sits higher than a key the draft calls fake, so the underline waits for
   * 0.55. The verdict is not the span's to make: `pii` owns it (see decide()).
   */
  contact: 0.55,
  /** the blame/belittle statement reaches 0.55 on the hostile reply, 0.27 elsewhere. */
  hostile: 0.5,
  /**
   * /rate legal, on the scale above. Level 2 is the original policy.ts `legalWarn` rule, back
   * now that the scale separates: it fires on the guaranteed ship date (1.93) and on nothing
   * else in the sixteen smoke drafts, which sit at 0.34-1.62. Level 3 none of them reached.
   */
  legalWarn: 2,
  legalBlock: 3,
  /** /classify only escalates when it is actually sure. */
  classify: 0.6,
  /**
   * "The model looked and saw nothing", not merely "under the flag bar". Only a credential
   * read this quiet lets a /classify block be talked down: 0.07 on the key the draft calls a
   * fake example, against 0.35-0.60 on keys it does not vouch for.
   */
  quiet: 0.25,
} as const;

/** The bar a span has to clear to earn the red wavy underline. */
export const spanHit = (kind: SpanKind): number =>
  kind === "email" || kind === "phone" ? THRESHOLDS.contact : THRESHOLDS.span;

/**
 * Tone level 0..3 (warm, neutral, curt, hostile), from three escalating yes/no answers.
 *
 * The brief routed tone to /rate, and it was tried there — twice, on the brief's own four-level
 * scale and on a second, more concrete wording of it. Both compress: measured on twelve drafts,
 * the polite refusal read 1.75 and the genuinely hostile reply 1.98, 0.23 apart and both
 * argmaxing to *curt*. Wired up, that reading downgraded the hostile reply from block to warn
 * and put a curt tone on a polite one — two regressions in one call.
 *
 * These three statements separate by a mile on the same drafts: the hostile reply reads curt
 * 0.87 / blaming 0.55 against 0.26 / 0.17 on the polite refusal, and the four levels all get
 * used. They also ride in a batch that is already going out, so tone costs no extra request.
 * The demo keeps the measurement, not the route.
 */
export const toneLevel = (p: Record<string, number>): number =>
  (p.toneHostile ?? 0) >= THRESHOLDS.hostile ? 3
    : (p.toneCurt ?? 0) >= THRESHOLDS.yes ? 2
      : (p.toneWarm ?? 0) >= THRESHOLDS.yes ? 0
        : 1;

const RANK: Record<Verdict, number> = { send: 0, warn: 1, block: 2 };
const worse = (a: Verdict, b: Verdict): Verdict => (RANK[a] >= RANK[b] ? a : b);

export interface Decision {
  verdict: Verdict;
  reason: string;
  culpritSpanIds: string[];
}

/**
 * Policy lives in code. The API supplies the judgments; these rules pick the button colour.
 * Hard rules always win; the /classify verdict can only escalate, never wave something through.
 */
export function decide(j: Judgments, audience: Audience, spans: Span[], draft = ""): Decision {
  const external = audience !== "internal";
  const fragment = looksIncomplete(draft);
  const p = j.p;
  const yes = (k: string) => (p[k] ?? 0) >= THRESHOLDS.yes;
  const reasons: Array<[Verdict, string]> = [];

  // A credential shows up two ways: the whole-draft statement, or a key-shaped span the
  // model confirmed. The span is the sharper signal, so take whichever is higher.
  const keySpan = Math.max(0, ...spans.filter((s) => s.kind === "key").map((s) => p[s.id] ?? 0));
  if (Math.max(p.secret ?? 0, keySpan) >= THRESHOLDS.span) reasons.push(["block", "contains a credential"]);
  // A contact span underlines the fragment and nothing more. The brief only ever asked the span
  // read for the red wavy underline; letting it hard-block on its own turned every external
  // draft in which the author gave out their own work email into a blocked send.
  //
  // `pii` owns this verdict, with the author's-own carve-out applied here rather than in the
  // statement (see AUTHOR). A draft whose only located contact details are the author's own
  // cannot be a customer-PII block, whatever the statement answered. A draft with no contact
  // spans at all still can: the statement reads more than the regexes locate.
  const contacts = spans.filter((s) => s.kind === "email" || s.kind === "phone");
  const authorsOwn = contacts.length > 0 && contacts.every(isAuthorContact);
  if (yes("pii") && !authorsOwn) reasons.push([external ? "block" : "warn", external ? "customer PII to an external audience" : "customer PII"]);
  if (external && (yes("confidential") || yes("confidentialPeople"))) reasons.push(["block", "leaks confidential internal info"]);

  const tone = toneLevel(p);
  if (tone >= 3) reasons.push([external ? "block" : "warn", "hostile tone"]);
  else if (tone >= 2) reasons.push(["warn", "curt tone"]);

  if (yes("commitment")) reasons.push(["warn", "makes a binding commitment"]);
  // The level-2 rung of the legal scale reads "passes on one person's private contact details",
  // so it fires on the author handing out their own work email and desk phone — measured level 2
  // on both phrasings of that tuning draft. The same carve-out that owns `pii` owns this: whose
  // details they are is code's to know. Level 3 is left alone; nothing in that rung is about the
  // author's own contact details.
  if (j.legal !== null && j.legal >= THRESHOLDS.legalBlock) reasons.push(["block", "severe legal/compliance risk"]);
  else if (j.legal !== null && j.legal >= THRESHOLDS.legalWarn && !authorsOwn) reasons.push(["warn", "legal exposure"]);
  if (yes("misfit")) reasons.push(["warn", "doesn't fit this audience"]);
  if (fragment) reasons.push(["warn", "looks unfinished"]);
  if (yes("hedging")) reasons.push(["warn", "hedging undermines the message"]);

  // /classify reads the whole draft and cannot tell a pasted key from one the draft calls a
  // fake example: it says block 0.94 on "let's use an obviously fake placeholder key ...
  // sk-live-000...". The span read is the sharper signal and the page says so, so when every
  // key the model looked at came back harmless, /classify may still warn but may not block.
  const keySpans = spans.filter((s) => s.kind === "key");
  const keysCleared =
    keySpans.length > 0 &&
    (p.secret ?? 0) < THRESHOLDS.quiet &&
    keySpans.every((s) => (p[s.id] ?? 0) < THRESHOLDS.quiet);
  // The second thing /classify cannot do is read half a sentence. On "Rolled back the relay
  // because the signature check was rejecting v1 payloads and the" — an internal engineering
  // note cut off mid-clause, with nothing harmful in it — it answers block 0.89, because none of
  // the three labels fits a fragment and block is the loudest. A guard that judges every typing
  // pause would then paint the composer red for most of the time the author spends writing.
  // Code already knows the draft is unfinished, so an unfinished draft caps /classify at a warn.
  // The hard rules are untouched: a fragment holding a credential, a customer's details or a
  // leak still blocks on its own statement.
  const fromClassify: Verdict | null =
    j.verdictScore < THRESHOLDS.classify ? null
      : j.verdict === "block" ? (keysCleared || fragment ? "warn" : "block")
        : j.verdict === "warn" ? "warn"
          : null;
  if (fromClassify)
    reasons.push([fromClassify, fromClassify === "block" ? "model: must not be sent" : "model: review before sending"]);

  let verdict: Verdict = "send";
  for (const [v] of reasons) verdict = worse(verdict, v);
  const top = reasons.filter(([v]) => v === verdict).map(([, r]) => r);
  return {
    verdict,
    reason: verdict === "send" ? "Looks good" : top.slice(0, 2).join(" · "),
    culpritSpanIds: spans
      .filter((s) => (p[s.id] ?? 0) >= spanHit(s.kind) && !isAuthorContact(s))
      .map((s) => s.id),
  };
}

/** What a classic regex DLP rule decides: block on key-like tokens, warn on contact details. */
export function regexVerdict(kinds: string[]): { verdict: Verdict; reason: string } {
  if (kinds.includes("key")) return { verdict: "block", reason: "key-like token" };
  if (kinds.includes("email") || kinds.includes("phone")) return { verdict: "warn", reason: "contact detail" };
  return { verdict: "send", reason: "no pattern matched" };
}

/* -------------------------------------------------------------------- misc */

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}
