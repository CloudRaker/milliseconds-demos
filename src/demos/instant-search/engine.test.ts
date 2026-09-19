// Network-free checks, ported from the jev-instant-search experiment's catalog/retriever/
// rank/sequence suites and moved from vitest to node:test, plus the two cases this port
// needs of its own: the new parseAnswers and the sort derivation.
//
//   node --test "src/demos/**/*.test.ts"

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CATALOG_SIZE, CATEGORIES, catalogFingerprint, generateCatalog, type Category, type Product } from "./data.ts";
import {
  combine,
  createIndex,
  DEFAULT_WEIGHTS,
  DEPARTMENTS,
  deriveSort,
  GATE,
  LatencyStats,
  lexicalOnly,
  MAX_PER_TYPE,
  parseAnswers,
  processTerm,
  search,
  stem,
  toRelevance,
  TOP_K,
  type Answers,
  type LexicalHit,
  type QueryJudgment,
  type RelevanceAnswer,
} from "./engine.ts";

/* ------------------------------------------------------------------ catalog */

describe("catalog", () => {
  const a = generateCatalog();

  it("is deterministic for the same seed and changes with another", () => {
    assert.equal(a.length, CATALOG_SIZE);
    assert.equal(catalogFingerprint(a), catalogFingerprint(generateCatalog()));
    assert.notEqual(catalogFingerprint(generateCatalog(CATALOG_SIZE, 1)), catalogFingerprint(a));
  });

  it("has unique ids, valid categories, and sane prices/ratings", () => {
    assert.equal(new Set(a.map((p) => p.id)).size, a.length);
    for (const p of a) {
      assert.ok(CATEGORIES.includes(p.category));
      assert.ok(p.price > 0);
      assert.ok(p.rating >= 1 && p.rating <= 5);
      assert.ok(p.description.length > 20);
    }
  });

  it("covers every category with hundreds of products", () => {
    for (const c of CATEGORIES) assert.ok(a.filter((p) => p.category === c).length > 500);
  });
});

/* ---------------------------------------------------------------- retriever */

describe("retriever", () => {
  const catalog = generateCatalog();
  const index = createIndex(catalog);
  const byId = new Map(catalog.map((p) => [p.id, p]));

  it("returns at most TOP_K hits, normalized to the top score", () => {
    const found = search(index, byId, "headphones");
    assert.equal(found.length, TOP_K);
    assert.equal(found[0].norm, 1);
    for (let i = 1; i < found.length; i++) {
      assert.ok(found[i].score <= found[i - 1].score);
      assert.ok(found[i].norm > 0 && found[i].norm <= 1);
    }
  });

  it("returns nothing for an empty query", () => {
    assert.deepEqual(search(index, byId, ""), []);
    assert.deepEqual(search(index, byId, "   "), []);
  });

  it("matches prefixes while typing", () => {
    const found = search(index, byId, "keyb");
    assert.ok(found.length > 0);
    assert.ok(found.slice(0, 5).every((h) => /keyboard/i.test(h.product.title)));
  });

  it("stems, drops stopwords and caps one product type", () => {
    assert.equal(stem("hiking"), stem("hike"));
    assert.equal(processTerm("the"), null);
    const found = search(index, byId, "something to keep coffee hot on a hike");
    const perType = new Map<string, number>();
    for (const h of found) perType.set(h.product.type, (perType.get(h.product.type) ?? 0) + 1);
    assert.ok(Math.max(...perType.values()) <= MAX_PER_TYPE);
    assert.ok(perType.size >= 3);
    assert.ok(found.some((h) => h.product.type === "Vacuum Bottle"));
  });

  it("is deterministic and inside a keystroke budget", () => {
    const q = "gift for a 6 yr old who likes space";
    const ids = () => search(index, byId, q).map((h) => h.product.id);
    assert.deepEqual(ids(), ids());
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) search(index, byId, "cheap headphones that dont leak sound");
    assert.ok((performance.now() - t0) / 20 < 25);
  });
});

/* -------------------------------------------------------------------- rank */

function product(id: string, price: number, rating: number, description = "A product.", category: Category = "electronics"): Product {
  return { id, title: `Item ${id}`, description, category, type: "Thing", attributes: {}, price, rating, reviews: 10 };
}
function hit(p: Product, norm: number): LexicalHit {
  return { product: p, score: norm * 10, norm };
}
function rel(score: number): RelevanceAnswer {
  return { kind: score, fit: score, score };
}
const A = product("a", 10, 4.0);
const B = product("b", 50, 4.8, "Great gift for kids ages 6+.");
const C = product("c", 200, 3.2);
const hits = [hit(A, 1), hit(B, 0.6), hit(C, 0.3)];

const NEUTRAL: QueryJudgment = {
  department: null,
  departmentConfidence: 0,
  departmentScores: {},
  wantsCheap: 0.05,
  wantsPremium: 0.05,
  isGift: 0.05,
  wantsRating: 0.05,
  sort: "relevance",
  sortConfidence: 0.95,
  source: "model",
};
function answers(relevance: Record<string, number>, q: Partial<QueryJudgment> = {}): Answers {
  return { relevance: new Map(Object.entries(relevance).map(([id, s]) => [id, rel(s)])), query: { ...NEUTRAL, ...q } };
}
const ids = (r: { items: { product: Product }[] }) => r.items.map((i) => i.product.id);

describe("lexicalOnly", () => {
  it("orders by lexical score with no relevance data", () => {
    const r = lexicalOnly(hits);
    assert.deepEqual(ids(r), ["a", "b", "c"]);
    assert.equal(r.items[0].relevance, null);
    assert.equal(r.appliedSort, "relevance");
  });
});

describe("combine", () => {
  it("lets model relevance override lexical order", () => {
    assert.deepEqual(ids(combine(hits, answers({ a: 0.25, b: 0.5, c: 1 }), DEFAULT_WEIGHTS)), ["c", "b", "a"]);
  });

  it("zero relevance weight restores lexical order", () => {
    const r = combine(hits, answers({ a: 0.25, b: 0.5, c: 1 }), { ...DEFAULT_WEIGHTS, relevance: 0, relevanceFloor: 0 });
    assert.deepEqual(ids(r), ["a", "b", "c"]);
  });

  it("pushes items below the relevance floor to the bottom", () => {
    const r = combine(hits, answers({ a: 0, b: 0.75, c: 0.75 }), DEFAULT_WEIGHTS);
    assert.equal(r.items.at(-1)!.product.id, "a");
    assert.equal(r.items.at(-1)!.belowFloor, true);
    assert.equal(r.items[0].belowFloor, false);
  });

  it("applies cheap and premium preference only above the flag gate", () => {
    const eq = { a: 0.75, b: 0.75, c: 0.75 };
    const on = combine(hits, answers(eq, { wantsCheap: GATE.flag + 0.1 }), { ...DEFAULT_WEIGHTS, lexical: 0 });
    assert.equal(on.filters.cheap, true);
    assert.equal(on.items[0].product.id, "a");
    const off = combine(hits, answers(eq, { wantsCheap: GATE.flag - 0.1 }), DEFAULT_WEIGHTS);
    assert.equal(off.filters.cheap, false);
    assert.ok(off.items.every((i) => i.bonuses.price === 0));
    const up = combine(hits, answers(eq, { wantsPremium: 0.95 }), { ...DEFAULT_WEIGHTS, lexical: 0 });
    assert.equal(up.items[0].product.id, "c");
  });

  it("applies a gift bonus to giftable descriptions", () => {
    const r = combine(hits, answers({ a: 0.75, b: 0.75, c: 0.75 }, { isGift: 0.9 }), { ...DEFAULT_WEIGHTS, lexical: 0 });
    assert.equal(r.filters.gift, true);
    assert.equal(r.items[0].product.id, "b");
    assert.ok(r.items[0].bonuses.gift > 0);
  });

  it("applies the department bonus only when the department is confident", () => {
    const kitchen = product("k", 30, 4, "A product.", "kitchen");
    const mixed = [hit(A, 0.5), hit(kitchen, 0.5)];
    const eq = { a: 0.75, k: 0.75 };
    const yes = combine(mixed, answers(eq, { department: "kitchen", departmentConfidence: 0.8 }), DEFAULT_WEIGHTS);
    assert.equal(yes.items[0].product.id, "k");
    assert.equal(yes.filters.department, "kitchen");
    const low = combine(mixed, answers(eq, { department: "kitchen", departmentConfidence: 0.2 }), DEFAULT_WEIGHTS);
    assert.equal(low.filters.department, null);
  });

  it("applies inferred sort only above the sort gate and only when enabled", () => {
    const eq = { a: 0.75, b: 0.75, c: 0.75 };
    const byPrice = combine(hits, answers(eq, { sort: "price_high", sortConfidence: 0.8 }), DEFAULT_WEIGHTS);
    assert.equal(byPrice.appliedSort, "price_high");
    assert.deepEqual(ids(byPrice), ["c", "b", "a"]);
    assert.deepEqual(ids(combine(hits, answers(eq, { sort: "rating", sortConfidence: 0.8 }), DEFAULT_WEIGHTS)), ["b", "a", "c"]);
    assert.equal(combine(hits, answers(eq, { sort: "price_high", sortConfidence: GATE.sort - 0.1 }), DEFAULT_WEIGHTS).appliedSort, "relevance");
    assert.equal(combine(hits, answers(eq, { sort: "price_high", sortConfidence: 0.9 }), { ...DEFAULT_WEIGHTS, applySort: false }).appliedSort, "relevance");
  });

  it("sorts within relevance bands, and sort never resurrects a below-floor item", () => {
    const banded = combine(hits, answers({ a: 0.55, b: 0.97, c: 0.9 }, { sort: "price_low", sortConfidence: 0.9 }), DEFAULT_WEIGHTS);
    assert.deepEqual(ids(banded), ["b", "c", "a"]);
    const floored = combine(hits, answers({ a: 1, b: 1, c: 0 }, { sort: "price_high", sortConfidence: 0.9 }), DEFAULT_WEIGHTS);
    assert.deepEqual(ids(floored), ["b", "a", "c"]);
  });

  // The demo's flagship chip, in miniature. a = the coffee maker: matches "coffee" and
  // "hot" word for word (lex 1.00) but only 0.89 relevant. b = the vacuum flask that
  // actually answers it: lex 0.53, relevance 0.99. Ranking on the raw probability put a
  // first, because 0.25·(1.00 − 0.53) beats a 0.10 gap in a saturated probability.
  it("keeps a saturated relevance gap ahead of a full lexical advantage", () => {
    const coffee = product("a", 92, 4.2);
    const flask = product("b", 31, 4.6);
    const near = [hit(coffee, 1.0), hit(flask, 0.53), hit(product("c", 20, 4.0), 0.2)];
    const r = combine(near, answers({ a: 0.89, b: 0.99, c: 0.05 }), DEFAULT_WEIGHTS);
    assert.deepEqual(ids(r), ["b", "a", "c"]);
  });

  // Same shape, but now the near-tie is 0.98 vs 0.99 and the 0.98 sits in the department
  // /classify picked. At the original 0.12 the bonus overturned the model's own order.
  it("keeps the department bonus below the smallest relevance gap the model draws", () => {
    const flask = product("a", 31, 4.6, "A product.", "kitchen");
    const bottle = product("b", 12, 4.4, "A product.", "outdoors");
    const near = [hit(flask, 0.53), hit(bottle, 0.55), hit(product("c", 20, 4.0), 0.2)];
    const q = { department: "outdoors" as Category, departmentConfidence: 1 };
    assert.deepEqual(ids(combine(near, answers({ a: 0.99, b: 0.98, c: 0.05 }, q), DEFAULT_WEIGHTS)), ["a", "b", "c"]);
  });

  it("is deterministic on ties", () => {
    const tie = [hit(A, 0.5), hit(B, 0.5), hit(C, 0.5)];
    assert.deepEqual(ids(combine(tie, answers({ a: 0.75, b: 0.75, c: 0.75 }), DEFAULT_WEIGHTS)), ["a", "b", "c"]);
  });
});

/* -------------------------------------------------------- derivation, parse */

describe("deriveSort", () => {
  const flags = (o: Partial<Record<"wantsCheap" | "wantsPremium" | "isGift" | "wantsRating", number>> = {}) => ({
    wantsCheap: 0.05,
    wantsPremium: 0.05,
    isGift: 0.05,
    wantsRating: 0.05,
    ...o,
  });

  it("puts rating first, then cheap, then premium, each behind its gate", () => {
    assert.equal(deriveSort(flags({ wantsRating: GATE.sort, wantsCheap: 0.99 })).sort, "rating");
    assert.equal(deriveSort(flags({ wantsRating: GATE.sort - 0.01, wantsCheap: GATE.flag })).sort, "price_low");
    assert.equal(deriveSort(flags({ wantsCheap: GATE.flag - 0.01, wantsPremium: GATE.flag })).sort, "price_high");
    assert.equal(deriveSort(flags({ wantsPremium: GATE.flag - 0.01 })).sort, "relevance");
    assert.equal(deriveSort(flags({ wantsCheap: 0.9 })).confidence, 0.9);
  });
});

describe("toRelevance", () => {
  it("weights 'right kind' over the near-saturated 'does everything asked'", () => {
    // Measured shape: fit stays 0.95-1.00 for every candidate, kind does the separating.
    const bad = toRelevance(0.07, 1.0);
    assert.ok(bad.score < DEFAULT_WEIGHTS.relevanceFloor, `a plain mean would have scored ${bad.score}`);
    assert.ok(toRelevance(0.99, 1.0).score > 0.9);
    assert.equal(bad.kind, 0.07);
    assert.equal(bad.fit, 1.0);
  });
});

describe("parseAnswers", () => {
  const found = [hit(A, 1), hit(B, 0.6), hit(C, 0.3)];
  const relResults = [
    { results: [{ probability: 0.9 }, { probability: 1 }] },
    { results: [{ probability: 0.5 }, { probability: 1 }] },
    { results: [{ probability: 0.1 }, { probability: 1 }] },
  ];
  const flagResults = [{ probability: 0.8 }, { probability: 0.02 }, { probability: 0.03 }, { probability: 0.04 }];

  it("maps rel.results[i] onto found[i].product.id", () => {
    const parsed = parseAnswers(found, relResults, flagResults, { label: "electronics", probability: 0.9, scores: { electronics: 0.9 } });
    assert.deepEqual([...parsed.relevance.keys()], ["a", "b", "c"]);
    assert.equal(parsed.relevance.get("a")!.kind, 0.9);
    assert.equal(parsed.relevance.get("c")!.kind, 0.1);
    assert.equal(parsed.relevance.get("a")!.score, toRelevance(0.9, 1).score);
    assert.equal(parsed.query.wantsCheap, 0.8);
    assert.equal(parsed.query.sort, "price_low");
    assert.equal(parsed.query.department, "electronics");
  });

  it("treats the 'any' label and a low-confidence department as no department", () => {
    assert.ok("any" in DEPARTMENTS);
    const any = parseAnswers(found, relResults, flagResults, { label: "any", probability: 0.95, scores: {} });
    assert.equal(any.query.department, null);
    assert.equal(any.query.departmentConfidence, 0.95);
    const unsure = parseAnswers(found, relResults, flagResults, { label: "outdoors", probability: GATE.department - 0.01, scores: {} });
    assert.equal(unsure.query.department, null);
  });

  it("survives a short or missing response without throwing", () => {
    const parsed = parseAnswers(found, [], [], { label: "any", probability: 0, scores: {} });
    assert.equal(parsed.relevance.get("a")!.score, 0);
    assert.equal(parsed.query.sort, "relevance");
  });
});

/* --------------------------------------------------------------- latencies */

describe("LatencyStats", () => {
  it("reports last, p50 and p95 over its samples", () => {
    const s = new LatencyStats();
    assert.equal(s.p50, 0);
    for (let i = 1; i <= 100; i++) s.push(i);
    assert.equal(s.last, 100);
    assert.equal(s.count, 100);
    assert.equal(s.p50, 50);
    assert.equal(s.p95, 95);
  });
});
