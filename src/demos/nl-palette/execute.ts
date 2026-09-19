import { COMMAND_BY_ID, SEED_NOTES, THEMES, type ExportFormat, type Theme } from "./data.ts";
import {
  activeNote,
  clearFormatting,
  DEFAULT_FONT_SIZE,
  lineBounds,
  MAX_UNDO,
  replaceRange,
  setHeading,
  titleCase,
  togglePrefixLines,
  wrapSelection,
  type EditorState,
  type FontFamily,
  type Selection,
} from "./model.ts";


export function initialState(): EditorState {
  return {
    notes: SEED_NOTES.map((n) => ({ ...n })),
    tabs: SEED_NOTES.map((n) => n.id),
    activeTab: SEED_NOTES[0].id,
    closedTabs: [],
    selection: { start: 0, end: 0 },
    undo: [],
    redo: [],
    sidebar: true,
    outline: true,
    statusBar: true,
    minimap: false,
    lineNumbers: true,
    wordWrap: true,
    preview: false,
    zen: false,
    split: false,
    fullscreen: false,
    zoom: 100,
    theme: "dark",
    fontSize: DEFAULT_FONT_SIZE,
    fontFamily: "mono",
    ligatures: true,
    typewriter: false,
    spellCheck: true,
    autosave: true,
    prompt: null,
    toast: null,
    effect: null,
  };
}

function withText(s: EditorState, text: string, selection: Selection): EditorState {
  const note = activeNote(s);
  if (note.text === text) return { ...s, selection };
  const undo = [...s.undo, { noteId: note.id, text: note.text, selection: s.selection }].slice(-MAX_UNDO);
  return { ...s, notes: s.notes.map((n) => (n.id === note.id ? { ...n, text } : n)), selection, undo, redo: [] };
}

/** Called by the editor on every keystroke; records undo history. */
export function setText(s: EditorState, text: string, selection: Selection): EditorState {
  return withText(s, text, selection);
}

export function setSelection(s: EditorState, selection: Selection): EditorState {
  return s.selection.start === selection.start && s.selection.end === selection.end ? s : { ...s, selection };
}

const FONT_CYCLE: FontFamily[] = ["mono", "serif", "sans"];

function toast(s: EditorState, message: string): EditorState {
  return { ...s, toast: message };
}

function insertAtCursor(s: EditorState, snippet: string, selectInner?: Selection): EditorState {
  const note = activeNote(s);
  const text = replaceRange(note.text, s.selection, snippet);
  const base = s.selection.start;
  const sel = selectInner ? { start: base + selectInner.start, end: base + selectInner.end } : { start: base + snippet.length, end: base + snippet.length };
  return withText(s, text, sel);
}

function transformSelection(s: EditorState, fn: (selected: string) => string, whenEmpty = "Select some text first"): EditorState {
  const note = activeNote(s);
  if (s.selection.end <= s.selection.start) return toast(s, whenEmpty);
  const selected = note.text.slice(s.selection.start, s.selection.end);
  const out = fn(selected);
  return withText(s, replaceRange(note.text, s.selection, out), { start: s.selection.start, end: s.selection.start + out.length });
}

function wrap(s: EditorState, marker: string, closing = marker): EditorState {
  const note = activeNote(s);
  const r = wrapSelection(note.text, s.selection, marker, closing);
  return withText(s, r.text, r.selection);
}

function lines(s: EditorState, fn: (text: string, sel: Selection) => { text: string; selection: Selection }): EditorState {
  const note = activeNote(s);
  const r = fn(note.text, s.selection);
  return withText(s, r.text, r.selection);
}

function switchTab(s: EditorState, id: string): EditorState {
  return { ...s, activeTab: id, selection: { start: 0, end: 0 }, prompt: null };
}

/**
 * Executes a command id (plus optional typed argument) against the editor
 * state. Every one of the palette's commands lands here.
 */
export function execute(state: EditorState, id: string, arg?: string): EditorState {
  const s: EditorState = { ...state, toast: null, effect: null };
  const note = activeNote(s);
  const cmd = COMMAND_BY_ID.get(id);
  if (!cmd) return toast(s, `Unknown command: ${id}`);

  switch (id) {
    // View
    case "toggle_sidebar":
      return { ...s, sidebar: !s.sidebar };
    case "toggle_outline":
      return { ...s, outline: !s.outline };
    case "toggle_status_bar":
      return { ...s, statusBar: !s.statusBar };
    case "toggle_minimap":
      return { ...s, minimap: !s.minimap };
    case "toggle_line_numbers":
      return { ...s, lineNumbers: !s.lineNumbers };
    case "toggle_word_wrap":
      return { ...s, wordWrap: !s.wordWrap };
    case "toggle_preview":
      return { ...s, preview: !s.preview };
    case "toggle_zen_mode":
      return { ...s, zen: !s.zen };
    case "zoom_in":
      return { ...s, zoom: Math.min(200, s.zoom + 10) };
    case "zoom_out":
      return { ...s, zoom: Math.max(50, s.zoom - 10) };
    case "reset_zoom":
      return { ...s, zoom: 100 };
    case "split_editor":
      return { ...s, split: true };
    case "close_split":
      return { ...s, split: false };
    case "toggle_fullscreen":
      return { ...s, fullscreen: !s.fullscreen };

    // Appearance
    case "set_theme": {
      const theme = (THEMES as readonly string[]).includes(arg ?? "") ? (arg as Theme) : s.theme === "dark" ? "light" : "dark";
      return { ...s, theme };
    }
    case "change_font_size": {
      const delta = Number(arg ?? "+2");
      return { ...s, fontSize: Math.max(9, Math.min(32, s.fontSize + (Number.isFinite(delta) ? delta : 2))) };
    }
    case "reset_font_size":
      return { ...s, fontSize: DEFAULT_FONT_SIZE };
    case "cycle_font_family":
      return { ...s, fontFamily: FONT_CYCLE[(FONT_CYCLE.indexOf(s.fontFamily) + 1) % FONT_CYCLE.length] };
    case "toggle_ligatures":
      return toast({ ...s, ligatures: !s.ligatures }, `Font ligatures ${s.ligatures ? "off" : "on"}`);
    case "toggle_typewriter_mode":
      return { ...s, typewriter: !s.typewriter };

    // Format
    case "set_heading": {
      const level = Math.max(1, Math.min(6, Number(arg ?? "1") || 1));
      return lines(s, (t, sel) => setHeading(t, sel, level));
    }
    case "toggle_bold":
      return wrap(s, "**");
    case "toggle_italic":
      return wrap(s, "_");
    case "toggle_strikethrough":
      return wrap(s, "~~");
    case "toggle_inline_code":
      return wrap(s, "`");
    case "insert_code_block":
      return insertAtCursor(s, "\n```\n\n```\n", { start: 5, end: 5 });
    case "toggle_bullet_list":
      return lines(s, (t, sel) => togglePrefixLines(t, sel, "bullet"));
    case "toggle_numbered_list":
      return lines(s, (t, sel) => togglePrefixLines(t, sel, "numbered"));
    case "toggle_task_list":
      return lines(s, (t, sel) => togglePrefixLines(t, sel, "task"));
    case "toggle_blockquote":
      return lines(s, (t, sel) => togglePrefixLines(t, sel, "quote"));
    case "insert_link": {
      const selected = note.text.slice(s.selection.start, s.selection.end) || "link text";
      const snippet = `[${selected}](https://)`;
      return withText(s, replaceRange(note.text, s.selection, snippet), { start: s.selection.start + snippet.length - 1, end: s.selection.start + snippet.length - 1 });
    }
    case "insert_image":
      return insertAtCursor(s, "![alt text](image.png)", { start: 2, end: 10 });
    case "insert_table":
      return insertAtCursor(s, "\n| Column | Column |\n| --- | --- |\n| cell | cell |\n");
    case "insert_horizontal_rule":
      return insertAtCursor(s, "\n---\n");
    case "insert_date":
      return insertAtCursor(s, new Date().toISOString().slice(0, 10));
    case "clear_formatting":
      return transformSelection(s, clearFormatting);

    // Text
    case "uppercase_selection":
      return transformSelection(s, (t) => t.toUpperCase());
    case "lowercase_selection":
      return transformSelection(s, (t) => t.toLowerCase());
    case "title_case_selection":
      return transformSelection(s, titleCase);
    case "sort_lines":
      return lines(s, (t, sel) => {
        const b = lineBounds(t, sel);
        const sorted = t.slice(b.start, b.end).split("\n").sort((a, c) => a.localeCompare(c)).join("\n");
        return { text: replaceRange(t, b, sorted), selection: { start: b.start, end: b.start + sorted.length } };
      });
    case "remove_duplicate_lines":
      return lines(s, (t, sel) => {
        const b = lineBounds(t, sel);
        const seen = new Set<string>();
        const kept = t.slice(b.start, b.end).split("\n").filter((l) => (seen.has(l) ? false : (seen.add(l), true))).join("\n");
        return { text: replaceRange(t, b, kept), selection: { start: b.start, end: b.start + kept.length } };
      });
    case "trim_trailing_whitespace": {
      const text = note.text.replace(/[ \t]+$/gm, "");
      return withText(s, text, { start: Math.min(s.selection.start, text.length), end: Math.min(s.selection.end, text.length) });
    }
    case "join_lines":
      return lines(s, (t, sel) => {
        const b = lineBounds(t, sel);
        const joined = t.slice(b.start, b.end).split("\n").map((l) => l.trim()).filter(Boolean).join(" ");
        return { text: replaceRange(t, b, joined), selection: { start: b.start, end: b.start + joined.length } };
      });
    case "duplicate_line":
      return lines(s, (t, sel) => {
        const b = lineBounds(t, sel);
        const line = t.slice(b.start, b.end);
        return { text: replaceRange(t, { start: b.end, end: b.end }, `\n${line}`), selection: { start: b.end + 1, end: b.end + 1 + line.length } };
      });
    case "delete_line":
      return lines(s, (t, sel) => {
        const b = lineBounds(t, sel);
        const end = b.end < t.length ? b.end + 1 : b.end;
        const start = b.end >= t.length && b.start > 0 ? b.start - 1 : b.start;
        return { text: replaceRange(t, { start, end }, ""), selection: { start, end: start } };
      });
    case "move_line_up":
      return lines(s, (t, sel) => {
        const b = lineBounds(t, sel);
        if (b.start === 0) return { text: t, selection: sel };
        const prev = lineBounds(t, { start: b.start - 1, end: b.start - 1 });
        const swapped = t.slice(b.start, b.end) + "\n" + t.slice(prev.start, prev.end);
        return { text: replaceRange(t, { start: prev.start, end: b.end }, swapped), selection: { start: prev.start, end: prev.start + (b.end - b.start) } };
      });
    case "move_line_down":
      return lines(s, (t, sel) => {
        const b = lineBounds(t, sel);
        if (b.end >= t.length) return { text: t, selection: sel };
        const next = lineBounds(t, { start: b.end + 1, end: b.end + 1 });
        const swapped = t.slice(next.start, next.end) + "\n" + t.slice(b.start, b.end);
        const newStart = b.start + (next.end - next.start) + 1;
        return { text: replaceRange(t, { start: b.start, end: next.end }, swapped), selection: { start: newStart, end: newStart + (b.end - b.start) } };
      });

    // Edit
    case "undo": {
      const entry = s.undo[s.undo.length - 1];
      if (!entry) return toast(s, "Nothing to undo");
      const cur = s.notes.find((n) => n.id === entry.noteId) ?? note;
      return {
        ...s,
        notes: s.notes.map((n) => (n.id === entry.noteId ? { ...n, text: entry.text } : n)),
        activeTab: entry.noteId,
        selection: entry.selection,
        undo: s.undo.slice(0, -1),
        redo: [...s.redo, { noteId: entry.noteId, text: cur.text, selection: s.selection }],
      };
    }
    case "redo": {
      const entry = s.redo[s.redo.length - 1];
      if (!entry) return toast(s, "Nothing to redo");
      const cur = s.notes.find((n) => n.id === entry.noteId) ?? note;
      return {
        ...s,
        notes: s.notes.map((n) => (n.id === entry.noteId ? { ...n, text: entry.text } : n)),
        activeTab: entry.noteId,
        selection: entry.selection,
        redo: s.redo.slice(0, -1),
        undo: [...s.undo, { noteId: entry.noteId, text: cur.text, selection: s.selection }],
      };
    }
    case "select_all":
      return { ...s, selection: { start: 0, end: note.text.length } };

    // Find / navigation / tools
    case "find":
      return { ...s, prompt: "find" };
    case "find_replace":
      return { ...s, prompt: "find_replace" };
    case "go_to_line":
      return { ...s, prompt: "go_to_line" };
    case "toggle_spell_check":
      return { ...s, spellCheck: !s.spellCheck };
    case "toggle_autosave":
      return { ...s, autosave: !s.autosave };

    // File
    case "new_note": {
      const n = { id: `n${Date.now().toString(36)}`, title: "Untitled", text: "# Untitled\n\n", pinned: false };
      return { ...switchTab({ ...s, notes: [...s.notes, n], tabs: [...s.tabs, n.id] }, n.id), selection: { start: n.text.length, end: n.text.length } };
    }
    case "save_note":
      return toast(s, `Saved "${note.title}"`);
    case "export_note": {
      const format: ExportFormat = arg === "html" || arg === "pdf" || arg === "plain_text" ? arg : "markdown";
      return { ...s, effect: { kind: "download", format, title: note.title, text: note.text }, toast: `Exporting "${note.title}" as ${format.replace("_", " ")}` };
    }
    case "rename_note":
      return { ...s, prompt: "rename" };
    case "delete_note": {
      if (s.notes.length === 1) return toast(s, "Can't delete the last note");
      const notes = s.notes.filter((n) => n.id !== note.id);
      const tabs = s.tabs.filter((t) => t !== note.id);
      const nextActive = tabs[0] ?? notes[0].id;
      return { ...switchTab({ ...s, notes, tabs: tabs.length ? tabs : [nextActive] }, nextActive), toast: `Deleted "${note.title}"` };
    }
    case "toggle_pin_note":
      return { ...s, notes: s.notes.map((n) => (n.id === note.id ? { ...n, pinned: !n.pinned } : n)) };

    // Tabs
    case "close_tab": {
      if (s.tabs.length === 1) return toast(s, "Can't close the last tab");
      const idx = s.tabs.indexOf(note.id);
      const tabs = s.tabs.filter((t) => t !== note.id);
      return switchTab({ ...s, tabs, closedTabs: [...s.closedTabs, note.id] }, tabs[Math.min(idx, tabs.length - 1)]);
    }
    case "close_other_tabs":
      return { ...s, tabs: [note.id], closedTabs: [...s.closedTabs, ...s.tabs.filter((t) => t !== note.id)] };
    case "reopen_closed_tab": {
      const id = [...s.closedTabs].reverse().find((t) => s.notes.some((n) => n.id === t));
      if (!id) return toast(s, "No closed tabs to reopen");
      return switchTab({ ...s, tabs: s.tabs.includes(id) ? s.tabs : [...s.tabs, id], closedTabs: s.closedTabs.filter((t) => t !== id) }, id);
    }
    case "next_tab":
      return switchTab(s, s.tabs[(s.tabs.indexOf(note.id) + 1) % s.tabs.length]);
    case "previous_tab":
      return switchTab(s, s.tabs[(s.tabs.indexOf(note.id) - 1 + s.tabs.length) % s.tabs.length]);
  }
  return toast(s, `${cmd.title} is not implemented`);
}

/** Opens a note from the sidebar (adds a tab if needed). */
export function openNote(s: EditorState, id: string): EditorState {
  return switchTab({ ...s, tabs: s.tabs.includes(id) ? s.tabs : [...s.tabs, id] }, id);
}

export function renameNote(s: EditorState, title: string): EditorState {
  const note = activeNote(s);
  return { ...s, notes: s.notes.map((n) => (n.id === note.id ? { ...n, title: title.trim() || n.title } : n)), prompt: null };
}

export function replaceAll(s: EditorState, find: string, replacement: string): EditorState {
  if (!find) return s;
  const note = activeNote(s);
  const count = note.text.split(find).length - 1;
  const text = note.text.split(find).join(replacement);
  return { ...withText(s, text, { start: 0, end: 0 }), toast: `Replaced ${count} occurrence${count === 1 ? "" : "s"}` };
}

export function goToLine(s: EditorState, line: number): EditorState {
  const note = activeNote(s);
  const lines = note.text.split("\n");
  const target = Math.max(1, Math.min(lines.length, Math.floor(line)));
  const offset = lines.slice(0, target - 1).reduce((acc, l) => acc + l.length + 1, 0);
  return { ...s, selection: { start: offset, end: offset + lines[target - 1].length }, prompt: null };
}
