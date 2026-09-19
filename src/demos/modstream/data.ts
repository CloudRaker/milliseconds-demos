// Seeded chat simulator, ground-truth corpus, word-list baseline and the pure policy,
// ported from the jev-experiments/modstream shared/ modules (corpus.ts, wordlist.ts,
// policy.ts, stats.ts, types.ts). Everything here is deterministic: no inference, no fetch.
// Content note: the corpus contains harassment, disguised slurs and self-harm lines,
// because that is what a moderation filter has to be measured against.

export type Truth =
  | "ok"
  | "backseat"
  | "harassment"
  | "slur_evasion"
  | "scam"
  | "doxxing"
  | "self_harm"
  | "spam"
  | "off_topic_fight";

/** Ground-truth categories a moderator would want removed. */
export const HARMFUL_TRUTHS: ReadonlySet<Truth> = new Set<Truth>([
  "harassment",
  "slur_evasion",
  "scam",
  "doxxing",
  "spam",
  "off_topic_fight",
]);

export type Action = "allow" | "hide" | "timeout_user" | "escalate_to_human";

/** The judgments for one message: fifteen yes-no, one classify, one rate. */
export interface Judgment {
  action: Action;
  actionScores: Record<string, number>;
  actionConfidence: number;
  harassment: number;
  scam_or_phishing: number;
  self_harm_risk: number;
  spam: number;
  group_attack: number;
  is_obfuscated_slur_or_evasion: number;
  wish_harm: number;
  unwanted: number;
  doxxing: number;
  no_one_would_miss: number;
  stated_intent: number;
  first_person: number;
  own_feelings: number;
  game_frustration: number;
  joking: number;
  /** 0 harmless … 3 severe, the /rate weighted position. */
  severity: number;
  severityConfidence: number;
}

export interface ChatMessage {
  id: number;
  user: string;
  color: string;
  text: string;
  truth: Truth;
  ts: number;
  raid: boolean;
  judgment: Judgment | null;
  error: string | null;
  /** ms between arrival and release; null while still held. */
  heldMs: number | null;
}

// ---------------------------------------------------------------------------
// The three request shapes. smoke.mjs carries the same strings — change both.
// ---------------------------------------------------------------------------

/**
 * One /yes-no call carries all fifteen statements for up to 32 texts. Wording is not
 * free: each one was picked by running the whole fixture through candidates with
 * smoke.mjs and keeping the phrasing that separated its bucket from normal chat.
 * Doxxing gets its own statement because /classify has no state object to carry it, and
 * `group_attack` its own because the personal-insult statement is deliberately narrow:
 * "The message is a personal insult directed at someone." scores 0.14 on backseat-gaming
 * advice where a broader "attacking or mocking someone" scores 0.44 and times the viewer
 * out, so the group case has to be asked separately instead of widened into it.
 *
 * Three statements cover abuse that dodges a word filter, because one cannot. The
 * obvious single question, "The message contains a disguised slur or abusive phrase.",
 * reads the disguise rather than the abuse and ranks emotes with it: it scores 0.22 on
 * "KEKW" and 0.28 on "im gonna kill this boss if it takes me all night" while reaching
 * only 0.39 on the slur bucket, so the band that catches a slur also hides hype. Asking
 * about the disguise directly is worse, not better — "The words are deliberately
 * misspelled or spaced out to hide them." scores 0.37 on "Pog Pog Pog" and 0.21 on
 * "k y s lmao", i.e. it ranks an emote above a slur. What works is ignoring the spelling
 * and naming the act:
 *   - `is_obfuscated_slur_or_evasion` "The message uses a slur." — slur bucket mean 0.47,
 *     highest clean line 0.19, and it still reads through light respellings: "what a f@g"
 *     0.75, "shut up f4g" 0.77, "k y s lmao" 0.45, "n i g g e r s in this chat lol" 0.31.
 *   - `wish_harm` "The message tells the reader to kill themselves." — 0.78 on "k1ll
 *     yours3lf you trash streamer", 0.01 on "im gonna kill this boss if it takes me all
 *     night". Saying "the reader" is what keeps game-directed aggression out of it.
 *   - `unwanted` "The message tells the reader that nobody likes or wants them." — the
 *     cheapest statement on the page: no clean fixture line clears 0.06, and it carries
 *     the abuse that has no insult word in it at all ("everyone in chat is laughing at
 *     you, nobody actually likes you" 0.56). "The message mocks or belittles the reader."
 *     catches more harassment but scores 0.38 on "my aim is trash today lol", so it was
 *     dropped: a false block on self-deprecation is the failure this page is about.
 *
 * None of `harassment`, `unwanted` or `wish_harm` reads direction, and no rewording makes
 * them. Each names a topic — being insulted, being unwanted, being told to die — and fires
 * on the topic whoever it is about. Measured: "nobody wants me around anymore, not even my
 * own family" scores 0.98 on `unwanted` and 0.33 on `harassment`, above the abusive lines
 * both were written for, and every candidate that tries to word the direction in scores the
 * same way ("The sender tells another person that nobody wants them." 0.94 on that same
 * self-directed line, "The message says that nobody likes you." 0.68). `wish_harm` has the
 * mirror problem: "ngl im probably gonna off myself tonight lmao" scores 0.45 on it. So
 * direction is asked separately — and NOT of the model, because the model cannot answer
 * it. Fourteen candidate direction statements were measured on ten crisis lines and eight
 * abusive ones, and every single one of them ranked at least one abusive line above at
 * least one crisis line. Some examples of how badly: "The message is directed at another
 * person, not about the sender." reads 0.05–0.22 on everything, abuse and crisis alike.
 * "The message is aimed at a second person." reads 0.06–0.33, with the abuse range
 * strictly inside the crisis range. "The message says that nobody wants the reader." and
 * "…that nobody wants the sender." come back within 0.05 of each other on every line, so
 * the two words are not distinguished at all. The best of the fourteen, "The message
 * attacks the person reading it.", still reads 0.32 on a Spanish crisis line and 0.09 on
 * "everyone in chat is laughing at you, nobody actually likes you".
 *
 * So the text tests in SECOND_PERSON and SELF_IS_OBJECT do the excluding, and these two
 * stay to confirm that a line with no pronouns in it is about its sender's own state:
 *   - `first_person` "The message is written in the first person about the sender."
 *   - `own_feelings` "The sender is describing their own feelings."
 *     Read as the HIGHER of the two, because the veto has already removed the abuse the
 *     lower-of-two was there to exclude — see FIRST_PERSON_BAR for what taking the lower
 *     cost. They are what covers text the regex cannot read: the Spanish abuse line
 *     "eres un idiota de mierda, muerete ya" carries no second-person token a regex knows.
 *
 * Known limit, stated because the page states it too: this model does not decode arbitrary
 * respellings. "kys already n0body cares" reads 0.02 on the slur statement and 0.05 on
 * wish_harm, and only `unwanted` reaches it at 0.22 — enough to hold it for a human, not
 * enough to remove it. The tokens are the problem, not the meaning: "n0body cares about
 * you" on its own scores 0.76 on `unwanted`; the "kys already " prefix destroys it.
 *
 * The last four exist because one crisis statement cannot do the job alone. Measured
 * on the fixture, "The sender sounds hopeless…" scores 0.40 on the ordinary chat line
 * "i keep dying on this level too, its brutal" and only 0.07 on the real crisis line
 * "if i wasnt around anymore would anyone here even notice", so on its own it ranks
 * game-death hyperbole above genuine distress. Writing the exclusion into the statement
 * does not fix it: this model collapses on the negation, and "…not that a game is hard"
 * drops every real crisis line to 0.01–0.04. So the exclusion lives in the policy —
 * `no_one_would_miss` adds the quiet phrasing the hopelessness statement misses,
 * `stated_intent` adds stated means and intent ("i have the pills right here"), which
 * hopelessness alone scores at 0.03, and `game_frustration` / `joking` are the two gates.
 * They are not the same gate: game talk is about the game and stops the care path dead,
 * a jokey register is a common way to say a real thing and only softens it, so it can
 * suppress care but never the human check.
 */
export const STATEMENTS: ReadonlyArray<{ key: keyof Judgment; statement: string; label: string }> = [
  { key: "harassment", label: "Harassment", statement: "The message is a personal insult directed at someone." },
  { key: "scam_or_phishing", label: "Scam", statement: "The writer is trying to scam the reader or promote something unsolicited." },
  { key: "self_harm_risk", label: "Self-harm", statement: "The sender sounds hopeless, in crisis, or ready to give up." },
  { key: "spam", label: "Spam", statement: "The message is a repetitive flood of the same words or characters." },
  { key: "group_attack", label: "Group attack", statement: "The message attacks or demeans a group of people." },
  { key: "is_obfuscated_slur_or_evasion", label: "Slur", statement: "The message uses a slur." },
  { key: "wish_harm", label: "Tells to die", statement: "The message tells the reader to kill themselves." },
  { key: "unwanted", label: "Unwanted", statement: "The message tells the reader that nobody likes or wants them." },
  { key: "doxxing", label: "Doxxing", statement: "The message exposes someone's private details: address, phone or workplace." },
  { key: "no_one_would_miss", label: "Unmissed", statement: "The sender feels that nobody would miss them." },
  { key: "stated_intent", label: "Intent", statement: "The sender says they intend to end their life or hurt themselves." },
  { key: "first_person", label: "About self", statement: "The message is written in the first person about the sender." },
  { key: "own_feelings", label: "Own feelings", statement: "The sender is describing their own feelings." },
  { key: "game_frustration", label: "Game talk", statement: "The sender is complaining about how hard the game is." },
  { key: "joking", label: "Joking", statement: "The sender is joking or exaggerating." },
];

/**
 * One /classify call: the moderation action, as described labels.
 *
 * The policy reads one number out of this call — `scores.escalate_to_human` — and
 * ignores the winning label, because measured on the fixture the label is not good
 * enough to act on: it returns `timeout_user` for 22 of 50 ordinary chat lines and for
 * every backseat-gaming line. The escalate score is not reliable either (0.95 on "i
 * keep dying on this level too, its brutal"), so it can only hold a borderline message
 * for a human — it can never route to care or remove a message on its own.
 */
export const ACTION_LABELS: Record<Action, string> = {
  allow: "GG, hype, emotes, questions, jokes, gameplay advice",
  hide: "spam flood, scam link, giveaway bait",
  timeout_user: "targeted abuse, slur, threat, doxxing",
  escalate_to_human: "the sender sounds suicidal",
};

/**
 * One /rate call: harm to the community, low to high. `score` comes back 0…3.
 *
 * Honest note: severity is shown on every message but almost never decides one. Over
 * the 114-line fixture it runs min 0.01, median 1.03, max 2.71, so at the tuned
 * defaults `hideSeverity` 2.7 clears one line and `timeoutSeverity` 3 clears none.
 * It is a second opinion next to the probabilities, not a third of the verdict.
 */
export const SEVERITY_SCALE: readonly string[] = ["Harmless.", "Annoying.", "Harmful.", "Abusive."];

// ---------------------------------------------------------------------------
// Policy: pure function from judgment to decision. Moving a slider re-decides
// every stored judgment with no new inference.
// ---------------------------------------------------------------------------

export type Decision = "allow" | "hide" | "timeout_user" | "care" | "review";

export interface Thresholds {
  /** crisis probability at or above this routes to care (never a ban). Doubles as the
   * bar the hyperbole gates have to stay under. */
  selfHarm: number;
  /** harassment, slur or tells-them-to-die probability at or above this times the user out. */
  timeout: number;
  /** any harm probability at or above this hides the message. */
  hide: number;
  /** severity (0–3) that hides on its own, and the one that times a user out. */
  hideSeverity: number;
  timeoutSeverity: number;
  /** a signal this far below the hide line is held for a human instead. */
  reviewBand: number;
}

// Tuned on the fixture with smoke.mjs. decision-machine-1 answers a bare statement
// with an absolute entailment probability, so the bands sit lower than Jev's.
export const DEFAULT_THRESHOLDS: Thresholds = {
  selfHarm: 0.3,
  timeout: 0.45,
  hide: 0.3,
  hideSeverity: 2.7,
  timeoutSeverity: 3,
  reviewBand: 0.1,
};

/**
 * The direction gate, half one. Whether a message points at a reader is grammar, not
 * meaning, so the policy reads it off the text instead of asking the model.
 *
 * That is not a retreat to the word list, it is the division of labour the page argues
 * for. The model decides whether a line is an attack at all — which spelling, which
 * language, which euphemism — and that is what a substring list cannot do. Who the line
 * points at is grammar, and the model is measurably worse at it: on the two direction
 * statements below, "honestly i hate you
 * and i wish you would just kill yourself" reads first_person 0.39 / own_feelings 0.84,
 * higher than the genuine crisis line "nobody wants me around anymore, not even my own
 * family" at 0.35 / 0.64. One "i ..." clause is all it takes, and no rewording fixes it:
 * fourteen candidates were measured on the same lines and every one of them put at least
 * one abusive line above at least one crisis line. "The message insults the reader."
 * reads 0.28 on a Spanish crisis line and 0.08 on "everyone in chat is laughing at you".
 * "The message says that nobody wants the reader." and "…the sender." return the same
 * numbers to within 0.05 on every line: the model does not distinguish the two words.
 *
 * This test alone is NOT direction, and reading it as direction shipped a ban on ordinary
 * crisis wording: one incidental "you" un-gated the four topic statements and timed the
 * sender out. SELF_IS_OBJECT below is what carries those lines now, and it carries all
 * four that were measured. What is left is the honest ceiling, measured rather than
 * assumed: a viewer who writes their own distress entirely in the second person loses the
 * gate, because the verb's object is "you". "do you ever feel like nobody wants you
 * around, because i do" decides timeout_user on `unwanted` 0.71. The branch order does not
 * save it either, because nothing reads it as a crisis to begin with — its crisis score is
 * 0.09, so no crisis branch is reached at all. The model and the text agree on this line
 * and both are wrong. Nothing measured separates it, so the row that bans it prints
 * NOTE_DIRECTION under the message and the page lists it as a published limit.
 * ponytail: eleven tokens, English plus the common respellings; a language the regex
 * does not cover falls back on the two statements below, which is why they stayed. Both
 * Spanish abuse lines measured stay at timeout_user on those two alone ("nadie te quiere,
 * deberias desaparecer" reads first_person 0.09 / own_feelings 0.16, so it never gates).
 */
const SECOND_PERSON = /\b(y[o0]u|yu|u|y[o0]ur|ur|y[o0]urs|urs|y[o0]ur?s[e3]lf|urs[e3]lf|y[o0]urselves)\b/i;

/** Does the message address a second person at all? */
// The mirror of SELF_IS_OBJECT: the reader is the verb's object, not merely present. A first-person
// crisis line with an incidental "you" ("i know you all tried to help but ... without me") must not ban.
const READER_IS_OBJECT =
  /\b(wants?|likes?|hates?|misses?|needs?|kill|k1ll|die|d1e)\s+(y[o0]u|u|y[o0]urs[e3]lf|urs[e3]lf)\b|\b(y[o0]u|u)\s+(should|need to|ought to|gotta|better|deserve to|can|could|will)\s+(just\s+)?(die|d1e|kill|k1ll|kys|end it|off yourself|disappear|drop dead|not exist)\b|\bkys\b/i;
export const addressesReader = (text: string): boolean => READER_IS_OBJECT.test(text) || (SECOND_PERSON.test(text) && !FIRST_PERSON_TOKEN.test(text));

/**
 * The direction gate, half one-and-a-half: the sender is the OBJECT of the attack verb.
 *
 * Presence of a second-person token is not direction. A viewer in crisis who says "you"
 * anywhere in the line lost the gate and was banned for it. Measured live at
 * DEFAULT_THRESHOLDS, before this test existed, each line reproduced on two runs:
 *   "nobody wants me here and you all know it, im done"        → timeout_user, unwanted 0.97
 *   "sorry to dump this on you chat but nobody likes me…"      → timeout_user, unwanted 0.90
 *   "i know you all think im a joke, everyone hates me…"       → timeout_user, unwanted 0.85
 *   "thanks for the stream, you helped, but nobody wants me…"  → timeout_user, unwanted 0.93
 * The model was not what failed on them: crisis reads 0.30–0.68 and the two direction
 * statements 0.63–0.89 / 0.57–0.84. Only the pronoun veto discarded that.
 *
 * So the object of the verb decides, not the presence of a pronoun. Five verbs, first
 * person only. It matches all four lines above and none of the abusive mirrors, which
 * take a second-person object: "nobody in this chat wants you here" (unwanted 0.73),
 * "everyone in chat is laughing at you, nobody actually likes you" (0.55) and the
 * Spanish "nadie te quiere, deberias desaparecer" (0.98) all stay at timeout_user.
 *
 * ponytail: five verbs, present tense, English. A line that says the same thing with
 * other words falls back on the two direction statements, as before.
 */
const SELF_IS_OBJECT = /\b(wants?|likes?|hates?|misses?|needs?)\s+(me|myself)\b/i;

/**
 * The care branch needs the message to be about a first person, and the model cannot say
 * so: it reads "X should kill himself" as the sender's own intent. Measured live, 3 of 3,
 * before this test existed:
 *   "honestly pixel_otter42 should kill himself, the world would be better" → care, crisis 0.73
 *   "this streamer should honestly just end it already, nobody would miss him" → care, crisis 0.80
 *   "that mod should just off himself, nobody would miss that guy" → care, crisis 0.38
 * On all three the attack statements stay at 0.02–0.23 and the direction statements at
 * 0.07–0.28, so nothing in the judgment stops the hotline reply going to the harasser.
 * A cry for help names its own writer; every care line measured carries one of these
 * tokens, the Spanish one included ("nadie me quiere"). Without one the message falls
 * through to the human-review branch below — never to care.
 *
 * One token is not enough on its own: "i think that streamer should honestly just kill
 * himself" carries "i" and still took the care reply (crisis 0.78, harassment 0.03). So a
 * third-person reflexive vetoes care as well. The cost is disclosed on the page: a viewer
 * writing about someone else's death ("my brother killed himself and i cant cope") gets a
 * human instead of the hotline text. That is the softer error of the two.
 */
const FIRST_PERSON_TOKEN = /\b(i|im|i'm|me|my|myself|mine)\b/i;
// Any third person vetoes the care reply, not only a reflexive: "i really think that streamer should just end it"
// is abuse aimed at someone else even with a first-person clause in front.
const THIRD_PERSON_REFLEXIVE = /\b(himself|herself|themselves|themself|hisself|he|him|his|she|her|they|them)\b/i;

/**
 * The direction gate, half two: the bar the model's own direction statements have to
 * clear. A message counts as being about the sender when it addresses no reader AND the
 * HIGHER of `first_person` / `own_feelings` clears this.
 *
 * The higher of the two, not the lower. Taking the lower was the previous shape and it
 * banned people in crisis: "nobody likes me. nobody wants me. thats it" reads
 * first_person 0.28 / own_feelings 0.65, missed the bar by 0.05, and was timed out on
 * `unwanted` 0.98 with the reason text "tells them nobody wants them" — asserting the
 * sender had said it to someone else. The lower of the two only had to carry the whole
 * direction test because nothing else did; with the two text tests doing the excluding,
 * this side only has to confirm that the line is about a person's own state, and the
 * higher of the two does that with margin (0.55–0.98 on every crisis line measured).
 * It is what keeps the two statements earning their tokens on text the regex cannot
 * read: the Spanish abuse line "eres un idiota de mierda, muerete ya" carries no
 * second-person token a regex would know, and stays ungated on these numbers alone.
 *
 * Not a slider: it is a direction test, not a strictness knob, and there is nothing a
 * moderator would want to trade against it. Below the bar nothing changes. Above it,
 * `harassment`, `group_attack`, `unwanted` and `wish_harm` stop counting as attacks — on
 * every branch, the removal ones included — because all four name a topic rather than a
 * target. `group_attack` was left ungated once, on the reasoning that a group attack is
 * by construction not about the sender; it is not, because the statement fires on the
 * word "everyone" wherever it points. "everyone hates me and im done" reads 0.38 on it
 * and "nobody likes me. nobody wants me. thats it" reads 0.41, both above the hide line.
 * `is_obfuscated_slur_or_evasion` is the only statement never gated: a slur is a slur in
 * any grammatical person, and it is what carries the abusive lines with no pronoun in
 * them at all.
 */
export const FIRST_PERSON_BAR = 0.33;

export interface PolicyResult {
  decision: Decision;
  reason: string;
  /**
   * What the TEXT decided when the model could not, printed in the chat row beside the
   * badge. A visitor can reach a timeout with a message that is not abuse — a viewer who
   * writes their own distress in the second person — so the gate that did it says so on
   * the screen where it happens, not only in these notes.
   */
  note?: string;
}

/** The three notes, one per text test. Kept here so the page and the UI print the same words. */
export const NOTE_DIRECTION = "direction read from the pronouns in the text, not by the model";
export const NOTE_SELF_OBJECT = "read as about its own sender from “…me”, not by the model";
export const NOTE_NO_FIRST_PERSON = "no first-person wording, so no care reply — held for a human";

const pct = (v: number) => v.toFixed(2);

export function decide(j: Judgment | null, t: Thresholds, text = ""): PolicyResult {
  if (!j) return { decision: "review", reason: "no judgment (error)" };

  // The crisis signal is the strongest of the three self-harm statements: the hopelessness
  // one carries most lines, `no_one_would_miss` carries the quiet ones it misses
  // ("if i wasnt around anymore would anyone here even notice" scores 0.07 and 0.69), and
  // `stated_intent` carries stated means ("i have the pills right here" scores 0.03 on
  // hopelessness).
  const crisis = Math.max(j.self_harm_risk, j.no_one_would_miss, j.stated_intent ?? 0);
  // Two gates, not one, because they mean different things. Game talk is about the game
  // and not about the sender: "i keep dying on this level too, its brutal" scores 0.40 on
  // the crisis statement and 0.69 here, and it is the gate that made the care queue fire
  // on ordinary chat. A jokey register is different — "gonna off myself tonight lmao" is
  // how people say a real thing — so it suppresses the care reply but never the human check.
  const gameTalk = j.game_frustration;
  const hyperbole = Math.max(gameTalk, j.joking);
  // …and never for abuse aimed at someone else. "k y s lmao" reads as crisis to any
  // filter, and the intent statement is worse: it scores 0.91 on "k!ll urself streamer",
  // reading the second person as the sender. So any attack signal at all vetoes the care
  // path — a tie-break on the larger number is not enough when crisis wins that tie.
  //
  // But "any attack signal" has to mean an attack on someone, and four of the five attack
  // statements name a topic rather than a target. Measured on one Spanish crisis line,
  // "nadie me quiere, ya no aguanto mas": harassment 0.58, unwanted 0.99, group attack
  // 0.34 — every one of them over its line, on a viewer saying nobody loves them. Two
  // more, in English: "nobody likes me. nobody wants me. thats it" reads harassment 0.54
  // and unwanted 0.98, and "everyone hates me and im done" reads harassment 0.46 and group
  // attack 0.38. Counting those as attacks vetoes this branch and the human-review branch
  // under it and then bans the sender on the same numbers. Dropping them instead hands
  // "you should kill yourself, seriously" a hotline number, because the slur statement
  // reads 0.05 on the plain spelling. Neither wording works — see the STATEMENTS note —
  // so direction is measured separately: three text tests, then the two
  // direction statements. smoke.mjs asserts every one of these lines, in both directions,
  // before it makes a single call.
  // "nobody wants me" is about its sender even when the line also says "you". The verb's
  // object settles it, and it overrides the pronoun veto — see SELF_IS_OBJECT.
  const selfIsObject = SELF_IS_OBJECT.test(text);
  const pointsAtReader = !selfIsObject && addressesReader(text);
  const aboutSender = selfIsObject || (!pointsAtReader && Math.max(j.first_person ?? 0, j.own_feelings ?? 0) >= FIRST_PERSON_BAR);
  // One rule, every branch: a statement that names a topic counts as an attack only when
  // the message is not about its sender. Applying it on the veto alone was the previous
  // shape, defended on the grounds that ungating the removal path bought two fixture
  // catches. That was measured wrong — the two catches are "how are you this dumb,
  // genuinely" and "imagine being this bad at a kids game", and neither is about its
  // sender, so neither is gated here either. What the ungated copy bought was a ban on
  // any viewer whose own distress reads as an insult.
  const aimed = (v: number) => (aboutSender ? 0 : (v ?? 0));
  const insult = aimed(j.harassment);
  const groupAttack = aimed(j.group_attack);
  const outward = Math.max(aimed(j.unwanted), aimed(j.wish_harm));
  // `is_obfuscated_slur_or_evasion` is the one statement that is never gated: a slur is a
  // slur in any grammatical person, and it is what holds the abusive lines that carry no
  // second-person pronoun ("bunch of r3tards in this chat", "what a f@g").
  const aimedAtOthers = Math.max(insult, j.is_obfuscated_slur_or_evasion, groupAttack, outward);
  // The /classify escalate score is too noisy to act on (0.95 on that same ordinary chat
  // line), so it can only widen the band that reaches a human, never route on its own.
  const escalate = j.actionScores?.escalate_to_human ?? 0;
  // …and never for abuse aimed at a named third party. The model reads "that mod should
  // just off himself" as the sender's own intent (crisis 0.38–0.80 on the three measured
  // lines) while every attack statement stays under 0.25, so only the text says who the
  // line is about. A cry for help names its own writer — see FIRST_PERSON_TOKEN.
  const namesSelf = FIRST_PERSON_TOKEN.test(text) && !THIRD_PERSON_REFLEXIVE.test(text);
  if (crisis >= t.selfHarm && hyperbole < t.selfHarm && aimedAtOthers < t.selfHarm && namesSelf) {
    return { decision: "care", reason: `crisis ${pct(crisis)}, not hyperbole (${pct(hyperbole)})`, note: selfIsObject ? NOTE_SELF_OBJECT : undefined };
  }

  // Everything that still reads as crisis rather than as abuse goes in front of a human
  // here, ABOVE the timeout and hide branches, so no such message can be quietly removed
  // and none can be released because a joke gate vetoed the care reply.
  // A strong escalate score on its own is the last net, for the lines no crisis statement
  // reaches: "i have the pills right here and honestly its fine, goodbye chat" scores 0.03
  // on hopelessness and 0.70 here. It is gated hard because the score is noisy (0.95 on
  // "i keep dying on this level too, its brutal", which the game-talk gate stops).
  //
  // This branch carries the promise the page prints, so its veto is narrower than the care
  // one on purpose. A message with no second-person pronoun anywhere in it is not aimed at
  // a reader, whatever the four topic statements read, so here they do not veto: only a
  // slur does, because a slur needs no pronoun to be abuse. That is what makes "never a
  // ban and never a silent delete" structural instead of a property of the direction
  // statements — a crisis line whose `own_feelings` comes back low still lands in front of
  // a human rather than being removed on `unwanted` 0.99. Measured cost on the fixture:
  // see the miss list printed by smoke.mjs.
  const vetoHere = pointsAtReader ? aimedAtOthers : j.is_obfuscated_slur_or_evasion;
  if (gameTalk < t.selfHarm && vetoHere < t.selfHarm && (crisis >= t.selfHarm || escalate >= 0.65 || (crisis >= t.selfHarm / 2 && escalate >= 0.5))) {
    // A crisis score with no first-person wording in the text is the third-party-abuse
    // shape ("that mod should just off himself"): the care reply is withheld and the row
    // says which test withheld it.
    const note = crisis >= t.selfHarm && !namesSelf ? NOTE_NO_FIRST_PERSON : selfIsObject ? NOTE_SELF_OBJECT : undefined;
    return { decision: "review", reason: `crisis ${pct(crisis)} + escalate ${pct(escalate)}`, note };
  }

  const worstAttack = Math.max(insult, j.is_obfuscated_slur_or_evasion, outward);
  // Game-directed aggression is not harassment, and the statements carry that rather than
  // the gate: "im gonna kill this boss if it takes me all night" measures 0.06 on the slur
  // statement, 0.01 on wish_harm and 0.16 on the insult one, so it never reaches this
  // branch. The gameTalk gate is the backstop for the case the wording misses — it reads
  // 0.03 on that line, so it is not what saves it.
  if ((worstAttack >= t.timeout && gameTalk < t.selfHarm) || j.severity >= t.timeoutSeverity) {
    const why =
      j.is_obfuscated_slur_or_evasion >= t.timeout
        ? `slur ${pct(j.is_obfuscated_slur_or_evasion)}`
        : !aboutSender && (j.wish_harm ?? 0) >= t.timeout
          ? `tells them to die ${pct(j.wish_harm)}`
          : !aboutSender && (j.unwanted ?? 0) >= t.timeout
            ? `tells them nobody wants them ${pct(j.unwanted)}`
            : insult >= t.timeout
              ? `harassment ${pct(insult)}`
              : `severity ${j.severity.toFixed(1)}/3`;
    // A ban decided on one of the four topic statements rests on the pronoun test: the
    // statements fire on the topic, and only the text says who it is about. Say so in the
    // row, because a viewer writing their own distress in the second person lands here.
    const fromPronouns = pointsAtReader && !why.startsWith("slur") && !why.startsWith("severity");
    return { decision: "timeout_user", reason: why, note: fromPronouns ? NOTE_DIRECTION : undefined };
  }

  const signals: Array<[string, number]> = [
    ["scam", j.scam_or_phishing],
    ["spam", j.spam],
    ["group attack", groupAttack],
    ["harassment", insult],
    ["slur", j.is_obfuscated_slur_or_evasion],
    // Same gate as above, for the same reason: a viewer writing "nobody wants me around
    // anymore" must not be hidden for it. Crisis lines leave through the branches above,
    // but the gate belongs on the signal, not on the one path that happens to reach it.
    ["tells them to die", aboutSender ? 0 : (j.wish_harm ?? 0)],
    ["tells them nobody wants them", aboutSender ? 0 : (j.unwanted ?? 0)],
    ["doxxing", j.doxxing],
  ];
  const strongest = signals.reduce((a, b) => (b[1] > a[1] ? b : a));
  const TOPIC_SIGNALS = new Set(["group attack", "harassment", "tells them to die", "tells them nobody wants them"]);
  if (strongest[1] >= t.hide) {
    return { decision: "hide", reason: `${strongest[0]} ${pct(strongest[1])}`, note: pointsAtReader && TOPIC_SIGNALS.has(strongest[0]) ? NOTE_DIRECTION : undefined };
  }
  if (j.severity >= t.hideSeverity) return { decision: "hide", reason: `severity ${j.severity.toFixed(1)}/3` };

  if (strongest[1] >= t.hide - t.reviewBand) {
    return { decision: "review", reason: `borderline ${strongest[0]} ${pct(strongest[1])}` };
  }
  return { decision: "allow", reason: `nothing above ${pct(t.hide - t.reviewBand)}` };
}

/** Did the decision take the message off the screen? */
export const isBlocking = (d: Decision) => d === "hide" || d === "timeout_user" || d === "care";

export interface FilterScore {
  harmfulTotal: number;
  caught: number;
  wronglyBlocked: number;
  cleanTotal: number;
}
export const emptyScore = (): FilterScore => ({ harmfulTotal: 0, caught: 0, wronglyBlocked: 0, cleanTotal: 0 });

/**
 * Score one verdict against ground truth. Self-harm is excluded: routing it to
 * care is right and banning it is wrong, so it counts as neither catch nor miss.
 */
export function scoreVerdict(acc: FilterScore, truth: Truth, blocked: boolean): void {
  if (truth === "self_harm") return;
  if (HARMFUL_TRUTHS.has(truth)) {
    acc.harmfulTotal++;
    if (blocked) acc.caught++;
  } else {
    acc.cleanTotal++;
    if (blocked) acc.wronglyBlocked++;
  }
}

export const CARE_REPLY =
  "Hey, we read that and we're glad you're here. If things feel heavy right now you can text or call 988 (US) or find a local line at findahelpline.com. A mod is going to DM you — you don't have to carry this alone.";

// ---------------------------------------------------------------------------
// The word-list baseline: a case-insensitive substring match, the way most chat
// bots ship it. It catches the obvious spelling and fires on innocent chat.
// ---------------------------------------------------------------------------

export const WORD_LIST: readonly string[] = [
  "kys", "kill yourself", "kill", "die", "trash", "idiot", "loser", "stupid", "retard", "fag",
  "nazi", "whore", "free", "giftcard", "gift card", "giveaway", "http", "discord.gg", "bit.ly",
  "crypto", "address", "dox", "vote", "trump", "biden", "election", "shut up",
];

export function wordListMatch(text: string): string | null {
  const lower = text.toLowerCase();
  for (const term of WORD_LIST) if (lower.includes(term)) return term;
  return null;
}

// ---------------------------------------------------------------------------
// Seeded simulator.
// ---------------------------------------------------------------------------

/** mulberry32 — small seeded PRNG so every run is reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ADJ = [
  "silent", "neon", "turbo", "crispy", "sleepy", "pixel", "lucky", "salty", "cosmic", "rusty",
  "frosty", "mellow", "spicy", "quiet", "wobbly", "sneaky", "golden", "shadow", "hyper", "fuzzy",
  "chunky", "swift", "dizzy", "lunar", "grumpy", "velvet", "static", "sunny", "arctic", "toxic",
  "cyber", "retro", "mint", "iron", "wild", "tiny", "mega", "zesty", "gloomy", "witty",
];
const NOUN = [
  "otter", "falcon", "panda", "gamer", "wizard", "noodle", "raccoon", "viking", "ghost", "pirate",
  "badger", "goblin", "koala", "sniper", "toast", "walrus", "ninja", "llama", "moth", "cactus",
  "yeti", "penguin", "dragon", "hobbit", "wolf", "taco", "comet", "robot", "fox", "bean",
];
const COLORS = ["#ff7a90", "#7dd3fc", "#a7f3d0", "#fcd34d", "#c4b5fd", "#fdba74", "#f9a8d4", "#86efac", "#93c5fd", "#fde68a"];

export interface ChatUser {
  name: string;
  color: string;
}

export function makeUsers(count: number, rng: () => number): ChatUser[] {
  const seen = new Set<string>();
  const users: ChatUser[] = [];
  while (users.length < count) {
    const name = `${ADJ[Math.floor(rng() * ADJ.length)]}_${NOUN[Math.floor(rng() * NOUN.length)]}${Math.floor(rng() * 999)}`;
    if (seen.has(name)) continue;
    seen.add(name);
    users.push({ name, color: COLORS[Math.floor(rng() * COLORS.length)] });
  }
  return users;
}

// Normal chat deliberately includes word-list bait ("this boss is killing me",
// "free weekend", "my aim is trash") that a keyword filter blocks wrongly.
const NORMAL: readonly string[] = [
  "LETS GOOO that clutch was insane PogChamp",
  "what sens do you play on?",
  "GG that was clean",
  "W streamer",
  "first time here, this game looks fun",
  "KEKW",
  "that boss fight was mid ngl",
  "how long have you been running this game?",
  "the music in this zone slaps",
  "Pog Pog Pog",
  "is this the DLC or base game?",
  "my aim is trash today lol",
  "this boss is killing me every time i try it",
  "i died to that same jump like 40 times",
  "wait is there a free weekend on steam right now?",
  "lurking from work, dont tell my boss",
  "the pacing on this run is so good",
  "what a save omg",
  "chat is moving so fast today",
  "raid from the other stream, hello everyone!",
  "monkaS that health bar",
  "ez clap",
  "nooo the checkpoint 😭",
  "can you show the settings menu real quick?",
  "this is the best run ive seen all week",
  "LUL",
  "big brain play right there",
  "what's the world record for this category?",
  "hello from brazil 🇧🇷",
  "the vod from yesterday was amazing",
  "i keep dying on this level too, its brutal",
  "you have the patience of a saint for this game",
  "sheeeesh",
  "F in chat for that run",
  "the new patch nerfed that weapon right?",
  "wholesome stream tonight",
  "ok that skip was actually genius",
  "hyped for the marathon this weekend",
  "1v5 and still won, what",
  "gonna grab snacks, brb chat",
  "who else is watching at 3am",
  "the lighting in this cave section is gorgeous",
  "that dodge roll timing tho",
  "how do you keep so calm after dying that many times",
  "peepoHappy good vibes only",
  "did the run get reset or is that a save state?",
  "10/10 commentary",
  "the elevator music while loading is a vibe",
  "lmaooo the physics in this game",
  "that was a certified hood classic moment",
];

const BACKSEAT: readonly string[] = [
  "just use the shotgun bro, why do you keep picking the sniper",
  "you missed a chest back there, go back",
  "why didnt you heal there, you had 3 potions",
  "the skip is on the left, everyone knows that",
  "you should have parried instead of rolling",
  "wrong route, the faster one is through the sewer",
  "buy the upgrade already omg",
  "you keep forgetting to reload between fights",
];

const HARASSMENT: readonly string[] = [
  "you are the worst streamer on this whole site, quit already",
  "imagine being this bad at a kids game, embarrassing",
  "everyone in chat is laughing at you, nobody actually likes you",
  "@{u} shut up nobody asked for your opinion, clown",
  "@{u} you type like you have two brain cells",
  "your voice is so annoying i hope you lose your job",
  "trash streamer, trash chat, trash game",
  "nobody would notice if you never streamed again",
  "@{u} log off forever please, you ruin every stream",
  "how are you this dumb, genuinely",
];

const SLUR_EVASION: readonly string[] = [
  "k1ll yours3lf you trash streamer",
  "k y s lmao",
  "you're such a f4gg0t lol",
  "bunch of r3tards in this chat",
  "go d1e in a fire",
  "kys already n0body cares",
  "what a f@g",
  "this streamer is a r e t a r d",
  "k!ll urself streamer",
  "shut up f4g",
];

const SCAM: readonly string[] = [
  "Free 100$ steam giftcards, DM me on discord to claim before they run out",
  "streamer is giving away 50 nitro subs, check my bio for the link",
  "want free skins? add me and send me your login, i can dupe them",
  "🎁 GIVEAWAY 🎁 first 20 people to DM me get a free PS5",
  "I doubled my money on this coin in one week, dm me for the group invite",
  "get free vbucks here -> bit.ly/vb-free-2026",
  "streamer sent me here, everyone gets 2 months free if you click my profile",
  "selling this account cheap, pm me, paypal only",
  "join discord.gg/xyz-giveaways for free gift cards from the mods",
  "message me for free follower boosts, totally legit",
];

const DOXXING: readonly string[] = [
  "I live in the same town as you, I know your street. 4421 Maple",
  "i found your real name on linkedin, want me to post it?",
  "his phone number is 555-0134 if anyone wants to call and tell him he sucks",
  "@{u} i know which school you go to, careful what you say",
  "pretty sure the streamer's apartment is the one with the red door, i drove past it",
  "her mom works at the pharmacy on 3rd street, someone should pay a visit",
];

const SELF_HARM: readonly string[] = [
  "honestly i dont see the point anymore. nobody would care if i was gone",
  "this stream is the only thing keeping me going, i dont think ill be here next week",
  "i keep thinking about hurting myself again, sorry for being a downer chat",
  "not doing well lately. failed everything. dont know why i bother waking up",
  "sorry to dump this here but i just want it all to stop",
  "if i wasnt around anymore would anyone here even notice",
];

const SPAM: readonly string[] = [
  "GG GG GG GG GG GG GG GG GG GG GG GG GG GG GG",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
  "PogChamp PogChamp PogChamp PogChamp PogChamp PogChamp PogChamp PogChamp",
  "LOOK AT ME LOOK AT ME LOOK AT ME LOOK AT ME LOOK AT ME LOOK AT ME",
  "ᕕ( ᐛ )ᕗ ᕕ( ᐛ )ᕗ ᕕ( ᐛ )ᕗ ᕕ( ᐛ )ᕗ ᕕ( ᐛ )ᕗ ᕕ( ᐛ )ᕗ ᕕ( ᐛ )ᕗ",
  "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
  "spam spam spam spam spam spam spam spam spam spam spam spam",
];

const OFF_TOPIC_FIGHT: readonly string[] = [
  "why are you not talking about the election, cowards, everyone here votes wrong anyway",
  "@{u} people like you are the reason this country is finished",
  "anyone who supports that party is a traitor, fight me",
  "stop gaming and talk about politics, your silence is a statement, coward",
  "@{u} typical, you people always cry when someone brings up the real issues",
  "this chat is full of brainwashed sheep, wake up",
];

export const BUCKETS: ReadonlyArray<{ truth: Truth; weight: number; lines: readonly string[] }> = [
  { truth: "ok", weight: 74, lines: NORMAL },
  { truth: "backseat", weight: 6, lines: BACKSEAT },
  { truth: "harassment", weight: 5, lines: HARASSMENT },
  { truth: "slur_evasion", weight: 3, lines: SLUR_EVASION },
  { truth: "scam", weight: 4, lines: SCAM },
  { truth: "doxxing", weight: 1.5, lines: DOXXING },
  { truth: "self_harm", weight: 1.5, lines: SELF_HARM },
  { truth: "spam", weight: 3, lines: SPAM },
  { truth: "off_topic_fight", weight: 2, lines: OFF_TOPIC_FIGHT },
];

export const RAID_BUCKETS: ReadonlyArray<{ truth: Truth; weight: number; lines: readonly string[] }> = [
  { truth: "spam", weight: 55, lines: SPAM },
  { truth: "harassment", weight: 25, lines: HARASSMENT },
  { truth: "slur_evasion", weight: 15, lines: SLUR_EVASION },
  { truth: "scam", weight: 5, lines: SCAM },
];

function pickWeighted<T extends { weight: number }>(items: readonly T[], rng: () => number): T {
  const total = items.reduce((s, b) => s + b.weight, 0);
  let r = rng() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

export function generateLine(
  rng: () => number,
  users: readonly ChatUser[],
  buckets: typeof BUCKETS = BUCKETS,
): { text: string; truth: Truth } {
  const bucket = pickWeighted(buckets, rng);
  let text = bucket.lines[Math.floor(rng() * bucket.lines.length)];
  if (text.includes("{u}")) text = text.replace("{u}", users[Math.floor(rng() * users.length)].name);
  return { text, truth: bucket.truth };
}

/** Every labelled line once, for the offline evaluation in smoke.mjs. */
export function allFixtureLines(): Array<{ text: string; truth: Truth }> {
  const out: Array<{ text: string; truth: Truth }> = [];
  for (const b of BUCKETS) for (const text of b.lines) out.push({ text: text.replace("{u}", "pixel_otter42"), truth: b.truth });
  return out;
}

/** Finite stock sequences keep requests independent of timer and raid timing. */
export const STOCK_CHAT = (() => {
  const rng = makeRng(20260919);
  const users = makeUsers(64, makeRng(4242));
  return Array.from({ length: 128 }, () => generateLine(rng, users));
})();
export const STOCK_RAID = (() => {
  const rng = makeRng(20260920);
  const users = makeUsers(64, makeRng(4242));
  return Array.from({ length: 32 }, () => generateLine(rng, users, RAID_BUCKETS));
})();
export const STOCK_TEXTS = [...new Set([...STOCK_CHAT, ...STOCK_RAID].map(row => row.text))];

/** The chat visible before anything is sent: held, unjudged, deterministic. */
export function seedMessages(count: number, seed = 7): ChatMessage[] {
  const rng = makeRng(seed);
  const users = makeUsers(64, rng);
  const out: ChatMessage[] = [];
  const t0 = Date.now() - count * 1400;
  for (let i = 0; i < count; i++) {
    const { text, truth } = generateLine(rng, users);
    const user = users[Math.floor(rng() * users.length)];
    out.push({
      id: -count + i,
      user: user.name,
      color: user.color,
      text,
      truth,
      ts: t0 + i * 1400,
      raid: false,
      judgment: null,
      error: null,
      heldMs: null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rolling stats.
// ---------------------------------------------------------------------------

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/** Fixed-capacity ring of recent numbers for rolling percentiles. */
export class Rolling {
  // ponytail: plain fields, no parameter property, so `node smoke.mjs` can import this file directly.
  buf: number[] = [];
  capacity: number;
  constructor(capacity: number) {
    this.capacity = capacity;
  }
  push(v: number): void {
    this.buf.push(v);
    if (this.buf.length > this.capacity) this.buf.shift();
  }
  values(): readonly number[] {
    return this.buf;
  }
}
