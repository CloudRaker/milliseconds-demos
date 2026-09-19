import { attemptFinished, attemptStarted, metricHeader, requestFinished, requestStarted, type DemoSource } from "./telemetry.ts";
import { stockRequestId } from './stock-client.ts';

// Stock requests resolve to immutable public IDs. Custom requests use the visitor's own key.
// The sponsor credential exists only on the Worker. One page-wide queue keeps a page under the free plan's
// 200 requests/minute: at most CONCURRENCY calls in flight and RATE calls per second. Batch with
// `texts` (up to 32) or `statements` (up to 32) instead of firing per item.

export type Route = "yes-no" | "classify" | "classify-tree" | "rate" | "answer" | "entities" | "extract" | "verify";

export interface Meta {
  /** Model processing time from x-inference-ms; original recorded time for cached responses. */
  inferenceMs: number;
  /** Input tokens billed for the call, from x-input-tokens. */
  tokens: number;
  /** Browser round trip, ms. */
  wallMs: number;
  source?: DemoSource;
  generatedAt?: string | null;
}
export interface Result<T> {
  data: T;
  meta: Meta;
}
export class Dm1Error extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const RATE = 3; // calls per second, page-wide (200 requests/minute on the free plan)
export const CONCURRENCY = 4;

/** Manually pasted keys persist; console-sourced test keys stay in this page only. */
export const KEY_STORAGE = "ms.apiKey";
export const KEY_EVENT = "ms:apikey";
export const KEY_SHAPE = /^(?:sk-ms|test_sk|prod_sk)-[A-Za-z0-9_-]{20,}$/;
const TEST_KEY_SHAPE = /^test_sk-[A-Za-z0-9_-]{20,}$/;
let pageKey: string | null = null;
let keyRevision = 0;
let automaticController: AbortController | undefined;
let initialConsoleKey: ReturnType<typeof connectInitialConsoleKey> | undefined;
export function getKey(): string {
  if (pageKey !== null) return pageKey;
  try {
    return localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}
export function setKey(key: string) {
  keyRevision++;
  automaticController?.abort();
  pageKey = key;
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* private mode: the key is not remembered past this page */
  }
  window.dispatchEvent(new CustomEvent(KEY_EVENT, { detail: { hasKey: Boolean(key) } }));
}
/** Explicitly replace any saved manual key so it cannot reappear after clearing this key. */
export function setConsoleKey(key: string) {
  if (!TEST_KEY_SHAPE.test(key)) throw new Dm1Error(502, "invalid_test_key", "The console did not return a test key. Try again.");
  setKey("");
  pageKey = key;
  window.dispatchEvent(new CustomEvent(KEY_EVENT, { detail: { hasKey: true } }));
}

export async function fetchConsoleTestKey(signal?: AbortSignal): Promise<{ key: string; organizationId: string; organizationName?: string }> {
  const response = await fetch("https://console.milliseconds.ai/api/demo-test-key", {
    method: "POST",
    credentials: "include",
    headers: { "X-Milliseconds-Demo": "1" },
    redirect: "error",
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
  if (response.status === 401) throw new Dm1Error(401, "sign_in_required", "Sign in to the console, then try Use my test key again.");
  if (response.status === 409) throw new Dm1Error(409, "organization_required", "Choose or create a workspace in the console, then try again.");
  if (!response.ok) throw new Dm1Error(response.status, "console_unavailable", "Could not get your test key. Try again or paste a key below.");
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || !("key" in data) || typeof data.key !== "string" || !TEST_KEY_SHAPE.test(data.key) || !("organizationId" in data) || typeof data.organizationId !== "string" || !data.organizationId) {
    throw new Dm1Error(502, "invalid_test_key", "The console did not return a test key. Try again.");
  }
  return { key: data.key, organizationId: data.organizationId, ...("organizationName" in data && typeof data.organizationName === "string" ? { organizationName: data.organizationName } : {}) };
}

async function connectInitialConsoleKey() {
  const revision = keyRevision;
  automaticController = new AbortController();
  try {
    const result = await fetchConsoleTestKey(automaticController.signal);
    // A manual key or Clear key action always wins over an in-flight automatic lookup.
    if (revision !== keyRevision) return null;
    setConsoleKey(result.key);
    return result;
  } catch (error) {
    if (revision !== keyRevision || (error instanceof Dm1Error && error.status === 401)) return null;
    throw error;
  }
}

/** One quiet automatic lookup per page; explicit reconnect remains available in the key panel. */
export function initializeConsoleKey() {
  return initialConsoleKey ??= connectInitialConsoleKey();
}

export const hasKey = () => Boolean(getKey());
/** Opens the header key panel; demos call it from their "add a key" prompt. */
export function openKeyPanel() {
  const panel = document.querySelector<HTMLDetailsElement>(".key-panel");
  if (panel) {
    panel.open = true;
    panel.querySelector<HTMLInputElement>("input")?.focus();
  }
}

let inFlight = 0;
let nextSlot = 0;
const waiters: Array<() => void> = [];

function release() {
  inFlight--;
  waiters.shift()?.();
}
async function acquire() {
  if (inFlight >= CONCURRENCY) await new Promise<void>((r) => waiters.push(r));
  inFlight++;
  const now = performance.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + 1000 / RATE;
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const abort = () => { clearTimeout(timer); reject(signal?.reason); };
  const timer = setTimeout(() => {
    signal?.removeEventListener("abort", abort);
    resolve();
  }, ms);
  signal?.addEventListener("abort", abort, { once: true });
});

/**
 * How many calls are currently sitting out a 429 backoff, page-wide. The retry happens
 * inside dm1(), so without this a rate-limited visitor sees nothing but a spinner for
 * several seconds. Subscribe to show a "rate limited, retrying" pill.
 */
let backingOff = 0;
const backoffListeners = new Set<(n: number) => void>();
export function onRateLimited(fn: (waiting: number) => void): () => void {
  backoffListeners.add(fn);
  return () => backoffListeners.delete(fn);
}
function setBackingOff(delta: number) {
  backingOff += delta;
  for (const fn of backoffListeners) fn(backingOff);
}

/** POST one call through the proxy. Retries 429 with backoff (3 tries), throws Dm1Error otherwise. */
export async function dm1<T = unknown>(route: Route, body: Record<string, unknown>, signal?: AbortSignal): Promise<Result<T>> {
  signal?.throwIfAborted();
  const exampleId = await stockRequestId(route, body);
  signal?.throwIfAborted();
  if (!exampleId) await initializeConsoleKey().catch(() => null);
  signal?.throwIfAborted();
  const key = exampleId ? '' : getKey();
  const requestKeyRevision = keyRevision;
  if (!exampleId && !key) {
    if (typeof document !== 'undefined') openKeyPanel();
    throw new Dm1Error(401, "no_key", "Use your API key for this input, or restore a supplied example to run for free. Your edits have been kept.");
  }
  const defaultSource: DemoSource = exampleId ? 'example-unknown' : 'personal-live';
  let source: DemoSource = defaultSource;
  const started = performance.now();
  requestStarted();
  try {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      await acquire();
      const t0 = performance.now();
      let res: Response;
      let dispatched = false;
      try {
        signal?.throwIfAborted();
        attemptStarted(attempt > 0);
        dispatched = true;
        res = await fetch(exampleId ? `/api/examples/${exampleId}` : "/api/run", {
          method: "POST",
          headers: { "content-type": "application/json", ...(exampleId ? {} : { "x-ms-key": key }) },
          body: exampleId ? '{}' : JSON.stringify({ route, body }),
          signal,
        });
      } catch (error) {
        if (dispatched) attemptFinished(null, defaultSource);
        throw error;
      } finally {
        release();
      }
      const tokens = metricHeader(res.headers, "x-input-tokens");
      const inferenceMs = metricHeader(res.headers, "x-inference-ms");
      const headerSource = res.headers.get('x-demo-source');
      source = exampleId ? (headerSource === 'cache' || headerSource === 'sponsored-live' ? headerSource : 'example-unknown') : 'personal-live';
      const generatedAt = res.headers.get('x-demo-generated-at');
      attemptFinished(tokens, source, generatedAt);
      if (res.status === 401 && !exampleId) {
        // Rejected key: forget it so the panel asks again instead of every demo failing quietly.
        const data = (await res.json()) as { error?: { code: string; message: string } };
        if (keyRevision === requestKeyRevision && getKey() === key) setKey("");
        throw new Dm1Error(401, data.error?.code ?? "key_rejected", data.error?.message ?? "API key rejected");
      }
      if (res.status === 429 && attempt < 3) {
        const retry = Number(res.headers.get("retry-after") ?? 2);
        setBackingOff(1);
        try {
          await sleep(Math.min(60000, Math.max(1, retry || 2) * 1000), signal);
        } finally {
          setBackingOff(-1);
        }
        continue;
      }
      const data = (await res.json()) as T & { error?: { code: string; message: string } };
      if (!res.ok) throw new Dm1Error(res.status, data.error?.code ?? "error", data.error?.message ?? res.statusText);
      if (source === 'example-unknown') throw new Dm1Error(502, 'unconfirmed_example', 'The example response did not include its source. Try again.');
      requestFinished("succeeded", performance.now() - started, inferenceMs, source);
      return {
        data,
        meta: {
          inferenceMs: inferenceMs ?? 0,
          tokens: tokens ?? 0,
          wallMs: Math.round(performance.now() - t0),
          source,
          generatedAt,
        },
      };
    }
  } catch (error) {
    requestFinished(signal?.aborted || (error instanceof Error && error.name === "AbortError") ? "cancelled" : "failed", performance.now() - started, null, source);
    throw error;
  }
}

export interface YesNoResult {
  statement: string;
  answer: boolean;
  probability: number;
}
export interface ClassifyResult {
  label: string;
  probability: number;
  confidence: number;
  scores: Record<string, number>;
}
export interface RateResult {
  score: number;
  level: number;
  probability: number;
  confidence: number;
  scores: number[];
}

/** Yes/no over one text and many statements in one call (up to 32). */
export async function yesNo(text: string, statements: string[], hints?: { when_true?: string; when_false?: string }, signal?: AbortSignal) {
  const r = await dm1<{ results: YesNoResult[] }>("yes-no", { text, statements, ...hints }, signal);
  return { results: r.data.results, meta: r.meta };
}

/** Classify one text. */
export async function classify(text: string, labels: string[] | Record<string, string>, signal?: AbortSignal) {
  const r = await dm1<ClassifyResult>("classify", { text, labels }, signal);
  return { result: r.data, meta: r.meta };
}

/** Classify many texts against one label set in one call (up to 32 texts). */
export async function classifyMany(texts: string[], labels: string[] | Record<string, string>, signal?: AbortSignal) {
  const r = await dm1<{ results: ClassifyResult[] }>("classify", { texts, labels }, signal);
  return { results: r.data.results, meta: r.meta };
}

/** Rate many texts on one scale in one call (up to 32 texts). */
export async function rateMany(texts: string[], scale: string[], signal?: AbortSignal) {
  const r = await dm1<{ results: RateResult[] }>("rate", { texts, scale }, signal);
  return { results: r.data.results, meta: r.meta };
}

/** Split a list into chunks of at most `size` (the API takes 32 texts per call). */
export function chunk<T>(xs: T[], size = 32): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
