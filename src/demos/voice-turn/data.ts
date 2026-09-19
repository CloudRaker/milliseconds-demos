// Seed data ported 1:1 from the Jev experiment: DemoScript (Sources/SimulatedMic.swift),
// the Intent rubrics (Sources/Models.swift) and the candidate lists (Sources/TurnState.swift).
// Word timings come from the same rule as `ScriptedUtterance.spoken`, so the script is
// deterministic: the only randomness is the level-envelope jitter, which is cosmetic.

export interface ScriptWord {
  text: string;
  /** Milliseconds of silence before this word starts. */
  gapBeforeMs: number;
  durationMs: number;
}
export interface ScriptedUtterance {
  words: ScriptWord[];
  text: string;
  /** Spoken while the assistant is still talking, `bargeInDelayMs` after it starts. */
  bargeIn: boolean;
  bargeInDelayMs: number;
}

/** Same rule as the Swift original: duration = 150 + 40 x chars, 70 ms between words. */
function spoken(text: string, pauseAfterWords: Record<string, number> = {}): ScriptedUtterance {
  let pendingGap = 0;
  const words = text.split(" ").map((t) => {
    const w = { text: t, gapBeforeMs: pendingGap, durationMs: 150 + 40 * t.length };
    pendingGap = pauseAfterWords[t] ?? 70;
    return w;
  });
  return { words, text, bargeIn: false, bargeInDelayMs: 900 };
}
function interruption(text: string, afterMs: number): ScriptedUtterance {
  return { ...spoken(text), bargeIn: true, bargeInDelayMs: afterMs };
}

/** The ten scripted utterances of the original demo, in order. */
export const SCRIPT: ScriptedUtterance[] = [
  spoken("set a timer for ten minutes"),
  spoken("what's the weather like in Boston tomorrow"),
  spoken("turn off the lights in the kitchen"),
  spoken("play some jazz"),
  spoken("text mom I'll be late"),
  spoken("how tall is the Eiffel Tower"),
  // Mid-sentence hesitation longer than the silence timeout: the baseline cuts the speaker off.
  spoken("send a message to Sarah saying I'm on my way", { to: 1300 }),
  spoken("turn on the living room lights"),
  interruption("stop stop", 700),
  spoken("set a timer for forty five minutes"),
];

export type Intent =
  | "set_timer"
  | "weather"
  | "play_music"
  | "lights"
  | "send_message"
  | "question"
  | "chit_chat"
  | "incomplete";

/** /classify labels: the Intent rubrics, verbatim from the original. */
export const INTENT_LABELS: Record<Intent, string> = {
  set_timer: "Start a timer, alarm or countdown for a duration",
  weather: "Ask about weather, temperature or forecast",
  play_music: "Play a song, artist, genre or playlist",
  lights: "Turn lights on, off, dim them, or change their color",
  send_message: "Send a text or message to a person",
  question: "A general knowledge or factual question",
  chit_chat: "Greeting, small talk or thanks with no task",
  incomplete: "Too little said so far to tell what the speaker wants",
};

export const INTENT_TITLES: Record<Intent, string> = {
  set_timer: "Set timer",
  weather: "Weather",
  play_music: "Play music",
  lights: "Lights",
  send_message: "Send message",
  question: "Question",
  chit_chat: "Chit-chat",
  incomplete: "Incomplete",
};

/**
 * /yes-no statement and hints for the original `is_barge_in` question. Measured on the framed
 * text below: "stop stop" 0.92, "no wait" 0.91, "ok thanks" 0.09, "uh" 0.25, an echo 0.42.
 */
export const BARGE_IN = {
  statement: "The speaker cuts the assistant off.",
  when_true: "the speaker tells the assistant to stop, wait, cancel or be quiet",
  when_false: "the speaker lets the assistant finish: a filler sound, a thanks, or nothing at all",
};

/** Interruptions depend on the heard words and speaking state, never a generated reply. */
export const bargeInText = (_saying: string, heard: string) =>
  `Assistant is speaking. Speaker says: "${heard}"`;

/**
 * The intents that cannot be acted on until one detail is said, and the regex that finds it.
 * This is the readiness half of endpointing: the router knows what you want long before you
 * finish, so the missing detail is what tells the code to keep listening.
 */
export const SLOT_FOR_INTENT = {
  set_timer: "timer_duration",
  send_message: "contact",
  lights: "room",
} as const;

/** Slot label descriptions, one per candidate plus the always-present `none`. */
export const SLOT_LABELS = {
  timer_duration: {
    hit: "This phrase is the duration the speaker wants the timer set for",
    none: "None of the phrases is the timer duration",
  },
  room: { hit: "This is the room the lights command applies to", none: "No specific room is named" },
  contact: { hit: "This is the person the message is for", none: "No recipient is named" },
};

export const ROOMS = [
  "kitchen",
  "bedroom",
  "living room",
  "bathroom",
  "office",
  "garage",
  "hallway",
  "dining room",
  "basement",
  "nursery",
  "porch",
];

const NUMBER_WORDS =
  "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|" +
  "thirty|forty|forty-five|fifty|sixty|ninety|half an?|an?)";
export const DURATION_RE = new RegExp(
  `\\b${NUMBER_WORDS}(?:[\\s-]${NUMBER_WORDS})?(?:\\s+and\\s+a\\s+half)?\\s+(?:seconds?|minutes?|hours?|mins?|secs?)\\b`,
  "gi",
);
export const CONTACT_RE = /\b(?:text|message|tell|call)\s+(?:to\s+)?([A-Za-z]+)\b/gi;
export const NON_CONTACTS = ["me", "them", "him", "her", "it", "the", "a", "to", "that"];

/** Published price for decision-machine-1: input tokens only, $0.04 per million. */
export const USD_PER_INPUT_TOKEN = 0.04 / 1_000_000;
