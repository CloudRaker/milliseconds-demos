// Seed data for the inbox-blitz demo, copied from the Jev experiment
// (jev-experiments/inbox-blitz/src/data/{emails,traps}.ts and src/lib/types.ts).
// Deterministic: mulberry32(20260917) produces the same 500 emails on every load,
// so the page renders a full inbox before any request is made.

export const CATEGORIES = ["billing", "bug", "feature_request", "sales_lead", "security", "legal_privacy", "spam_marketing", "internal", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const URGENCY_LEVELS = ["Can wait a week", "This week", "Today", "Right now"] as const;
export const SENTIMENT_LEVELS = ["Friendly", "Neutral", "Frustrated", "Furious"] as const;

export interface Email {
  id: string;
  from: string;
  fromEmail: string;
  subject: string;
  body: string;
  receivedAt: string;
  threadId?: string;
  /** Present on hand-written fixtures designed to defeat keyword rules. */
  trap?: string;
}

/** One email judged on all seven dimensions. Fields land as their batch call returns. */
export interface Judgment {
  category: Category;
  categoryConfidence: number;
  categoryProbabilities: Record<string, number>;
  needsReply: number;
  urgency: number; // 0..3
  urgencyConfidence: number;
  sentiment: number; // 0..3
  sentimentConfidence: number;
  isPhishingOrScam: number;
  mentionsChurnOrCancel: number;
  asksForRefund: number;
}

/** The API sees one text per email: From line, subject, blank line, body. */
export function emailText(e: Email): string {
  return `From: ${e.from} <${e.fromEmail}>\nSubject: ${e.subject}\n\n${e.body}`;
}

export interface TrapEmail {
  from: string;
  fromEmail: string;
  subject: string;
  body: string;
  trap: string;
}

export const TRAPS: TrapEmail[] = [
  {
    from: "Priya Raman",
    fromEmail: "priya.raman@corvid-logistics.com",
    subject: "not urgent at all",
    body: "Hey team,\n\nNot urgent at all, take your time... just kidding. Prod is down for all of our warehouses since 09:40 and the API returns 502 on every request. Drivers can't scan anything.\n\nPlease call me. +1 (415) 555-0142.\n\nPriya",
    trap: "Sarcastic 'not urgent' → keyword rules say low urgency; the situation is a full outage.",
  },
  {
    from: "Northwind Product Updates",
    fromEmail: "updates@news.northwind.cloud",
    subject: "New: automated refund workflows, plus 3 more September features",
    body: "September product update\n\n• Automated refund workflows: issue a refund from the order view in one click.\n• Cancel-anytime toggles for subscription plans.\n• Faster invoice PDF generation.\n• New security dashboard.\n\nYou are receiving this because you opted in to product news. Manage preferences | Unsubscribe",
    trap: "Newsletter mentions 'refund' and 'cancel' as feature names → rules flag refund + churn; nobody is asking for anything.",
  },
  {
    from: "Marcus Bell",
    fromEmail: "mbell@harlow-dental.com",
    subject: "Great job guys",
    body: "Great job guys. Really love paying twice for the same month. Truly a wonderful experience, five stars. 🙃\n\nInvoice #INV-20933 and #INV-20941 are both for September. Please sort it out.\n\nMarcus",
    trap: "Sarcasm: 'great job', 'love', 'wonderful' → rules read it as friendly; the sender is clearly frustrated about a double charge.",
  },
  {
    from: "Elena Vogt",
    fromEmail: "e.vogt@brightpath.io",
    subject: "Question about my invoice (I'm NOT cancelling!)",
    body: "Hi,\n\nTo be clear up front: I am not cancelling and I don't want to cancel anything. I just want to understand why the September invoice shows 14 seats when we have 12 users.\n\nThanks,\nElena",
    trap: "Contains 'cancel' three times while explicitly saying she is not cancelling → rules flag churn.",
  },
  {
    from: "Grant @ SecureScore",
    fromEmail: "grant@securescore-outreach.com",
    subject: "URGENT: your security score dropped this week",
    body: "Hi there,\n\nOur scanner noticed your domain's security score dropped 4 points this week. Companies like yours lose an average of $4.2M per breach!\n\nBook a 15-minute call this week and I'll send over a free report. Limited slots available.\n\nGrant Ellis\nSecureScore | Enterprise Security Ratings",
    trap: "'URGENT' + 'security' + 'breach' → rules classify as urgent security; it is cold sales outreach.",
  },
  {
    from: "Dana Whitfield",
    fromEmail: "dana.whitfield.ceo@gmail.com",
    subject: "quick favor",
    body: "Are you at your desk? I'm in a board meeting and can't talk. Need you to handle something for me quickly and discreetly. Reply as soon as you see this.\n\nSent from my iPhone",
    trap: "Classic CEO-impersonation gift-card scam with zero phishing keywords (no link, no 'password', no 'verify').",
  },
  {
    from: "Tom Okafor",
    fromEmail: "tom.okafor@meridian-hr.com",
    subject: "Password reset link goes to a blank page",
    body: "Hi support,\n\nWhen I click the password reset link in the email you send, I land on a blank page. Tried Chrome and Safari. Can you verify the link is working on your end and update the account settings? Happy to send a screenshot.\n\nTom",
    trap: "'password', 'link', 'verify', 'account' → rules flag phishing; it is a legitimate bug report.",
  },
  {
    from: "Sofia Lindqvist",
    fromEmail: "sofia@kettlebrook.se",
    subject: "small thing whenever you have a moment",
    body: "Hello,\n\nWhenever you have a moment: since this morning every export we run comes back empty, and the nightly sync appears to have deleted last week's records for all of our users. We're a hospital scheduling team so we're working from paper right now.\n\nNo rush if you're busy.\n\nSofia",
    trap: "Polite understatement ('whenever you have a moment', 'no rush') hides data loss in a hospital → rules say low urgency.",
  },
  {
    from: "FlashDeals",
    fromEmail: "promo@flashdeals-mail.net",
    subject: "ASAP: 70% off ends at midnight!!!",
    body: "Act ASAP! Only hours left to grab 70% off our entire catalog. This is CRITICAL savings you can't miss!!!\n\nShop now → https://flashdeals-mail.net/sale\n\nUnsubscribe",
    trap: "'ASAP', 'CRITICAL', exclamation marks → rules score maximum urgency and 'furious' sentiment; it is marketing noise.",
  },
  {
    from: "Rebecca Chao",
    fromEmail: "rchao@atlas-freight.com",
    subject: "Evaluating options for Q1",
    body: "Hello,\n\nWe're a 400-person freight company and we're evaluating options for Q1. Your Enterprise tier came up in a few conversations. Who would be the right person to walk us through it and talk numbers? Ideally next week.\n\nRebecca Chao\nVP Operations, Atlas Freight",
    trap: "A strong sales lead with none of the words 'pricing', 'quote', 'demo', 'buy' → rules fall through to 'other'.",
  },
  {
    from: "Jonas Petersen",
    fromEmail: "jonas@nordicroast.dk",
    subject: "It's broken that I can't export to CSV",
    body: "Honestly it's broken that there's still no CSV export from the reports page. Every competitor has this. Please add it so we can stop copy-pasting into spreadsheets.\n\nJonas",
    trap: "'broken' → rules classify as a bug; the sender is asking for functionality that does not exist (feature request).",
  },
  {
    from: "Amira Haddad",
    fromEmail: "amira.haddad@lumenworks.co",
    subject: "Re: Duplicate charge on order 88213",
    body: "Perfect, thank you so much — I see the credit on my statement now. You can close this one.\n\nAmira\n\n> On Tue, Sep 15, support@northwind.cloud wrote:\n> Hi Amira, I've issued a refund for the duplicate charge on order 88213. It should appear within 3-5 business days.\n>\n>> Hi, I was charged twice for order 88213 and I'd like a refund of the second charge please.",
    trap: "'refund' appears only in quoted history → rules flag refund + needs reply; the thread is resolved and needs no reply.",
  },
  {
    from: "Derek Malone",
    fromEmail: "dmalone@pinecrest-builders.com",
    subject: "Numbers don't match",
    body: "The amount on my card statement this month is $412.80 but the dashboard says my plan is $349. What's the difference for? Nobody told me about any change.\n\nDerek",
    trap: "A billing dispute with no 'invoice', 'charge', 'billing' or 'refund' keyword → rules say 'other'.",
  },
  {
    from: "Lukas Brandt",
    fromEmail: "lukas.brandt@posteo.de",
    subject: "wipe my stuff",
    body: "Hi, can you wipe everything you have on me? Account, emails, the lot. I'm in Germany and I believe I have the right to ask for this. Please confirm when it's done.\n\nLukas",
    trap: "A GDPR erasure request without 'GDPR', 'delete my data' or 'privacy' → rules miss legal_privacy.",
  },
  {
    from: "Helen Ashworth",
    fromEmail: "h.ashworth@ashworth-partners.co.uk",
    subject: "Re: Re: Re: Ticket 44120",
    body: "I have now explained this four times to four different people. I will not be explaining it a fifth time. I expect a resolution and a named owner by end of day, or my next email goes to your CEO and our legal counsel.\n\nHelen Ashworth",
    trap: "Icy fury with no caps, no swearing, no exclamation marks → rules score sentiment as neutral.",
  },
  {
    from: "Nate Ruiz",
    fromEmail: "nate@fernhill-studio.com",
    subject: "Heads up on next month",
    body: "Just a heads up: we've signed with Ledgerly starting October 1st, so we'll be moving our data over during the last week of September. Can someone send instructions for a full export?\n\nNate",
    trap: "Sender is switching to a competitor but never writes 'cancel', 'churn' or 'leaving' → rules miss churn.",
  },
  {
    from: "DocuSign",
    fromEmail: "noreply@docusign-esign-notice.com",
    subject: "Completed: Please review and sign your document",
    body: "A document has been shared with you for signature.\n\nDocument: Vendor_Agreement_Q3.pdf\nSender: Accounts Payable\n\nREVIEW DOCUMENT: https://docusign-esign-notice.com/view/8213\n\nThis is an automated message from DocuSign. Do not reply.",
    trap: "Polite lookalike-domain phishing with no 'urgent'/'password'/'verify' → rules classify as 'other'.",
  },
  {
    from: "Casey Nguyen",
    fromEmail: "casey@sunnybrook-bakery.com",
    subject: "THANK YOU!!!",
    body: "THANK YOU SO MUCH!!! YOU GUYS ROCK!!! The migration went PERFECTLY and my whole team is thrilled. Seriously, BEST support team I have ever dealt with!!!\n\nCasey",
    trap: "All caps and triple exclamation marks → rules score 'furious'; the sender is delighted.",
  },
  {
    from: "Workplace Weekly",
    fromEmail: "digest@workplaceweekly-news.com",
    subject: "Emergency preparedness: 7 critical steps every office needs",
    body: "This week in Workplace Weekly\n\n• Emergency preparedness: 7 critical steps every office needs\n• How to run an urgent all-hands without the panic\n• Case study: a security breach that wasn't\n\nRead online | Unsubscribe",
    trap: "'Emergency', 'critical', 'urgent', 'breach' in a newsletter → rules score it as urgent security.",
  },
  {
    from: "Ibrahim Diallo",
    fromEmail: "ibrahim@westbay-clinic.org",
    subject: "Re: Login loop on iPad",
    body: "No worries, clearing the cache fixed it. You can close this.\n\nIbrahim\n\n> Hi Ibrahim, could you try clearing Safari's cache and let us know if the login loop persists?",
    trap: "Customer closing the loop → rules treat every customer email as needing a reply.",
  },
];

/** Deterministic PRNG (mulberry32) so every run sees the same 500 emails. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Ava", "Liam", "Noah", "Mia", "Ethan", "Zoe", "Omar", "Ines", "Kenji", "Leila", "Mateo", "Hanna", "Ravi", "Chloe", "Felix", "Nora", "Yusuf", "Freya", "Diego", "Anya", "Theo", "Maya", "Idris", "Sana", "Otto", "Wren", "Bao", "Elif", "Jonah", "Rosa"];
const LAST = ["Kowalski", "Mensah", "Fischer", "Tanaka", "O'Neill", "Novak", "Haddad", "Silva", "Bergström", "Adeyemi", "Moreau", "Ivanova", "Castillo", "Brennan", "Okoye", "Larsen", "Nakamura", "Reyes", "Duval", "Petrov", "Achebe", "Hughes", "Sato", "Marin", "Weber"];
const COMPANIES = ["Bluefin Analytics", "Harbor & Vine", "Oakridge Health", "Tessellate Labs", "Kingsway Logistics", "Meadowlark Books", "Copperline Energy", "Northstar Dental", "Riverbend Schools", "Solstice Apparel", "Glasswing Studio", "Ironclad Fitness", "Pemberton Law", "Verdant Farms", "Halcyon Travel", "Quarry Street Coffee", "Lumen Robotics", "Fairweather Insurance", "Saltmarsh Brewing", "Pinnacle Realty"];
const PLANS = ["Starter", "Team", "Business", "Enterprise"];
const FEATURES = ["the reports dashboard", "CSV import", "the mobile app", "SSO login", "webhook delivery", "the API", "scheduled exports", "the billing portal", "team permissions", "the Slack integration", "search", "the audit log"];
const ERRORS = ["a 500 error", "a blank white screen", "'Something went wrong'", "a spinner that never finishes", "error code E_TIMEOUT", "'Permission denied' even for admins", "a 502 from the gateway"];
const COMPETITORS = ["Ledgerly", "Stackline", "Cobalt", "Brightwork", "Fathom"];
const INTERNAL_NAMES = ["Sam Ortiz", "Jules Park", "Devi Rao", "Kim Achterberg", "Marco Lenz", "Tobi Adler", "Ren Ishikawa", "Ola Nowak"];

interface Gen {
  from: string;
  fromEmail: string;
  subject: string;
  body: string;
  threadId?: string;
}

interface Ctx {
  r: () => number;
  pick: <T>(arr: readonly T[]) => T;
  int: (a: number, b: number) => number;
  person: () => { name: string; email: string; company: string; domain: string };
  amount: () => string;
  orderNo: () => string;
  ticket: () => string;
  invoice: () => string;
}

function makeCtx(r: () => number): Ctx {
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(r() * arr.length)];
  const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  return {
    r,
    pick,
    int,
    person: () => {
      const first = pick(FIRST);
      const last = pick(LAST);
      const company = pick(COMPANIES);
      const domain = company.toLowerCase().replace(/[^a-z]+/g, "") + pick([".com", ".io", ".co", ".org"]);
      const email = `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, "")}@${domain}`;
      return { name: `${first} ${last}`, email, company, domain };
    },
    amount: () => `$${int(19, 2400)}.${pick(["00", "50", "99", "20", "80"])}`,
    orderNo: () => String(int(40000, 99999)),
    ticket: () => String(int(40000, 49999)),
    invoice: () => `INV-${int(20000, 29999)}`,
  };
}

type Template = (c: Ctx) => Gen;

const sign = (c: Ctx, p: { name: string; company: string }) => c.pick([`\n\n${p.name}`, `\n\nThanks,\n${p.name}`, `\n\nBest,\n${p.name}\n${p.company}`, `\n\nRegards,\n${p.name.split(" ")[0]}`, `\n\n${p.name.split(" ")[0]}\nSent from my phone`]);

const billing: Template[] = [
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: `Charged twice for ${c.pick(["September", "this month", "order " + c.orderNo()])}`, body: `Hi,\n\nMy card was charged twice (${c.amount()} each) ${c.pick(["on the 3rd", "yesterday", "this morning", "last week"])}. I only have one ${c.pick(PLANS)} subscription. Can you refund the duplicate?${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: `Invoice ${c.invoice()} question`, body: `Hello,\n\nInvoice ${c.invoice()} shows ${c.int(8, 40)} seats but we only have ${c.int(3, 7)} active users. Could you explain the line items or send a corrected invoice?${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "Need a receipt for accounting", body: `Hi team,\n\nOur finance department needs a PDF receipt for the ${c.pick(["annual", "quarterly", "last"])} payment of ${c.amount()} with our VAT number on it. Where can I download that?${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "Downgrade request", body: `Hi,\n\nWe'd like to move from ${PLANS[2]} to ${PLANS[1]} starting next billing cycle. Will the difference be prorated? We're not leaving, just right-sizing.${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "Payment failed but card is fine", body: `Hello,\n\nI'm getting 'payment failed' emails every day but the card works everywhere else and has plenty of room. Can you check what your processor is rejecting? I don't want the account suspended.${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: `Refund for unused ${c.pick(PLANS)} seats`, body: `Hi,\n\nWe removed ${c.int(2, 9)} users on the ${c.pick(["2nd", "5th", "9th", "11th", "14th", "19th", "23rd"])} but were billed for the full month. Please refund the unused portion (${c.amount()}) to the original card.${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "Update billing email", body: `Hi,\n\nPlease send future invoices to ap@${p.domain} instead of my address. Nothing else changes.${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "Why did my price go up?", body: `My monthly charge went from ${c.amount()} to ${c.amount()} without any email about it. I'd like an explanation and, if this was a mistake, a credit for the difference.${sign(c, p)}` };
  },
];

const bugs: Template[] = [
  (c) => {
    const p = c.person();
    const f = c.pick(FEATURES);
    const err = c.pick(ERRORS);
    return { from: p.name, fromEmail: p.email, subject: `${f[0].toUpperCase()}${f.slice(1)} shows ${err}`, body: `Hi,\n\nSince ${c.pick(["this morning", "yesterday's update", "about an hour ago", "Monday"])}, ${f} shows ${err} for ${c.pick(["everyone on our team", "two of our users", "me only", "all admins"])}. ${c.pick(["Reloading doesn't help.", "Incognito mode has the same issue.", "It worked fine last week.", "Happens in Chrome and Firefox."])} ${c.pick(["Steps: open the page, click Export, wait 10 seconds.", "Screenshot attached.", "Let me know what logs you need.", "Our account id is " + c.int(1000, 9999) + "."])}${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "Webhooks arriving twice", body: `Hello,\n\nWe're receiving every webhook event twice, about ${c.int(2, 40)} seconds apart, with the same event id. Started ${c.pick(["last night", "after the maintenance window", "on Friday"])}. Our system dedupes so it's not critical, but it's noisy.${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "Mobile app crashes on open", body: `The iOS app (version ${c.int(4, 7)}.${c.int(0, 9)}.${c.int(0, 9)}) crashes immediately on launch on my iPhone ${c.int(13, 17)}. Reinstalled twice. Android colleagues are fine.${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "Data not syncing between devices", body: `Hi,\n\nChanges I make on desktop don't show on the mobile app for ${c.int(10, 90)} minutes. Is there a known sync delay right now? It's making it hard to coordinate with my field team.${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "URGENT: whole team locked out", body: `Nobody at ${p.company} can log in — ${c.int(15, 120)} people. SSO redirects to an error page saying 'invalid state'. We have a ${c.pick(["client presentation", "payroll run", "board meeting", "product launch"])} in ${c.int(1, 3)} hours. Please treat as P1.${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "Typo on settings page", body: `Tiny thing: on the Settings > Notifications page 'recieve' is misspelled. Not important, just thought you'd want to know.${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "Search returns nothing", body: `Hi,\n\nSearching for anything in ${c.pick(FEATURES)} returns zero results even for items I can see on screen. Affects our whole workspace. Started around ${c.int(1, 12)}${c.pick(["am", "pm"])} today.${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "API rate limit lower than documented?", body: `Hello,\n\nDocs say ${c.int(500, 2000)} requests/min on ${c.pick(PLANS)} but we get 429s at about ${c.int(100, 400)}. Is that a bug or did the limits change? We're throttling on our side for now.${sign(c, p)}` };
  },
];

const features: Template[] = [
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "Feature request: dark mode", body: `Hi!\n\nWould love a dark mode for the dashboard, our ops team runs it on a wall screen all night. Not a blocker, just a wish.${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    const f = c.pick(["a Zapier integration", "bulk editing", "custom fields", "an offline mode", "two-way calendar sync", "role-based dashboards"]);
    return { from: p.name, fromEmail: p.email, subject: `Any plans for ${f}?`, body: `Hello,\n\nWe'd get a lot of value from ${f}. Is it on the roadmap? Happy to be a design partner.${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "Suggestion for the export flow", body: `It would be great if scheduled exports could go straight to an S3 bucket instead of email. Right now someone downloads the attachment every morning and uploads it by hand.${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "Keyboard shortcuts please", body: `Hi team, small ask: keyboard shortcuts for archiving and assigning. Power users on our side would love it. Thanks for the great product.${sign(c, p)}` };
  },
];

const sales: Template[] = [
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "Pricing for ~" + c.int(50, 900) + " seats", body: `Hi,\n\nWe're looking at rolling ${c.pick(["your platform", "Northwind"])} out to about ${c.int(50, 900)} people across ${c.int(2, 6)} offices. Can you send Enterprise pricing and let us know what the implementation timeline looks like?${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "Demo request", body: `Hello,\n\nI'd like to book a demo for our ${c.pick(["operations", "finance", "customer success", "engineering"])} team (${c.int(4, 12)} people). We're currently on ${c.pick(COMPETITORS)} and the renewal is in ${c.pick(["6 weeks", "two months", "Q1"])}. Availability next week?${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "Upgrading to Business", body: `Hi,\n\nWe've outgrown ${PLANS[1]}. What does moving to ${PLANS[2]} involve and can we get an annual quote? We'd also need SSO.${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "Procurement questions", body: `Hello,\n\nOur procurement team needs a W-9, your SOC 2 report and a security questionnaire filled in before we can sign. Who should I send these to? Targeting a start date of the 1st.${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "Trial ending — some questions", body: `Hi,\n\nOur trial ends in ${c.int(2, 5)} days and we're leaning towards buying. Two questions: does the ${c.pick(PLANS)} plan include ${c.pick(FEATURES)}, and is there a discount for nonprofits?${sign(c, p)}` };
  },
];

const spam: Template[] = [
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: `${p.name.split(" ")[0].toLowerCase()}@${c.pick(["growthstack", "leadgenpro", "scaleup-agency", "outboundhq", "pipelinebooster"])}.${c.pick(["com", "io", "co"])}`, subject: c.pick(["Quick question", "Re: your growth goals", `${p.company.split(" ")[0]} x Northwind?`, "Following up", "Idea for your team", "10x your pipeline"]), body: `Hi there,\n\nI noticed your company is growing fast — congrats! We help teams like yours ${c.pick(["book 30+ qualified meetings a month", "cut cloud costs by 40%", "automate lead generation with AI", "hire senior engineers in 2 weeks", "rank #1 on Google"])}.\n\nWorth a quick 15-minute chat ${c.pick(["Tuesday", "this week", "Thursday at 2pm"])}?\n\n${p.name}\n${c.pick(["Head of Growth", "Founder & CEO", "Partnerships"])}\n\nP.S. If you're not the right person, who is?` };
  },
  (c) => ({ from: "Deals Central", fromEmail: "promo@dealscentral-mail.com", subject: c.pick([`${c.int(30, 80)}% off everything — this weekend only`, "Your exclusive coupon inside", "Last chance: flash sale ends tonight", "You've been selected for VIP pricing"]), body: `Don't miss out! ${c.pick(["Thousands of items", "Our entire range", "Selected brands"])} at up to ${c.int(30, 80)}% off. Use code ${c.pick(["SAVE", "BLITZ", "VIP"])}${c.int(10, 99)} at checkout.\n\nShop now → https://example-promo.net/sale\n\nYou received this because you shopped with us. Unsubscribe` }),
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: `${p.name.split(" ")[0].toLowerCase()}@${c.pick(["seo-wizards", "devshop-offshore", "linkbuilders", "webdesign-cheap"])}.net`, subject: c.pick(["Your website has 37 SEO errors", "We can redesign your website", "Guest post opportunity", "Link exchange proposal"]), body: `Dear Sir/Madam,\n\nI was going through your website and found several issues affecting your Google ranking. Our team of ${c.int(20, 200)} experts can fix this at a very affordable price.\n\nCan I send you a free audit report?\n\nKind regards,\n${p.name}` };
  },
  (c) => ({ from: "Events @ CloudSummit", fromEmail: "events@cloudsummit-events.com", subject: c.pick(["[Webinar] Scaling support with AI — reserve your seat", "You're invited: CloudSummit 2026", "Free ticket: SaaS Growth Conf"]), body: `Join ${c.int(500, 5000)}+ leaders for ${c.pick(["a live webinar", "our flagship conference", "a virtual summit"])} on ${c.pick(["AI in customer support", "scaling revenue operations", "the future of work"])}.\n\nRegister free → https://example-events.com/register\n\nCan't make it? Register anyway and we'll send the recording. Unsubscribe` }),
];

const newsletters: Template[] = [
  (c) => {
    const lead = c.pick(["Why onboarding is your best retention lever", "The case against roadmaps", "How we cut our infra bill in half", "Interview: running support at scale", "Five tools we're watching this month"]);
    return { from: "The Ops Digest", fromEmail: "hello@opsdigest.news", subject: `Issue #${c.int(80, 420)}: ${lead}`, body: `${c.pick(["Good morning!", "Hi friend,", "Welcome back."])} This week:\n\n• ${lead}\n• ${c.pick(["A checklist for cancelling unused SaaS", "Refund policies that don't hurt", "Security basics for small teams", "What good incident comms look like"])}\n• Community spotlight and job board\n\nRead the full issue online. You're receiving this because you subscribed. Unsubscribe anytime.` };
  },
  (c) => {
    const item = c.pick(["faster search", "new API version", "improved permissions", "redesigned mobile app", "workflow automations"]);
    return { from: "Northwind Changelog", fromEmail: "changelog@updates.northwind.cloud", subject: `What's new: ${item}`, body: `Here's what shipped this month:\n\n- ${item}\n- Bug fixes and performance improvements\n- Deprecation notice: the v1 endpoints will be removed on ${c.pick(["Dec 1", "Jan 15", "March 31"])}\n\nManage your notification preferences in Settings.` };
  },
];

const internal: Template[] = [
  (c) => {
    const n = c.pick(INTERNAL_NAMES);
    const [subject, body] = c.pick([
      ["Standup moved to 10:15", "Quick note: standup moves to 10:15 starting tomorrow so the Berlin folks can join."],
      ["Q4 planning doc — comments by Friday", "I've shared the Q4 planning doc. Please leave comments by Friday EOD."],
      ["Office closed Monday", "The office is closed Monday for the public holiday. Enjoy the long weekend!"],
      ["Lunch order for the offsite", "Please add your lunch choice to the sheet for the offsite by Wednesday."],
      ["Reminder: expense reports due", "Expense reports for last month are due by the 5th, thanks!"],
      ["New parental leave policy", "HR has published the updated parental leave policy on the wiki."],
    ]);
    return { from: n, fromEmail: `${n.split(" ")[0].toLowerCase()}@northwind.cloud`, subject, body: `Hey all,\n\n${body}\n\n${n.split(" ")[0]}` };
  },
  (c) => {
    const n = c.pick(INTERNAL_NAMES);
    const [subject, body] = c.pick([
      ["Can you review my PR?", "Could you take a look at PR #" + c.int(1000, 4000) + " when you get a chance? Not blocking."],
      ["1:1 reschedule?", "Can we push our 1:1 to Thursday? Dentist."],
      ["Slides for Thursday", "Attached the slides for Thursday's customer call. Section 3 needs your numbers."],
      ["Draft customer email — thoughts?", "Draft response to the Oakridge escalation below — does the tone land?"],
    ]);
    return { from: n, fromEmail: `${n.split(" ")[0].toLowerCase()}@northwind.cloud`, subject, body: `Hi,\n\n${body}\n\n${n.split(" ")[0]}` };
  },
  (c) => {
    const n = c.pick(INTERNAL_NAMES);
    const [subject, body] = c.pick([
      ["FYI: vendor invoice for AWS", "Finance received the AWS invoice for last month; it's within budget. No action needed."],
      ["Laptop refresh schedule", "IT will refresh laptops older than 3 years starting next week. Book a slot in the calendar."],
      ["Payroll cutoff this Friday", "Payroll cutoff is Friday at noon; get your timesheets in."],
      ["Support rota for the holidays", "Please fill in the holiday support rota by the 20th."],
    ]);
    return { from: n, fromEmail: `${n.split(" ")[0].toLowerCase()}@northwind.cloud`, subject, body: `Team,\n\n${body}\n\n${n.split(" ")[0]}` };
  },
];

const security: Template[] = [
  (c) => ({ from: "Northwind Security", fromEmail: "security-alerts@northwind.cloud", subject: `New sign-in from ${c.pick(["Lagos, Nigeria", "São Paulo, Brazil", "Hanoi, Vietnam", "an unrecognised device", "Tor exit node"])}`, body: `We detected a new sign-in to the admin account ${c.pick(["ops", "billing", "root", "admin"])}@northwind.cloud from ${c.pick(["Lagos, Nigeria", "São Paulo, Brazil", "Hanoi, Vietnam", "an unrecognised device"])} at ${c.int(0, 23)}:${c.int(10, 59)} UTC. ${c.pick(["2FA was not completed.", "The session is still active.", "Password was changed 2 minutes later."])}\n\nIf this wasn't you, revoke the session and rotate credentials immediately.` }),
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "Possible vulnerability in your API", body: `Hello security team,\n\nI'm a security researcher. I believe the ${c.pick(["/v2/users", "/export", "/invite"])} endpoint leaks ${c.pick(["other tenants' email addresses", "internal ids", "session tokens in error messages"])} when given a malformed id. I have a proof of concept and have not shared it with anyone. Do you have a responsible disclosure program?${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "I think my account was hacked", body: `Hi,\n\nThere are ${c.int(2, 8)} API keys in my account I never created, and the notification email was changed to an address I don't recognise. Please lock the account and help me recover it. I've already changed my password.${sign(c, p)}` };
  },
  (c) => {
    const sev = c.pick(["High", "Critical", "Medium"]);
    const [title, detail] = c.pick([
      ["CVE in lodash", "A dependency with a known vulnerability is in use."],
      ["Exposed S3 bucket", "A storage bucket allows public listing."],
      ["Unusual API call pattern", "An IAM principal made unusual calls from a new region."],
      ["TLS certificate expires in 3 days", "A certificate expires in 3 days."],
    ]);
    return { from: "Cloud Security Monitor", fromEmail: "alerts@monitor.northwind.cloud", subject: `[${sev}] ${title}`, body: `Severity: ${sev}\nResource: ${c.pick(["prod-api", "billing-worker", "static-assets"])}\n\n${detail} Review the finding in the console.` };
  },
];

const escalations: Template[] = [
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: c.pick(["THIS IS UNACCEPTABLE", "Third time writing about this", "Escalation — ticket " + c.ticket(), "I want to speak to a manager"]), body: `${c.pick(["I have been waiting", "This is the third email I've sent", "Nobody has replied"])} for ${c.int(4, 12)} days about ${c.pick(["the double charge", "the outage that lost our data", "the broken import", "my locked account"])}. ${c.pick(["This is completely unacceptable for a paid product.", "We pay you " + c.amount() + " a month for this?", "My team has lost hours of work."])} ${c.pick(["Fix it today or we're cancelling and disputing the charge.", "I want a full refund and a call from a manager.", "I'm about to move everything to " + c.pick(COMPETITORS) + ".", "Reply today. I mean it."])}\n\n${p.name}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: `Re: ${c.pick(["Ticket " + c.ticket(), "Outage yesterday", "Missing invoice"])}`, body: `This is not good enough. Your last reply just repeated the FAQ. ${c.pick(["We're a hospital.", "We have 200 users depending on this.", "Our customers are asking us questions we can't answer."])} I need someone technical on a call today, not another template.\n\n${p.name}\n\n> Thanks for reaching out! Have you tried clearing your cache? Let us know if the issue persists.` };
  },
];

const legal: Template[] = [
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: c.pick(["GDPR data access request", "Subject access request under Art. 15", "Request for my personal data"]), body: `Dear Data Protection Officer,\n\nUnder Article 15 GDPR I request a copy of all personal data you hold about me, the purposes of processing, and any third parties it has been shared with. Please respond within the statutory one month.${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "Please delete my account and data", body: `Hi,\n\nI'd like to exercise my right to erasure. Please delete my account (${p.email}) and all associated data, and confirm in writing when complete.${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: `legal@${p.domain}`, subject: c.pick(["DPA for signature", "Questions on your Terms of Service", "Notice regarding trademark use"]), body: `To whom it may concern,\n\n${c.pick(["Please find attached our Data Processing Agreement for countersignature before we can proceed with onboarding.", "Section 9.2 of your Terms appears to limit liability below what our policy allows; can your counsel discuss?", "We note your marketing materials use a mark similar to our client's registered trademark. Please contact us within 14 days."])}\n\n${p.name}\nLegal, ${p.company}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "CCPA: do not sell my information", body: `Hello,\n\nAs a California resident I request that you do not sell or share my personal information, and that you disclose what categories you have collected in the past 12 months.${sign(c, p)}` };
  },
];

const phishing: Template[] = [
  (c) => ({ from: "IT Helpdesk", fromEmail: `no-reply@${c.pick(["micros0ft-secure", "office365-verify", "it-helpdesk-alerts"])}.com`, subject: c.pick(["Your password expires in 24 hours", "Action required: verify your mailbox", "[Final notice] Account suspension"]), body: `Your account password will expire in 24 hours. To keep your current password, verify your identity now:\n\nhttp://${c.pick(["micros0ft-secure", "office365-verify"])}.com/login?user=you\n\nFailure to verify will result in permanent suspension.\n\nIT Department` }),
  (c) => {
    const [from, domain, subject, body] = c.pick([
      ["PayPal", "paypa1-alerts", "We couldn't process your payment", "Your payment could not be processed. Update your billing details within 48 hours to avoid interruption."],
      ["Chase Bank", "chase-secure-msg", "Unusual activity on your account", "We noticed a sign-in from a new device. If this wasn't you, secure your account now."],
      ["Amazon", "amaz0n-orders", `Your order #${c.int(100000, 999999)} has been placed`, "Thank you for your order of an iPhone 17 Pro ($1,299). If you did not place this order, cancel it here."],
    ]);
    return { from, fromEmail: `service@${domain}.com`, subject, body: `Dear Customer,\n\n${body}\n\nhttps://${domain}.com/secure\n\nThis is an automated message.` };
  },
  (c) => {
    const [from, user] = c.pick([["Michael Torres", "mtorres"], ["Sarah Kim", "skim"], ["David Osei", "dosei"]]);
    const [subject, body] = c.pick([
      ["Updated bank details for invoice", "Our bank details have changed. Please pay the attached invoice (" + c.amount() + ") to the new account below before end of day."],
      ["Wire transfer today", "I need you to process a wire of " + c.amount() + " to the vendor below today. I'll send the paperwork after."],
      ["Overdue invoice — please pay", "This invoice is 30 days overdue. Please remit immediately to avoid legal action."],
    ]);
    return { from, fromEmail: `${user}.${c.pick(["finance", "exec", "office"])}@${c.pick(["outlook", "gmail", "protonmail"])}.com`, subject, body: `Hi,\n\n${body}\n\nIBAN: DE${c.int(10, 99)} ${c.int(1000, 9999)} ${c.int(1000, 9999)} ${c.int(1000, 9999)} ${c.int(1000, 9999)} 00\n\nRegards` };
  },
  (c) => ({ from: "Delivery Notification", fromEmail: `tracking@${c.pick(["dhl-parcel-notice", "ups-redelivery", "fedex-track-info"])}.net`, subject: `Package ${c.int(1000000, 9999999)} could not be delivered`, body: `We attempted to deliver your package but nobody was available. A redelivery fee of $${c.int(1, 3)}.${c.int(10, 99)} is required.\n\nPay and reschedule: https://${c.pick(["dhl-parcel-notice", "ups-redelivery"])}.net/track\n\nPackages not claimed within 3 days are returned to sender.` }),
];

const misc: Template[] = [
  (c) => {
    const p = c.person();
    const [subject, body] = c.pick([
      ["Speaking at our meetup?", "We run a monthly ops meetup and would love someone from your team to talk about how you do support. No sales pitch needed."],
      ["Podcast invitation", "I host a small podcast about SaaS operations. Would someone on your team be up for a 30-minute chat?"],
      ["Student project question", "I'm a student writing a thesis on ticket triage; would you be willing to answer three questions about your process?"],
      ["Partnership idea", "We build a complementary tool and think an integration would help both sides. Open to a chat?"],
    ]);
    return { from: p.name, fromEmail: p.email, subject, body: `Hi,\n\n${body}${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: c.pick(["Thank you!", "Kudos to your support team", "Just wanted to say thanks"]), body: `Hi,\n\nJust wanted to say ${c.pick(["thank you for the quick fix last week", "your support team is fantastic", "the new release is great"])}. ${c.pick(["No action needed.", "Made my Monday.", "Keep it up!"])}${sign(c, p)}` };
  },
  (c) => {
    const p = c.person();
    return { from: p.name, fromEmail: p.email, subject: "Wrong address?", body: `Hi, I think this email was meant for someone else — I've never used your product. Please remove me from whatever list this is.\n\n${p.name}` };
  },
];

const MIX: Array<[Template[], number]> = [
  [bugs, 84],
  [billing, 70],
  [spam, 55],
  [internal, 55],
  [sales, 45],
  [features, 35],
  [newsletters, 35],
  [security, 30],
  [escalations, 25],
  [phishing, 25],
  [legal, 20],
  [misc, 12],
];

export function generateEmails(seed = 20260917, target = 500): Email[] {
  const r = mulberry32(seed);
  const c = makeCtx(r);
  const drafts: Gen[] = [];
  for (const [templates, count] of MIX) {
    for (let i = 0; i < count; i++) drafts.push(c.pick(templates)(c));
  }
  for (const t of TRAPS) drafts.push(t);
  while (drafts.length < target) drafts.push(c.pick(misc)(c));

  // Shuffle deterministically (Fisher–Yates).
  for (let i = drafts.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [drafts[i], drafts[j]] = [drafts[j], drafts[i]];
  }

  // Spread arrivals over the last ~6 hours, newest first.
  const now = Date.parse("2026-09-17T17:00:00Z");
  const emails: Email[] = drafts.slice(0, target).map((d, i) => {
    const receivedAt = new Date(now - i * c.int(20_000, 70_000)).toISOString();
    const trap = "trap" in d ? (d as { trap: string }).trap : undefined;
    return { id: `m${String(i + 1).padStart(3, "0")}`, from: d.from, fromEmail: d.fromEmail, subject: d.subject, body: d.body, receivedAt, ...(trap ? { trap } : {}) };
  });

  // Turn ~8% of customer emails into short follow-ups in a thread.
  for (let i = 0; i < emails.length; i++) {
    const e = emails[i];
    const human = /^[a-z]+\.[a-z]+@/.test(e.fromEmail) && !/(outlook|gmail|protonmail)\.com$/.test(e.fromEmail);
    if (!human || e.trap || e.subject.startsWith("Re:") || r() > 0.09) continue;
    const followUpIdx = i - c.int(1, 20);
    if (followUpIdx < 0) continue;
    const target = emails[followUpIdx];
    if (target.trap || target.subject.startsWith("Re:")) continue;
    const threadId = `t${e.id}`;
    e.threadId = threadId;
    const quoted = e.body.split("\n").map((l) => `> ${l}`).join("\n");
    emails[followUpIdx] = {
      ...target,
      from: e.from,
      fromEmail: e.fromEmail,
      threadId,
      subject: `Re: ${e.subject}`,
      body: `${c.pick(["Any update on this?", "Following up — haven't heard back.", "Adding a screenshot as requested.", "Bumping this, still an issue on our side.", "Quick follow-up on the below."])}\n\n${e.from.split(" ")[0]}\n\n${quoted}`,
    };
  }
  return emails;
}

export const EMAILS: Email[] = generateEmails();

/** Include hand-written examples first, then seeded mail. Shared with the stock catalog. */
export const RUN_ORDER: Email[] = [...EMAILS.filter(e => e.trap), ...EMAILS.filter(e => !e.trap)];
