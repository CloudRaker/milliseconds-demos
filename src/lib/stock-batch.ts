import { dm1, type Result, type Route } from './dm1';

/** Stable requests for stock streams, independent of arrival timing or pause position. */
export function stockGroups(texts: readonly string[]): string[][] {
  const unique = [...new Set(texts)];
  const groups: string[][] = [];
  for (let i = 0; i < unique.length; i += 32) groups.push(unique.slice(i, i + 32));
  return groups;
}

export function stockPlan(texts: string[], stock: readonly string[]): { texts: string[]; positions: number[] }[] {
  const groups = stockGroups(stock);
  const index = new Map(groups.flatMap((group, n) => group.map(text => [text, n] as const)));
  // A mixed/custom input must keep its original complete request and use the personal-key path.
  if (texts.some(text => !index.has(text))) return [{ texts, positions: texts.map((_, i) => i) }];
  return [...new Set(texts.map(text => index.get(text)!))].map(n => ({
    texts: groups[n],
    positions: texts.map(text => groups[n].indexOf(text)),
  }));
}

/** Values remain genuine API results. Recorded usage includes every row of each full cohort. */
export async function stockBatch<T extends { results: unknown[] }>(
  route: Route,
  body: Record<string, unknown> & { texts: string[] },
  stock: readonly string[],
  signal?: AbortSignal,
): Promise<Result<T>> {
  const started = performance.now();
  const results: unknown[] = Array(body.texts.length);
  let tokens = 0;
  let inferenceMs = 0;
  for (const group of stockPlan(body.texts, stock)) {
    const response = await dm1<T>(route, { ...body, texts: group.texts }, signal);
    if (!Array.isArray(response.data.results) || response.data.results.length !== group.texts.length) {
      throw new Error('The model returned an incomplete stock batch. Retry the example.');
    }
    group.positions.forEach((position, i) => { if (position >= 0) results[i] = response.data.results[position]; });
    tokens += response.meta.tokens;
    inferenceMs += response.meta.inferenceMs;
  }
  return { data: { results } as T, meta: { tokens, inferenceMs, wallMs: Math.round(performance.now() - started) } };
}
