// Pure logic, ported 1:1 from the Jev experiment: TurnPolicy.swift, TurnState.swift
// (CandidateExtractor), TranscriptSource.swift (mergeWords), LatencyStats.swift and
// TimelineMath.swift. No React, no fetch: thresholds live here, the model only supplies
// probabilities. `smoke.mjs` runs the self-check at the bottom of this file.

import {
  CONTACT_RE,
  DURATION_RE,
  INTENT_TITLES,
  NON_CONTACTS,
  ROOMS,
  SLOT_FOR_INTENT,
  type Intent,
} from "./data.ts";

export interface TranscriptWord {
  text: string;
  /** Seconds since the session started. */
  time: number;
}
export interface DecisionSample {
  seq: number;
  time: number;
  /** Winning intent and its probability, from /classify over the partial transcript. */
  intent: Intent;
  probability: number;
  /** False while the detail this intent needs (duration, room, contact) has not been said. */
  ready: boolean;
  /** Only set while the assistant speaks, from /yes-no. */
  bargeIn?: number;
}
export type FireSource = "judge" | "fallback" | "baseline";
export interface Policy {
  fireThreshold: number;
  bargeInThreshold: number;
  minPauseMs: number;
  silenceTimeoutMs: number;
  incompleteThreshold: number;
  patientMultiplier: number;
}
export const DEFAULT_POLICY: Policy = {
  fireThreshold: 0.85,
  bargeInThreshold: 0.8,
  minPauseMs: 250,
  silenceTimeoutMs: 1000,
  incompleteThreshold: 0.35,
  patientMultiplier: 2.5,
};

/**
 * Act now, or keep listening. `latest` is the newest answer for the current transcript.
 * Ported from TurnPolicy.verdict, with the original's single `turn_complete` probability
 * replaced by the pair the model can actually answer: intent probability plus slot readiness.
 */
export function verdict(
  p: Policy,
  latest: DecisionSample | null,
  msSinceLastWord: number,
  hasWords: boolean,
): FireSource | null {
  if (!hasWords) return null;
  if (!latest) return msSinceLastWord >= p.silenceTimeoutMs ? "fallback" : null;
  const confident = latest.ready && latest.probability >= p.fireThreshold;
  if (confident && msSinceLastWord >= p.minPauseMs) return "judge";
  const timeout =
    !latest.ready || latest.probability < p.incompleteThreshold
      ? p.silenceTimeoutMs * p.patientMultiplier
      : p.silenceTimeoutMs;
  return msSinceLastWord >= timeout ? "fallback" : null;
}

export function isBargeIn(p: Policy, latest: DecisionSample | null): boolean {
  return latest?.bargeIn !== undefined && latest.bargeIn >= p.bargeInThreshold;
}

/** When a fixed-silence endpointer would have fired for a turn ending at `lastWordTime`. */
export function baselineFireTime(p: Policy, lastWordTime: number): number {
  return lastWordTime + p.silenceTimeoutMs / 1000;
}

/** Recognizer partials revise earlier words, so re-time only the words that are new. */
export function mergeWords(
  existing: TranscriptWord[],
  partial: string,
  now: number,
): TranscriptWord[] {
  return partial
    .split(/\s+/)
    .filter(Boolean)
    .map((text, i) => ({ text, time: i < existing.length ? existing[i].time : now }));
}

export const sameWords = (a: TranscriptWord[], b: TranscriptWord[]) =>
  a.length === b.length && a.every((w, i) => w.text === b[i].text);

// --- Candidate extraction: the model only ever picks from these, it never invents a value. ---

function allMatches(re: RegExp, text: string, group: number): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const s = m[group]?.toLowerCase();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}
export const durationsIn = (text: string) => allMatches(DURATION_RE, text, 0);
export const roomsIn = (text: string) => ROOMS.filter((r) => text.toLowerCase().includes(r));
export const contactsIn = (text: string) =>
  allMatches(CONTACT_RE, text, 1).filter((c) => !NON_CONTACTS.includes(c));

export type SlotKind = "timer_duration" | "room" | "contact";
const EXTRACT: Record<SlotKind, (t: string) => string[]> = {
  timer_duration: durationsIn,
  room: roomsIn,
  contact: contactsIn,
};

/** The slot question this intent calls for, with the candidates the model picks between. */
export function slotQuestion(
  intent: Intent,
  transcript: string,
): { kind: SlotKind; candidates: string[] } | null {
  const kind = SLOT_FOR_INTENT[intent as keyof typeof SLOT_FOR_INTENT];
  if (!kind) return null;
  return { kind, candidates: EXTRACT[kind](transcript) };
}

/**
 * Readiness: the model says what the speaker wants, code checks the detail that intent needs.
 * `incomplete` and `chit_chat` are never ready to act on.
 */
export function isReady(intent: Intent, transcript: string): boolean {
  if (intent === "incomplete") return false;
  const q = slotQuestion(intent, transcript);
  return !q || q.candidates.length > 0;
}

/** The canned reply, assembled from the intent plus the slot the model selected. */
export function composeReply(intent: Intent, slot: string | null, transcript: string): string {
  switch (intent) {
    case "set_timer":
      return slot ? `Timer set for ${slot}.` : "Starting a timer.";
    case "weather":
      return "It's 68 degrees and clear, with a high of 74 later today.";
    case "play_music":
      return "Playing that now.";
    case "lights": {
      const verb = transcript.toLowerCase().includes("off") ? "off" : "on";
      return slot ? `Turning the ${slot} lights ${verb}.` : `Turning the lights ${verb}.`;
    }
    case "send_message":
      return slot ? `Sending your message to ${slot[0].toUpperCase()}${slot.slice(1)}.` : "Sending your message.";
    case "question":
      return "Here's what I found for that.";
    case "chit_chat":
      return "Happy to help. Anything else?";
    default:
      return "Sorry, I didn't catch all of that.";
  }
}

export const intentTitle = (i: Intent) => INTENT_TITLES[i] ?? i;

// --- Stats and timeline math ---

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const rank = p * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (s[hi] - s[lo]) * (rank - lo);
}

export interface TurnRecord {
  index: number;
  transcript: string;
  intent: Intent;
  slot: string | null;
  reply: string;
  lastWordTime: number;
  fireTime: number;
  fireSource: FireSource;
  baselineFireTime: number;
  fireProbability: number;
  requests: number;
  bargedIn: boolean;
  /** The silence baseline fired on a mid-sentence pause, before the speaker had finished. */
  baselineCutOffEarly: boolean;
}
export const savedMs = (t: TurnRecord) => (t.baselineFireTime - t.fireTime) * 1000;
export const judgeDelayMs = (t: TurnRecord) => (t.fireTime - t.lastWordTime) * 1000;
export const baselineDelayMs = (t: TurnRecord) => (t.baselineFireTime - t.lastWordTime) * 1000;

export function comparison(turns: TurnRecord[]) {
  const n = turns.length || 1;
  const sum = (f: (t: TurnRecord) => number) => turns.reduce((a, t) => a + f(t), 0);
  return {
    turns: turns.length,
    judgeFires: turns.filter((t) => t.fireSource === "judge").length,
    fallbackFires: turns.filter((t) => t.fireSource !== "judge").length,
    meanJudgeDelayMs: sum(judgeDelayMs) / n,
    meanBaselineDelayMs: sum(baselineDelayMs) / n,
    meanSavedMs: sum(savedMs) / n,
    totalSavedMs: sum(savedMs),
    bargeIns: turns.filter((t) => t.bargedIn).length,
    cutOffs: turns.filter((t) => t.baselineCutOffEarly).length,
  };
}

/** Step line: each sample holds its value until the next one. */
export function probabilityPath(samples: DecisionSample[], until: number) {
  if (!samples.length) return [] as Array<[number, number]>;
  const value = (s: DecisionSample) => (s.ready ? s.probability : 0);
  const out: Array<[number, number]> = [[samples[0].time, value(samples[0])]];
  let prev = value(samples[0]);
  for (const s of samples.slice(1)) {
    out.push([s.time, prev], [s.time, value(s)]);
    prev = value(s);
  }
  out.push([until, prev]);
  return out;
}

export const fmtMs = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? "--" : `${Math.round(ms)} ms`;
export const fmtSeconds = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
export const fmtUSD = (usd: number) => (usd < 0.01 ? `$${usd.toFixed(5)}` : `$${usd.toFixed(3)}`);

// --- Self-check. Run with: node src/demos/voice-turn/smoke.mjs (it imports and calls this). ---

export function selfCheck(assert: (ok: boolean, msg: string) => void) {
  const p = DEFAULT_POLICY;
  const s = (probability: number, ready = true, bargeIn?: number): DecisionSample => ({
    seq: 1,
    time: 0,
    intent: "set_timer",
    probability,
    ready,
    bargeIn,
  });
  assert(verdict(p, null, 0, false) === null, "no words never fires");
  assert(verdict(p, null, 999, true) === null, "no answer waits for the silence timeout");
  assert(verdict(p, null, 1000, true) === "fallback", "no answer falls back at 1000 ms");
  assert(verdict(p, s(0.9), 200, true) === null, "confident answer still waits for min pause");
  assert(verdict(p, s(0.9), 260, true) === "judge", "confident answer fires after min pause");
  assert(verdict(p, s(0.99, false), 260, true) === null, "a missing slot never fires early");
  assert(
    verdict(p, s(0.99, false), 1500, true) === null,
    "a missing slot stretches the timeout to 2500 ms",
  );
  assert(verdict(p, s(0.99, false), 2500, true) === "fallback", "patient timeout is a hard stop");
  assert(verdict(p, s(0.2), 1500, true) === null, "an unsure intent is patient too");
  assert(verdict(p, s(0.5), 1000, true) === "fallback", "half-sure keeps the plain timeout");
  assert(!isBargeIn(p, s(0.1)), "no barge-in probability means no barge-in");
  assert(isBargeIn(p, s(0.1, true, 0.81)), "barge-in fires at the threshold");
  assert(isReady("play_music", "play some jazz"), "an intent with no slot is ready at once");
  assert(!isReady("send_message", "send a message to"), "no recipient yet means not ready");
  assert(isReady("send_message", "send a message to Sarah saying hi"), "a recipient means ready");
  assert(!isReady("lights", "turn off the lights in the"), "no room yet means not ready");
  assert(!isReady("incomplete", "set a"), "the incomplete label is never ready");

  const w = mergeWords([], "set a", 1);
  assert(w.length === 2 && w[0].time === 1, "first partial times every word now");
  const w2 = mergeWords(w, "set a timer", 2);
  assert(w2[0].time === 1 && w2[2].time === 2, "only new words get the new time");
  assert(mergeWords(w2, "set a", 3).length === 2, "a shrinking partial shrinks the transcript");

  assert(durationsIn("set a timer for ten minutes")[0] === "ten minutes", "duration candidate");
  assert(durationsIn("timer for forty five minutes").length === 1, "two-word number candidate");
  assert(roomsIn("lights in the kitchen")[0] === "kitchen", "room candidate");
  assert(contactsIn("text mom I'll be late")[0] === "mom", "contact candidate");
  assert(contactsIn("send a message to Sarah saying")[0] === "sarah", "contact after 'message to'");
  assert(contactsIn("tell me the time").length === 0, "pronouns are not contacts");

  assert(
    composeReply("lights", "kitchen", "turn off the lights in the kitchen") ===
      "Turning the kitchen lights off.",
    "lights reply reads the on/off from the transcript",
  );
  assert(composeReply("send_message", "mom", "text mom") === "Sending your message to Mom.", "contact reply");
  assert(percentile([10, 20, 30], 0.5) === 20, "p50");
  assert(probabilityPath([s(0.2), { ...s(0.9), time: 1 }], 2).length === 4, "step line points");
  assert(probabilityPath([s(0.9, false)], 1)[0][1] === 0, "a not-ready sample plots at zero");
}
