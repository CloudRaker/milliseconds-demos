// Retrieval, prompt building and re-ranking for the instant-search demo.
// The retriever (MiniSearch, BM25-style) is copied from the jev-instant-search experiment.
// The Jev per-candidate `score` questions become one /yes-no call over 30 product texts;
// the query-level questions become one /yes-no call plus one /classify call over the query.

import MiniSearch from "minisearch";
import type { Category, Product } from "./data.ts";

/* ---------------------------------------------------------------- retriever */

export interface LexicalHit {
  product: Product;
  score: number;
  norm: number;
}

export const TOP_K = 30;
export const MAX_PER_TYPE = 6;

const STOPWORDS = new Set(["a", "an", "the", "for", "to", "on", "in", "of", "that", "who", "and", "or", "with", "my", "me", "i", "some", "something", "dont", "don't", "not", "no", "is", "it", "at", "by"]);

export function stem(t: string): string {
  if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith("ed")) t = t.slice(0, -2);
  else if (t.length > 4 && t.endsWith("es")) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  if (t.length > 3 && t.endsWith("e")) t = t.slice(0, -1);
  return t;
}

export function processTerm(term: string): string | null {
  const t = term.toLowerCase().replace(/[^a-z0-9]/g, "");
  return t.length < 2 || STOPWORDS.has(t) ? null : stem(t);
}

export function createIndex(products: Product[]) {
  const index = new MiniSearch<Product>({
    fields: ["title", "description", "category", "attrText"],
    storeFields: ["id"],
    idField: "id",
    extractField: (doc, field) => (field === "attrText" ? Object.values(doc.attributes).join(" ") : (doc as unknown as Record<string, string>)[field]),
    processTerm,
    searchOptions: { boost: { title: 2, category: 1.5, description: 1, attrText: 0.5 }, prefix: true, fuzzy: 0.15, combineWith: "OR" },
  });
  index.addAll(products);
  return index;
}

/** Top-k lexical hits, at most MAX_PER_TYPE of any one product type before overflow. */
export function search(index: MiniSearch<Product>, byId: Map<string, Product>, query: string, k = TOP_K): LexicalHit[] {
  const q = query.trim();
  if (!q) return [];
  const raw = index.search(q);
  const max = raw.length ? raw[0].score : 1;
  const hits: LexicalHit[] = [];
  const overflow: LexicalHit[] = [];
  const perType = new Map<string, number>();
  for (const r of raw) {
    if (hits.length >= k) break;
    const product = byId.get(r.id as string);
    if (!product) continue;
    const hit = { product, score: r.score, norm: r.score / max };
    const n = perType.get(product.type) ?? 0;
    if (n >= MAX_PER_TYPE) {
      overflow.push(hit);
      continue;
    }
    perType.set(product.type, n + 1);
    hits.push(hit);
  }
  for (const h of overflow) {
    if (hits.length >= k) break;
    hits.push(h);
  }
  return hits.sort((a, b) => b.score - a.score || a.product.id.localeCompare(b.product.id));
}

/* ------------------------------------------------------------ what we send */

/** One text per candidate. The product only: the search lives in the statements. */
export function candidateText(p: Product): string {
  return `${p.title}. ${p.description} Category: ${p.category}. Price $${p.price.toFixed(2)}. Rated ${p.rating.toFixed(1)} stars.`;
}

/** Two statements per candidate: right kind of thing, then right answer to the whole request. */
export function relevanceStatements(query: string): [string, string] {
  const q = query.trim().replace(/\s+/g, " ");
  return [`This product is the kind of thing a shopper asking for ${q} is shopping for.`, `This product does everything the request asks for: ${q}.`];
}

export const RELEVANCE_HINTS = {
  when_true: "The product's own stated features cover the whole request.",
  when_false: "The product misses any part of the request, or only shares a word with it.",
};

export const INTENT_STATEMENTS = [
  "The shopper wants a cheap or budget product.",
  "The shopper wants a premium or high-end product.",
  "The shopper is buying a gift for someone else.",
  "The shopper wants the best-rated product.",
] as const;

export const INTENT_HINTS = { when_true: "The words of the search say so.", when_false: "The words of the search do not say so." };

/** Five departments plus the original's sixth "any" escape hatch. */
export const DEPARTMENTS: Record<Category | "any", string> = {
  electronics: "Audio, headphones, phones and phone accessories, keyboards, mice, computers, cameras, gadgets",
  kitchen: "Cooking, coffee, blenders, drinkware, insulated bottles and tumblers, food storage",
  outdoors: "Hiking, camping, sports, cycling, travel gear, outdoor clothing",
  toys: "Children's toys, games, building kits and gifts for kids",
  office: "Desks, chairs, stationery, paper, work-from-home furniture and accessories",
  any: "The search does not point to one department",
};

/** Shared by the demo and the fixed public example catalog. */
export function searchRequestBodies(query: string, found: LexicalHit[]) {
  return {
    relevance: { texts: found.map((h) => candidateText(h.product)), statements: relevanceStatements(query), ...RELEVANCE_HINTS },
    intent: { text: query, statements: [...INTENT_STATEMENTS], ...INTENT_HINTS },
    department: { text: query, labels: DEPARTMENTS },
  };
}

/* ------------------------------------------------------- what we get back */

export const SORTS = ["relevance", "price_low", "price_high", "rating"] as const;
export type SortPreference = (typeof SORTS)[number];

/** Per candidate: p(right kind), p(right answer) and the mean the ranker uses. */
export interface RelevanceAnswer {
  kind: number;
  fit: number;
  score: number;
}

export interface QueryJudgment {
  department: Category | null;
  departmentConfidence: number;
  departmentScores: Record<string, number>;
  wantsCheap: number;
  wantsPremium: number;
  isGift: number;
  wantsRating: number;
  sort: SortPreference;
  sortConfidence: number;
  source: "model" | "heuristic";
}

export interface Answers {
  relevance: Map<string, RelevanceAnswer>;
  query: QueryJudgment;
}

export const GATE = { department: 0.6, flag: 0.6, sort: 0.5 };

/**
 * "Right kind" carries the judgment. "Does everything asked" sits near 1.00 for almost
 * every candidate (measured 0.95-1.00 across all 30 on several queries), so a plain mean
 * lifted an obvious non-match from 0.07 to 0.51 and cleared the 0.3 floor. Weight it down.
 */
export const RELEVANCE_MIX = { kind: 0.75, fit: 0.25 };

export function toRelevance(kind: number, fit: number): RelevanceAnswer {
  return { kind, fit, score: RELEVANCE_MIX.kind * kind + RELEVANCE_MIX.fit * fit };
}

/** The sort the ranker applies, derived in code from the four flags (same rule as the original). */
export function deriveSort(j: Pick<QueryJudgment, "wantsCheap" | "wantsPremium" | "isGift" | "wantsRating">): { sort: SortPreference; confidence: number } {
  if (j.wantsRating >= GATE.sort) return { sort: "rating", confidence: j.wantsRating };
  if (j.wantsCheap >= GATE.flag) return { sort: "price_low", confidence: j.wantsCheap };
  if (j.wantsPremium >= GATE.flag) return { sort: "price_high", confidence: j.wantsPremium };
  return { sort: "relevance", confidence: 1 - Math.max(j.wantsCheap, j.wantsPremium, j.wantsRating) };
}

/** The slices of the three responses this code reads; smoke.mjs's plain JSON fits too. */
export interface YesNoProbability {
  probability: number;
}
export interface ClassifyAnswer {
  label: string;
  probability: number;
  scores: Record<string, number>;
}

/**
 * rel.results[i] lines up with found[i]; statement 0 is "right kind", statement 1 is
 * "right answer". One copy, because the page and the smoke script have to agree.
 */
export function parseAnswers(found: LexicalHit[], rel: { results: YesNoProbability[] }[], flags: YesNoProbability[], dept: ClassifyAnswer): Answers {
  const relevance = new Map(found.map((h, i) => [h.product.id, toRelevance(rel[i]?.results[0]?.probability ?? 0, rel[i]?.results[1]?.probability ?? 0)]));
  const flagged = {
    wantsCheap: flags[0]?.probability ?? 0,
    wantsPremium: flags[1]?.probability ?? 0,
    isGift: flags[2]?.probability ?? 0,
    wantsRating: flags[3]?.probability ?? 0,
  };
  const { sort, confidence } = deriveSort(flagged);
  // "any" is a real label, not a department: it means the query points at no one aisle.
  const named = dept.label !== "any" && dept.probability >= GATE.department;
  return {
    relevance,
    query: {
      department: named ? (dept.label as Category) : null,
      departmentConfidence: dept.probability,
      departmentScores: dept.scores,
      ...flagged,
      sort,
      sortConfidence: confidence,
      source: "model",
    },
  };
}

const CHEAP_WORDS = /\b(cheap|budget|affordable|inexpensive|under \$?\d+|low[- ]cost)\b/i;
const PREMIUM_WORDS = /\b(premium|high[- ]end|luxury|best|pro|professional|top[- ]tier)\b/i;
const GIFT_WORDS = /\b(gift|present|for (my|a|an) (\d+ ?(yr|year)[- ]old|kid|son|daughter|mom|dad|friend|wife|husband|coworker|niece|nephew))\b/i;
const RATING_WORDS = /\b(best[- ]rated|top[- ]rated|highly rated|reliable|well[- ]reviewed)\b/i;

/** Regex-only baseline, and the fallback when a call fails. */
export function heuristicJudgment(query: string): QueryJudgment {
  const flags = {
    wantsCheap: CHEAP_WORDS.test(query) ? 0.9 : 0.05,
    wantsPremium: PREMIUM_WORDS.test(query) ? 0.9 : 0.05,
    isGift: GIFT_WORDS.test(query) ? 0.9 : 0.05,
    wantsRating: RATING_WORDS.test(query) ? 0.9 : 0.05,
  };
  const { sort, confidence } = deriveSort(flags);
  return { department: null, departmentConfidence: 0, departmentScores: {}, ...flags, sort, sortConfidence: confidence, source: "heuristic" };
}

/* ---------------------------------------------------------------- ranking */

export interface Weights {
  lexical: number;
  relevance: number;
  department: number;
  price: number;
  gift: number;
  relevanceFloor: number;
  applySort: boolean;
}

export const DEFAULT_WEIGHTS: Weights = {
  // The lexical term breaks ties between candidates the model rates alike. It must not do
  // more than that: on "coffee hot on a hike" a coffee maker matches "coffee" and "hot"
  // word for word and takes lex 1.00, while the vacuum flask that answers the question
  // takes 0.53. That 0.47 gap has to stay smaller than the relevance gap it sits against.
  lexical: 0.1,
  relevance: 1.0,
  // A tie-breaker, not a lever. The department the query points at is not always the
  // catalog category the right product is filed under: "something to keep coffee hot on a
  // hike" classifies as outdoors 1.00 because of the hike, and vacuum flasks are filed
  // under kitchen, so at the original 0.12 every outdoors water bottle jumped the flasks
  // the model rated higher. The smallest separation the model draws between two seed
  // candidates is 0.98 vs 0.99, worth 0.028 of the spread below; stay under that.
  department: 0.02,
  price: 0.4,
  gift: 0.15,
  // "fit" alone contributes up to 0.25 to every candidate, so the floor sits above the
  // original's 0.3. At 0.4 a candidate has to clear about 0.2 on "right kind" to survive.
  relevanceFloor: 0.4,
  applySort: true,
};

export interface RankedItem {
  product: Product;
  lexNorm: number;
  relevance: RelevanceAnswer | null;
  base: number;
  belowFloor: boolean;
  bonuses: { department: number; price: number; gift: number };
}

export interface Ranking {
  items: RankedItem[];
  appliedSort: SortPreference;
  filters: { cheap: boolean; premium: boolean; gift: boolean; department: string | null };
}

const GIFTABLE = /\b(gift|ages? \d|kids?|children)\b/i;

/**
 * A yes-no probability saturates: the model separates a coffee maker (0.89) from a vacuum
 * flask (0.99) on "keep coffee hot on a hike" by 0.10, so a lexical term or a department
 * bonus of that size decides the top of the list instead of the model. Rank on the
 * log-odds, min-max normalised over the candidate set, which makes the last two points of
 * probability worth as much as the first eighty. Rows still show the raw probability.
 */
export function spreadRelevance(scores: number[]): number[] {
  const logit = (p: number) => Math.log(Math.min(Math.max(p, 1e-4), 1 - 1e-4) / (1 - Math.min(Math.max(p, 1e-4), 1 - 1e-4)));
  const l = scores.map(logit);
  const lo = Math.min(...l);
  const span = Math.max(...l) - lo;
  // Every candidate scored alike: nothing to spread, so let the other terms decide.
  return span > 1e-6 ? l.map((x) => (x - lo) / span) : l.map(() => 1);
}

/** Lexical norm + model relevance + department/price/gift bonuses, floor-gated then sorted. */
export function combine(hits: LexicalHit[], answers: Answers | null, w: Weights): Ranking {
  const q = answers?.query;
  const prices = hits.map((h) => h.product.price);
  const minP = Math.min(...prices, Infinity);
  const maxP = Math.max(...prices, -Infinity);
  const span = maxP > minP ? maxP - minP : 1;

  const deptActive = !!q && q.department !== null && q.departmentConfidence >= GATE.department;
  const cheap = !!q && q.wantsCheap >= GATE.flag;
  const premium = !!q && q.wantsPremium >= GATE.flag && !cheap;
  const gift = !!q && q.isGift >= GATE.flag;

  const spread = spreadRelevance(hits.map((h) => answers?.relevance.get(h.product.id)?.score ?? 0));

  const items: RankedItem[] = hits.map((h, i) => {
    const rel = answers?.relevance.get(h.product.id) ?? null;
    let base = answers ? w.lexical * h.norm + w.relevance * spread[i] : h.norm;
    const priceNorm = (h.product.price - minP) / span;
    const bonuses = { department: 0, price: 0, gift: 0 };
    // Scaled by relevance: the department the query points at is not always the catalog
    // category the right product is filed under, so the bonus never rescues a poor match.
    if (q && deptActive && h.product.category === q.department) bonuses.department = w.department * q.departmentConfidence * (rel?.score ?? 1);
    if (q && cheap) bonuses.price = w.price * (1 - priceNorm) * q.wantsCheap;
    if (q && premium) bonuses.price = w.price * priceNorm * q.wantsPremium;
    if (q && gift && GIFTABLE.test(h.product.description)) bonuses.gift = w.gift * q.isGift;
    base += bonuses.department + bonuses.price + bonuses.gift;
    const belowFloor = !!rel && rel.score < w.relevanceFloor;
    return { product: h.product, lexNorm: h.norm, relevance: rel, base, belowFloor, bonuses };
  });

  let appliedSort: SortPreference = "relevance";
  if (q && w.applySort && q.sort !== "relevance" && q.sortConfidence >= GATE.sort) appliedSort = q.sort;

  const byBase = (a: RankedItem, b: RankedItem) => b.base - a.base || a.product.id.localeCompare(b.product.id);
  // Sort inside relevance bands so an inferred price sort never lifts a poor match to the
  // top. Bands are 0.1 wide on the score the row shows, so a price sort can only reorder
  // rows whose printed scores round the same way — at 0.25 wide, 0.64 and 0.87 shared a
  // band and the column read as an arbitrary sort.
  const band = (i: RankedItem) => (i.relevance ? Math.round(i.relevance.score * 10) : 0);
  const bySort = (a: RankedItem, b: RankedItem) => {
    if (appliedSort === "relevance") return byBase(a, b);
    const d = band(b) - band(a);
    if (d) return d;
    if (appliedSort === "price_low") return a.product.price - b.product.price || byBase(a, b);
    if (appliedSort === "price_high") return b.product.price - a.product.price || byBase(a, b);
    return b.product.rating - a.product.rating || byBase(a, b);
  };

  const kept = items.filter((i) => !i.belowFloor).sort(bySort);
  const dropped = items.filter((i) => i.belowFloor).sort(byBase);
  return { items: kept.concat(dropped), appliedSort, filters: { cheap, premium, gift, department: deptActive && q ? q.department : null } };
}

export function lexicalOnly(hits: LexicalHit[]): Ranking {
  return combine(hits, null, DEFAULT_WEIGHTS);
}

/* ------------------------------------------------------------- latencies */

/** Rolling window of samples, for the p50/p95 in the metrics strip. */
export class LatencyStats {
  private samples: number[] = [];
  last = 0;
  count = 0;
  push(ms: number) {
    this.last = ms;
    this.count++;
    this.samples.push(ms);
    if (this.samples.length > 200) this.samples.shift();
  }
  percentile(p: number): number {
    if (!this.samples.length) return 0;
    const sorted = this.samples.slice().sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
  }
  get p50() {
    return this.percentile(50);
  }
  get p95() {
    return this.percentile(95);
  }
}
