import { requestDigest } from './example-contract.ts';

const manifests = new Map<string, Promise<Record<string, string>>>();
/** Exact local matching is for convenience. The server independently resolves immutable IDs. */
export async function stockRequestId(route: string, body: Record<string, unknown>): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  const demo = document.querySelector<HTMLElement>('[data-demo-slug]')?.dataset.demoSlug;
  if (!demo) return null;
  if (!manifests.has(demo)) {
    const pending = fetch(`/examples/${encodeURIComponent(demo)}.json`, { cache: 'no-cache' }).then(async response => {
      if (!response.ok) throw new Error('The example catalog is unavailable. Reload the page and try again.');
      const data = await response.json() as { requests?: Record<string, string> };
      if (!data.requests || typeof data.requests !== 'object') throw new Error('The example catalog could not be read. Reload and try again.');
      return data.requests;
    }).catch(error => { manifests.delete(demo); throw error; });
    manifests.set(demo, pending);
  }
  const entries = await manifests.get(demo)!;
  return entries[await requestDigest(route, body)] ?? null;
}
