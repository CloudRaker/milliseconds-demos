// Sends the demo's real request bodies for the five example queries and prints the
// top 5 of each column, so the statements and labels can be checked against the
// hand-labelled eval in the original experiment's README.
//
//   MS_API_KEY=sk-... node src/demos/instant-search/smoke.mjs ["another query" …]
//
// Runs the .ts sources through node's type stripping (node >= 22.18), so parseAnswers,
// the weights and the retriever here are byte-for-byte the ones the page runs.

import { generateCatalog, EXAMPLES, catalogFingerprint } from "./data.ts";
import { createIndex, search, candidateText, relevanceStatements, RELEVANCE_HINTS, INTENT_STATEMENTS, INTENT_HINTS, DEPARTMENTS, combine, lexicalOnly, parseAnswers, DEFAULT_WEIGHTS } from "./engine.ts";

const KEY = process.env.MS_API_KEY;
if (!KEY) throw new Error("set MS_API_KEY");
const API = "https://api.milliseconds.ai/v1/decision-machine-1";
const QUERIES = process.argv.slice(2).length ? process.argv.slice(2) : EXAMPLES;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One call, retrying 429 the way src/lib/dm1.ts does for the page. */
async function call(route, body) {
  for (let attempt = 0; ; attempt++) {
    const t0 = performance.now();
    const res = await fetch(`${API}/${route}`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 5) {
      const retry = Number(res.headers.get("retry-after") ?? 2) || 2;
      await sleep(retry * 1000 * (attempt + 1));
      continue;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(`${route} ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
    return {
      data,
      ms: Math.round(performance.now() - t0),
      inference: Number(res.headers.get("x-inference-ms") ?? 0),
      tokens: Number(res.headers.get("x-input-tokens") ?? 0),
    };
  }
}

const catalog = generateCatalog();
const index = createIndex(catalog);
const byId = new Map(catalog.map((p) => [p.id, p]));
console.log(`catalog ${catalog.length} products, fingerprint ${catalogFingerprint(catalog)}\n`);

const totals = { calls: 0, tokens: 0, rerankWall: [], rerankInference: [], group: [] };

for (const query of QUERIES) {
  const t0 = performance.now();
  const hits = search(index, byId, query);
  const retrieverMs = (performance.now() - t0).toFixed(2);
  // The page guards this too: dispatch() returns when the retriever finds nothing.
  if (!hits.length) {
    console.log(`\n=== "${query}"\n    no candidates, nothing to send`);
    continue;
  }

  // Sequential, not Promise.all: one query never needs three slots of the shared key at once.
  const groupStart = performance.now();
  const relevance = await call("yes-no", { texts: hits.map((h) => candidateText(h.product)), statements: relevanceStatements(query), ...RELEVANCE_HINTS });
  const flags = await call("yes-no", { text: query, statements: [...INTENT_STATEMENTS], ...INTENT_HINTS });
  const dept = await call("classify", { text: query, labels: DEPARTMENTS });
  const groupMs = Math.round(performance.now() - groupStart);
  totals.calls += 3;
  totals.tokens += relevance.tokens + flags.tokens + dept.tokens;
  totals.rerankWall.push(relevance.ms);
  totals.rerankInference.push(relevance.inference);
  totals.group.push(groupMs);

  const answers = parseAnswers(hits, relevance.data.results, flags.data.results, dept.data);
  const j = answers.query;

  const left = lexicalOnly(hits);
  const right = combine(hits, answers, DEFAULT_WEIGHTS);
  const leftPos = new Map(left.items.map((it, i) => [it.product.id, i]));

  console.log(`\n=== "${query}"`);
  console.log(`    retriever ${retrieverMs} ms · ${hits.length} candidates · 3 calls, ${relevance.tokens + flags.tokens + dept.tokens} input tokens`);
  console.log(`    department ${j.department ?? `(none: ${dept.data.label} ${pct(dept.data.probability)})`} · cheap ${pct(j.wantsCheap)} · premium ${pct(j.wantsPremium)} · gift ${pct(j.isGift)} · rated ${pct(j.wantsRating)} · sort ${right.appliedSort}`);
  console.log(`    re-rank call ${relevance.inference} ms model / ${relevance.ms} ms round trip · group to paint ${groupMs} ms (sequential)`);
  console.log("    LEXICAL ONLY".padEnd(56) + "RE-RANKED");
  for (let i = 0; i < 5; i++) {
    const l = left.items[i];
    const r = right.items[i];
    const from = r ? leftPos.get(r.product.id) : null;
    const move = r && from !== null && from !== i ? (from > i ? `+${from - i}` : `${from - i}`) : "  ";
    console.log(
      `    ${i + 1}. ${trim(l?.product.title, 44).padEnd(48)}${i + 1}. ${trim(r?.product.title, 40).padEnd(42)} ${r?.relevance ? r.relevance.score.toFixed(2) : "  - "} ${move}`,
    );
  }
  const buried = right.items.filter((i) => i.belowFloor).length;
  console.log(`    ${buried} of ${hits.length} pushed below the relevance floor (${DEFAULT_WEIGHTS.relevanceFloor})`);
}

const p50 = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
console.log(
  `\ntotal: ${totals.calls} calls, ${totals.tokens} input tokens · re-rank call p50 ${p50(totals.rerankInference)} ms model / ${p50(totals.rerankWall)} ms round trip · group p50 ${p50(totals.group)} ms`,
);

function pct(v) {
  return `${Math.round(v * 100)}%`;
}
function trim(s, n) {
  if (!s) return "-";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
