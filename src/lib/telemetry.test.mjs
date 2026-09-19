// Run: node --experimental-transform-types src/lib/telemetry.test.mjs
import assert from "node:assert/strict";
import { dm1 } from "./dm1.ts";
import { attemptFinished, attemptStarted, requestStarted, requestFinished, estimatedUSD, formatUSD, getTelemetry, median, metricHeader, subscribeTelemetry } from "./telemetry.ts";

globalThis.localStorage = { getItem: () => "test-key" };
const reply = (status, headers = {}) => new Response(JSON.stringify({ ok: status === 200 }), { status, headers });
const reported = { "x-input-tokens": "100", "x-inference-ms": "20" };
const replies = [
  reply(200, reported), reply(200), reply(503), new DOMException("Aborted", "AbortError"),
  reply(429, { "retry-after": "0.001" }), reply(200, reported),
];
globalThis.fetch = async (url) => {
  if (url === "https://console.milliseconds.ai/api/demo-test-key") return new Response(null, { status: 401 });
  const next = replies.shift();
  if (next instanceof Error) throw next;
  assert(next, "Every network attempt must have an expected response");
  return next;
};

assert.equal(metricHeader(new Headers(), "x-input-tokens"), null);
for (const value of ["", "-1", "NaN", "Infinity"]) assert.equal(metricHeader(new Headers({ t: value }), "t"), null);
assert.equal(metricHeader(new Headers({ t: "0" }), "t"), 0);
assert.equal(median([]), null);
assert.equal(median([4, 1, 3, 2]), 2.5);
assert.equal(estimatedUSD(1_000_000), 0.04);
assert.equal(formatUSD(estimatedUSD(1)), "<$0.000001");
assert.equal(formatUSD(estimatedUSD(349_999)), "$0.014000");

const first = await dm1("classify", { text: "test", labels: ["a"] });
assert.equal(first.meta.tokens, 100);
assert.equal(getTelemetry().succeeded, 1, "Requests completed before subscription remain visible");
let notifications = 0;
const unsubscribe = subscribeTelemetry(() => notifications++);
await dm1("classify", { text: "test", labels: ["a"] });
await assert.rejects(dm1("classify", { text: "test", labels: ["a"] }));
await assert.rejects(dm1("classify", { text: "test", labels: ["a"] }), { name: "AbortError" });
const retried = await dm1("classify", { text: "test", labels: ["a"] });
unsubscribe();

const s = getTelemetry();
assert.deepEqual({ pending: s.pending, succeeded: s.succeeded, failed: s.failed, cancelled: s.cancelled, attempts: s.attempts, retries: s.retries },
  { pending: 0, succeeded: 3, failed: 1, cancelled: 1, attempts: 6, retries: 1 });
assert.equal(s.tokens, 200);
assert.equal(s.unknownUsage, 4, "Unreported and interrupted usage stays explicitly unknown");
assert.equal(s.modelSamples, 2);
assert.equal(s.modelMs, 40);
assert.equal(s.elapsed.length, 3);
assert(s.elapsed.at(-1) > retried.meta.wallMs + 100, "Session request time includes queue and retry waits");
assert(notifications > 0);
assert.equal(replies.length, 0);

// Cancellation before transmission must not invent attempts or unknown billing.
let transmitted = 0;
globalThis.fetch = async (_url, init) => {
  init.signal?.throwIfAborted();
  transmitted++;
  return reply(200, reported);
};
const beforeAbort = getTelemetry();
const alreadyAborted = new AbortController();
alreadyAborted.abort();
await assert.rejects(dm1("classify", { text: "test" }, alreadyAborted.signal), { name: "AbortError" });
assert.equal(transmitted, 0);
assert.equal(getTelemetry().attempts, beforeAbort.attempts);
assert.equal(getTelemetry().unknownUsage, beforeAbort.unknownUsage);

const queued = new AbortController();
const queuedRequest = dm1("classify", { text: "test" }, queued.signal);
queued.abort();
await assert.rejects(queuedRequest, { name: "AbortError" });
assert.equal(transmitted, 0);
assert.equal(getTelemetry().attempts, beforeAbort.attempts);
assert.equal(getTelemetry().unknownUsage, beforeAbort.unknownUsage);

// Abort during backoff must settle promptly and must not count a phantom retry.
const retryController = new AbortController();
let responseSent;
const firstResponse = new Promise((resolve) => { responseSent = resolve; });
globalThis.fetch = async (_url, init) => {
  init.signal?.throwIfAborted();
  transmitted++;
  responseSent();
  return reply(429, { "retry-after": "8" });
};
const beforeRetry = getTelemetry();
const retryRequest = dm1("classify", { text: "test" }, retryController.signal);
await firstResponse;
await new Promise((resolve) => setTimeout(resolve, 10));
const abortStarted = performance.now();
retryController.abort();
await assert.rejects(retryRequest, { name: "AbortError" });
assert(performance.now() - abortStarted < 500, "Abort must interrupt the eight-second retry sleep");
assert.equal(transmitted, 1);
assert.equal(getTelemetry().attempts, beforeRetry.attempts + 1);
assert.equal(getTelemetry().retries, beforeRetry.retries);
assert.equal(getTelemetry().unknownUsage, beforeRetry.unknownUsage + 1);
assert.equal(getTelemetry().pending, 0);
console.log("telemetry: accounting, retries, preflight/queued/backoff cancellation, missing headers, cost precision, timing and late subscription passed");

// Provenance is an accounting boundary, including unknown public deliveries.
const baseline = getTelemetry();
const complete = (source, tokens, modelMs, generatedAt) => {
  requestStarted();
  attemptStarted(false);
  attemptFinished(tokens, source, generatedAt);
  requestFinished("succeeded", 8, modelMs, source);
};
complete("cache", 1000, 250, "2026-09-19T10:00:00Z");
let mixed = getTelemetry();
assert.equal(mixed.tokens, baseline.tokens, "Cache hits never create live tokens");
assert.equal(mixed.personalTokens, baseline.personalTokens);
assert.equal(mixed.modelMs, baseline.modelMs, "Recorded compute never becomes live compute");
assert.equal(mixed.modelSamples, baseline.modelSamples);
assert.equal(mixed.cachedTokens, 1000);
assert.equal(mixed.cachedModelMs, 250);
assert.equal(mixed.cachedModelSamples, 1);
assert.equal(mixed.cachedGeneratedAt, "2026-09-19T10:00:00.000Z");
assert.equal(mixed.elapsed.at(-1), 8, "Cached delivery records the current browser time");
complete("cache", null, null, "not-a-date");
complete("sponsored-live", 200, 30);
complete("personal-live", 300, 40);
mixed = getTelemetry();
assert.equal(mixed.tokens, baseline.tokens + 500);
assert.equal(mixed.personalTokens, baseline.personalTokens + 300);
assert.equal(mixed.sponsoredTokens, 200);
assert.equal(mixed.cachedUnknownUsage, 1);
assert.equal(mixed.unknownUsage, baseline.unknownUsage, "Missing recorded usage is not unknown new billing");
assert.equal(mixed.cachedGeneratedAt, "2026-09-19T10:00:00.000Z");
assert.equal(mixed.modelMs, baseline.modelMs + 70);
assert.equal(mixed.modelSamples, baseline.modelSamples + 2);
assert.equal(estimatedUSD(mixed.personalTokens - baseline.personalTokens), estimatedUSD(300));

// A public abort may leave a shared fill running, but cannot charge the visitor.
const beforePublicAbort = getTelemetry();
requestStarted();
attemptStarted(false);
attemptFinished(null, "example-unknown");
requestFinished("cancelled", 3, null, "example-unknown");
assert.equal(getTelemetry().personalUnknownUsage, beforePublicAbort.personalUnknownUsage);
assert.equal(getTelemetry().unknownUsage, beforePublicAbort.unknownUsage + 1);
assert.equal(getTelemetry().cancelled, beforePublicAbort.cancelled + 1);
assert.equal(getTelemetry().elapsed.length, beforePublicAbort.elapsed.length);

// Response metadata is retained even if cancellation interrupts its body.
requestStarted();
attemptStarted(false);
attemptFinished(42, "sponsored-live");
requestFinished("cancelled", 3, null, "sponsored-live");
assert.equal(getTelemetry().sponsoredTokens, 242);
assert.equal(getTelemetry().personalTokens, mixed.personalTokens);
complete("sponsored-live", null, null);
assert.equal(getTelemetry().sponsoredUnknownUsage, 1);
assert.equal(getTelemetry().personalUnknownUsage, mixed.personalUnknownUsage);

// A public retry followed by a hit does not reclassify earlier unknown usage as personal.
requestStarted();
attemptStarted(false);
attemptFinished(null, "example-unknown");
attemptStarted(true);
attemptFinished(1000, "cache", "2026-09-18T10:00:00Z");
requestFinished("succeeded", 10, 250, "cache");
assert.equal(getTelemetry().personalUnknownUsage, mixed.personalUnknownUsage);
assert.equal(getTelemetry().cachedTokens, 2000);
assert.equal(getTelemetry().cachedGeneratedAt, "2026-09-19T10:00:00.000Z");
assert.equal(getTelemetry().pending, 0);

// Client rejection before dispatch cannot invent any usage.
const beforeNoKey = getTelemetry();
globalThis.localStorage = { getItem: () => "" };
await assert.rejects(dm1("classify", { text: "my own custom text" }), { code: "no_key" });
assert.deepEqual(getTelemetry(), beforeNoKey);
console.log("telemetry: cached, sponsored, personal, mixed, unknown provenance, recorded timing and free cancellation passed");
