#!/usr/bin/env node
// Sends the demo's real request bodies to the live API and prints what comes back, so the
// labels, statements and hints can be tuned against the original's acceptance table:
//   MS_API_KEY=sk-... node src/demos/launcher/smoke.mjs
// The pure-logic checks (calculator, fuzzy tie, time window) run first and need no key.

import assert from "node:assert/strict";
import { INDEX } from "./data.ts";
import {
  prefilter,
  rank,
  isReady,
  looksLikeSet,
  evaluate,
  parseWindow,
  fuzzyScore,
  targetBody,
  targetScores,
  readyBody,
  scopeBody,
  matchBody,
  matchCandidates,
  hasLocalRow,
  setMembers,
  GROUP_ID,
} from "./engine.ts";

const API = "https://api.milliseconds.ai/v1/decision-machine-1";
const KEY = process.env.MS_API_KEY;

// ---- pure logic, no network (ported from CalculatorTests / RankingTests) -------------------
{
  assert.equal(evaluate("15% of 240")?.formatted, "36");
  assert.equal(evaluate("2+3*4")?.formatted, "14");
  assert.equal(evaluate("(2+3)*4")?.formatted, "20");
  assert.equal(evaluate("sqrt(16)")?.formatted, "4");
  assert.equal(evaluate("200 * 10%")?.formatted, "20");
  assert.equal(evaluate("-2^2")?.formatted, "-4");
  assert.equal(evaluate("hello"), null);
  assert.equal(evaluate("240"), null);

  const w = parseWindow("links I visited in the past 24 hours");
  assert.equal(w?.sinceMinutes, 1440);
  assert.equal(w?.remainder, "links I visited");
  assert.equal(parseWindow("the pdf I just downloaded"), null);

  // The tie the model exists to break: fuzzy cannot separate the two Downloads PDFs.
  const pre = prefilter("the pdf I just downloaded", INDEX);
  const q3 = pre.candidates.find((c) => c.title.startsWith("Q3"));
  const invoice = pre.candidates.find((c) => c.title.startsWith("invoice"));
  assert.ok(q3 && invoice);
  assert.equal(
    fuzzyScore("the pdf I just downloaded", q3).toFixed(3),
    fuzzyScore("the pdf I just downloaded", invoice).toFixed(3),
  );
  // Without a judgment the list is pure fuzzy order and never empty.
  assert.ok(rank(pre, null).length > 2);
  assert.equal(isReady(rank(pre, null), null), false);
  assert.equal(looksLikeSet("dark", null), false);
  assert.equal(looksLikeSet("the files I downloaded in the last hour", pre.window), true);
  // The window drops the 70 h old duplicate before anything is sent.
  const links = prefilter("open devin ambassador links I visited in the past 24 hours", INDEX);
  assert.equal(links.candidates.filter((c) => c.title.startsWith("Introducing")).length, 1);
  assert.equal(links.windowOnly, false);
  // "everything from the past hour" describes nothing but the window, so no match call is made
  // and every dated row inside the window is a member.
  const bare = prefilter("everything from the past hour", INDEX);
  assert.equal(bare.windowOnly, true);
  const bareSet = setMembers(bare, { target: {}, match: {}, setProbability: 0.6, ready: 0.2 });
  assert.equal(bareSet.size, bare.candidates.length - 1); // every row but the web-search fallback

  // isReady: a certain target only rescues Enter on a finished query with an empty field behind it.
  const row = (id, target) => ({
    candidate: INDEX.find((c) => c.id === id) ?? { id, title: id, keywords: [] },
    fuzzy: 0,
    target,
    match: null,
    inSet: false,
    score: 0,
  });
  const readyOn = (q, top, second, ready) =>
    isReady([row(top[0], top[1]), row(second[0], second[1])], { target: {}, match: {}, setProbability: 0, ready }, q);
  // measured on the seed data, 2026-09-19
  assert.equal(readyOn("the pdf I just downloaded", ["file:~/Downloads/Q3-Roadmap-Review.pdf", 0.78], ["x", 0.1], 0.49), true);
  assert.equal(readyOn("dark", ["toggle:toggleDarkMode", 0.97], ["x", 0.03], 0.47), true);
  assert.equal(readyOn("da", ["toggle:toggleDarkMode", 0.75], ["shortcut:Daily Standup Note", 0.13], 0.35), false);
  assert.equal(readyOn("wifi", ["toggle:wifiOff", 0.61], ["toggle:wifiOn", 0.38], 0.57), false);
  // "sle": the model is sure, but the user is mid-word, so Enter stays unpromised.
  assert.equal(readyOn("sle", ["toggle:sleep", 0.91], ["toggle:showHiddenFiles", 0.04], 0.57), false);
  assert.equal(readyOn("sleep", ["toggle:sleep", 0.91], ["toggle:showHiddenFiles", 0.04], 0.57), true);
  console.log("pure logic: ok\n");
}

if (!KEY) {
  console.error("MS_API_KEY not set — skipping the live part.");
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(route, body) {
  for (let attempt = 0; ; attempt++) {
    const t0 = Date.now();
    const res = await fetch(`${API}/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (res.status === 429 && attempt < 4) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${route} ${res.status}: ${text.slice(0, 300)}`);
    return {
      data: JSON.parse(text),
      ms: Date.now() - t0,
      inference: Number(res.headers.get("x-inference-ms") ?? 0),
      tokens: Number(res.headers.get("x-input-tokens") ?? 0),
    };
  }
}

const QUERIES = [
  "dark",
  "wifi off",
  "wifi",
  "da", // ambiguous prefix: must NOT be ready
  "sle", // ambiguous prefix: must NOT be ready
  "sleep",
  "15% of 240",
  "the pdf I just downloaded",
  "hacker news",
  "open devin ambassador links I visited in the past 24 hours",
  "the files I downloaded in the last hour",
  "everything from the past hour",
];

let calls = 0;
let tokens = 0;
const wall = [];
const model = [];

for (const query of QUERIES) {
  const pre = prefilter(query, INDEX);
  const members = matchCandidates(pre);
  if (!hasLocalRow(pre)) {
    console.log(`\n── ${query}: no local candidate, no call`);
    continue;
  }
  const wantsSet = looksLikeSet(query, pre.window) && members.length >= 2;

  const t = targetBody(query, pre.candidates);
  const r = readyBody(query, pre.candidates);
  const jobs = [post("classify", t), post("yes-no", r)];
  if (wantsSet) {
    jobs.push(post("classify", scopeBody(query)));
    // A bare window query skips the match call: prefilter() already applied the window.
    if (!pre.windowOnly) jobs.push(post("yes-no", matchBody(query, pre.window, members)));
  }
  const [target, ready, scope, match] = await Promise.all(jobs);
  for (const a of [target, ready, scope, match]) {
    if (!a) continue;
    calls++;
    tokens += a.tokens;
    wall.push(a.ms);
    model.push(a.inference);
  }

  const matchProb = {};
  match?.data.results.forEach((res, i) => {
    if (members[i]) matchProb[members[i].id] = res.probability;
  });
  const judgment = {
    target: targetScores(target.data.scores, t.ids),
    match: matchProb,
    setProbability: scope ? (scope.data.scores.all ?? 0) : 0,
    ready: ready.data.results[0].probability,
  };
  const hits = rank(pre, judgment);
  const set = setMembers(pre, judgment);

  console.log(`\n── ${query}   (${pre.candidates.length} rows, ${jobs.length} calls)`);
  console.log(
    `   ready ${judgment.ready.toFixed(2)} · P(all) ${judgment.setProbability.toFixed(2)} · ` +
      `${isReady(hits, judgment, query) ? "ENTER READY" : "not ready"} · ${target.inference} ms model`,
  );
  for (const hit of hits.slice(0, 6)) {
    const pct = (hit.target === null ? "—" : `${Math.round(hit.target * 100)}%`).padStart(4);
    const mark = set.has(hit.candidate.id) ? "✓" : hit.candidate.id === GROUP_ID ? "▣" : " ";
    const m = hit.match === null ? "" : ` match ${hit.match.toFixed(2)}`;
    console.log(`   ${mark} ${pct}  ${hit.candidate.title}${m}`);
  }
  await sleep(700); // stay well under the shared 200 requests/minute
}

const p50 = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
console.log(
  `\n${calls} calls · ${tokens} input tokens · model p50 ${p50(model)} ms · round trip p50 ${p50(wall)} ms`,
);
