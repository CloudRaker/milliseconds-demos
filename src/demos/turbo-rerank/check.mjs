// Self-check for the seed data: corpus size, unique ids, every benchmark target present,
// and BM25 recall of the target inside the candidate window. No network.
import { BENCH_QUERIES, BY_ID, NO_ANSWER, PASSAGES, band, bm25, statementFor } from "./data.ts";

const t0 = performance.now();
const index = bm25();
console.log(`corpus ${PASSAGES.length} passages, index built in ${(performance.now() - t0).toFixed(0)} ms`);

const missing = BENCH_QUERIES.filter((q) => !BY_ID.has(q.target));
console.assert(missing.length === 0, `missing targets: ${missing.map((m) => m.target).join(", ")}`);

for (const k of [32, 50]) {
  let inWindow = 0;
  let top1 = 0;
  let ms = 0;
  for (const q of BENCH_QUERIES) {
    const s = performance.now();
    const hits = index.search(q.query, k);
    ms += performance.now() - s;
    const rank = hits.findIndex((h) => h.id === q.target);
    if (rank >= 0) inWindow++;
    if (rank === 0) top1++;
  }
  console.log(`k=${k}: BM25 top-1 ${top1}/${BENCH_QUERIES.length}, target inside window ${inWindow}/${BENCH_QUERIES.length}, ${(ms / BENCH_QUERIES.length).toFixed(2)} ms/query`);
}

const sample = index.search(BENCH_QUERIES[1].query, 3);
console.log("\nsample statement: " + statementFor(BENCH_QUERIES[1].query));
console.log("sample passage: " + BY_ID.get(sample[0].id).text.slice(0, 160));
// Band calibration against the 40-query run: these are the probabilities the correct #1 hit
// actually came back with. None of them may read as "off topic", and the no-answer banner must
// stay well clear of the 0.09 floor while still catching the 0.002 an unanswerable query returns.
const CORRECT_TOP1 = [0.09, 0.14, 0.15, 0.3, 0.49, 0.75, 0.81, 0.99];
const mislabelled = CORRECT_TOP1.filter((p) => band(p).label === "off topic");
console.assert(mislabelled.length === 0, `correct hits read as off topic: ${mislabelled.join(", ")}`);
console.assert(NO_ANSWER < 0.09 / 2, `NO_ANSWER ${NO_ANSWER} too close to the 0.09 correct-hit floor`);
console.assert(NO_ANSWER > 0.002 * 2, `NO_ANSWER ${NO_ANSWER} would not fire on an unanswerable query`);
console.log(`bands: ${CORRECT_TOP1.map((p) => `${p}=${band(p).label}`).join(", ")}`);

console.assert(missing.length === 0 && PASSAGES.length > 500, "seed data check failed");
console.log("\nseed data OK");
