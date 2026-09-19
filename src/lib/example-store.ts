import registry from '../generated/examples.json';
import type { StockExample } from './example-contract';

export const examples = registry as Record<string, StockExample & { pinned?: boolean }>;
export const API = 'https://api.milliseconds.ai/v1/decision-machine-1';
export const REVISION = 'dm1-2026-09-19-v1';
const DAY = 86_400_000;
const COOLDOWN = 30_000;
const MAX_RESPONSE = 512_000;
export interface ExampleEnv {
  PLAYGROUND_API_KEY?: string;
  EXAMPLE_DAILY_BUDGET?: string;
  API?: { fetch(input: string | Request, init?: RequestInit): Promise<Response> };
}
type Stored = { data: unknown; tokens: number; modelMs: number; generatedAt: string };
export const error = (status: number, code: string, message: string) => new Response(JSON.stringify({ error: { code, message } }), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(status === 429 ? { 'retry-after': '30' } : {}) },
});
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const probability = (value: unknown) => finite(value) && value >= 0 && value <= 1;
function validTree(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(validTree);
  if (object(value)) return Object.values(value).every(validTree);
  return value === null || typeof value === 'boolean' || typeof value === 'string';
}
/** Basic transport shape only. Demo-specific validators still assess source spans and business meaning. */
export function validResult(route: string, value: unknown): boolean {
  if (!object(value) || Object.hasOwn(value, 'error') || !validTree(value)) return false;
  if (Object.hasOwn(value, 'results')) return false;
  switch (route) {
    case 'yes-no': return typeof value.answer === 'boolean' && probability(value.probability);
    case 'classify': return typeof value.label === 'string' && probability(value.probability) && object(value.scores);
    case 'classify-tree': return Array.isArray(value.path) && value.path.length > 0 && value.path.every(item => typeof item === 'string') && typeof value.label === 'string' && probability(value.probability) && Array.isArray(value.levels);
    case 'rate': return finite(value.score) && Number.isInteger(value.level) && probability(value.confidence) && typeof value.label === 'string' && Array.isArray(value.scores) && value.scores.every(probability);
    case 'extract': return object(value.data);
    case 'verify': return typeof value.matches === 'boolean' && probability(value.probability) && Array.isArray(value.found) && value.found.every(item => typeof item === 'string');
    case 'entities': return Array.isArray(value.entities) && value.entities.every(item => object(item) && typeof item.text === 'string' && typeof item.type === 'string' && Number.isInteger(item.start) && Number.isInteger(item.end) && probability(item.probability));
    case 'answer': return value.answer === null || (typeof value.answer === 'string' && Number.isInteger(value.start) && Number.isInteger(value.end));
    default: return false;
  }
}
export function validResponse(example: Pick<StockExample, 'route' | 'body'>, data: unknown): boolean {
  const axes: number[] = [];
  if (Array.isArray(example.body.texts)) axes.push(example.body.texts.length);
  const inner = example.route === 'yes-no' ? example.body.statements : example.route === 'answer' ? example.body.questions : undefined;
  if (Array.isArray(inner)) axes.push(inner.length);
  if (axes.some(count => count < 1 || count > 32)) return false;
  function matches(value: unknown, depth: number): boolean {
    if (depth === axes.length) return validResult(example.route, value);
    return object(value) && !Object.hasOwn(value, 'error') && Array.isArray(value.results)
      && value.results.length === axes[depth] && value.results.every(item => matches(item, depth + 1));
  }
  return matches(data, 0);
}

const validStored = (example: StockExample, stored: Stored) => validResponse(example, stored.data) && finite(stored.tokens) && Number.isSafeInteger(stored.tokens) && stored.tokens >= 0 && finite(stored.modelMs) && stored.modelMs >= 0 && Number.isFinite(Date.parse(stored.generatedAt));
export function exampleResponse(id: string, stored: Stored, source: 'cache' | 'sponsored-live') {
  return new Response(JSON.stringify(stored.data), { headers: {
    'content-type': 'application/json', 'cache-control': 'no-store',
    'x-demo-source': source, 'x-demo-generated-at': stored.generatedAt, 'x-demo-example-id': id,
    'x-input-tokens': String(stored.tokens), 'x-inference-ms': String(stored.modelMs),
  } });
}
export async function boundedBody(request: Request | Response, max: number): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > max) { void reader.cancel(); throw new Error('too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** One globally named object owns all sponsored fills and their durable budget. */
export class ExampleStore {
  private fills = new Map<string, Promise<Response>>();
  constructor(private state: DurableObjectState, private env: ExampleEnv) {}
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const id = url.pathname.slice(1);
    if (request.method !== 'GET' || url.search || !Object.hasOwn(examples, id)) return error(404, 'not_found', 'Unknown example.');
    const example = examples[id];
    if (example.recorded && example.pinned) return validStored(example, example.recorded)
      ? exampleResponse(id, example.recorded, 'cache') : error(503, 'example_unavailable', 'This recorded example is unavailable.');
    const key = `${REVISION}:${id}`;
    const stored = await this.state.storage.get<Stored>(key) ?? example.recorded;
    if (stored && validStored(example, stored)) {
      if (Date.now() - Date.parse(stored.generatedAt) >= DAY) this.state.waitUntil(this.fill(id, key).then(() => {}));
      return exampleResponse(id, stored, 'cache');
    }
    return (await this.fill(id, key)).clone();
  }
  private fill(id: string, key: string): Promise<Response> {
    const pending = this.fills.get(key);
    if (pending) return pending;
    const promise = this.execute(id, key).catch(() => error(503, 'example_unavailable', 'This example is temporarily unavailable. Try again shortly.')).finally(() => this.fills.delete(key));
    this.fills.set(key, promise);
    return promise;
  }
  private async execute(id: string, key: string): Promise<Response> {
    if (!this.env.PLAYGROUND_API_KEY) return error(503, 'examples_not_configured', 'Free examples are temporarily unavailable. Try again shortly.');
    if (this.fills.size >= 4) return error(429, 'examples_busy', 'Free examples are busy. Try again shortly.');
    const now = Date.now();
    const reservation = await this.state.storage.transaction(async storage => {
      const retryAt = await storage.get<number>(`retry:${key}`) ?? 0;
      if (retryAt > now) return false;
      const day = Math.floor(now / DAY), minute = Math.floor(now / 60_000);
      const budget = await storage.get<{ day: number; count: number; minute: number; minuteCount: number }>('budget') ?? { day, count: 0, minute, minuteCount: 0 };
      if (budget.day !== day) { budget.day = day; budget.count = 0; }
      if (budget.minute !== minute) { budget.minute = minute; budget.minuteCount = 0; }
      const configured = Number(this.env.EXAMPLE_DAILY_BUDGET ?? 2000);
      const limit = Number.isSafeInteger(configured) && configured >= 0 ? configured : 2000;
      if (budget.count >= limit || budget.minuteCount >= 180) return false;
      budget.count++; budget.minuteCount++;
      await storage.put('budget', budget);
      await storage.put(`retry:${key}`, now + COOLDOWN);
      return true;
    });
    if (!reservation) return error(429, 'example_budget', 'Free examples are busy. Cached examples remain available; try this one later.');
    const example = examples[id];
    try {
      const response = await (this.env.API ?? globalThis).fetch(`${API}/${example.route}`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.env.PLAYGROUND_API_KEY}` },
        body: JSON.stringify(example.body), signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 429) return error(429, 'examples_busy', 'Live example inference is busy. Cached results remain available; retrying shortly.');
      if (!response.ok) return error(503, 'example_unavailable', 'This example is temporarily unavailable. Try again shortly.');
      const data: unknown = JSON.parse(await boundedBody(response, MAX_RESPONSE));
      const tokens = response.headers.get('x-input-tokens'), ms = response.headers.get('x-inference-ms');
      if (!validResponse(example, data) || !tokens?.trim() || !ms?.trim() || !Number.isSafeInteger(Number(tokens)) || Number(tokens) < 0 || !Number.isFinite(Number(ms)) || Number(ms) < 0) throw new Error('invalid_result');
      const stored = { data, tokens: Number(tokens), modelMs: Number(ms), generatedAt: new Date().toISOString() };
      await this.state.storage.put(key, stored);
      await this.state.storage.delete(`retry:${key}`);
      return exampleResponse(id, stored, 'sponsored-live');
    } catch { return error(503, 'example_unavailable', 'This example is temporarily unavailable. Try again shortly.'); }
  }
}
