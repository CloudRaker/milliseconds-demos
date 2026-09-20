import { API, REVISION, boundedBody, examples, error, type ExampleEnv } from './lib/example-store';
import { DETAIL_EDGE, IMAGE_MESSAGES, MAX_IMAGE_CHARS, imageProblem } from './lib/image';
export { ExampleStore } from './lib/example-store';

const ROUTES = new Set(["yes-no", "classify", "classify-tree", "rate", "answer", "entities", "extract", "verify"]);
const MAX_BODY = 96_000; // bytes of JSON: 32 texts of 2,000 chars plus labels
const MAX_TEXT = 6_000;
const MAX_TEXTS = 32;
/** One base64 image (5 MB decoded) on top of the JSON body. */
const MAX_REQUEST = MAX_BODY * 2 + MAX_IMAGE_CHARS;
const UPSTREAM_TIMEOUT_MS = 20_000;
const KEY = /^(?:sk-ms|test_sk|prod_sk)-[A-Za-z0-9_-]{20,}$/;

interface Env extends ExampleEnv {
  EXAMPLES?: DurableObjectNamespace;
  RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Service binding to the decision-machine Worker; optional so `wrangler dev` without it still works. */
  API?: { fetch(input: string | Request, init?: RequestInit): Promise<Response> };
}

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
const fail = (status: number, code: string, message: string, headers: HeadersInit = {}) =>
  json({ error: { code, message } }, status, headers);

/**
 * Bound the request: one image, or one text, or up to 32 texts, each capped, and the body under
 * MAX_BODY. The image never counts towards that budget; it has its own 5 MB limit.
 */
export function sanitize(route: string, body: unknown) {
  if (!ROUTES.has(route) || typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  const validText = (text: unknown) => typeof text === 'string' && text.length > 0 && text.length <= MAX_TEXT;
  const { image, ...rest } = input;
  if (Object.hasOwn(input, 'image')) {
    // An image replaces `texts` and may carry one optional text alongside it.
    if (imageProblem(image) || Object.hasOwn(input, 'texts')) return null;
    if (Object.hasOwn(input, 'text') && !validText(input.text)) return null;
    if (input.detail !== undefined && !Object.hasOwn(DETAIL_EDGE, String(input.detail))) return null;
  } else if (Object.hasOwn(input, 'text') === Object.hasOwn(input, 'texts')) {
    return null;
  } else if (Object.hasOwn(input, 'text')) {
    if (!validText(input.text)) return null;
  } else if (!Array.isArray(input.texts) || input.texts.length === 0 || input.texts.length > MAX_TEXTS || !input.texts.every(validText)) return null;
  if (new TextEncoder().encode(JSON.stringify(rest)).byteLength > MAX_BODY) return null;
  return input;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (url.pathname.startsWith('/api/examples/')) {
      if (request.method !== 'POST') return error(405, 'method_not_allowed', 'POST only.');
      const id = url.pathname.slice('/api/examples/'.length);
      if (url.search || !/^[a-z0-9-]+\/stock-v1\/[a-f0-9]{64}$/.test(id) || !Object.hasOwn(examples, id)) return error(404, 'not_found', 'Unknown example.');
      let text: string;
      try { text = await boundedBody(request, 256); }
      catch { return error(413, 'too_large', 'Example requests must contain only {}.'); }
      // Reject duplicate keys and all overrides, including ones a JSON parser could discard.
      if (!/^\s*\{\s*\}\s*$/.test(text)) return error(400, 'invalid_request', 'Example requests must contain only {}.');
      if (env.RATE_LIMITER && !(await env.RATE_LIMITER.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' })).success) return error(429, 'rate_limited', 'Too many example requests. Try again shortly.');
      const cacheKey = new Request(`https://demo.milliseconds.ai/__examples/${REVISION}/${id}`);
      const cache = (caches as unknown as { default: Cache }).default;
      const cached = await cache.match(cacheKey);
      if (cached) return new Response(cached.body, { headers: new Headers({ ...Object.fromEntries(cached.headers), 'cache-control': 'no-store', 'x-demo-source': 'cache' }) });
      if (!env.EXAMPLES) return error(503, 'examples_not_configured', 'Free examples are temporarily unavailable. Try again shortly.');
      const response = await env.EXAMPLES.get(env.EXAMPLES.idFromName('stock-examples')).fetch(new Request(`https://examples/${id}`));
      if (response.ok) {
        const headers = new Headers(response.headers);
        headers.set('cache-control', 'public, max-age=300');
        headers.set('x-demo-source', 'cache');
        ctx.waitUntil(cache.put(cacheKey, new Response(response.clone().body, { headers })));
      }
      return response;
    }
    if (url.pathname !== "/api/run") return fail(404, "not_found", "No such route.");
    if (request.method !== "POST") return fail(405, "method_not_allowed", "POST only.");
    const key = request.headers.get("x-ms-key")?.trim() ?? "";
    if (!key) return fail(401, "no_key", "Add your milliseconds.ai API key in the key panel to run the demos.");
    if (!KEY.test(key)) return fail(401, "invalid_key", "That does not look like a milliseconds.ai key (test_sk-… or prod_sk-…).");
    // A key that only looks right is not a gate: the body can be megabytes, so throttle per IP
    // before buffering it. A chunked request declares no length, so it is refused outright.
    if (env.RATE_LIMITER && !(await env.RATE_LIMITER.limit({ key: request.headers.get("cf-connecting-ip") ?? "unknown" })).success)
      return fail(429, "rate_limited", "Too many requests from this address. Try again shortly.");
    // A declared length is advisory: a chunked body declares none, and boundedBody caps the read.
    if (Number(request.headers.get("content-length") ?? 0) > MAX_REQUEST)
      return fail(413, "too_large", "Request too large for the demo.");

    let payload: { route?: unknown; body?: unknown };
    try {
      payload = JSON.parse(await boundedBody(request, MAX_REQUEST));
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid_json");
    } catch {
      return fail(400, "invalid_json", "Body must be JSON.");
    }
    const route = String(payload.route ?? "");
    // Name the image problem instead of hiding it behind the generic text message.
    if (payload.body && typeof payload.body === "object" && Object.hasOwn(payload.body, "image")) {
      const problem = imageProblem((payload.body as Record<string, unknown>).image);
      if (problem) return fail(400, problem, IMAGE_MESSAGES[problem]);
      if (Object.hasOwn(payload.body, "texts")) return fail(400, "image_with_texts", IMAGE_MESSAGES.image_with_texts);
    }
    const forward = sanitize(route, payload.body);
    if (!forward) return fail(400, "invalid_request", `Send { route, body } with one text or up to ${MAX_TEXTS} texts, each 1–${MAX_TEXT} characters. Your input was not changed.`);

    let upstream: Response;
    try {
      upstream = await (env.API ?? globalThis).fetch(`${API}/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(forward),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch {
      return fail(504, "upstream_timeout", "The model did not answer in time. Try again.");
    }
    if (upstream.status === 401 || upstream.status === 403)
      return fail(401, "key_rejected", "Your API key was rejected. Check it in the key panel.");
    if (upstream.status === 429)
      return fail(429, "rate_limited", "Your key's rate limit is busy. Retrying shortly.", {
        "retry-after": upstream.headers.get("retry-after") ?? "3",
      });
    if (upstream.status >= 500) return fail(503, "model_busy", "The model is busy. Try again in a moment.");
    const passthrough: Record<string, string> = { "x-demo-path": env.API ? "binding" : "public", "x-demo-source": "personal-live" };
    for (const name of ["x-input-chars", "x-input-tokens", "x-inference-ms"]) {
      const value = upstream.headers.get(name);
      if (value) passthrough[name] = value;
    }
    try { return json(JSON.parse(await boundedBody(upstream, 512_000)), upstream.status, passthrough); }
    catch { return fail(502, "invalid_response", "The service returned an unreadable response. Try again."); }
  },
};
