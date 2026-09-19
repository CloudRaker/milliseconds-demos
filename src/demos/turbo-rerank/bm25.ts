import type { Bm25Hit } from "./types.ts";

const STOPWORDS = new Set(
  (
    "a an and are as at be by for from has have how i in is it its of on or that the this to was what when where which who will with you your do does can should my we our not if any" +
    " into than then there these those they them their been being about after before over under"
  ).split(" "),
);

/** Crude English stemmer: strips common suffixes so "deploys"/"deploying"/"deployed" collide. */
export function stem(word: string): string {
  let w = word;
  if (w.length > 5 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.length > 4 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("es")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ly")) w = w.slice(0, -2);
  return w;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

export interface Bm25Options {
  k1?: number;
  b?: number;
}

export class Bm25Index {
  private readonly ids: string[] = [];
  private readonly docLengths: number[] = [];
  private readonly postings = new Map<string, Map<number, number>>();
  private avgDocLength = 0;
  private readonly k1: number;
  private readonly b: number;

  constructor(docs: { id: string; text: string }[], options: Bm25Options = {}) {
    this.k1 = options.k1 ?? 1.2;
    this.b = options.b ?? 0.75;
    let total = 0;
    docs.forEach((doc, index) => {
      const tokens = tokenize(doc.text);
      this.ids.push(doc.id);
      this.docLengths.push(tokens.length);
      total += tokens.length;
      for (const token of tokens) {
        let posting = this.postings.get(token);
        if (!posting) {
          posting = new Map();
          this.postings.set(token, posting);
        }
        posting.set(index, (posting.get(index) ?? 0) + 1);
      }
    });
    this.avgDocLength = docs.length ? total / docs.length : 0;
  }

  get size(): number {
    return this.ids.length;
  }

  idf(token: string): number {
    const df = this.postings.get(token)?.size ?? 0;
    const n = this.ids.length;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  search(query: string, k = 50): Bm25Hit[] {
    const scores = new Float64Array(this.ids.length);
    const seen = new Set<string>();
    for (const token of tokenize(query)) {
      if (seen.has(token)) continue;
      seen.add(token);
      const posting = this.postings.get(token);
      if (!posting) continue;
      const idf = this.idf(token);
      for (const [docIndex, tf] of posting) {
        const len = this.docLengths[docIndex];
        const norm = this.k1 * (1 - this.b + (this.b * len) / this.avgDocLength);
        scores[docIndex] += (idf * tf * (this.k1 + 1)) / (tf + norm);
      }
    }
    const hits: Bm25Hit[] = [];
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] > 0) hits.push({ id: this.ids[i], score: scores[i] });
    }
    hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return hits.slice(0, k);
  }
}
