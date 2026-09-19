// The Worker owns every request in this finite catalog. Browser hashes only select entries.
export const EXAMPLE_VERSION = 'stock-v1';
export type ExampleRoute = 'yes-no' | 'classify' | 'classify-tree' | 'rate' | 'answer' | 'entities' | 'extract' | 'verify';
export interface StockExample {
  demo: string;
  scenario: string;
  route: ExampleRoute;
  body: Record<string, unknown>;
  /** Optional real API capture for a bounded state-dependent scenario, never a curated fixture. */
  recorded?: { data: unknown; tokens: number; modelMs: number; generatedAt: string };
  /** State-dependent traces cannot refresh individual decisions without invalidating later steps. */
  pinned?: boolean;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => canonical(item ?? null)).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function requestDigest(route: string, body: Record<string, unknown>): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical({ route, body })));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
