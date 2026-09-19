// Seed data for the live-minutes demo: the synthetic 12-minute product standup from the
// Jev experiment, copied verbatim (180 labelled utterances plus the meeting context).
// Ground truth rides along so the smoke script can score the model's answers.

export type Kind = "action_item" | "decision" | "open_question" | "risk" | "status_update" | "chit_chat";

export type DeadlineKind = "specific_date" | "this_week" | "next_sprint" | "before_launch" | "end_of_quarter" | "none";

export interface Attendee {
  name: string;
  role: string;
}

export interface MeetingContext {
  /** ISO date, e.g. 2026-09-17 */
  today: string;
  /** ISO date the current sprint ends */
  sprintEnd: string;
  /** Sprint length in days */
  sprintDays: number;
  /** ISO date of the launch the team is working toward */
  launch: string;
  attendees: Attendee[];
}

export interface Utterance {
  id: number;
  speaker: string;
  text: string;
  /** Seconds since meeting start when the utterance finishes */
  endsAt: number;
}


/** Synthetic product standup: "Checkout redesign" launch, Thursday 2026-09-17. No real people. */
export const MEETING: MeetingContext = {
  today: "2026-09-17",
  sprintEnd: "2026-09-25",
  sprintDays: 14,
  launch: "2026-10-01",
  attendees: [
    { name: "Priya Nair", role: "Engineering Manager" },
    { name: "Marcus Lee", role: "Backend Engineer" },
    { name: "Sofia Alvarez", role: "Product Manager" },
    { name: "Dev Okafor", role: "Product Designer" },
  ],
};

export const MEETING_TITLE = "Checkout redesign — daily standup";

const P = "Priya Nair";
const M = "Marcus Lee";
const S = "Sofia Alvarez";
const D = "Dev Okafor";

export interface GroundTruth {
  kind: Kind;
  /** Resolved owner name for action items; null = unassigned / not applicable */
  assignee: string | null;
  deadline: DeadlineKind;
  reverses: boolean;
  blocked: boolean;
}

export interface LabelledUtterance extends Utterance {
  truth: GroundTruth;
}

type Extra = { a?: string | null; dl?: DeadlineKind; rev?: true; blk?: true };
type Row = [speaker: string, text: string, kind: Kind, extra?: Extra];

// prettier-ignore
const ROWS: Row[] = [
  [P, "Morning everyone, let's get started, we've got a lot to cover today.", "chit_chat"],
  [M, "Morning. Coffee hasn't kicked in yet, bear with me.", "chit_chat"],
  [S, "Hey all. Quick heads up, I have a hard stop at the half hour.", "chit_chat"],
  [D, "Hi hi. Sharing my screen in a sec for the address form stuff.", "chit_chat"],
  [P, "Cool. Marcus, you want to kick off with the payment service migration?", "chit_chat"],

  [M, "Sure. So the migration to the new payments service is basically done, all the write paths are cut over.", "status_update"],
  [M, "Read paths are still going through the old service for about ten percent of traffic.", "status_update"],
  [P, "Any issues so far?", "open_question"],
  [M, "One thing, refund reconciliation is off by a few cents on some multi-currency orders.", "risk"],
  [M, "It's a rounding thing between the two services, not data loss, but finance will notice.", "risk"],
  [S, "Finance will definitely notice, they notice everything.", "chit_chat"],
  [P, "Marcus, can you write up the rounding discrepancy and send it to finance before end of day tomorrow?", "action_item", { a: M, dl: "specific_date" }],
  [M, "Yep, I'll have the write-up to finance by tomorrow.", "action_item", { a: M, dl: "specific_date" }],
  [M, "I also need someone to double check the currency table, I'm not confident the JPY entries are right.", "action_item", { a: null }],
  [S, "I can take the currency table check, I've got the spreadsheet from the last audit anyway.", "action_item", { a: S }],
  [P, "Great, Sofia has the currency table.", "chit_chat"],

  [P, "Okay, feature flag rollout. Where did we land on percentages?", "open_question"],
  [S, "My proposal was five percent tomorrow, twenty-five on Monday, then a hundred on launch day.", "status_update"],
  [M, "Five is fine. Twenty-five on Monday makes me a bit nervous with the reconciliation thing open.", "risk"],
  [D, "From a design side I don't care about percentages, as long as the new form is what people see.", "chit_chat"],
  [P, "Let's do five percent tomorrow and hold at five until the rounding issue is closed.", "decision"],
  [S, "Okay, so we hold at five until Marcus gives the all clear. That works.", "decision"],
  [M, "Sounds good.", "chit_chat"],
  [P, "Sofia, can you update the rollout doc with the new schedule?", "action_item", { a: S }],
  [S, "Will do, I'll update the rollout doc right after this.", "action_item", { a: S, dl: "specific_date" }],
  [P, "And we should let support know about the five percent, they've been asking.", "action_item", { a: null }],
  [S, "I'll take that too, I'm meeting the support lead at two.", "action_item", { a: S }],

  [P, "Analytics. Sofia, what are the numbers from the beta cohort looking like?", "open_question"],
  [S, "Conversion in the beta cohort is up four point two percent against control, which is honestly better than I expected.", "status_update"],
  [S, "Drop-off on the shipping step is down a lot, that's the new address autocomplete doing its thing.", "status_update"],
  [D, "Told you the autocomplete would pay for itself.", "chit_chat"],
  [S, "But, and this is weird, average order value is down about a dollar fifty.", "risk"],
  [M, "Down? Are people skipping the upsell step?", "open_question"],
  [S, "That's my guess but I don't actually know yet. Do we have the upsell impressions instrumented?", "open_question"],
  [M, "I don't think the upsell impressions are tracked in the new flow, we may have dropped that event in the rewrite.", "risk"],
  [P, "That's a problem, we need that before we go to twenty-five percent.", "risk"],
  [P, "Marcus, add the upsell impression event back this week please.", "action_item", { a: M, dl: "this_week" }],
  [M, "Okay, upsell impression event, this week.", "action_item", { a: M, dl: "this_week" }],
  [S, "And I'll dig into the AOV drop once we have a few days of that data.", "action_item", { a: S }],

  [P, "Dev, you're up. Address form review.", "chit_chat"],
  [D, "So I've got two versions of the address form. Version A stacks everything, version B puts city and postcode on one line.", "status_update"],
  [D, "Usability sessions liked B, but B breaks on narrow screens under three hundred and twenty pixels.", "risk"],
  [S, "How many users are under three twenty? Like, two?", "open_question"],
  [M, "It's more than you'd think, a lot of the older Android devices in the LATAM markets.", "status_update"],
  [D, "Right, so my proposal is B with a fallback to A below three sixty.", "status_update"],
  [P, "Fine by me. Let's go with B and the stacked fallback under three sixty.", "decision"],
  [S, "Agreed.", "chit_chat"],
  [D, "Cool. I'll have the final specs in Figma by Monday.", "action_item", { a: D, dl: "specific_date" }],
  [D, "Also, side note, can we please talk about the font at some point, the numerals in Inter look weird in the totals.", "open_question"],
  [M, "Oh no, not the font conversation again.", "chit_chat"],
  [D, "It's a legitimate concern! The zero and the letter O are basically identical in order numbers.", "risk"],
  [P, "Park the font, we're not changing typefaces two weeks before launch.", "decision"],
  [D, "Fine, fine. Parking it. I'll put it in the post-launch backlog.", "action_item", { a: D }],

  [M, "Okay, can I raise something about webhooks?", "chit_chat"],
  [P, "Go ahead.", "chit_chat"],
  [M, "Stripe webhook retries. Our new endpoint isn't idempotent yet, so if Stripe retries we could double-record a payment.", "risk"],
  [S, "Double-record as in charge twice?", "open_question"],
  [M, "No, charge once, record twice. Which is still bad because the order history shows two payments.", "risk"],
  [P, "How big a fix is idempotency?", "open_question"],
  [M, "A day, maybe a day and a half. It's mostly adding the event ID as a unique key.", "status_update"],
  [P, "Okay. Marcus, make the webhook endpoint idempotent, that has to land before we go past five percent.", "action_item", { a: M, dl: "before_launch" }],
  [M, "Understood, idempotency before we widen the rollout.", "action_item", { a: M, dl: "before_launch" }],
  [M, "Also the integration tests for the webhook handler are flaky, they fail maybe one in five runs on CI.", "risk"],
  [P, "That's going to bite us during the launch window. Someone needs to look at the flaky tests.", "action_item", { a: null }],
  [M, "I'll take a look at it when I'm in there for the idempotency work.", "action_item", { a: M }],

  [S, "Can we talk about the launch date itself for a second?", "open_question"],
  [P, "Sure, what's up?", "chit_chat"],
  [S, "Marketing wants to send the announcement email on the Wednesday, the thirtieth, so the feature needs to be at a hundred percent by then.", "risk"],
  [P, "The plan says a hundred percent on October first.", "status_update"],
  [S, "Right, and that's a day late for the email. Can we go to a hundred on Tuesday instead?", "open_question"],
  [M, "If the reconciliation and idempotency stuff land next week, technically yes.", "status_update"],
  [P, "Okay, let's move the hundred percent to Tuesday the twenty-ninth then.", "decision", { rev: true }],
  [D, "Tuesday is tight for the final QA pass on the address form though.", "risk"],
  [P, "Hmm. Actually, no, let's not. Scrap Tuesday, we keep October first and marketing shifts the email a day.", "decision", { rev: true }],
  [S, "Okay, I'll go back to marketing and ask them to move the email to Thursday the first.", "action_item", { a: S }],
  [P, "Thanks. Sorry for the flip-flop.", "chit_chat"],

  [M, "Is anyone else's coffee machine on the third floor broken or is it just mine?", "chit_chat"],
  [D, "It's everyone's, it's been making that grinding noise since Monday.", "chit_chat"],
  [S, "I filed a facilities ticket, they said two to three business days, which I think is facilities speak for never.", "chit_chat"],
  [M, "Legendary.", "chit_chat"],
  [P, "Okay, okay, back to it. We've got fifteen minutes.", "chit_chat"],

  [S, "Legal. Has anyone heard back from legal about the new terms checkbox wording?", "open_question"],
  [P, "Not that I've seen.", "status_update"],
  [S, "Because if they want changes, Dev has to redo the review step and that's a design and a copy change.", "risk"],
  [D, "It's a small change but I'd rather know now than the day before launch.", "chit_chat"],
  [P, "Sofia, chase legal today and get a yes or no on the checkbox wording.", "action_item", { a: S, dl: "specific_date" }],
  [S, "On it, I'll ping the legal channel after standup.", "action_item", { a: S, dl: "specific_date" }],
  [M, "Also, the terms version needs to be stored with the order for the audit trail. Are we doing that?", "open_question"],
  [P, "Are we? Marcus, is that in the new schema?", "open_question"],
  [M, "It's not. It's a column and a migration, I can add it.", "action_item", { a: M }],
  [P, "Please do, terms version on the order record, end of next sprint is fine for that one.", "action_item", { a: M, dl: "next_sprint" }],
  [M, "Terms version column, end of next sprint. Got it.", "action_item", { a: M, dl: "next_sprint" }],

  [D, "Oh, one more thing on my side, the iOS Safari bug.", "chit_chat"],
  [D, "The postcode field zooms the whole page when you focus it on iPhone. It's the sixteen pixel font-size thing.", "risk"],
  [M, "Classic. That's a one-line CSS fix.", "chit_chat"],
  [D, "One line but it's in the shared input component so it touches every form in the app.", "risk"],
  [P, "Is that in the launch scope or post-launch?", "open_question"],
  [S, "It has to be launch scope, iOS is forty percent of mobile checkout.", "decision"],
  [P, "Agreed, iOS zoom fix is in scope for launch.", "decision"],
  [P, "Dev, can you pair with Marcus on the input component change so we don't break the other forms?", "action_item", { a: D }],
  [D, "Yeah, I'll grab Marcus tomorrow morning for it.", "action_item", { a: D, dl: "specific_date" }],
  [M, "Works for me.", "chit_chat"],

  [P, "Let's do a quick pass on the end of quarter stuff since that's coming up.", "chit_chat"],
  [S, "The OKR review needs the checkout metrics doc. I'll get that written up by end of quarter.", "action_item", { a: S, dl: "end_of_quarter" }],
  [P, "And the cost report for the old payments service, we need that before we can decommission it.", "action_item", { a: null, dl: "none" }],
  [M, "I'll pull the cost numbers, but decommissioning the old service isn't happening this quarter, that's a Q4 thing.", "action_item", { a: M }],
  [P, "Agreed, decommission is Q4, we're not touching that before launch.", "decision"],
  [D, "Do we have a name for the old service yet or are we still calling it 'the old one'?", "chit_chat"],
  [M, "It's called payments-legacy in the repo, which is somehow more depressing.", "chit_chat"],

  [P, "Load testing. Marcus, where are we?", "open_question"],
  [M, "I ran a load test on Tuesday, five hundred checkouts a minute, everything held.", "status_update"],
  [M, "p99 latency on the payment call was about nine hundred milliseconds, which is fine, but the tax lookup was the slow part.", "status_update"],
  [S, "Black Friday is going to be more than five hundred a minute though.", "risk"],
  [M, "Yeah, we should test at two thousand. But the staging tax API rate-limits us above about eight hundred.", "risk", { blk: true }],
  [P, "Can we get a higher limit from the tax vendor?", "open_question"],
  [M, "I asked, they said they need a ticket from the account owner, which is Sofia.", "status_update", { blk: true }],
  [S, "Okay, I'll file the ticket with the tax vendor for a higher staging rate limit.", "action_item", { a: S }],
  [P, "And then Marcus reruns the load test at two thousand once the limit's raised.", "action_item", { a: M }],
  [M, "Yep, blocked on the vendor until then, but I'll run it as soon as the limit's up.", "action_item", { a: M, blk: true }],

  [S, "Support enablement. The support team needs a runbook for the new checkout before five percent goes live tomorrow.", "risk"],
  [P, "Who's writing that?", "open_question"],
  [S, "I started it but I don't know the failure modes well enough. Marcus, could you fill in the troubleshooting section?", "action_item", { a: M }],
  [M, "I can do the troubleshooting section tonight, it won't be pretty but it'll be accurate.", "action_item", { a: M, dl: "specific_date" }],
  [D, "I can add the screenshots of each step, I have them all from the Figma export anyway.", "action_item", { a: D }],
  [P, "Perfect. Runbook draft to support by tomorrow morning then.", "action_item", { a: null, dl: "specific_date" }],
  [S, "Yep, I'll send the runbook to support first thing tomorrow.", "action_item", { a: S, dl: "specific_date" }],

  [D, "Quick one, the accessibility audit came back on the new form.", "status_update"],
  [D, "Mostly fine, but the error messages on the card field aren't announced by screen readers.", "risk"],
  [S, "Is that a launch blocker? Legally I mean.", "open_question"],
  [P, "For the EU markets it kind of is, yes.", "risk"],
  [D, "It's an aria-live region, it's not hard, I just need someone on the frontend to wire it up.", "action_item", { a: null }],
  [M, "I can do the aria-live thing while I'm in the input component with you tomorrow.", "action_item", { a: M, dl: "specific_date" }],
  [P, "Good. Card field error announcements, Marcus and Dev, tomorrow.", "action_item", { a: M, dl: "specific_date" }],
  [D, "And I'll rerun the audit tool after so we have a clean report for the launch checklist.", "action_item", { a: D }],

  [S, "Promo codes. We found an edge case where a percentage code plus free shipping goes negative on tiny orders.", "risk"],
  [M, "Negative as in we pay the customer?", "open_question"],
  [S, "Negative as in the total shows minus forty cents and then the payment call fails.", "risk"],
  [P, "Let's just block stacking codes with free shipping for launch. Simplest fix.", "decision"],
  [S, "Hmm, marketing has a stacked promo planned for launch week though.", "risk"],
  [D, "There's also a design for the stacked codes already, it's in the review step.", "status_update"],
  [P, "Okay, forget blocking it. We keep stacking and clamp the total at zero instead.", "decision", { rev: true }],
  [M, "Clamp at zero is a two-line change, I'll do that with the idempotency work.", "action_item", { a: M }],
  [S, "And I'll tell marketing the stacked promo is safe to plan around.", "action_item", { a: S }],
  [P, "Good catch on that one, Sofia.", "chit_chat"],

  [D, "Sorry, that's my dog, someone's at the door.", "chit_chat"],
  [M, "Say hi to Biscuit.", "chit_chat"],
  [D, "Biscuit says hi and also please ship the address form.", "chit_chat"],
  [P, "Biscuit has the right priorities.", "chit_chat"],

  [P, "Monitoring. Do we have alerts on the new payment path or are we just staring at dashboards?", "open_question"],
  [M, "Dashboards only right now. There's no paging alert on payment failures.", "risk"],
  [P, "We need an alert on payment failure rate before tomorrow's five percent, that's non-negotiable.", "action_item", { a: null, dl: "specific_date" }],
  [M, "I'll set up the failure rate alert tonight along with the runbook section.", "action_item", { a: M, dl: "specific_date" }],
  [S, "Threshold? One percent? Two?", "open_question"],
  [P, "Let's go with two percent over five minutes to start, we can tighten it later.", "decision"],

  [M, "One blocker I should flag. The new service needs a secrets rotation before launch and that's owned by the infra team.", "risk"],
  [M, "I've had a ticket open with infra for a week and it's not moving.", "risk", { blk: true }],
  [P, "That's a launch blocker if it doesn't happen. I'll escalate to the infra lead today.", "action_item", { a: P, dl: "specific_date" }],
  [S, "Do we have a fallback if infra can't do it in time?", "open_question"],
  [M, "We could rotate them ourselves but it's against policy, so, not really.", "status_update"],
  [P, "Right, no, we're not doing that. I'll escalate. If there's no movement by Monday we raise it in the leadership sync.", "action_item", { a: P }],

  [P, "Okay, let's do a fast recap of owners so nothing falls through.", "chit_chat"],
  [P, "Marcus: rounding write-up to finance tomorrow, upsell event this week, webhook idempotency, flaky tests, terms column next sprint.", "status_update"],
  [M, "That's a lot of Marcus.", "chit_chat"],
  [P, "It is a lot of Marcus. Do you want to hand the flaky tests off?", "open_question"],
  [M, "Honestly, yeah, if someone else can take the flaky tests that would help.", "action_item", { a: null }],
  [D, "I'm not touching backend tests, sorry.", "chit_chat"],
  [P, "I'll take the flaky tests then, I miss writing code anyway.", "action_item", { a: P }],
  [M, "Deal.", "chit_chat"],
  [P, "Sofia: currency table, rollout doc, support update, legal, marketing email, tax vendor ticket, runbook.", "status_update"],
  [S, "Yes, and the AOV investigation once the data's in.", "action_item", { a: S }],
  [P, "Dev: Figma specs Monday, iOS zoom fix with Marcus, runbook screenshots, and the font thing in the backlog.", "status_update"],
  [D, "Correct.", "chit_chat"],
  [P, "And me: escalate infra, flaky tests.", "status_update"],
  [S, "Also, we never decided who's on call for the five percent rollout tomorrow.", "open_question"],
  [M, "I'll be on call for the rollout tomorrow, I want to watch the reconciliation numbers anyway.", "action_item", { a: M, dl: "specific_date" }],
  [P, "Great. Marcus is on call tomorrow.", "chit_chat"],

  [S, "That's my hard stop, I have to jump.", "chit_chat"],
  [P, "Go go. Thanks everyone, good meeting.", "chit_chat"],
  [D, "Thanks all, bye.", "chit_chat"],
  [M, "See you tomorrow at five percent.", "chit_chat"],
];

const TARGET_DURATION_S = 12 * 60;

/** Speaking time ~ words at a natural pace plus a short pause, scaled so the whole meeting lasts 12 minutes. */
function rawDuration(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return 0.6 + words * 0.36;
}

function build(): LabelledUtterance[] {
  const total = ROWS.reduce((s, r) => s + rawDuration(r[1]), 0);
  const scale = TARGET_DURATION_S / total;
  let t = 0;
  return ROWS.map(([speaker, text, kind, extra], i) => {
    t += rawDuration(text) * scale;
    const isTask = kind === "action_item";
    return {
      id: i,
      speaker,
      text,
      endsAt: Math.round(t * 100) / 100,
      truth: {
        kind,
        assignee: isTask ? (extra?.a ?? null) : null,
        deadline: isTask ? (extra?.dl ?? "none") : "none",
        reverses: extra?.rev ?? false,
        blocked: extra?.blk ?? false,
      },
    };
  });
}

export const TRANSCRIPT: LabelledUtterance[] = build();

/**
 * The stretch the demo page plays: three contiguous pieces of the standup that hold every feature
 * the five calls produce — the open (small talk that must stay out of the minutes, the first
 * to-dos and decisions), the launch-date flip-flop (a decision that reverses an earlier one), and
 * the load test (work blocked on a vendor). Timings are re-based so playback is continuous.
 */
const SEGMENTS: [number, number][] = [
  [0, 16],
  [65, 76],
  [109, 119],
];

export const DEMO_LINES: LabelledUtterance[] = (() => {
  const out: LabelledUtterance[] = [];
  let t = 0;
  for (const [from, to] of SEGMENTS) {
    for (let i = from; i < to; i++) {
      const u = TRANSCRIPT[i];
      t += i > from ? Math.max(0.8, u.endsAt - TRANSCRIPT[i - 1].endsAt) : 2.5;
      out.push({ ...u, endsAt: Math.round(t * 100) / 100 });
    }
    t += 2;
  }
  return out;
})();
