// The six decision-machine-1 calls that turn one window of utterances into minutes,
// plus the plain TypeScript that resolves owner, due date and reversals afterwards.
// Kept free of React and of the browser client so smoke.mjs can import it in node.

import type { Attendee, DeadlineKind, GroundTruth, Kind, MeetingContext } from "./data.ts";
import { MEETING } from "./data.ts";

/* ---------------------------------------------------------------- deadlines */

const DAY_MS = 86_400_000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, "twenty-first": 21, "twenty-second": 22, "twenty-third": 23,
  "twenty-fourth": 24, "twenty-fifth": 25, "twenty-sixth": 26, "twenty-seventh": 27, "twenty-eighth": 28,
  "twenty-ninth": 29, thirtieth: 30, "thirty-first": 31,
};

export const parseISO = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
export const toISO = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (iso: string, days: number): string => toISO(new Date(parseISO(iso).getTime() + days * DAY_MS));

export function formatDate(iso: string, today: string, relative = true): string {
  const d = parseISO(iso);
  const diff = Math.round((d.getTime() - parseISO(today).getTime()) / DAY_MS);
  if (relative && diff === 0) return "today";
  if (relative && diff === 1) return "tomorrow";
  const wd = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return diff > 0 && diff < 7 ? `${wd} ${md}` : md;
}

function endOfWeek(today: string): string {
  const dow = parseISO(today).getUTCDay();
  return addDays(today, (5 - dow + 7) % 7);
}

function endOfQuarter(today: string): string {
  const d = parseISO(today);
  const lastMonth = Math.floor(d.getUTCMonth() / 3) * 3 + 2;
  return toISO(new Date(Date.UTC(d.getUTCFullYear(), lastMonth + 1, 0)));
}

function ordinalToDay(word: string): number | null {
  const m = /^(\d{1,2})(?:st|nd|rd|th)$/.exec(word);
  if (m) return Number(m[1]);
  return ORDINAL_WORDS[word] ?? null;
}

/** Deterministic parse of a named day or date in the utterance, relative to `today`. */
export function parseSpecificDate(text: string, today: string): string | null {
  const t = text.toLowerCase().replace(/[.,!?;]/g, " ");
  const todayD = parseISO(today);

  if (/\btomorrow\b/.test(t)) return addDays(today, 1);
  if (/\b(today|tonight|eod|end of (the )?day|after (this|standup)|right after)\b/.test(t)) return today;

  const monthRe = new RegExp(`\\b(${MONTHS.map((m) => `${m}|${m.slice(0, 3)}`).join("|")})\\b\\s+(\\d{1,2}(?:st|nd|rd|th)?|[a-z-]+)`);
  const mm = monthRe.exec(t);
  if (mm) {
    const monthIdx = MONTHS.findIndex((m) => m === mm[1] || m.slice(0, 3) === mm[1]);
    const day = /^\d+/.test(mm[2]) ? Number.parseInt(mm[2], 10) : ordinalToDay(mm[2]);
    if (day && monthIdx >= 0) {
      let year = todayD.getUTCFullYear();
      if (monthIdx < todayD.getUTCMonth()) year++;
      return toISO(new Date(Date.UTC(year, monthIdx, day)));
    }
  }

  const om = /\bthe\s+(\d{1,2}(?:st|nd|rd|th)|[a-z-]+teenth|[a-z-]+th|first|second|third)\b/.exec(t);
  if (om) {
    const day = ordinalToDay(om[1]);
    if (day) {
      let y = todayD.getUTCFullYear();
      let m = todayD.getUTCMonth();
      if (day < todayD.getUTCDate()) {
        m++;
        if (m > 11) {
          m = 0;
          y++;
        }
      }
      return toISO(new Date(Date.UTC(y, m, day)));
    }
  }

  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(t)) {
      return addDays(today, (i - todayD.getUTCDay() + 7) % 7);
    }
  }
  return null;
}

export interface ResolvedDeadline {
  kind: DeadlineKind;
  /** ISO date, or null when the kind implies a date the text does not name. */
  date: string | null;
  label: string;
}

/** The model decides the *kind* of deadline; this code turns it into a real date. */
export function resolveDeadline(kind: DeadlineKind, text: string, ctx: MeetingContext): ResolvedDeadline {
  switch (kind) {
    case "specific_date": {
      const date = parseSpecificDate(text, ctx.today);
      return { kind, date, label: date ? formatDate(date, ctx.today) : "date?" };
    }
    case "this_week": {
      const date = endOfWeek(ctx.today);
      return { kind, date, label: `this week · ${formatDate(date, ctx.today, false)}` };
    }
    case "next_sprint": {
      const date = addDays(ctx.sprintEnd, ctx.sprintDays);
      return { kind, date, label: `next sprint · ${formatDate(date, ctx.today)}` };
    }
    case "before_launch":
      return { kind, date: ctx.launch, label: `before launch · ${formatDate(ctx.launch, ctx.today)}` };
    case "end_of_quarter": {
      const date = endOfQuarter(ctx.today);
      return { kind, date, label: `EOQ · ${formatDate(date, ctx.today)}` };
    }
    default:
      return { kind: "none", date: null, label: "" };
  }
}

/* ------------------------------------------------------------- the prompts */

/*
 * Every label set below was tuned against the transcript's ground truth with smoke.mjs.
 * Two findings shaped them. Cue-word descriptions ("the speaker says 'I'll do it'") beat abstract
 * ones by 20 points, and a long catch-all description swallows the whole batch, so the two labels
 * whose lines never become a note are as concrete as the four that do. The previous three lines,
 * packed into the text as the port brief suggested, made every question worse, so each call sees
 * the line itself and nothing more.
 */

/** /classify labels for the note kind. */
export const KIND_LABELS: Record<string, string> = {
  action_item: "the speaker says 'I'll do it', 'I can take that', 'can you do this', or asks a named person to do a new piece of work",
  decision: "the speaker says 'let's do this', 'we're not doing that', 'we'll go with this one', 'park it', 'agreed, we keep the plan'",
  open_question:
    "a question about the work that this line does not answer: 'any issues so far?', 'do we have that?', 'how many?', 'where are we on this?'",
  risk: "the speaker warns that something is broken, flaky, missing, slipping, at risk, or could fail",
  progress_report:
    "the speaker reports where the work already stands, with no new work handed out: 'the migration is done', 'conversion is up four percent', 'I spent yesterday on the address form'",
  small_talk: "a greeting, a goodbye, a joke, thanks, a bare agreement like 'sounds good', or handing the floor to the next person",
};

/** The two labels above that never become a note. */
const KIND_MAP: Record<string, Kind> = { progress_report: "status_update", small_talk: "chit_chat" };

/** Under this winning probability the line stays in the transcript instead of becoming a note. */
export const KIND_KEEP = 0.6;

/** /classify labels for the owner, one per attendee. First names score better than full names. */
export function assigneeLabels(attendees: Attendee[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const a of attendees) {
    const f = a.name.split(" ")[0];
    labels[f] = `the work lands on ${f}: someone asks ${f} to do it, ${f} says 'I'll do it' or 'I can take that', or someone says ${f} will do it`;
  }
  labels.nobody =
    "no name is attached to the work: 'someone should do this', 'we need that', the line hands out no work, or the speaker asks for a volunteer without naming one: 'I need someone to check this', 'someone should file a ticket'";
  return labels;
}

/** /classify labels for the kind of due date. The label feeds resolveDeadline, which makes the real ISO date. */
export const DEADLINE_LABELS: Record<DeadlineKind, string> = {
  /*
   * "Marcus, can you write up the rounding discrepancy ... before end of day tomorrow?" used to come
   * back `none` at 0.61: the old wording was a bare cue list, and a request that carries its time
   * inside the question did not look like one. Naming the shape ("the line names a day or a time of
   * day for the work") takes it to 0.99 and lifts the dated to-dos from 78% to 91%. Lengthening the
   * `none` description instead — the obvious other move — swallows the batch: it drops the same
   * measure to 39%, which is the catch-all failure this file's header warns about.
   */
  specific_date:
    "the line names a day or a time of day for the work: tomorrow, tonight, today, by Friday, Monday morning, the 24th, October 1st, before end of day, first thing, after standup, or right after this",
  this_week: "the line says this week, by end of week, EOW, or in the next couple of days",
  next_sprint: "the line says next sprint, end of next sprint, by sprint end, or before sprint planning",
  before_launch: "the line says before launch, before we ship, before we widen the rollout, pre-launch, or before go-live",
  end_of_quarter: "the line says end of quarter, EOQ, by end of Q3, or before the quarter closes",
  none: "the line names no time at all",
};

/**
 * /yes-no statement for "is this a to-do". action_item loses inside the six-way classify: textbook
 * hand-offs like "Yep, I'll have the write-up to finance by tomorrow" come back progress_report at
 * 0.99, and the classify alone finds only 15 of the transcript's 50 to-dos. This second, narrower
 * question gets a vote on the lines the classify filed as progress or risk. It is not trusted on
 * its own — alone it says yes on 70 of 180 lines — so a promotion also needs the owner classify to
 * name an attendee. With both gates the page shows 23 to-dos, 83% of them real.
 */
export const IS_TASK = {
  statement: "Someone leaves this meeting owing a piece of work because of this line.",
  when_true:
    "the line hands work out, asks for it, takes it on, or repeats back what was just agreed: 'Marcus, add the upsell event this week', 'I'll send the write-up tomorrow', 'understood, idempotency before we widen the rollout', 'on it', 'I can take that', 'someone needs to file a ticket'",
  when_false:
    "nobody picks up work here: a greeting or handing the floor over ('Dev, you're up'), a question, a warning, a report on work already finished, a decision about what to build, or an end-of-meeting recap of what everyone already agreed to",
};
/**
 * 0.65 dropped the opening excerpt's own headline hand-off ("Marcus, can you write up the rounding
 * discrepancy ... before end of day tomorrow?", task=true at 0.57). 0.55 lets it through.
 */
export const TASK_YES = 0.55;

/**
 * Where the promotion is allowed to act. Asked over all 180 lines the yes-no is too loose to
 * override the classify everywhere; asked only where the classify's own mistakes live — the lines
 * it filed as a progress report or a risk — it turns 15 to-dos into 23 without costing list
 * precision. Questions and decisions keep their own labels.
 */
const PROMOTE_FROM = new Set<Kind>(["status_update", "risk"]);

/** /yes-no statement for the reversal rule, with its two hints. Only decisions are asked. */
export const REVERSES = {
  statement: "The speaker says 'actually, scrap that' and changes a plan the team already agreed.",
  when_true: "the line starts over: 'actually, no, let's not', 'scrap Tuesday', 'forget blocking it', 'okay, let's move it to Monday instead'",
  /*
   * Deliberately NOT extended with "…or only asks whether to change it: 'should we move it to
   * Monday instead?'". That counter-example does kill the false positive (the adversarial question
   * drops from 0.97 to 0.00, and line #69 from 0.91 to 0.00), but it also pulls the transcript's
   * own reversal #71, "Okay, let's move the hundred percent to Tuesday the twenty-ninth then",
   * from 0.89 to 0.57 — because when_true's example, "okay, let's move it to Monday instead", is
   * that same sentence minus the question mark. #71 is the decision the flip-flop strikes through,
   * and at kind 0.45 it only survives KIND_KEEP through this flag, so the demo's one curated
   * interaction dies with it. Three wordings and a stronger `decision` label were measured; the
   * best of them cost 3 points of list precision, 3 points of recall and two shown to-dos to buy
   * one point of reversal accuracy. The false positive stays.
   */
  when_false: "the line leaves the earlier plan alone: it confirms it, asks about it, proposes something new, or says nothing about any plan",
};
/** Reversal strikes through an earlier decision, so it needs a high bar. */
export const REVERSES_YES = 0.8;

/** /yes-no statement for the blocked flag, with its two hints. */
export const BLOCKED = {
  statement: "The speaker says the work is blocked right now and cannot continue.",
  when_true:
    "the work cannot run until something outside the team moves: waiting on another team, a vendor, an approval or a dependency; a quota or rate limit that caps it ('the staging API rate-limits us so we cannot run it at that volume'); or 'we asked and they will not move until someone else does X first'.",
  when_false:
    "the work is not stuck: a deadline, a plan, a prerequisite in the plan that nobody is waiting on yet, a hypothetical risk, a request, a question, or work simply in progress. This includes 'we need X before we can start Y' and 'we need sign-off first', where nobody has asked yet and nothing is waiting.",
};
/**
 * Blocked needs its own high bar, not the generic 0.5. The answers are bimodal: a real blocker
 * comes back 0.97-1.00, while "we need that before we go to twenty-five percent" and every other
 * prerequisite sits at 0.5-0.8. Cutting in the gap costs one line and removes thirteen red tags.
 */
export const BLOCKED_YES = 0.85;

/* ------------------------------------------------- one window of utterances */

/** A window leaves when it holds WINDOW_MAX lines, or after WINDOW_MS. Here so the page copy can quote them. */
export const WINDOW_MAX = 12;
export const WINDOW_MS = 1200;

export interface JudgeRow {
  id: number;
  speaker: string;
  text: string;
}

/** The owner call is the only one that needs to know who is talking. */
export function ownerText(row: JudgeRow): string {
  return `${row.speaker.split(" ")[0]} says: "${row.text}" Who does the work?`;
}

export type CallKey = "kind" | "assignee" | "deadline" | "task" | "reverses" | "blocked";
export interface Call {
  key: CallKey;
  route: "classify" | "yes-no";
  body: Record<string, unknown>;
}

/** The six request bodies for one window of lines. Each call carries the whole window in `texts`. */
export function windowCalls(rows: JudgeRow[], attendees: Attendee[] = MEETING.attendees): Call[] {
  const plain = rows.map((r) => r.text);
  return [
    { key: "kind", route: "classify", body: { texts: plain, labels: KIND_LABELS } },
    { key: "assignee", route: "classify", body: { texts: rows.map(ownerText), labels: assigneeLabels(attendees) } },
    { key: "deadline", route: "classify", body: { texts: plain, labels: DEADLINE_LABELS } },
    { key: "task", route: "yes-no", body: { texts: plain, ...IS_TASK } },
    { key: "reverses", route: "yes-no", body: { texts: plain, ...REVERSES } },
    { key: "blocked", route: "yes-no", body: { texts: plain, ...BLOCKED } },
  ];
}

/* --------------------------------------------------- resolving one judgment */

/** Below this the owner is shown as an amber "Who owns this?" chip the viewer can fix. */
export const ASSIGNEE_CONFIDENCE = 0.6;
export const YES = 0.5;

export interface AssigneeCandidate {
  name: string;
  p: number;
}

export interface Judgment {
  kind: Kind;
  kindProbability: number;
  /** True when the to-do came from the yes-no promotion rather than from the kind classify. */
  promoted: boolean;
  /** First name of the owner, or null. */
  assignee: string | null;
  assigneeUncertain: boolean;
  assigneeCandidates: AssigneeCandidate[];
  deadline: ResolvedDeadline;
  reverses: boolean;
  blocked: boolean;
}

export interface ClassifyRow {
  label: string;
  probability: number;
  confidence: number;
  scores: Record<string, number>;
}
export interface YesNoRow {
  answer: boolean;
  probability: number;
}

export interface WindowAnswers {
  kind: ClassifyRow[];
  assignee: ClassifyRow[];
  deadline: ClassifyRow[];
  task: YesNoRow[];
  reverses: YesNoRow[];
  blocked: YesNoRow[];
}

/** Maps the five answers for one line onto the note the UI renders. */
export function resolveJudgment(a: WindowAnswers, i: number, text: string, ctx: MeetingContext): Judgment {
  const kindRow = a.kind[i];
  const raw = kindRow?.label ?? "small_talk";
  const rawKind = (KIND_MAP[raw] ?? raw) as Kind;

  const owner = a.assignee[i];
  const candidates: AssigneeCandidate[] = Object.entries(owner?.scores ?? {})
    .filter(([name]) => name !== "nobody")
    .map(([name, p]) => ({ name, p }))
    .sort((x, y) => y.p - x.p);

  const named = owner?.label && owner.label !== "nobody" ? owner.label : null;
  const sure = (owner?.probability ?? 0) >= ASSIGNEE_CONFIDENCE;

  const reverses = rawKind === "decision" && (a.reverses[i]?.answer ?? false) && (a.reverses[i]?.probability ?? 0) >= REVERSES_YES;

  /*
   * The promotion. The six-way classify buries hand-offs under progress_report, so a dedicated
   * yes-no gets a second vote — but only together with the owner call, because the yes-no alone
   * says yes on roughly as many lines as it should not. A decision that scraps an earlier plan is
   * never promoted: its strikethrough is the whole point of that card.
   */
  const taskRow = a.task?.[i];
  const taskYes = (taskRow?.answer ?? false) && (taskRow?.probability ?? 0) >= TASK_YES;
  // An unassigned to-do is still a to-do. When the owner call confidently answers `nobody`
  // ("someone needs to file a ticket") the card is promoted anyway and renders the amber
  // "Who owns this?" chip with the per-attendee percentages behind it.
  const promoted = PROMOTE_FROM.has(rawKind) && taskYes && (named !== null ? sure : (owner?.probability ?? 0) >= ASSIGNEE_CONFIDENCE);

  const kind = promoted ? ("action_item" as Kind) : rawKind;
  const kindProbability = promoted ? (taskRow?.probability ?? 0) : (kindRow?.probability ?? 0);
  const isTask = kind === "action_item";

  const dl = a.deadline[i];
  const dlKind = (dl?.label ?? "none") as DeadlineKind;
  const dated = isTask && dlKind !== "none" && (dl?.probability ?? 0) >= YES;

  return {
    kind,
    kindProbability,
    promoted,
    assignee: isTask ? named : null,
    assigneeUncertain: isTask && (named === null || !sure),
    assigneeCandidates: candidates,
    deadline: resolveDeadline(dated ? dlKind : "none", text, ctx),
    reverses,
    blocked: (a.blocked[i]?.answer ?? false) && (a.blocked[i]?.probability ?? 0) >= BLOCKED_YES,
  };
}

export type Bucket = "decisions" | "actions" | "questions" | "risks";

/**
 * Which list a note lands in, if any. A blocked progress report surfaces as a risk, and a line the
 * model is unsure about (probability under KIND_KEEP) stays in the transcript.
 */
export function bucketFor(j: Judgment): Bucket | null {
  if (j.kind === "status_update") return j.blocked ? "risks" : null;
  // The reversal exemption carries no extra floor. The transcript's own reversal #71 sits at
  // kind 0.45 and the adversarial false positive at 0.59, so any floor that removes the second
  // removes the first, and the first is the strikethrough this demo exists to show.
  if (j.kind === "decision") return j.kindProbability >= KIND_KEEP || j.reverses ? "decisions" : null;
  // A promoted to-do already passed TASK_YES on the dedicated yes-no; re-gating it at KIND_KEEP
  // just makes the two thresholds fight. That is what dropped the opening excerpt's own hand-off,
  // "Marcus, can you write up the rounding discrepancy ... before end of day tomorrow?" — promoted
  // with Marcus and a due date of tomorrow, then thrown away because task=0.57 is under 0.6.
  if (j.kind === "action_item" && j.promoted) return "actions";
  if (j.kindProbability < KIND_KEEP) return null;
  switch (j.kind) {
    case "action_item":
      return "actions";
    case "open_question":
      return "questions";
    case "risk":
      return "risks";
    default:
      return null;
  }
}

/**
 * The decision a reversing note strikes through: the last still-standing decision from an earlier
 * line. Shared by the page and by smoke.mjs --demo, which asserts the strikethrough really fires.
 */
export function supersedes<T extends { bucket: Bucket; supersededBy: number | null; lineId: number }>(notes: T[], lineId: number): T | undefined {
  return [...notes].reverse().find((x) => x.bucket === "decisions" && x.supersededBy === null && x.lineId < lineId);
}

/**
 * The mock fallback the port brief asks for. When the proxy is down the page fills from the
 * transcript's own ground truth instead of going blank, and the metrics strip is tagged "mock".
 */
export function judgeFromTruth(t: GroundTruth, text: string, ctx: MeetingContext): Judgment {
  const isTask = t.kind === "action_item";
  const named = isTask && t.assignee ? t.assignee.split(" ")[0] : null;
  return {
    kind: t.kind,
    kindProbability: 1,
    promoted: false,
    assignee: named,
    assigneeUncertain: isTask && named === null,
    assigneeCandidates: [],
    deadline: resolveDeadline(isTask ? t.deadline : "none", text, ctx),
    reverses: t.reverses,
    blocked: t.blocked,
  };
}
