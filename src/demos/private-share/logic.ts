export const TYPES = {
  person: "A person’s full name",
  email: "An email address",
  phone: "A telephone number",
  account_id: "A customer account, order, or ticket identifier",
  address: "A street or postal address",
};
export type Finding = { id: string; type: string; text: string; start: number; end: number; probability?: number; manual?: boolean };
export type Range = { start: number; end: number };

export function parseFindings(source: string, response: unknown): { findings: Finding[]; rejected: number } {
  if (!response || typeof response !== "object" || !Array.isArray((response as { entities?: unknown }).entities)) {
    throw new Error("The service returned an unreadable detection result. Try again.");
  }
  const entities = (response as { entities: unknown[] }).entities;
  const findings: Finding[] = [];
  let rejected = 0;
  // API offsets count Unicode code points; the browser slices UTF-16 code units.
  const points = [...source];
  const units = [0];
  for (const point of points) units.push(units[units.length - 1] + point.length);
  for (const raw of entities) {
    if (!raw || typeof raw !== "object") { rejected++; continue; }
    const e = raw as Record<string, unknown>;
    if (typeof e.text !== "string" || !e.text || typeof e.type !== "string" || !Object.hasOwn(TYPES, e.type) || !Number.isInteger(e.start) || !Number.isInteger(e.end) || typeof e.probability !== "number" || !Number.isFinite(e.probability) || e.probability < 0 || e.probability > 1) { rejected++; continue; }
    const from = e.start as number, to = e.end as number;
    if (from < 0 || to <= from || to > points.length) { rejected++; continue; }
    const start = units[from], end = units[to];
    if (source.slice(start, end) !== e.text) { rejected++; continue; }
    const id = `${start}:${end}:${e.type}`;
    if (!findings.some((f) => f.id === id)) findings.push({ id, type: e.type, text: e.text, start, end, probability: e.probability });
  }
  return { findings: findings.sort((a, b) => a.start - b.start || b.end - a.end), rejected };
}

export function literalFindings(source: string, text: string): Finding[] {
  if (!text) return [];
  const hits: Finding[] = [];
  let start = source.indexOf(text);
  while (start !== -1) {
    hits.push({ id: `${start}:${start + text.length}:manual`, type: "manual", text, start, end: start + text.length, manual: true });
    start = source.indexOf(text, start + 1);
  }
  return hits;
}

export function mergedRanges(source: string, findings: Finding[]): Range[] {
  const ranges: Range[] = [];
  for (const f of [...findings].sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (!Number.isInteger(f.start) || !Number.isInteger(f.end) || f.start < 0 || f.end > source.length || f.end <= f.start || source.slice(f.start, f.end) !== f.text) continue;
    const last = ranges[ranges.length - 1];
    if (last && f.start <= last.end) last.end = Math.max(last.end, f.end);
    else ranges.push({ start: f.start, end: f.end });
  }
  return ranges;
}
export function redact(source: string, findings: Finding[]): string {
  let cursor = 0, out = "";
  for (const range of mergedRanges(source, findings)) {
    out += source.slice(cursor, range.start) + "[REDACTED]";
    cursor = range.end;
  }
  return out + source.slice(cursor);
}

export const SAMPLE = `Customer: Hi, I’m Maya Chen. The weekly export stops at 80%.\n\nAgent: I can send a reproduction to our integration vendor. Which account is affected?\n\nCustomer: My email is maya.chen@example.com and my account is NW-2048. You can call +1 202 555 0148.\n\nAgent: Thanks. We can reproduce this when the date filter is set to last month. The workaround is to export one week at a time.`;
export const SAMPLE_FINDINGS: Finding[] = [
  ["person", "Maya Chen"], ["email", "maya.chen@example.com"], ["account_id", "NW-2048"], ["phone", "+1 202 555 0148"],
].map(([type, text]) => { const start = SAMPLE.indexOf(text); return { id: `${start}:${start + text.length}:${type}`, type, text, start, end: start + text.length }; });

export const detectionRequest = (text: string) => ({ text, types: TYPES });
