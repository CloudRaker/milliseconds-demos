// Deterministic regex baseline. Used as the "before" comparison mode and as the
// fallback when a Jev request fails or is slow.

import type { Language } from "./analysis.ts";
import type { Kind, Marker, Severity } from "./markers.ts";

interface Rule {
  kind: Kind;
  severity: Severity;
  re: RegExp;
  message: string;
  langs?: Language[];
}

const RULES: Rule[] = [
  { kind: "security_risk", severity: "error", re: /\beval\s*\(/, message: "eval() on dynamic input" },
  { kind: "security_risk", severity: "error", re: /(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["'][^"']{6,}["']/i, message: "hardcoded credential" },
  { kind: "security_risk", severity: "error", re: /["'`][^"'`]*\b(?:select|insert|update|delete)\b[^"'`]*["'`]\s*\+|f["'](?:select|insert|update|delete)\b|["'].*(?:select|insert|update|delete)\b.*["']\s*%\s*\(?\w|format!\s*\(\s*"(?:select|insert|update|delete)|Sprintf\s*\(\s*"(?:select|insert|update|delete)/i, message: "SQL built by string concatenation" },
  { kind: "security_risk", severity: "error", re: /shell\s*=\s*True|os\.system\s*\(|child_process|\bexec\s*\(\s*["'`].*\$\{|sh\s+-c\s+"?\$/, message: "shell command from untrusted input" },
  { kind: "security_risk", severity: "warning", re: /Math\.random\s*\(\)|\brandom\.(?:random|randint|choice)\s*\(|\brand\.Intn?\(|\$RANDOM/, message: "insecure random for a security value" },
  { kind: "security_risk", severity: "warning", re: /innerHTML\s*=|dangerouslySetInnerHTML/, message: "HTML injection sink" },
  { kind: "security_risk", severity: "warning", re: /(?:path\.join|os\.path\.join|filepath\.Join|Path::new|open)\s*\([^)]*(?:req\.|params|query|input|user)/i, message: "path built from user input" },
  { kind: "security_risk", severity: "error", re: /rm\s+-rf\s+["']?\$\{?\w+\}?\/?["']?\s*$|rm\s+-rf\s+"?\$\{?\w+\}?\/\*?/, message: "rm -rf with an unquoted/unchecked variable" },
  { kind: "probable_bug", severity: "error", re: /<=\s*[\w.]+\.(?:length|len|size)\b|<=\s*len\s*\(/, message: "<= against a length looks off-by-one" },
  { kind: "probable_bug", severity: "error", re: /\bif\s*\(\s*[\w.[\]]+\s*=\s*[^=]/, message: "assignment inside condition" },
  { kind: "probable_bug", severity: "warning", re: /^\s*except\s*:\s*$|^\s*except\s*:\s*pass\b|catch\s*(?:\([^)]*\))?\s*\{\s*\}/, message: "exception swallowed" },
  { kind: "probable_bug", severity: "warning", re: /\bif\s+err\s*==\s*nil\s*\{\s*return\b/, message: "inverted nil check" },
  { kind: "probable_bug", severity: "warning", re: /\[\s*-?0\s*\]\s*\.\s*(?:lower|upper|split)|\.unwrap\(\)/, message: "possible panic on empty/None value", langs: ["rust"] },
  { kind: "probable_bug", severity: "warning", re: /^\s*\[\s*\$\w+\s*==?\s*/, message: "unquoted variable in test", langs: ["bash"] },
  { kind: "dead_or_unreachable", severity: "warning", re: /\bif\s*\(?\s*(?:false|0|False)\s*\)?\s*[{:]/, message: "always-false condition" },
  { kind: "performance_smell", severity: "warning", re: /\bfor\b.*\bfor\b|\bwhile\b.*\bfor\b/, message: "nested iteration on one line" },
];

export function heuristicMarker(line: number, text: string, lang: Language): Marker | undefined {
  for (const r of RULES) {
    if (r.langs && !r.langs.includes(lang)) continue;
    if (r.re.test(text)) {
      return {
        line,
        severity: r.severity,
        kinds: [{ kind: r.kind, p: 1 }],
        message: r.message,
        source: "heuristic",
      };
    }
  }
  return undefined;
}

/** Deterministic pass over a whole file. Also used as the baseline "heuristic-only" mode. */
export function heuristicScan(text: string, lang: Language): Marker[] {
  const out: Marker[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = heuristicMarker(i + 1, lines[i], lang);
    if (m) out.push(m);
    else if (i > 0 && /^\s*return\b/.test(lines[i - 1]) && lines[i].trim() !== "" && !/^\s*[}\]);]/.test(lines[i]) && indent(lines[i - 1]) === indent(lines[i]) && lang !== "sql") {
      out.push({ line: i + 1, severity: "warning", kinds: [{ kind: "dead_or_unreachable", p: 1 }], message: "statement after return", source: "heuristic" });
    }
  }
  return out;
}

function indent(s: string): number {
  return s.length - s.trimStart().length;
}
