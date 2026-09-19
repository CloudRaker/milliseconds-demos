// Sends the demo's real request bodies to the live API and prints what comes back.
//   MS_API_KEY=sk-... node src/demos/turbo-rerank/smoke.mjs [queryCount] [candidates]
// Same shape as the island: BM25 top-K candidates, chunks of 32, one POST /yes-no per chunk
// with texts = the raw passages and one statement carrying the query.
import { BENCH_QUERIES, BY_ID, bm25, hints, statementFor } from "./data.ts";

const KEY = process.env.MS_API_KEY;
if (!KEY) throw new Error("set MS_API_KEY");
const COUNT = Number(process.argv[2] ?? 10);
const K = Number(process.argv[3] ?? 32);
const URL = "https://api.milliseconds.ai/v1/decision-machine-1/yes-no";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function yesNo(texts, statement) {
  for (let attempt = 0; ; attempt++) {
    const t0 = performance.now();
    const res = await fetch(URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ texts, statement, ...hints }),
    });
    if (res.status === 429 && attempt < 3) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    const body = await res.json();
    if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 300)}`);
    return {
      results: body.results,
      inferenceMs: Number(res.headers.get("x-inference-ms") ?? 0),
      tokens: Number(res.headers.get("x-input-tokens") ?? 0),
      wallMs: Math.round(performance.now() - t0),
    };
  }
}

const index = bm25();
const queries = BENCH_QUERIES.slice(0, COUNT);
let bm25Top1 = 0;
let rerankTop1 = 0;
let bm25Top5 = 0;
let rerankTop5 = 0;
let bm25Mrr = 0;
let rerankMrr = 0;
let tokens = 0;
let calls = 0;
const wall = [];

for (const q of queries) {
  const candidates = index.search(q.query, K).map((h) => BY_ID.get(h.id));
  const statement = statementFor(q.query);
  const probs = [];
  let ms = 0;
  for (let i = 0; i < candidates.length; i += 32) {
    const batch = candidates.slice(i, i + 32);
    const r = await yesNo(batch.map((p) => p.text), statement);
    probs.push(...r.results.map((x) => x.probability));
    tokens += r.tokens;
    calls++;
    ms = Math.max(ms, r.wallMs);
    wall.push(r.wallMs);
  }
  const rows = candidates.map((p, i) => ({ id: p.id, title: p.title, bm25Rank: i + 1, p: probs[i] }));
  rows.sort((a, b) => b.p - a.p || a.bm25Rank - b.bm25Rank);

  const before = candidates.findIndex((p) => p.id === q.target) + 1;
  const after = rows.findIndex((x) => x.id === q.target) + 1;
  if (before === 1) bm25Top1++;
  if (after === 1) rerankTop1++;
  if (before && before <= 5) bm25Top5++;
  if (after && after <= 5) rerankTop5++;
  bm25Mrr += before ? 1 / before : 0;
  rerankMrr += after ? 1 / after : 0;
  const answerExists = Math.max(...probs);

  console.log(
    `${after === 1 ? "OK  " : after === 0 ? "MISS" : "~   "} BM25 #${before || "-"} -> #${after || "-"}  ${ms} ms  ` +
      `top ${rows[0].id} ${(rows[0].p * 100).toFixed(0)}%  P(answer) ${(answerExists * 100).toFixed(0)}%  | ${q.query}${q.paraphrase ? " (paraphrase)" : ""}`,
  );
}

const sorted = [...wall].sort((a, b) => a - b);
const pct = (n) => `${((n / queries.length) * 100).toFixed(0)}%`;
console.log(
  `\n${queries.length} queries, ${K} candidates each, ${calls} calls` +
    `\ntop-1  BM25 ${bm25Top1}/${queries.length} (${pct(bm25Top1)}) -> rerank ${rerankTop1}/${queries.length} (${pct(rerankTop1)})` +
    `\ntop-5  BM25 ${bm25Top5}/${queries.length} (${pct(bm25Top5)}) -> rerank ${rerankTop5}/${queries.length} (${pct(rerankTop5)})` +
    `\nMRR    BM25 ${(bm25Mrr / queries.length).toFixed(2)} -> rerank ${(rerankMrr / queries.length).toFixed(2)}` +
    `\nround trip p50 ${sorted[Math.floor(sorted.length / 2)]} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)]} ms, ${tokens.toLocaleString()} input tokens`,
);
