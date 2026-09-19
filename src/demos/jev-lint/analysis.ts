// Deterministic source analysis: function extraction, changed-line diffing,
// identifier collection and import extraction. No AI here; Jev only sees the
// structured output of this module.

export type Language = "typescript" | "python" | "go" | "sql" | "bash" | "rust";

export const LANGUAGES: Language[] = ["typescript", "python", "go", "sql", "bash", "rust"];

export interface FunctionSpan {
  name: string;
  /** 1-based inclusive */
  startLine: number;
  /** 1-based inclusive */
  endLine: number;
}

const HEADERS: Record<Exclude<Language, "python" | "sql">, RegExp[]> = {
  typescript: [
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[<(]/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=>\s*\{\s*$/,
    /^\s+(?:(?:public|private|protected|static|async|readonly|override)\s+)*(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/,
  ],
  go: [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/],
  rust: [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?fn\s+([A-Za-z_]\w*)/],
  bash: [/^\s*function\s+([A-Za-z_][\w-]*)\s*(?:\(\))?\s*\{?\s*$/, /^\s*([A-Za-z_][\w-]*)\s*\(\)\s*\{?\s*$/],
};

const TS_KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "else", "do", "try"]);

/** Find the line (0-based) of the `}` that closes the first `{` at or after `from`. */
function braceEnd(lines: string[], from: number, lang: Language): number {
  let depth = 0;
  let seen = false;
  let inBlock = false;
  for (let i = from; i < lines.length; i++) {
    const line = lines[i];
    let quote: string | null = null;
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (inBlock) {
        if (ch === "*" && line[c + 1] === "/") {
          inBlock = false;
          c++;
        }
        continue;
      }
      if (quote) {
        if (ch === "\\") c++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        if (lang === "rust" && ch === "'" && !/^'(?:\\.|[^'\\])'/.test(line.slice(c))) continue;
        quote = ch;
        continue;
      }
      if (lang === "bash" && ch === "#") break;
      if (lang !== "bash" && ch === "/" && line[c + 1] === "/") break;
      if (lang !== "bash" && ch === "/" && line[c + 1] === "*") {
        inBlock = true;
        c++;
        continue;
      }
      if (ch === "{") {
        depth++;
        seen = true;
      } else if (ch === "}") {
        depth--;
        if (seen && depth === 0) return i;
      }
    }
    if (seen && depth === 0) return i;
  }
  return lines.length - 1;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function pythonFunctions(lines: string[]): FunctionSpan[] {
  const out: FunctionSpan[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === "") continue;
      if (indentOf(lines[j]) <= indent) break;
      end = j;
    }
    out.push({ name: m[2], startLine: i + 1, endLine: end + 1 });
  }
  return out;
}

function sqlStatements(lines: string[]): FunctionSpan[] {
  const out: FunctionSpan[] = [];
  let start = -1;
  let inDollar = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "" || t.startsWith("--")) {
      if (start < 0) continue;
    } else if (start < 0) start = i;
    if ((lines[i].match(/\$\$/g) ?? []).length % 2 === 1) inDollar = !inDollar;
    if (!inDollar && start >= 0 && /;\s*(?:--.*)?$/.test(t)) {
      const head = lines.slice(start, i + 1).join(" ");
      const named = /create\s+(?:or\s+replace\s+)?(?:function|procedure|view|table|index|trigger)\s+(?:if\s+not\s+exists\s+)?([\w.]+)/i.exec(head);
      const kw = /^\s*([A-Za-z]+)/.exec(head)?.[1]?.toUpperCase() ?? "STATEMENT";
      out.push({ name: named ? named[1] : `${kw} #${out.length + 1}`, startLine: start + 1, endLine: i + 1 });
      start = -1;
    }
  }
  if (start >= 0) out.push({ name: `STATEMENT #${out.length + 1}`, startLine: start + 1, endLine: lines.length });
  return out;
}

export function extractFunctions(text: string, lang: Language): FunctionSpan[] {
  const lines = text.split("\n");
  if (lang === "python") return pythonFunctions(lines);
  if (lang === "sql") return sqlStatements(lines);
  const out: FunctionSpan[] = [];
  let skipUntil = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lang !== "typescript" && i <= skipUntil) continue;
    let name: string | undefined;
    for (const re of HEADERS[lang]) {
      const m = re.exec(lines[i]);
      if (m && !TS_KEYWORDS.has(m[1])) {
        name = m[1];
        break;
      }
    }
    if (!name) continue;
    let from = i;
    if (lang === "bash" && !lines[i].includes("{")) from = i + 1;
    const end = braceEnd(lines, from, lang);
    out.push({ name, startLine: i + 1, endLine: end + 1 });
    skipUntil = end;
  }
  return out;
}

/** Innermost function containing `line` (1-based). */
export function enclosingFunction(fns: FunctionSpan[], line: number): FunctionSpan | undefined {
  let best: FunctionSpan | undefined;
  for (const f of fns) {
    if (line >= f.startLine && line <= f.endLine && (!best || f.endLine - f.startLine < best.endLine - best.startLine)) best = f;
  }
  return best;
}

/**
 * Lines (1-based, in `next`) that differ from `prev`. Uses common prefix/suffix trimming, which is
 * exact for single-region edits (every keystroke). Pure deletions report the line at the seam so
 * the now-adjacent code is re-judged. Capped at `max` lines.
 */
export function changedLines(prev: string, next: string, max = 12): number[] {
  if (prev === next) return [];
  const a = prev.split("\n");
  const b = next.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const from = head;
  const to = b.length - tail; // exclusive
  const out: number[] = [];
  if (to <= from) {
    const seam = Math.min(Math.max(from, 0), b.length - 1);
    return [seam + 1];
  }
  for (let i = from; i < to && out.length < max; i++) out.push(i + 1);
  return out;
}

const KEYWORDS = new Set(
  "if else for while do switch case break continue return function const let var class new this true false null undefined import export from as async await try catch finally throw typeof instanceof in of def elif not and or is None True False lambda with pass yield raise except func package type struct interface map range go defer chan select fallthrough nil fn pub mut impl trait enum match use mod crate self Self where loop ref move static Some Ok Err then fi done esac local echo exit select from where join on group by order limit insert into values update set delete create table index view begin end declare exists".split(
    " ",
  ),
);

const DECL: Record<Language, RegExp> = {
  typescript: /\b(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)|\b([A-Za-z_$][\w$]*)\s*(?::[^,)=]+)?(?:,|\)\s*(?::|=>|\{))/g,
  python: /\b(?:def|class)\s+([A-Za-z_]\w*)|^\s*([A-Za-z_]\w*)\s*(?::[^=]+)?=[^=]/gm,
  go: /\b(?:func|type|var|const)\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)|([A-Za-z_]\w*)\s*:=/g,
  rust: /\b(?:fn|let(?:\s+mut)?|struct|enum|const|static|type)\s+([A-Za-z_]\w*)/g,
  bash: /^\s*(?:local\s+|export\s+|readonly\s+)?([A-Za-z_]\w*)=|^\s*(?:function\s+)?([A-Za-z_][\w-]*)\s*\(\)/gm,
  sql: /\b(?:as|function|procedure|view|table)\s+([A-Za-z_][\w.]*)/gi,
};

export interface Identifiers {
  declared: string[];
  used: string[];
}

export function collectIdentifiers(source: string, lang: Language): Identifiers {
  const stripped = source.replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');
  const declared = new Set<string>();
  for (const m of stripped.matchAll(DECL[lang])) {
    const id = m[1] ?? m[2];
    if (id && !KEYWORDS.has(id)) declared.add(id);
  }
  const used = new Set<string>();
  for (const m of stripped.matchAll(/[A-Za-z_$][\w$]*/g)) {
    if (!KEYWORDS.has(m[0]) && !declared.has(m[0]) && m[0].length > 1) used.add(m[0]);
    if (used.size >= 60) break;
  }
  return { declared: [...declared], used: [...used] };
}

export function extractImports(text: string, lang: Language): string[] {
  const res: Record<Language, RegExp> = {
    typescript: /^\s*import\s.*$|^\s*(?:const|let)\s.*=\s*require\(.*$/gm,
    python: /^\s*(?:from\s+\S+\s+)?import\s.*$/gm,
    go: /^\s*import\s*\(?[\s\S]*?\)|^\s*import\s+"[^"]+"/gm,
    rust: /^\s*(?:pub\s+)?use\s.*$|^\s*extern\s+crate\s.*$/gm,
    bash: /^\s*(?:source|\.)\s+\S+.*$/gm,
    sql: /^\s*(?:\\i|\\include|@)\s*\S+.*$/gm,
  };
  return (text.match(res[lang]) ?? []).map((s) => s.trim()).slice(0, 40);
}

/** `start..end` (1-based inclusive) with `N: ` prefixes so Jev can reference lines by number. */
export function numberedSource(text: string, start: number, end: number): string {
  return text
    .split("\n")
    .slice(start - 1, end)
    .map((l, i) => `${start + i}: ${l}`)
    .join("\n");
}

/** Context window used when a line is not inside any function. */
export function fallbackSpan(text: string, line: number, radius = 6): FunctionSpan {
  const total = text.split("\n").length;
  return { name: "(top level)", startLine: Math.max(1, line - radius), endLine: Math.min(total, line + radius) };
}

export function isJudgeable(lineText: string, lang: Language): boolean {
  const t = lineText.trim();
  if (t === "" || /^[{}()[\];,]*$/.test(t)) return false;
  if (lang === "python" || lang === "bash") return !t.startsWith("#");
  if (lang === "sql") return !t.startsWith("--");
  return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
}
