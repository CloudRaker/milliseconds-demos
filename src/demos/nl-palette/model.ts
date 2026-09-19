import type { ExportFormat, Note, Theme } from "./data.ts";

export interface Selection {
  start: number;
  end: number;
}

export type FontFamily = "mono" | "serif" | "sans";
export type Prompt = "find" | "find_replace" | "go_to_line" | "rename" | null;

export interface EditorState {
  notes: Note[];
  tabs: string[];
  activeTab: string;
  closedTabs: string[];
  selection: Selection;
  undo: Array<{ noteId: string; text: string; selection: Selection }>;
  redo: Array<{ noteId: string; text: string; selection: Selection }>;
  sidebar: boolean;
  outline: boolean;
  statusBar: boolean;
  minimap: boolean;
  lineNumbers: boolean;
  wordWrap: boolean;
  preview: boolean;
  zen: boolean;
  split: boolean;
  /** The editor pane fills the browser window and covers the page around it. */
  fullscreen: boolean;
  zoom: number;
  theme: Theme;
  fontSize: number;
  fontFamily: FontFamily;
  ligatures: boolean;
  typewriter: boolean;
  spellCheck: boolean;
  autosave: boolean;
  prompt: Prompt;
  /** Last user-visible message from a command (shown as a toast). */
  toast: string | null;
  /** Side effects the React layer performs (the export download). */
  effect: Effect | null;
}

export type Effect = { kind: "download"; format: ExportFormat; title: string; text: string };

export const DEFAULT_FONT_SIZE = 15;
export const MAX_UNDO = 100;

export function activeNote(s: EditorState): Note {
  return s.notes.find((n) => n.id === s.activeTab) ?? s.notes[0];
}

/* ---------- text helpers (pure) ---------- */

export function lineBounds(text: string, sel: Selection): Selection {
  const start = text.lastIndexOf("\n", sel.start - 1) + 1;
  let end = text.indexOf("\n", Math.max(sel.end - (sel.end > sel.start ? 1 : 0), sel.start));
  if (end === -1) end = text.length;
  return { start, end };
}

export function replaceRange(text: string, range: Selection, replacement: string): string {
  return text.slice(0, range.start) + replacement + text.slice(range.end);
}

export function wrapSelection(text: string, sel: Selection, marker: string, closing = marker): { text: string; selection: Selection } {
  const inner = text.slice(sel.start, sel.end);
  const before = text.slice(Math.max(0, sel.start - marker.length), sel.start);
  const after = text.slice(sel.end, sel.end + closing.length);
  if (before === marker && after === closing) {
    const next = text.slice(0, sel.start - marker.length) + inner + text.slice(sel.end + closing.length);
    return { text: next, selection: { start: sel.start - marker.length, end: sel.end - marker.length } };
  }
  const next = replaceRange(text, sel, marker + inner + closing);
  return { text: next, selection: { start: sel.start + marker.length, end: sel.end + marker.length } };
}

export function mapLines(text: string, sel: Selection, fn: (line: string, index: number) => string): { text: string; selection: Selection } {
  const b = lineBounds(text, sel);
  const lines = text.slice(b.start, b.end).split("\n").map(fn);
  const joined = lines.join("\n");
  return { text: replaceRange(text, b, joined), selection: { start: b.start, end: b.start + joined.length } };
}

const BULLET = /^(\s*)[-*]\s+(?!\[[ x]\])/;
const NUMBERED = /^(\s*)\d+\.\s+/;
const TASK = /^(\s*)[-*]\s+\[[ x]\]\s+/;
const QUOTE = /^(\s*)>\s?/;
const HEADING = /^#{1,6}\s+/;

export function togglePrefixLines(text: string, sel: Selection, kind: "bullet" | "numbered" | "task" | "quote"): { text: string; selection: Selection } {
  const b = lineBounds(text, sel);
  const lines = text.slice(b.start, b.end).split("\n");
  const re = kind === "bullet" ? BULLET : kind === "numbered" ? NUMBERED : kind === "task" ? TASK : QUOTE;
  const allHave = lines.every((l) => l.trim() === "" || re.test(l));
  return mapLines(text, sel, (line, i) => {
    if (line.trim() === "") return line;
    if (allHave) return line.replace(re, "$1");
    const bare = line.replace(TASK, "$1").replace(BULLET, "$1").replace(NUMBERED, "$1").replace(QUOTE, "$1");
    switch (kind) {
      case "bullet":
        return bare.replace(/^(\s*)/, "$1- ");
      case "numbered":
        return bare.replace(/^(\s*)/, `$1${i + 1}. `);
      case "task":
        return bare.replace(/^(\s*)/, "$1- [ ] ");
      case "quote":
        return bare.replace(/^(\s*)/, "$1> ");
    }
  });
}

export function setHeading(text: string, sel: Selection, level: number): { text: string; selection: Selection } {
  return mapLines(text, sel, (line) => `${"#".repeat(level)} ${line.replace(HEADING, "")}`);
}

export function clearFormatting(s: string): string {
  return s
    .replace(HEADING, "")
    .replace(/^(\s*)([-*]\s+\[[ x]\]\s+|[-*]\s+|\d+\.\s+|>\s?)/gm, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
}

export function titleCase(s: string): string {
  return s.replace(/\b([a-zA-Z])([a-zA-Z']*)/g, (_, a: string, b: string) => a.toUpperCase() + b.toLowerCase());
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function cursorPosition(text: string, offset: number): { line: number; col: number } {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  const col = offset - before.lastIndexOf("\n");
  return { line, col };
}

export function outlineOf(text: string): Array<{ level: number; title: string; line: number }> {
  return text.split("\n").flatMap((l, i) => {
    const m = /^(#{1,6})\s+(.*)$/.exec(l);
    return m ? [{ level: m[1].length, title: m[2], line: i + 1 }] : [];
  });
}

/** Tiny Markdown → HTML for the preview pane. Enough for headings, emphasis, lists, quotes, code, rules. */
export function renderMarkdown(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/~~(.+?)~~/g, "<del>$1</del>")
      .replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, "$1<em>$2</em>")
      .replace(/(^|\W)_(?!\s)(.+?)_(?=\W|$)/g, "$1<em>$2</em>")
      .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, '<span class="img">🖼 $1</span>')
      .replace(/\[([^\]]+)\]\(([^)]*)\)/g, '<a href="$2">$1</a>');
  const out: string[] = [];
  const lines = md.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      out.push("<hr/>");
      i++;
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      const cells = rows.filter((r) => !/^\|\s*-/.test(r)).map((r) => r.split("|").slice(1, -1).map((c) => `<td>${inline(c.trim())}</td>`).join(""));
      out.push(`<table>${cells.map((r) => `<tr>${r}</tr>`).join("")}</table>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
        const raw = lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, "");
        const task = /^\[([ x])\]\s+(.*)$/.exec(raw);
        items.push(task ? `<li class="task"><input type="checkbox" disabled ${task[1] === "x" ? "checked" : ""}/> ${inline(task[2])}</li>` : `<li>${inline(raw)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,6}\s|```|---|\||\s*[-*]\s|\s*\d+\.\s|\s*>)/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}

export function exportText(format: ExportFormat, title: string, text: string): { filename: string; mime: string; body: string } {
  switch (format) {
    case "markdown":
      return { filename: `${title}.md`, mime: "text/markdown", body: text };
    case "plain_text":
      return { filename: `${title}.txt`, mime: "text/plain", body: clearFormatting(text) };
    case "html":
    case "pdf":
      return {
        filename: `${title}.html`,
        mime: "text/html",
        body: `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font:16px/1.6 Georgia,serif;max-width:720px;margin:48px auto;padding:0 24px}code,pre{font-family:ui-monospace,monospace;background:#f3f3f3;padding:2px 4px}pre{padding:12px}blockquote{border-left:3px solid #999;margin:0;padding-left:12px;color:#555}</style></head><body>${renderMarkdown(text)}</body></html>`,
      };
  }
}
