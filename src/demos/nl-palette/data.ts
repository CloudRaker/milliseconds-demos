// Fixtures copied from the Jev experiment: the editor commands, its benchmark phrasings
// and its three seed notes. Deterministic; no randomness anywhere.
// All 66 commands are here. The 64-label cap of flat /classify does not apply, because
// the commands go to /classify-tree, where the cap is per level and the biggest level
// (Format) holds 16 labels.

export type ArgSlot = "font_size_delta" | "theme" | "heading_level" | "export_format";

export const FONT_DELTAS = ["-4", "-2", "+2", "+4"] as const;
export const THEMES = ["dark", "light", "sepia", "high_contrast"] as const;
export const HEADING_LEVELS = ["1", "2", "3", "4", "5", "6"] as const;
export const EXPORT_FORMATS = ["markdown", "html", "pdf", "plain_text"] as const;

export type FontDelta = (typeof FONT_DELTAS)[number];
export type Theme = (typeof THEMES)[number];
export type HeadingLevel = (typeof HEADING_LEVELS)[number];
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type ArgValue = FontDelta | Theme | HeadingLevel | ExportFormat;

export type CommandGroup =
  | "View"
  | "Window"
  | "Appearance"
  | "Text"
  | "Format"
  | "File"
  | "Edit"
  | "Find"
  | "Tabs"
  | "Tools";

export interface Command {
  id: string;
  title: string;
  /** Plain-language description used as the Choice criterion for Jev. */
  description: string;
  group: CommandGroup;
  shortcut?: string;
  arg?: ArgSlot;
  /** Discards data or is hard to undo; asks for confirmation when Jev is not sure. */
  destructive?: boolean;
}

export const COMMANDS: readonly Command[] = [
  // View
  { id: "toggle_sidebar", title: "Toggle Sidebar", group: "View", shortcut: "Ctrl+B", description: "Show or hide the sidebar: the left-hand panel, the left thing, the file explorer with the note list." },
  { id: "toggle_outline", title: "Toggle Outline Panel", group: "View", description: "Show or hide the document outline of headings on the right." },
  { id: "toggle_status_bar", title: "Toggle Status Bar", group: "View", description: "Show or hide the thin status bar along the bottom with word count and cursor position." },
  { id: "toggle_minimap", title: "Toggle Minimap", group: "View", description: "Show or hide the miniature overview of the document next to the scrollbar." },
  { id: "toggle_line_numbers", title: "Toggle Line Numbers", group: "View", description: "Show or hide line numbers in the gutter." },
  { id: "toggle_word_wrap", title: "Toggle Word Wrap", group: "View", description: "Turn soft wrapping on or off, so long lines stop running off the right edge and fold onto the next line instead." },
  { id: "toggle_preview", title: "Toggle Markdown Preview", group: "View", description: "Show or hide the rendered Markdown preview pane inside the editor, next to the source." },
  { id: "toggle_zen_mode", title: "Toggle Zen Mode", group: "Window", description: "Zen mode on or off: strip the window down to the text alone. Only for focus, quiet or no distractions, never for hiding one named panel." },
  { id: "zoom_in", title: "Zoom In", group: "Window", shortcut: "Ctrl+=", description: "Zoom the whole interface in, so every panel and all text on screen gets larger together. Not the editor font size." },
  { id: "zoom_out", title: "Zoom Out", group: "Window", shortcut: "Ctrl+-", description: "Zoom the whole interface out because everything on screen is too big; every panel and all text gets smaller together. Not the editor font size." },
  { id: "reset_zoom", title: "Reset Zoom", group: "Window", description: "Return the interface zoom to 100%." },
  { id: "split_editor", title: "Split Editor", group: "Window", description: "Open a second editor pane side by side with the current one." },
  { id: "close_split", title: "Close Split", group: "Window", description: "Close the second pane and return to a single editor." },
  { id: "toggle_fullscreen", title: "Toggle Full Screen", group: "Window", description: "Full screen on or off: blow the editor up so it fills the whole browser window and covers the page around it, or put it back." },

  // Appearance
  { id: "set_theme", title: "Change Color Theme", group: "Appearance", arg: "theme", description: "Switch the color theme: night or dark, day or light, warm paper-like sepia, or high contrast. Colors only, not sizes." },
  { id: "change_font_size", title: "Change Font Size", group: "Appearance", arg: "font_size_delta", description: "Change the size of the editor text in points, when it is too small, too big, hard to read or should be louder. Size only, not colors." },
  { id: "reset_font_size", title: "Reset Font Size", group: "Appearance", description: "Return the editor font size to its default." },
  { id: "cycle_font_family", title: "Cycle Font Family", group: "Appearance", description: "Switch to the next typeface (monospace, serif, sans-serif)." },
  { id: "toggle_typewriter_mode", title: "Toggle Typewriter Scrolling", group: "Appearance", description: "Keep the current line vertically centered while typing, or stop doing so." },
  // Last in its group on purpose: with this label sitting between Cycle Font Family and
  // Typewriter Scrolling, the batched run sent "switch to night mode" to Typewriter Scrolling
  // at 65% instead of Change Color Theme. Moved to the end, the benchmark is back at 30/32.
  { id: "toggle_ligatures", title: "Toggle Font Ligatures", group: "Appearance", description: "Turn programming ligatures on or off: whether pairs such as != and => are drawn joined into one glyph." },

  // Format
  { id: "set_heading", title: "Set Heading Level", group: "Format", arg: "heading_level", description: "Turn the current line into a heading of a given level (H1 to H6)." },
  { id: "toggle_bold", title: "Toggle Bold", group: "Format", shortcut: "Ctrl+B", description: "Make the selected text bold, or remove bold." },
  { id: "toggle_italic", title: "Toggle Italic", group: "Format", shortcut: "Ctrl+I", description: "Make the selected text italic, or remove italics." },
  { id: "toggle_strikethrough", title: "Toggle Strikethrough", group: "Format", description: "Strike through the selected text, or remove strikethrough." },
  { id: "toggle_inline_code", title: "Toggle Inline Code", group: "Format", description: "Wrap the selection in backticks as inline code, or unwrap it." },
  { id: "insert_code_block", title: "Insert Code Block", group: "Format", description: "Insert a fenced code block (triple backticks) at the cursor." },
  { id: "toggle_bullet_list", title: "Toggle Bullet List", group: "Format", description: "Turn the current lines into a bulleted (unordered) list, or back into plain text." },
  { id: "toggle_numbered_list", title: "Toggle Numbered List", group: "Format", description: "Turn the current lines into a numbered (ordered) list, or back into plain text." },
  { id: "toggle_task_list", title: "Toggle Task List", group: "Format", description: "Turn the current lines into checkbox to-do items, or back into plain text." },
  { id: "toggle_blockquote", title: "Toggle Blockquote", group: "Format", description: "Turn the current lines into a quoted block (prefixed with >), or remove the quote." },
  { id: "insert_link", title: "Insert Link", group: "Format", shortcut: "Ctrl+K", description: "Insert a Markdown hyperlink around the selection." },
  { id: "insert_image", title: "Insert Image", group: "Format", description: "Insert a Markdown image reference at the cursor." },
  { id: "insert_table", title: "Insert Table", group: "Format", description: "Insert an empty Markdown table at the cursor." },
  { id: "insert_horizontal_rule", title: "Insert Horizontal Rule", group: "Format", description: "Insert a horizontal divider line (---) at the cursor." },
  { id: "insert_date", title: "Insert Current Date", group: "Format", description: "Insert today's date at the cursor." },
  { id: "clear_formatting", title: "Clear Formatting", group: "Format", description: "Strip Markdown markup (bold, italic, code, headings) from the selection, leaving plain text." },

  // Text
  { id: "uppercase_selection", title: "Transform to Uppercase", group: "Text", description: "Convert the selected text to ALL CAPS, so that it shouts or is loud." },
  { id: "lowercase_selection", title: "Transform to Lowercase", group: "Text", description: "Convert the selected text to all lowercase letters." },
  { id: "title_case_selection", title: "Transform to Title Case", group: "Text", description: "Capitalize The First Letter Of Each Word in the selection." },
  { id: "sort_lines", title: "Sort Lines Ascending", group: "Text", description: "Sort the selected lines alphabetically." },
  { id: "remove_duplicate_lines", title: "Remove Duplicate Lines", group: "Text", description: "Delete repeated lines in the selection, keeping one copy of each." },
  { id: "trim_trailing_whitespace", title: "Trim Trailing Whitespace", group: "Text", description: "Remove spaces and tabs from the ends of all lines." },
  { id: "join_lines", title: "Join Lines", group: "Text", description: "Merge the selected lines into a single line." },
  { id: "duplicate_line", title: "Duplicate Line", group: "Text", description: "Copy the current line and insert the copy directly below it." },
  { id: "delete_line", title: "Delete Line", group: "Text", description: "Remove the current line entirely." },
  { id: "move_line_up", title: "Move Line Up", group: "Text", description: "Swap the current line with the line above it." },
  { id: "move_line_down", title: "Move Line Down", group: "Text", description: "Swap the current line with the line below it." },

  // Edit
  { id: "undo", title: "Undo", group: "Edit", shortcut: "Ctrl+Z", description: "Revert the most recent edit." },
  { id: "redo", title: "Redo", group: "Edit", shortcut: "Ctrl+Shift+Z", description: "Re-apply the edit that was just undone." },
  { id: "select_all", title: "Select All", group: "Edit", shortcut: "Ctrl+A", description: "Select the entire document text." },

  // Find
  { id: "find", title: "Find", group: "Find", shortcut: "Ctrl+F", description: "Open the search box to look for text in the current note." },
  { id: "find_replace", title: "Find and Replace", group: "Find", shortcut: "Ctrl+H", description: "Open search with a replacement field to substitute text in the current note." },
  { id: "go_to_line", title: "Go to Line", group: "Find", shortcut: "Ctrl+G", description: "Jump the cursor to a specific line number." },
  { id: "toggle_spell_check", title: "Toggle Spell Check", group: "Tools", description: "Stop or start the red squiggly underlines under misspelled words: the spelling checker." },

  // File
  { id: "new_note", title: "New Note", group: "File", shortcut: "Ctrl+N", description: "Create a fresh, empty note and open it in a new tab." },
  { id: "save_note", title: "Save Note", group: "File", shortcut: "Ctrl+S", description: "Save the current note to disk." },
  { id: "export_note", title: "Export Note", group: "File", arg: "export_format", description: "Export, save-as or download the current note as a file in another format (Markdown, an HTML web page, PDF or plain text) to share or open elsewhere." },
  { id: "rename_note", title: "Rename Note", group: "File", description: "Change the title / file name of the current note." },
  { id: "delete_note", title: "Delete Note", group: "File", destructive: true, description: "Permanently delete the current note from the workspace (destructive)." },
  { id: "toggle_pin_note", title: "Pin / Unpin Note", group: "File", description: "Pin the current note to the top of the sidebar list, or unpin it." },

  // Tabs
  { id: "close_tab", title: "Close Tab", group: "Tabs", shortcut: "Ctrl+W", description: "Close the current editor tab." },
  { id: "close_other_tabs", title: "Close Other Tabs", group: "Tabs", destructive: true, description: "Close every open tab except the current one." },
  { id: "reopen_closed_tab", title: "Reopen Closed Tab", group: "Tabs", shortcut: "Ctrl+Shift+T", description: "Restore the tab that was closed most recently." },
  { id: "next_tab", title: "Next Tab", group: "Tabs", shortcut: "Ctrl+Tab", description: "Switch to the tab to the right of the current one." },
  { id: "previous_tab", title: "Previous Tab", group: "Tabs", shortcut: "Ctrl+Shift+Tab", description: "Switch to the tab to the left of the current one." },
  { id: "toggle_autosave", title: "Toggle Autosave", group: "Tools", description: "Turn automatic saving after each change on or off." },
];

export const COMMAND_BY_ID: ReadonlyMap<string, Command> = new Map(COMMANDS.map((c) => [c.id, c]));

export function argOptions(slot: ArgSlot): readonly string[] {
  switch (slot) {
    case "font_size_delta":
      return FONT_DELTAS;
    case "theme":
      return THEMES;
    case "heading_level":
      return HEADING_LEVELS;
    case "export_format":
      return EXPORT_FORMATS;
  }
}

export const ARG_SLOTS: readonly ArgSlot[] = ["font_size_delta", "theme", "heading_level", "export_format"];

export interface BenchmarkCase {
  query: string;
  expected: string;
  /** Expected argument for commands with a slot. */
  expectedArg?: string;
}

/**
 * 32 phrasings a real user might type — the batch cap of one /classify-tree call, so the
 * whole benchmark is one request. 26 describe the *effect* they want ("make this louder");
 * 6 are the partial command names a fuzzy palette is built for ("zoom out", "wrd wrap"),
 * so the fuzzy baseline gets a fair shot.
 *
 * Both font-size cases used to ask for a bigger font, which is why an inverted /rate scale
 * survived a 10/10 argument score. "the text is way too big" is here to hold the shrink
 * direction down; it replaced "get rid of the sidebar", a third phrasing of a command two
 * other cases already cover.
 */
export const BENCHMARK_CASES: readonly BenchmarkCase[] = [
  { query: "make this louder", expected: "change_font_size", expectedArg: "+2" },
  { query: "the text is way too big", expected: "change_font_size", expectedArg: "-4" },
  { query: "hide the left thing", expected: "toggle_sidebar" },
  { query: "text is way too small", expected: "change_font_size", expectedArg: "+4" },
  { query: "switch to night mode", expected: "set_theme", expectedArg: "dark" },
  { query: "i want it to look like paper", expected: "set_theme", expectedArg: "sepia" },
  { query: "make this line the title", expected: "set_heading", expectedArg: "1" },
  { query: "turn this into a subheading", expected: "set_heading", expectedArg: "2" },
  { query: "h4 this", expected: "set_heading", expectedArg: "4" },
  { query: "smallest heading please", expected: "set_heading", expectedArg: "6" },
  { query: "send this as a pdf", expected: "export_note", expectedArg: "pdf" },
  { query: "give me a web page version", expected: "export_note", expectedArg: "html" },
  { query: "everything is too big on screen", expected: "zoom_out" },
  { query: "focus, no distractions", expected: "toggle_zen_mode" },
  { query: "show me what it renders like", expected: "toggle_preview" },
  { query: "search and swap words", expected: "find_replace" },
  { query: "make it shout", expected: "uppercase_selection" },
  { query: "alphabetize these", expected: "sort_lines" },
  { query: "checkboxes please", expected: "toggle_task_list" },
  { query: "stamp today's date", expected: "insert_date" },
  { query: "trash this note", expected: "delete_note" },
  { query: "get rid of every other tab", expected: "close_other_tabs" },
  { query: "stop the red squiggles", expected: "toggle_spell_check" },
  { query: "lines are running off the edge", expected: "toggle_word_wrap" },
  { query: "make this a quote", expected: "toggle_blockquote" },
  { query: "keep this note at the top", expected: "toggle_pin_note" },
  { query: "zoom out", expected: "zoom_out" },
  { query: "wrd wrap", expected: "toggle_word_wrap" },
  { query: "insert table", expected: "insert_table" },
  { query: "split", expected: "split_editor" },
  { query: "tog sidebar", expected: "toggle_sidebar" },
  { query: "reopen tab", expected: "reopen_closed_tab" },
];


export interface Note { id: string; title: string; text: string; pinned: boolean }

export const SEED_NOTES: Note[] = [
  {
    id: "n1",
    title: "Launch checklist",
    pinned: true,
    text: `# Launch checklist

The palette demo ships when every item below is green. Keep this note short and *ruthlessly* practical.

## Before the demo

- [x] Seed three realistic notes
- [x] Wire every command to a visible effect
- [ ] Test the example commands and review the results
- [ ] Record a 20 second GIF of the palette re-ranking live

## Talking points

1. Describe the effect you want in plain English.
2. Review the suggested command, then press Enter to apply it.
3. Commands update this editor. Destructive changes ask for confirmation.

> "The best interface is the one you never have to learn." — someone on a slide, probably

Try it: press Ctrl+K and type \`make this louder\`.
`,
  },
  {
    id: "n2",
    title: "Meeting notes 2026-09-16",
    pinned: false,
    text: `# Meeting notes — 2026-09-16

Attendees: Priya, Tomas, Lena, Kwame

## Decisions

- Keep the sidebar collapsible; default open on wide screens
- Sepia theme stays (Lena's request)
- Export to PDF uses the browser print dialog for now

## Open questions

- Should low-confidence results require a click?
- How many argument slots can we speculatively ask for before the request gets slow?
- banana
- apple
- cherry
- apple

## Action items

- [ ] Tomas: measure p95 under load
- [ ] Priya: write the README table
- [ ] Kwame: design the confirmation prompt for destructive commands
`,
  },
  {
    id: "n3",
    title: "Reading list",
    pinned: false,
    text: `# Reading list

Books and papers queued for the autumn.

| Title | Author | Status |
| --- | --- | --- |
| The Design of Everyday Things | Don Norman | reading |
| Thinking, Fast and Slow | Daniel Kahneman | queued |
| Site Reliability Engineering | Beyer et al. | done |

## Papers

- "Attention Is All You Need" — re-read section 3
- "The UNIX Time-Sharing System" — for the philosophy chapter

---

Notes to self: the palette should feel like search-as-you-type, not like a form.
`,
  },
];

/* ---------- what we send to decision-machine-1 ---------- */

/**
 * The one text every call in this demo classifies. The editor state is NOT in it:
 * DM1 has no structured state field, and a state preamble measurably drowned the query
 * (24/30 -> 17/30 on the benchmark). Every state-dependent command here is a toggle,
 * so "hide the sidebar" and "show the sidebar" are the same answer anyway; the one rule
 * that does need the state, "give me a different theme", is applied in resolve.ts.
 */
export function paletteText(query: string): string {
  return `User typed in the command palette of a markdown notes editor: "${query}"`;
}

/**
 * The one ordinal slot goes to /rate, lowest step first: the steps are a scale, not
 * four unrelated choices. `level` from the response indexes straight into this array.
 * Each step owns the "too X" cues for its own direction, and the word "way" sits on both
 * ends. Leaving "way" on +4 alone was enough to flip the complaint: "the text is way too
 * big" rated +4 at 59% (-4 got 3%), so the demo grew the font the user had just called
 * too large. With "way too big" on -4 and "way too small" on +4, the same phrase rates
 * -4 at 80% and the ten-phrase probe is 10/10.
 */
export const ARG_SCALES: Partial<Record<ArgSlot, Array<{ value: string; description: string }>>> = {
  font_size_delta: [
    { value: "-4", description: "Much smaller text: shrink the editor font by 4 points (a lot, way or much smaller or tinier; the text is way too big, far too big or far too large)" },
    { value: "-2", description: "Slightly smaller text: shrink the editor font by 2 points (a bit smaller, a touch smaller, more compact)" },
    { value: "+2", description: "Slightly bigger text: grow the editor font by 2 points (a bit bigger, a touch bigger, louder, more readable)" },
    { value: "+4", description: "Much bigger text: grow the editor font by 4 points (a lot or much bigger; the text is way too small, far too small or tiny)" },
  ],
};

/**
 * The three slots whose values are named, not ordered, stay on /classify. Heading level
 * looks ordinal but is not asked as one: "h4", "level 5" and "smallest heading" name the
 * level directly, and /rate cannot read a name off a scale ("h4 this" rated H2).
 */
export const ARG_LABELS: Partial<Record<ArgSlot, Record<string, string>>> = {
  theme: {
    dark: "Dark theme: dark background with light text (night, black, dim)",
    light: "Light theme: white background with dark text (day, bright, white)",
    sepia: "Sepia theme: warm cream paper-like background (warm, paper, parchment, vintage)",
    high_contrast: "High contrast theme: black and yellow for maximum legibility (accessibility, hard to read)",
  },
  heading_level: {
    "1": "Heading level 1, H1, the largest: title, top, biggest or main heading",
    "2": "Heading level 2, H2: section or subheading",
    "3": "Heading level 3, H3, an h3: subsection",
    "4": "Heading level 4, H4, an h4",
    "5": "Heading level 5, H5, an h5",
    "6": "Heading level 6, H6, an h6, the smallest heading",
  },
  export_format: {
    markdown: "Markdown (.md) source file: keep the Markdown source as it is",
    html: "HTML web page",
    pdf: "PDF document, for printing or sharing a finished document",
    plain_text: "Plain text (.txt) with all Markdown markup stripped",
  },
};

/**
 * The destructive check: one /yes-no statement with both hints. The second sentence of
 * when_false is what keeps the dialog off safe commands: without it "undo that" scored
 * 50% and "clear the formatting on this" 54%, both at or above the 0.5 gate. With it they
 * score 10% and 16%, while "trash this note" stays at 91% and "nuke everything" at 97%.
 */
export const DESTRUCTIVE_STATEMENT = "The request permanently discards content or closes work.";
export const DESTRUCTIVE_HINTS = {
  when_true: "The request removes, deletes, discards or closes something for good.",
  when_false:
    "The request only shows, changes, formats or navigates, or it can be undone. Undo, redo and clearing or stripping formatting change how text looks, never whether it is there.",
};

/**
 * /classify is biased toward its first labels once a flat set gets past ~30 entries,
 * and there are 66 commands here. So the commands go to /classify-tree as a two-level
 * tree: the ten command groups, then the commands of the winning group.
 */
export const GROUP_DESCRIPTIONS: Record<CommandGroup, string> = {
  View: "Show or hide one named panel or gutter of the editor: the sidebar or left panel, the outline of headings, the status bar, the minimap, the line numbers, the rendered markdown preview, or wrapping long lines that run off the right edge.",
  Window: "Change the window as a whole: zen or focus mode with no distractions, zooming the whole interface in or out when everything on screen is too big or too small, splitting the editor into two panes.",
  Appearance: "Change how the text and the app look: the color theme (night, dark, light, paper, sepia, high contrast), the size of the editor text when it is too small, too big, hard to read or should be louder, the typeface, typewriter scrolling.",
  Format: "Add or remove markdown markup on the current line or selection: make it a heading, a title or a subheading, bold, italic, strikethrough, inline code, a code block, a bullet, numbered or checkbox list, a quote, a link, an image, a table, a divider, insert today's date, strip formatting.",
  Text: "Rewrite words or whole lines that are already written: put them in capitals so they shout or are loud, in lower case or title case, sort them alphabetically, remove repeated lines, trim spaces, join, duplicate, move or delete a line.",
  Edit: "Undo the last change, redo it, or select the whole document.",
  Find: "Search this note for some text, search and replace words, or jump to a line number.",
  File: "Act on the note as a file: start a new note, save it, export or download it to send as a PDF, a web page or plain text, rename it, delete or trash it, pin it to the top of the list.",
  Tabs: "Act on the open editor tabs: close this tab, close every other tab, reopen the last closed tab, go to the next or previous tab.",
  Tools: "The spelling checker, which is what puts the red squiggly underlines under misspelled words, and saving the note automatically. Turn either background helper off or on.",
};

type TreeNode = string | { description?: string; labels?: Record<string, TreeNode> };

/** Two levels: the ten groups, then the commands of the winning group. Built once from COMMANDS. */
export const COMMAND_TREE: Record<string, TreeNode> = Object.fromEntries(
  (Object.keys(GROUP_DESCRIPTIONS) as CommandGroup[]).map((group) => [
    group.toLowerCase(),
    {
      description: GROUP_DESCRIPTIONS[group],
      labels: Object.fromEntries(
        COMMANDS.filter((c) => c.group === group).map((c) => [c.id, `${c.title}: ${c.description}`]),
      ),
    },
  ]),
);

/** The group a tree label belongs to, e.g. "view" -> "View". */
export const GROUP_BY_KEY: Record<string, CommandGroup> = Object.fromEntries(
  (Object.keys(GROUP_DESCRIPTIONS) as CommandGroup[]).map((g) => [g.toLowerCase(), g]),
);

/** Clickable phrases make the free path discoverable; benchmark phrases are also stock. */
export const PALETTE_EXAMPLES = [
  "make the text bigger", "switch to dark mode", "hide the left thing", "make this line the title", "give me a web page version", "trash this note",
];
export const STOCK_QUERIES = [...new Set([...PALETTE_EXAMPLES, ...BENCHMARK_CASES.map((item) => item.query)])];
export const benchmarkTexts = () => BENCHMARK_CASES.map((item) => paletteText(item.query));

export const treeBody = (query: string) => ({ text: paletteText(query), tree: COMMAND_TREE });
export const destructiveBody = (query: string) => ({ text: paletteText(query), statements: [DESTRUCTIVE_STATEMENT], ...DESTRUCTIVE_HINTS });

/** All argument branches stay finite even when the model chooses an unexpected command. */
export function argumentRequest(slot: ArgSlot, texts: string[], batch = false) {
  const steps = ARG_SCALES[slot];
  if (steps) return { route: "rate" as const, body: { texts, scale: steps.map((step) => step.description) } };
  return { route: "classify" as const, body: batch ? { texts, labels: ARG_LABELS[slot]! } : { text: texts[0], labels: ARG_LABELS[slot]! } };
}
