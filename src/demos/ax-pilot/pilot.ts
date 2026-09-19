// Port of the Swift pilot core from jev-ax-pilot: TreeFlattener, TextCandidates, AnswerHandler
// and the Metrics percentiles. Pure functions, no DOM, no network — the island and smoke.mjs
// both import this file, so the browser and the smoke test send byte-identical request bodies.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** One node of an accessibility tree, as recorded from AXUIElement or built by a simulated app. */
export interface AXNode {
  role: string;
  subrole?: string;
  title?: string;
  value?: string;
  description?: string;
  help?: string;
  identifier?: string;
  enabled?: boolean;
  focused?: boolean;
  selected?: boolean;
  frame?: Rect;
  actions?: string[];
  children?: AXNode[];
  /** Browser-only: ties a simulated element back to its DOM node for the highlight overlay. */
  key?: string;
}
export interface AXSnapshot {
  appName: string;
  windowTitle?: string;
  root: AXNode;
}

/** A pruned, addressable element the model can choose. */
export interface FlatElement {
  id: string;
  role: string;
  label?: string;
  value?: string;
  focused: boolean;
  selected: boolean;
  destructive: boolean;
  path: number[];
  frame: Rect;
  key?: string;
}
export interface FlatTree {
  elements: FlatElement[];
  contextText: string[];
  focused?: FlatElement;
  hasModalSheet: boolean;
  appName: string;
  windowTitle?: string;
}

export const isTextInput = (e: FlatElement) =>
  e.role === "text field" || e.role === "text area" || e.role === "search field" || e.role === "combo box";

/** What the model sees for this option: role plus label and current value. */
export function summary(e: FlatElement): string {
  const parts = [e.role];
  if (e.label) parts.push(`'${e.label}'`);
  if (e.value && e.value !== e.label) parts.push(`value=${e.value}`);
  if (e.focused) parts.push("(focused)");
  if (e.selected) parts.push("(selected)");
  return parts.join(" ");
}

/** True when `text` appears in any element value/label, visible text, or the window title. */
export function showsText(tree: FlatTree, text: string): boolean {
  const needle = text.toLowerCase();
  if (tree.windowTitle?.toLowerCase().includes(needle)) return true;
  if (tree.contextText.some((t) => t.toLowerCase().includes(needle))) return true;
  return tree.elements.some(
    (e) => e.value?.toLowerCase().includes(needle) || e.label?.toLowerCase().includes(needle),
  );
}

// ---------------------------------------------------------------- TreeFlattener

export const ELEMENT_CAP = 60;
/** /classify takes at most 64 labels and 5 of those are pseudo-actions. */
export const LABEL_ELEMENT_CAP = 55;
const CONTEXT_CAP = 14;
const VALUE_CAP = 80;
const MENU_ITEM_CAP = 10;

const ACTIONABLE_ROLES = new Set([
  "AXButton", "AXCheckBox", "AXRadioButton", "AXPopUpButton", "AXMenuButton", "AXComboBox",
  "AXTextField", "AXTextArea", "AXLink", "AXSlider", "AXRow", "AXDisclosureTriangle",
  "AXIncrementor", "AXToggle", "AXSwitch", "AXTab", "AXTabButton", "AXCell",
]);
const IGNORED_SUBROLES = new Set([
  "AXCloseButton", "AXZoomButton", "AXMinimizeButton", "AXFullScreenButton", "AXIncrementArrow",
  "AXDecrementArrow", "AXIncrementPage", "AXDecrementPage", "AXToolbarButton",
]);
const CONTAINER_ROLES = new Set(["AXWindow", "AXSheet", "AXDrawer", "AXPopover", "AXDialog"]);
const IGNORED_MENU_PREFIXES = ["About ", "Hide ", "Quit ", "Show All", "Services", "Hide Others"];

export const DESTRUCTIVE_WORDS = [
  "delete", "empty trash", "erase", "send", "pay", "purchase", "buy", "remove", "discard", "trash",
  "uninstall", "format", "reset", "sign out", "log out", "shut down", "restart",
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const containsWord = (text: string, word: string) =>
  new RegExp(`\\b${escapeRe(word)}\\b`, "i").test(text);

export function shortRole(role: string, subrole?: string): string {
  if (subrole === "AXSearchField") return "search field";
  if (subrole === "AXSwitch" || subrole === "AXToggle") return "switch";
  const stripped = role.startsWith("AX") ? role.slice(2) : role;
  let out = "";
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i];
    if (i > 0 && c >= "A" && c <= "Z") out += " ";
    out += c.toLowerCase();
  }
  return out;
}

export function cleaned(text?: string): string | undefined {
  if (text == null) return undefined;
  const collapsed = text
    .replace(/[​-‏‪-‮⁠﻿]/g, "")
    .replace(/ /g, " ")
    .replace(/‑/g, "-")
    .split(/[\r\n]+/)
    .join(" ")
    .trim();
  if (!collapsed) return undefined;
  return collapsed.length > VALUE_CAP ? collapsed.slice(0, VALUE_CAP) + "…" : collapsed;
}

export function isDestructive(label: string | undefined, goal: string): boolean {
  if (!label) return false;
  const lowered = label.toLowerCase();
  return DESTRUCTIVE_WORDS.some((w) => containsWord(lowered, w) && !containsWord(goal, w));
}

/** Text a row or cell shows, gathered from its static-text descendants. */
export function derivedLabel(node: AXNode, depth = 0): string | undefined {
  const parts: string[] = [];
  for (const child of node.children ?? []) {
    if (child.role === "AXStaticText" || child.role === "AXTextField") {
      const text = cleaned(child.value) ?? cleaned(child.title);
      if (text) parts.push(text);
    } else if (depth < 4) {
      const nested = derivedLabel(child, depth + 1);
      if (nested) parts.push(nested);
    }
    if (parts.length >= 3) break;
  }
  return parts.length ? parts.join(" · ") : undefined;
}

interface Candidate {
  element: FlatElement;
  score: number;
  order: number;
  inSheet: boolean;
  isMenuItem: boolean;
}

/** Turns a raw accessibility tree into a compact list of actionable elements. */
export function flatten(snapshot: AXSnapshot, goal: string, screen?: Rect): FlatTree {
  const goalTokens = relevanceTokens(goal);
  const lowerGoal = goal.toLowerCase();
  const candidates: Candidate[] = [];
  const contextText: string[] = [];
  let order = 0;
  let pathInSheet = false;

  const relevanceOf = (text: string) => relevance(text, goalTokens);
  const visible = (frame: Rect | undefined, container?: Rect) => {
    if (!frame || frame.w <= 0 || frame.h <= 0) return false;
    if (container && container.w > 0 && !intersects(container, frame)) return false;
    if (screen && !intersects(screen, frame)) return false;
    return true;
  };

  function addCandidate(node: AXNode, path: number[], container: Rect | undefined, inSheet: boolean) {
    if (node.enabled === false) return;
    if (!visible(node.frame, container)) return;
    const role = shortRole(node.role, node.subrole);
    let label = cleaned(node.title) ?? cleaned(node.description) ?? cleaned(node.help);
    if (
      label == null &&
      (node.role === "AXRow" || node.role === "AXCell" || node.role === "AXButton" || node.role === "AXLink")
    ) {
      label = derivedLabel(node);
    }
    let value = cleaned(node.value);
    if (node.role === "AXRow" || node.role === "AXCell") {
      if (label == null || (node.frame?.h ?? 0) <= 0) return;
      value = undefined;
    }
    const textInput = node.role === "AXTextField" || node.role === "AXTextArea" || node.role === "AXComboBox";
    if (label == null && value == null && !textInput && node.identifier == null) return;
    if (label == null && node.identifier != null && !textInput) label = cleaned(node.identifier);
    const element: FlatElement = {
      id: "",
      role,
      label,
      value,
      focused: node.focused === true,
      selected: node.selected === true,
      destructive: isDestructive(label, lowerGoal),
      path,
      frame: node.frame ?? rect(0, 0, 0, 0),
      key: node.key,
    };
    let score = relevanceOf(label ?? "") + relevanceOf(value ?? "") * 0.5;
    if (node.focused) score += 5;
    if (textInput) score += 2;
    if (inSheet) score += 3;
    candidates.push({ element, score, order, inSheet, isMenuItem: false });
  }

  function visitMenu(node: AXNode, path: number[], menuTrail: string[]) {
    if (node.role === "AXMenuBarItem" || node.role === "AXMenu") {
      const trail = node.role === "AXMenuBarItem" ? [...menuTrail, node.title ?? ""] : menuTrail;
      (node.children ?? []).forEach((child, index) => visitMenu(child, [...path, index], trail));
      return;
    }
    if (node.role !== "AXMenuItem") return;
    if (node.enabled === false) return;
    const title = cleaned(node.title);
    if (!title) return;
    if (IGNORED_MENU_PREFIXES.some((p) => title.startsWith(p))) return;
    if ((node.children ?? []).length) {
      (node.children ?? []).forEach((child, index) => visitMenu(child, [...path, index], [...menuTrail, title]));
      return;
    }
    const score = relevanceOf(title);
    if (score <= 0) return;
    order += 1;
    const label = [...menuTrail, title].join(" > ");
    candidates.push({
      element: {
        id: "", role: "menu item", label, focused: false, selected: false,
        destructive: isDestructive(title, lowerGoal), path, frame: node.frame ?? rect(0, 0, 0, 0),
      },
      score, order, inSheet: false, isMenuItem: true,
    });
  }

  function visit(node: AXNode, path: number[], depth: number, container: Rect | undefined, menuTrail: string[]) {
    order += 1;
    const role = node.role;
    if (role === "AXMenuBar") {
      (node.children ?? []).forEach((item, index) => {
        if (item.title !== "Apple") visit(item, [...path, index], depth + 1, undefined, []);
      });
      return;
    }
    if (role === "AXMenuBarItem" || role === "AXMenu" || role === "AXMenuItem") {
      visitMenu(node, path, menuTrail);
      return;
    }
    if (role === "AXScrollBar" || role === "AXRulerMarker" || role === "AXRuler" || role === "AXUnknown") return;
    if (CONTAINER_ROLES.has(role)) container = node.frame;
    const isSheet = role === "AXSheet" || role === "AXDialog";
    if (node.subrole && IGNORED_SUBROLES.has(node.subrole)) return;
    if (role === "AXStaticText") {
      if (visible(node.frame, container)) {
        const text = cleaned(node.value) ?? cleaned(node.title);
        if (text && !contextText.includes(text)) contextText.push(text);
      }
      return;
    }
    if (ACTIONABLE_ROLES.has(role)) {
      addCandidate(node, path, container, isSheet || pathInSheet);
      if (role === "AXRow" || role === "AXCell") {
        // Rows own their label; descend only for nested controls such as switches.
        (node.children ?? []).forEach((child, index) => {
          if (child.role !== "AXStaticText" && child.role !== "AXCell") {
            visit(child, [...path, index], depth + 1, container, menuTrail);
          }
        });
        return;
      }
      if (role === "AXTextField" || role === "AXTextArea" || role === "AXButton") return;
    }
    const wasInSheet = pathInSheet;
    if (isSheet) pathInSheet = true;
    (node.children ?? []).forEach((child, index) =>
      visit(child, [...path, index], depth + 1, container, menuTrail),
    );
    pathInSheet = wasInSheet;
  }

  (snapshot.root.children ?? []).forEach((child, index) => visit(child, [index], 1, undefined, []));

  let pool = candidates;
  const hasModalSheet = pool.some((c) => c.inSheet);
  if (hasModalSheet) pool = pool.filter((c) => c.inSheet || c.isMenuItem);

  // Keep the cap by relevance while preserving goal-relevant menu items and every text input.
  const menuItems = pool.filter((c) => c.isMenuItem);
  const others = pool.filter((c) => !c.isMenuItem);
  const keptMenu = [...menuItems].sort((a, b) => b.score - a.score).slice(0, MENU_ITEM_CAP);
  const room = Math.max(ELEMENT_CAP - keptMenu.length, 0);
  const keptOthers =
    others.length <= room
      ? others
      : [...others].sort((a, b) => b.score - a.score || a.order - b.order).slice(0, room);
  const selected = [...keptMenu, ...keptOthers].sort((a, b) => a.order - b.order);

  const elements = selected.map((c, index) => ({ ...c.element, id: `e${index + 1}` }));
  return {
    elements,
    contextText: contextText.slice(0, CONTEXT_CAP),
    focused: elements.find((e) => e.focused),
    hasModalSheet,
    appName: snapshot.appName,
    windowTitle: snapshot.windowTitle,
  };
}

// ---------------------------------------------------------------- Goal helpers

const STOP_WORDS = new Set([
  "a", "an", "the", "in", "on", "to", "and", "of", "with", "new", "open", "make", "create", "go",
  "turn", "into", "it", "up", "for", "at", "by", "from", "my", "please", "then",
]);

export function goalTokensOf(text: string): Set<string> {
  const parts = text.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  return new Set(parts.filter((p) => p.length > 1 && !STOP_WORDS.has(p)));
}

/** Goals that ask for something new cannot be satisfied by an item that already existed. */
export const createsSomething = (goal: string) =>
  ["new", "create", "make"].some((w) => containsWord(goal.toLowerCase(), w));

/** Goal tokens minus the app's own name, which otherwise matches every "About X" item. */
export function relevanceTokens(goal: string): Set<string> {
  const result = goalTokensOf(goal);
  const app = appName(goal);
  if (app) for (const t of goalTokensOf(app)) result.delete(t);
  return result;
}

/** Overlap with the goal, penalising unrelated extra words so "New Tab" beats "Tab Overview". */
export function relevance(text: string, tokens: Set<string>): number {
  const own = goalTokensOf(text);
  if (!own.size) return 0;
  let overlap = 0;
  for (const t of own) if (tokens.has(t)) overlap++;
  if (!overlap) return 0;
  return overlap * 10 - (own.size - overlap);
}

// ---------------------------------------------------------------- TextCandidates

export const KNOWN_APPS = [
  "Notes", "System Settings", "Calculator", "Safari", "TextEdit", "Finder", "Mail", "Messages",
  "Reminders", "Calendar", "Music", "Photos", "Preview", "Terminal", "Maps", "Contacts", "Stickies",
];
const VERBS = [
  "titled", "named", "called", "type", "enter", "write", "search for", "go to", "navigate to",
  "visit", "compute", "calculate", "evaluate", "paste", "say", "saying", "reading",
  "with the text", "containing",
];

const trimPunctuation = (t: string) => t.replace(/^[\s.,;:!?"“”']+|[\s.,;:!?"“”']+$/g, "");

/** Ordered, de-duplicated spans of the goal that could be typed verbatim, most specific first. */
export function textCandidates(goal: string): string[] {
  const found: string[] = [];
  const add = (raw: string) => {
    const c = trimPunctuation(raw);
    if (!c || found.includes(c) || KNOWN_APPS.includes(c)) return;
    found.push(c);
  };
  const all = (pattern: RegExp) => {
    for (const m of goal.matchAll(pattern)) if (m[1]) add(m[1]);
  };
  all(/["“']([^"”']+)["”']/g);
  for (const verb of VERBS) {
    all(
      new RegExp(
        `\\b${escapeRe(verb)}\\s+(.+?)(?=\\s+(?:in|into|inside|using|with|and then|then|and|,)\\s+[A-Z]|,|\\s+and\\s+|$)`,
        "g",
      ),
    );
  }
  all(/\b((?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?)/g);
  all(/(\d+(?:\.\d+)?(?:\s*[-+*/x×÷]\s*\d+(?:\.\d+)?)+)/g);
  // Candidates are ordered most specific first, so a later span inside an earlier one is the same
  // text again: "7*(3+4)" already covers "3+4", and typing both leaves the app in a wrong state.
  const distinct = found.filter((c, i) => !found.slice(0, i).some((earlier) => earlier.includes(c)));
  return distinct.slice(0, 6);
}

/** The app named in the goal, if it is one the pilot knows. */
export function appName(goal: string): string | undefined {
  const lowered = goal.toLowerCase();
  return [...KNOWN_APPS].sort((a, b) => b.length - a.length).find((a) => containsWord(lowered, a.toLowerCase()));
}

/** Arithmetic evaluated in code, so the model is never asked to do maths. */
export function arithmeticFacts(candidates: string[]): Record<string, string> {
  const facts: Record<string, string> = {};
  for (const candidate of candidates) {
    const normalized = candidate.replace(/[x×]/g, "*").replace(/÷/g, "/").replace(/\s+/g, "");
    if (!/^[0-9.+*/()-]+$/.test(normalized)) continue;
    if (!/[+*/-]/.test(normalized)) continue;
    const value = evaluateArithmetic(normalized);
    if (value == null || !Number.isFinite(value)) continue;
    facts[`${candidate} equals`] =
      value === Math.round(value) && Math.abs(value) < 1e15 ? String(Math.round(value)) : String(value);
  }
  return facts;
}

/** Tiny recursive-descent evaluator for + - * / and parentheses. No eval, no Function. */
export function evaluateArithmetic(input: string): number | null {
  let i = 0;
  const peek = () => input[i];
  function number(): number | null {
    if (peek() === "(") {
      i++;
      const v = expr();
      if (peek() !== ")") return null;
      i++;
      return v;
    }
    if (peek() === "-") {
      i++;
      const v = number();
      return v == null ? null : -v;
    }
    const start = i;
    while (i < input.length && /[0-9.]/.test(input[i])) i++;
    if (i === start) return null;
    const v = Number(input.slice(start, i));
    return Number.isNaN(v) ? null : v;
  }
  function term(): number | null {
    let left = number();
    if (left == null) return null;
    while (peek() === "*" || peek() === "/") {
      const op = input[i++];
      const right = number();
      if (right == null) return null;
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }
  function expr(): number | null {
    let left = term();
    if (left == null) return null;
    while (peek() === "+" || peek() === "-") {
      const op = input[i++];
      const right = term();
      if (right == null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  const value = expr();
  return i === input.length ? value : null;
}

// ---------------------------------------------------------------- State text and labels

export interface StepRecord {
  step: number;
  action: string;
  target?: string;
  source: string;
}
export interface PilotContext {
  goal: string;
  step: number;
  textCandidates: string[];
  typedTexts: string[];
  history: StepRecord[];
}

/** One imperative sentence per element: /classify label names carry no instruction. */
export function labelDescription(e: FlatElement): string {
  const what = e.label ? `labelled '${e.label}'` : "with no label";
  let s: string;
  if (isTextInput(e)) s = `Click into the ${e.role} ${what}.`;
  else if (e.role === "menu item") s = `Choose the menu item ${e.label}.`;
  else if (e.role === "row" || e.role === "cell") s = `Select the ${e.role} ${what}.`;
  else s = `Press the ${e.role} ${what}.`;
  if (e.value && e.value !== e.label) s += ` It currently reads ${e.value}.`;
  // Keep these two short. Spelling out that re-picking the current row is a no-op measurably made
  // the model pick it more often (System Settings: 'General' 65% against 'Appearance' 10%, against
  // 8% and 83% with the short wording), so the no-op rules live in decide(), not in the prose.
  if (e.selected) s += " It is already selected.";
  if (e.focused) s += " It has keyboard focus.";
  return s;
}

export const PSEUDO_LABELS: Record<string, string> = {
  type_text: "Type one of the text candidates into the focused text input. Only valid when a text input is focused.",
  press_key: "Press a keyboard shortcut instead of an element, for example Return to submit text already typed.",
  scroll: "Scroll the view down to reveal more elements.",
  done: "The goal is already visible in the state. Nothing more to do.",
  stuck: "No listed element or key can make progress toward the goal.",
};

export const KEY_LABELS: Record<string, string> = {
  Return: "Confirm the focused field or navigate to the typed URL.",
  Escape: "Dismiss a sheet, dialog or menu.",
  Tab: "Move focus to the next control.",
  Space: "Toggle the focused control.",
  Delete: "Delete the character before the cursor.",
  Down: "Move selection down.",
  Up: "Move selection up.",
  "Cmd+N": "Make a new document or note.",
  "Cmd+T": "Open a new browser tab.",
  "Cmd+L": "Focus the address bar.",
  "Cmd+A": "Select all text.",
  "Cmd+W": "Close the window or tab.",
  "Cmd+Comma": "Open the app settings.",
};

// One /yes-no call carries all three Nouls. Shared when_true/when_false hints flattened every
// probability towards 0.5 in testing, so each statement carries its own specifics instead and the
// batch goes out with no hints at all.
export const statementsFor = (goal: string) => [
  `The state above already shows this finished: ${goal}`,
  "Text from the text candidates still has to be typed into a field; it is not there yet.",
  "The next action would delete, erase, send, pay for or permanently discard something.",
];

/** The compact, declarative state text sent as `text` on every call of a step. */
export function stateText(tree: FlatTree, ctx: PilotContext): string {
  const lines = [
    `Goal: ${ctx.goal}.`,
    `App: ${tree.appName}.`,
    `Window: ${tree.windowTitle ?? "none"}.`,
    `Focused: ${tree.focused ? `${tree.focused.id} ${summary(tree.focused)}` : "nothing"}.`,
    `Modal sheet: ${tree.hasModalSheet ? "yes" : "no"}.`,
    `Visible text: ${tree.contextText.length ? tree.contextText.join(" | ") : "none"}.`,
    `Text candidates: ${ctx.textCandidates.length ? ctx.textCandidates.join(", ") : "none"}.`,
    `Already typed: ${ctx.typedTexts.length ? ctx.typedTexts.join(", ") : "none"}.`,
  ];
  const facts = arithmeticFacts(ctx.textCandidates);
  const factKeys = Object.keys(facts).sort();
  if (factKeys.length) lines.push(`Facts: ${factKeys.map((k) => `${k} ${facts[k]}`).join("; ")}.`);
  const history = ctx.history.slice(-8);
  lines.push(
    `Previous actions: ${
      history.length
        ? history.map((h) => `step ${h.step} ${h.action}${h.target ? ` ${h.target}` : ""}`).join("; ")
        : "none"
    }.`,
  );
  if (createsSomething(ctx.goal) && !ctx.history.length) {
    lines.push("The goal asks to create something new, so an item that already exists does not satisfy it.");
  }
  // Pulling the selected controls out of the element list roughly doubles goal_reached once a
  // setting has been switched (System Settings, Dark selected: 18% -> 37%) and lowers it slightly
  // while the work is still outstanding, so it separates the two cases from both sides.
  const selected = tree.elements.filter((e) => e.selected).map((e) => `${e.id} ${summary(e)}`);
  lines.push(`Selected right now: ${selected.length ? selected.join("; ") : "nothing"}.`);
  lines.push(`Elements: ${tree.elements.map((e) => `${e.id} ${summary(e)}`).join("; ")}.`);
  return lines.join("\n");
}

/**
 * Label map for the next-action /classify call: elements capped at 55 plus the pseudo-actions that
 * are actually available. Offering type_text with nothing focused, or scroll when the whole window
 * already fits in the tree, only bleeds probability away from the real answer.
 */
export function actionLabels(tree: FlatTree, ctx: PilotContext): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const e of tree.elements.slice(0, LABEL_ELEMENT_CAP)) labels[`${e.id} ${summary(e)}`] = labelDescription(e);
  const untyped = ctx.textCandidates.filter((c) => !ctx.typedTexts.includes(c));
  const canTypeNow = (tree.focused != null && isTextInput(tree.focused)) || acceptsRawKeystrokes(tree, ctx);
  if (untyped.length && canTypeNow) {
    labels.type_text = `Type '${untyped[0]}' into the focused control. The text is not there yet.`;
  }
  const pending = unsubmittedText(tree, ctx);
  labels.press_key = pending
    ? `Press a keyboard shortcut, such as Return to submit the '${pending}' already typed into the focused field.`
    : PSEUDO_LABELS.press_key;
  if (tree.elements.length >= ELEMENT_CAP) labels.scroll = PSEUDO_LABELS.scroll;
  if (!pending) labels.done = PSEUDO_LABELS.done;
  // Offer "stuck" only when the deterministic heuristic is out of moves too. While a listed element
  // still matches the goal, "nothing here can help" is simply false, and it drew 84% on a TextEdit
  // window whose one useful button was right there.
  if (fallback(tree, ctx, { allowStuck: true }).kind === "stuck") labels.stuck = PSEUDO_LABELS.stuck;
  return labels;
}

/**
 * Text the pilot typed that is still sitting unsubmitted in the focused single-line field.
 * A text area is excluded: Return there inserts a newline, it does not submit anything.
 */
export function unsubmittedText(tree: FlatTree, ctx: PilotContext): string | undefined {
  const f = tree.focused;
  if (!f || !isTextInput(f) || f.role === "text area" || !f.value) return undefined;
  return ctx.typedTexts.includes(f.value) ? f.value : undefined;
}

/** classify returns the full label name; the pilot works in ids and pseudo-action names. */
export function choiceFromLabel(label: string): string {
  const id = label.split(" ")[0];
  return PSEUDO_LABELS[label] ? label : /^e\d+$/.test(id) ? id : label;
}

// ---------------------------------------------------------------- AnswerHandler

export type PilotAction =
  | { kind: "press"; element: FlatElement }
  | { kind: "type_text"; text: string; into?: FlatElement }
  | { kind: "press_key"; key: string }
  | { kind: "scroll" }
  | { kind: "wait" }
  | { kind: "done" }
  | { kind: "stuck"; reason: string }
  | { kind: "blocked"; reason: string };

export const actionName = (a: PilotAction) => a.kind;
export function actionTarget(a: PilotAction): string | undefined {
  switch (a.kind) {
    case "press": return `${a.element.id} ${summary(a.element)}`;
    case "type_text": return `'${a.text}'${a.into ? ` into ${a.into.id}` : ""}`;
    case "press_key": return a.key;
    case "stuck":
    case "blocked": return a.reason;
    case "wait": return "UI not settled; re-observing";
    default: return undefined;
  }
}
export const isTerminal = (a: PilotAction) => a.kind === "done" || a.kind === "stuck" || a.kind === "blocked";

export interface Answers {
  choice?: string;
  confidence: number;
  probabilities: Array<[string, number]>;
  goalReached: number;
  needsText: number;
  destructive: number;
  key?: string;
  text?: string;
}
export interface Decision {
  action: PilotAction;
  source: "model" | "fallback";
  goalReached: number;
  needsText: number;
  isDestructive: number;
  confidence: number;
  probabilities: Array<[string, number]>;
}

export const THRESHOLDS = {
  // The Swift AnswerHandler's own value. A lower bar looked tempting on the Calculator run, but
  // goal_reached reads up to 0.79 with work still outstanding, so anything under 0.8 ends early.
  goalReached: 0.8,
  doneChoice: 0.5,
  doneConfidence: 0.5,
  needsText: 0.5,
  destructive: 0.5,
  minChoice: 0.12,
  maxRepeats: 2,
  maxWaits: 3,
};

export function repeatCount(element: FlatElement, history: StepRecord[]): number {
  const target = summary(element);
  return history.filter((h) => h.action === "press" && h.target?.endsWith(target)).length;
}
const trailingWaits = (h: StepRecord[]) => {
  let n = 0;
  for (let i = h.length - 1; i >= 0 && h[i].action === "wait"; i--) n++;
  return n;
};
const trailingKeyPresses = (key: string, h: StepRecord[]) => {
  let n = 0;
  for (let i = h.length - 1; i >= 0 && h[i].action === "press_key" && h[i].target === key; i--) n++;
  return n;
};

/** Apps without any text input (Calculator) take arithmetic as raw keystrokes. */
export const acceptsRawKeystrokes = (tree: FlatTree, ctx: PilotContext) =>
  !tree.elements.some(isTextInput) && Object.keys(arithmeticFacts(ctx.textCandidates)).length > 0;

/** Every code-evaluated arithmetic result from the goal is showing somewhere in the UI. */
export function arithmeticResultVisible(tree: FlatTree, ctx: PilotContext): boolean {
  const facts = Object.values(arithmeticFacts(ctx.textCandidates));
  return facts.length > 0 && facts.every((v) => showsText(tree, v));
}

/** A create goal needs at least one real action first; other goals may already be true. */
export const canFinish = (ctx: PilotContext) =>
  !createsSomething(ctx.goal) || ctx.history.some((h) => h.action !== "wait" && h.action !== "done");

/** Deterministic heuristic used when the model is slow, unavailable, or low confidence. */
export function fallback(
  tree: FlatTree,
  ctx: PilotContext,
  opts: { excluding?: FlatElement; allowStuck?: boolean } = {},
): PilotAction {
  const untyped = ctx.textCandidates.filter((c) => !ctx.typedTexts.includes(c));
  if (!untyped.length && arithmeticResultVisible(tree, ctx)) return { kind: "done" };
  if (tree.focused && isTextInput(tree.focused) && untyped.length)
    return { kind: "type_text", text: untyped[0], into: tree.focused };
  const tokens = relevanceTokens(ctx.goal);
  const scored: Array<[FlatElement, number]> = [];
  for (const e of tree.elements) {
    if (e.id === opts.excluding?.id || e.destructive) continue;
    if (repeatCount(e, ctx.history) >= THRESHOLDS.maxRepeats) continue;
    const score = relevance([e.label, e.value].filter(Boolean).join(" "), tokens);
    if (score > 0) scored.push([e, score]);
  }
  let best: [FlatElement, number] | undefined;
  for (const s of scored) if (!best || s[1] > best[1] || (s[1] === best[1] && s[0].id > best[0].id)) best = s;
  if (best) return { kind: "press", element: best[0] };
  if (acceptsRawKeystrokes(tree, ctx) && untyped.length) return { kind: "type_text", text: untyped[0] };
  const input = tree.elements.find((e) => isTextInput(e) && e.id !== opts.excluding?.id);
  if (input && untyped.length) return { kind: "press", element: input };
  if (tree.hasModalSheet) return { kind: "press_key", key: "Escape" };
  return {
    kind: "stuck",
    reason: opts.allowStuck ? "the model reported stuck and no heuristic match" : "no element matches the goal",
  };
}

/** Enforces the destructive-action policy in code regardless of what the model chose. */
export function guardAction(action: PilotAction, destructive: number, ctx: PilotContext): PilotAction {
  if (action.kind !== "press") return action;
  const e = action.element;
  if (e.destructive)
    return { kind: "blocked", reason: `'${e.label ?? e.role}' looks destructive and the goal does not name it` };
  const goalNamesDestructive = DESTRUCTIVE_WORDS.some((w) => containsWord(ctx.goal.toLowerCase(), w));
  if (destructive > THRESHOLDS.destructive && !goalNamesDestructive)
    return {
      kind: "blocked",
      reason: `the model judged '${e.label ?? e.role}' destructive (${Math.round(destructive * 100)}%)`,
    };
  return action;
}

/** The highest-probability real element behind a rejected pseudo-choice. */
function runnerUpElement(probabilities: Array<[string, number]>, tree: FlatTree, ctx: PilotContext) {
  for (const [label, p] of probabilities) {
    if (p < THRESHOLDS.minChoice) continue;
    const element = tree.elements.find((e) => e.id === choiceFromLabel(label));
    if (element && repeatCount(element, ctx.history) < THRESHOLDS.maxRepeats) return element;
  }
  return undefined;
}

/** Converts model answers (or their absence) into a safe action. All thresholds live here. */
export function decide(answers: Answers, tree: FlatTree, ctx: PilotContext): Decision {
  const { goalReached, needsText, destructive, confidence, probabilities } = answers;
  const make = (action: PilotAction, source: "model" | "fallback" = "model"): Decision => ({
    action: guardAction(action, destructive, ctx),
    source,
    goalReached,
    needsText,
    isDestructive: destructive,
    confidence,
    probabilities,
  });

  // Text typed into a field is not an outcome until something submits it, and a sum the code
  // worked out is not done until that number is on screen — however sure the model is.
  const pending = unsubmittedText(tree, ctx);
  const sumPending =
    Object.keys(arithmeticFacts(ctx.textCandidates)).length > 0 && !arithmeticResultVisible(tree, ctx);
  const mayFinish = !pending && !sumPending && canFinish(ctx);
  // A high needs_text contradicts a high goal_reached — but only while a candidate is still untyped.
  // Once every candidate is in the UI the statement reads true of the text that is already there, so
  // honouring it then would make "done" unreachable for the rest of the run.
  const untypedLeft = ctx.textCandidates.filter((c) => !ctx.typedTexts.includes(c));
  const wantsText = needsText > THRESHOLDS.needsText && untypedLeft.length > 0;
  if (mayFinish && goalReached > THRESHOLDS.goalReached && !wantsText && ctx.step > 1)
    return make({ kind: "done" });
  const choice = answers.choice;
  if (!choice || confidence < THRESHOLDS.minChoice) return make(fallback(tree, ctx), "fallback");

  const untyped = ctx.textCandidates.filter((c) => !ctx.typedTexts.includes(c));
  const canTypeNow = (tree.focused != null && isTextInput(tree.focused)) || acceptsRawKeystrokes(tree, ctx);
  const chosenText = answers.text && untyped.includes(answers.text) ? answers.text : untyped[0];
  // A high needs_text only upgrades to typing when the choice points at the focused input itself.
  if (
    needsText > THRESHOLDS.needsText && canTypeNow && untyped.length &&
    (choice === "type_text" || (tree.focused != null && choice === tree.focused.id))
  ) {
    return make({ kind: "type_text", text: chosenText, into: tree.focused });
  }
  switch (choice) {
    case "done": {
      // The model may say done while the UI is still settling; only trust it when goal_reached agrees.
      const trusted =
        goalReached >= THRESHOLDS.goalReached ||
        (goalReached >= THRESHOLDS.doneChoice && confidence >= THRESHOLDS.doneConfidence);
      if (trusted && mayFinish) return make({ kind: "done" });
      const runnerUp = runnerUpElement(probabilities, tree, ctx);
      if (runnerUp) return make({ kind: "press", element: runnerUp });
      if (!mayFinish) return make(fallback(tree, ctx), "fallback");
      if (trailingWaits(ctx.history) < THRESHOLDS.maxWaits) return make({ kind: "wait" });
      return make(fallback(tree, ctx, { allowStuck: true }), "fallback");
    }
    case "stuck":
      return make(fallback(tree, ctx, { allowStuck: true }), "fallback");
    case "scroll":
      return make({ kind: "scroll" });
    case "press_key": {
      const key = answers.key && KEY_LABELS[answers.key] ? answers.key : "Return";
      if (trailingKeyPresses(key, ctx.history) >= THRESHOLDS.maxRepeats)
        return make(fallback(tree, ctx, { allowStuck: true }), "fallback");
      return make({ kind: "press_key", key });
    }
    case "type_text": {
      if (!untyped.length) return make(fallback(tree, ctx), "fallback");
      if (!canTypeNow) {
        const input = tree.elements.find(isTextInput);
        if (input) return make({ kind: "press", element: input });
        return make(fallback(tree, ctx), "fallback");
      }
      return make({ kind: "type_text", text: chosenText, into: tree.focused });
    }
    default: {
      const element = tree.elements.find((e) => e.id === choice);
      if (!element) return make(fallback(tree, ctx), "fallback");
      // Clicking the field that already holds the typed text does nothing; submit it instead.
      if (pending && element.id === tree.focused?.id) return make({ kind: "press_key", key: "Return" }, "fallback");
      // Selecting what is already selected cannot change anything, so it gets one try, not two.
      if (element.selected && repeatCount(element, ctx.history) >= 1)
        return make(fallback(tree, ctx, { excluding: element }), "fallback");
      if (repeatCount(element, ctx.history) >= THRESHOLDS.maxRepeats)
        return make(fallback(tree, ctx, { excluding: element }), "fallback");
      return make({ kind: "press", element });
    }
  }
}

// ---------------------------------------------------------------- One decision, one transport

export const NEXT_QUESTION = "Which single action advances the goal next?";
export const KEY_QUESTION = "The next step is a keyboard shortcut. Which shortcut advances the goal?";
export const TEXT_QUESTION =
  "Text must be typed now into the focused input. Which candidate from the goal belongs there?";

/** Transport for one step: the island passes the queued helpers in src/lib/dm1.ts, smoke.mjs posts directly. */
export interface Ask {
  classify(
    text: string,
    labels: Record<string, string>,
  ): Promise<{ label: string; probability: number; scores: Record<string, number> }>;
  yesNo(text: string, statements: string[]): Promise<number[]>;
}

/** Two calls per step (next action + the three Nouls); a third only when the choice needs it. */
export async function askStep(tree: FlatTree, ctx: PilotContext, ask: Ask): Promise<Answers> {
  const text = stateText(tree, ctx);
  const [cls, yn] = await Promise.all([
    ask.classify(`${text}\n${NEXT_QUESTION}`, actionLabels(tree, ctx)),
    ask.yesNo(text, statementsFor(ctx.goal)),
  ]);
  const answers: Answers = {
    choice: choiceFromLabel(cls.label),
    confidence: cls.probability,
    probabilities: Object.entries(cls.scores ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    goalReached: yn[0] ?? 0,
    needsText: yn[1] ?? 0,
    destructive: yn[2] ?? 0,
  };
  if (answers.choice === "press_key") {
    answers.key = (await ask.classify(`${text}\n${KEY_QUESTION}`, KEY_LABELS)).label;
  }
  const untyped = ctx.textCandidates.filter((c) => !ctx.typedTexts.includes(c));
  if (untyped.length > 1 && (answers.choice === "type_text" || answers.needsText > THRESHOLDS.needsText)) {
    const labels = Object.fromEntries(untyped.map((c) => [c, `Type '${c}' into the focused input.`]));
    answers.text = (await ask.classify(`${text}\n${TEXT_QUESTION}`, labels)).label;
  }
  return answers;
}

/** Metrics percentile, same rank rule as the Swift Metrics struct. */
export function percentile(values: number[], fraction: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1));
  return sorted[rank];
}
