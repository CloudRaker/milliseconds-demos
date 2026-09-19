// Seed data for the pilot: five simulated macOS apps (deterministic state machines that publish an
// accessibility tree in the same shape the Swift app read from AXUIElement) and the five real
// recorded trees from the original experiment's Tests/Fixtures, flattened at run time.

import { rect, type AXNode, type AXSnapshot, type PilotAction } from "./pilot.ts";
import recorded from "./fixtures.ts";

/** A node of a simulated app: an AXNode plus the two browser-only hints the renderer needs. */
export interface SimNode extends AXNode {
  /** Which part of the window this control is drawn in. */
  group: "display" | "keys" | "toolbar" | "tabs" | "sidebar" | "pane" | "page" | "sheet";
  /** Glyph to draw instead of the accessibility label, e.g. × for the Multiply button. */
  display?: string;
}

export interface SimApp {
  name: string;
  initial: () => any;
  title: (s: any) => string;
  nodes: (s: any) => SimNode[];
  /** Activate the element with this key. Returns the next state. */
  press: (s: any, key: string) => any;
  typeText: (s: any, text: string) => any;
  pressKey: (s: any, chord: string) => any;
  /** Milliseconds to wait before reading the tree again (page loads). */
  settleMs?: (s: any) => number;
}

const F = rect(0, 0, 160, 28);
const node = (role: string, group: SimNode["group"], o: Partial<SimNode> = {}): SimNode =>
  ({ role, group, enabled: true, frame: F, ...o }) as SimNode;

/** Wraps the flat control list in the window (and sheet) structure the flattener walks. */
export function snapshot(app: SimApp, state: any): AXSnapshot {
  const all = app.nodes(state);
  const sheet = all.filter((n) => n.group === "sheet");
  const rest = all.filter((n) => n.group !== "sheet");
  const children: AXNode[] = [...rest];
  if (sheet.length) children.push({ role: "AXSheet", enabled: true, frame: rect(0, 0, 600, 400), children: sheet });
  return {
    appName: app.name,
    windowTitle: app.title(state),
    root: {
      role: "AXApplication",
      title: app.name,
      children: [{ role: "AXWindow", title: app.title(state), frame: rect(0, 0, 900, 620), children }],
    },
  };
}

// ---------------------------------------------------------------- Calculator

const CALC_KEYS: Array<[string, string]> = [
  ["All Clear", "AC"], ["Change Sign", "±"], ["Percent", "%"], ["Divide", "÷"],
  ["7", "7"], ["8", "8"], ["9", "9"], ["Multiply", "×"],
  ["4", "4"], ["5", "5"], ["6", "6"], ["Subtract", "−"],
  ["1", "1"], ["2", "2"], ["3", "3"], ["Add", "+"],
  ["0", "0"], ["Point", "."], ["Equals", "="], ["Delete", "⌫"],
];
const OPS: Record<string, string> = { Add: "+", Subtract: "-", Multiply: "*", Divide: "/" };
const applyOp = (a: number, op: string, b: number) =>
  op === "+" ? a + b : op === "-" ? a - b : op === "*" ? a * b : b === 0 ? NaN : a / b;
const show = (v: number) => (Number.isFinite(v) ? String(Number(v.toFixed(10))) : "Error");

const calculator: SimApp = {
  name: "Calculator",
  initial: () => ({ display: "0", acc: null as number | null, op: null as string | null, fresh: true }),
  title: () => "Calculator",
  nodes: (s) => [
    node("AXStaticText", "display", { value: s.display, key: "display" }),
    ...CALC_KEYS.map(([title, glyph]) => node("AXButton", "keys", { title, key: title, display: glyph })),
  ],
  press: (s, key) => {
    if (/^\d$/.test(key)) {
      const display = s.fresh || s.display === "0" ? key : s.display + key;
      return { ...s, display, fresh: false };
    }
    if (key === "Point")
      return s.fresh ? { ...s, display: "0.", fresh: false } : s.display.includes(".") ? s : { ...s, display: s.display + "." };
    if (key === "All Clear") return calculator.initial();
    if (key === "Change Sign") return { ...s, display: show(-Number(s.display)) };
    if (key === "Percent") return { ...s, display: show(Number(s.display) / 100) };
    if (key === "Delete") return { ...s, display: s.display.length > 1 ? s.display.slice(0, -1) : "0" };
    const value = s.acc != null && s.op ? applyOp(s.acc, s.op, Number(s.display)) : Number(s.display);
    if (key === "Equals") return { display: show(value), acc: null, op: null, fresh: true };
    if (OPS[key]) return { display: show(value), acc: value, op: OPS[key], fresh: true };
    return s;
  },
  typeText: (s, text) => {
    const map: Record<string, string> = { "*": "Multiply", x: "Multiply", "×": "Multiply", "/": "Divide", "÷": "Divide", "+": "Add", "-": "Subtract", "−": "Subtract", ".": "Point", "=": "Equals" };
    let next = s;
    for (const ch of text.replace(/\s/g, "")) {
      const key = /^\d$/.test(ch) ? ch : map[ch];
      if (key) next = calculator.press(next, key);
    }
    return next;
  },
  pressKey: (s, chord) =>
    chord === "Return" || chord === "Space" ? calculator.press(s, "Equals")
    : chord === "Escape" ? calculator.press(s, "All Clear")
    : chord === "Delete" ? calculator.press(s, "Delete")
    : s,
};

// ---------------------------------------------------------------- TextEdit

const textedit: SimApp = {
  name: "TextEdit",
  initial: () => ({ doc: false, text: "" }),
  title: (s) => (s.doc ? "Untitled" : "TextEdit"),
  nodes: (s) =>
    s.doc
      ? [
          node("AXCheckBox", "toolbar", { title: "bold", value: "0", key: "bold" }),
          node("AXCheckBox", "toolbar", { title: "italic", value: "0", key: "italic" }),
          node("AXPopUpButton", "toolbar", { title: "typeface", value: "Helvetica", key: "typeface" }),
          node("AXTextArea", "page", { value: s.text, focused: true, key: "body", frame: rect(0, 0, 640, 360) }),
        ]
      : [
          node("AXStaticText", "page", { value: "No document is open.", key: "hint" }),
          node("AXButton", "keys", { title: "New Document", key: "new" }),
          node("AXButton", "keys", { title: "Open…", key: "open" }),
        ],
  press: (s, key) => (key === "new" ? { ...s, doc: true } : s),
  typeText: (s, text) => (s.doc ? { ...s, text: s.text ? `${s.text} ${text}` : text } : s),
  pressKey: (s, chord) => (chord === "Cmd+N" ? { ...s, doc: true } : s),
};

// ---------------------------------------------------------------- Safari

const safari: SimApp = {
  name: "Safari",
  initial: () => ({
    tabs: [{ title: "Start Page", body: "Favorites · Frequently Visited · Privacy Report" }],
    active: 0,
    address: "",
    addressFocused: false,
    loadingUntil: 0,
  }),
  title: (s) => s.tabs[s.active].title,
  settleMs: (s) => Math.max(0, s.loadingUntil - Date.now()),
  nodes: (s) => {
    const loading = Date.now() < s.loadingUntil;
    return [
      ...s.tabs.map((t: any, i: number) =>
        node("AXTab", "tabs", { title: t.title, selected: i === s.active, key: `tab${i}` }),
      ),
      node("AXButton", "tabs", { title: "New Tab", key: "newtab", display: "+" }),
      node("AXTextField", "toolbar", {
        title: "smart search field",
        value: s.address,
        focused: s.addressFocused,
        key: "address",
        frame: rect(0, 0, 420, 30),
      }),
      node("AXStaticText", "page", {
        value: loading ? "Loading…" : s.tabs[s.active].title,
        key: "pagetitle",
        frame: rect(0, 0, 640, 30),
      }),
      node("AXStaticText", "page", {
        value: loading ? "" : s.tabs[s.active].body,
        key: "page",
        frame: rect(0, 0, 640, 290),
      }),
    ];
  },
  press: (s, key) => {
    if (key === "newtab")
      return { ...s, tabs: [...s.tabs, { title: "Start Page", body: "Favorites · Frequently Visited" }], active: s.tabs.length, address: "", addressFocused: true };
    if (key === "address") return { ...s, addressFocused: true };
    if (key.startsWith("tab")) return { ...s, active: Number(key.slice(3)) };
    return s;
  },
  typeText: (s, text) => ({ ...s, address: text, addressFocused: true }),
  pressKey: (s, chord) => {
    if (chord === "Cmd+T") return safari.press(s, "newtab");
    if (chord === "Cmd+L") return { ...s, addressFocused: true };
    if (chord === "Return" && s.address) {
      const tabs = s.tabs.map((t: any, i: number) =>
        i === s.active ? { title: s.address, body: `${s.address} — decisions in milliseconds, not seconds.` } : t,
      );
      return { ...s, tabs, addressFocused: false, loadingUntil: Date.now() + 800 };
    }
    return s;
  },
};

// ---------------------------------------------------------------- Notes

const notes: SimApp = {
  name: "Notes",
  initial: () => ({ sheet: true, notes: ["Meeting notes", "Reading list"], draft: null as string | null }),
  title: () => "Notes",
  nodes: (s) => {
    if (s.sheet)
      return [
        node("AXStaticText", "sheet", { value: "Welcome to Notes", key: "w1" }),
        node("AXStaticText", "sheet", { value: "Organize your thoughts, format with tables and checklists.", key: "w2" }),
        node("AXButton", "sheet", { title: "Continue", key: "continue" }),
      ];
    const list = s.draft != null ? [s.draft || "New Note", ...s.notes] : s.notes;
    return [
      node("AXButton", "toolbar", { title: "New Note", key: "newnote", display: "＋ New Note" }),
      ...list.map((title: string, i: number) =>
        node("AXRow", "sidebar", { title, selected: s.draft != null && i === 0, key: `note${i}`, frame: rect(0, 0, 200, 44) }),
      ),
      ...(s.draft != null
        ? [node("AXStaticText", "page", { value: s.draft || "New Note", key: "notetitle", frame: rect(0, 0, 600, 24) })]
        : []),
      node("AXTextArea", "page", {
        value: s.draft ?? "",
        focused: s.draft != null,
        key: "body",
        frame: rect(0, 0, 600, 340),
      }),
    ];
  },
  press: (s, key) =>
    key === "continue" ? { ...s, sheet: false }
    // Clicking into the empty note body starts a note, the way the real Notes window does.
    : key === "newnote" || (key === "body" && s.draft == null) ? { ...s, draft: "" }
    : s,
  typeText: (s, text) => (s.draft != null ? { ...s, draft: text } : s),
  pressKey: (s, chord) =>
    chord === "Escape" ? { ...s, sheet: false } : chord === "Cmd+N" && !s.sheet ? { ...s, draft: "" } : s,
};

// ---------------------------------------------------------------- System Settings

// Sidebar rows and General-pane buttons in the order the recorded SystemSettings.json tree has them.
const PANES = ["Wi-Fi", "Bluetooth", "Network", "Energy", "General", "Accessibility", "Appearance", "Menu Bar", "Desktop & Dock", "Displays", "Spotlight", "Wallpaper", "Siri", "Notifications"];
const GENERAL_ROWS = ["About", "Software Update", "Storage", "AppleCare & Warranty", "AirDrop & Continuity", "AutoFill & Passwords", "Date & Time", "Language & Region", "Login Items & Extensions"];

const settings: SimApp = {
  name: "System Settings",
  initial: () => ({ pane: "General", appearance: "Light" }),
  title: () => "System Settings",
  nodes: (s) => {
    const base: SimNode[] = [
      node("AXRow", "sidebar", { title: "Sign in, with your Apple Account", key: "pane:Apple Account", frame: rect(0, 0, 200, 52) }),
      ...PANES.map((p) => node("AXRow", "sidebar", { title: p, selected: p === s.pane, key: `pane:${p}`, frame: rect(0, 0, 200, 34) })),
      node("AXTextField", "sidebar", { subrole: "AXSearchField", value: "", key: "search", frame: rect(0, 0, 200, 26) }),
    ];
    if (s.pane === "Appearance")
      return [
        ...base,
        node("AXStaticText", "pane", { value: "Appearance", key: "h" }),
        node("AXStaticText", "pane", { value: "Choose how windows and menus look on this Mac.", key: "h2" }),
        // Settings panes print the setting's current value beside its name; without that line the
        // state text names a button 'Dark' and never says which appearance is in force.
        node("AXStaticText", "pane", { value: `Appearance: ${s.appearance}`, key: "h3" }),
        ...["Light", "Dark", "Auto"].map((m) =>
          node("AXRadioButton", "pane", {
            title: m,
            selected: s.appearance === m,
            value: s.appearance === m ? "1" : "0",
            key: `appearance:${m}`,
            frame: rect(0, 0, 120, 80),
          }),
        ),
      ];
    if (s.pane === "General")
      return [
        ...base,
        // Heading plus blurb as two texts, exactly as the recorded System Settings tree carries
        // them: with a bare "General" as the only visible text every judgement drifts to that row.
        node("AXStaticText", "pane", { value: "General", key: "h" }),
        node("AXStaticText", "pane", {
          value: "Manage your overall setup and preferences for Mac, such as software updates, devices and storage.",
          key: "h2",
        }),
        ...GENERAL_ROWS.map((r) => node("AXButton", "pane", { title: r, key: `general:${r}`, frame: rect(0, 0, 420, 34) })),
      ];
    return [...base, node("AXStaticText", "pane", { value: `${s.pane} has no controls in this demo.`, key: "h" })];
  },
  press: (s, key) =>
    key.startsWith("pane:") ? { ...s, pane: key.slice(5) }
    : key.startsWith("appearance:") ? { ...s, appearance: key.slice(11) }
    : s,
  typeText: (s) => s,
  pressKey: (s) => s,
};

export const APPS: Record<string, SimApp> = {
  Calculator: calculator,
  TextEdit: textedit,
  Safari: safari,
  Notes: notes,
  "System Settings": settings,
};

export interface Preset {
  goal: string;
  app: string;
  /** What the run should end with, shown under the goal before any call is made. */
  expect: string;
  /** Independent check on the app state, so "done" is verified by code and not by the model. */
  verify: (s: any) => boolean;
}

export const PRESETS: Preset[] = [
  { goal: "In Calculator compute 48*12", app: "Calculator", expect: "display reads 576", verify: (s) => s.display === "576" },
  {
    goal: "In TextEdit make a new document and type Hello from milliseconds",
    app: "TextEdit",
    expect: "the document holds the text",
    verify: (s) => s.doc && s.text.includes("Hello from milliseconds"),
  },
  {
    goal: "In Safari open a new tab and go to milliseconds.ai",
    app: "Safari",
    expect: "a second tab shows milliseconds.ai",
    verify: (s) => s.active > 0 && s.tabs[s.active].title === "milliseconds.ai" && Date.now() >= s.loadingUntil,
  },
  {
    goal: "Create a new note titled Grocery list in Notes",
    app: "Notes",
    expect: "a note named Grocery list exists",
    verify: (s) => !s.sheet && s.draft === "Grocery list",
  },
  {
    goal: "Open System Settings and turn on Dark Mode",
    app: "System Settings",
    expect: "Dark is the selected appearance",
    verify: (s) => s.appearance === "Dark",
  },
];

/** Executes one decided action against a simulated app. Scroll and wait change nothing here. */
export function applyAction(app: SimApp, state: any, action: PilotAction): any {
  if (action.kind === "press") return action.element.key ? app.press(state, action.element.key) : state;
  if (action.kind === "type_text") return app.typeText(state, action.text);
  if (action.kind === "press_key") return app.pressKey(state, action.key);
  return state;
}

/** The five raw macOS trees recorded by the Swift app, pruned by flatten() when this module loads. */
export const RECORDED = recorded;
