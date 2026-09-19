import type { StockExample } from '../lib/example-contract.ts';
import { EXAMPLES as SEARCH_EXAMPLES, generateCatalog } from '../demos/instant-search/data.ts';
import { createIndex, search, searchRequestBodies } from '../demos/instant-search/engine.ts';
import { EXAMPLES as LAUNCHER_EXAMPLES, INDEX } from '../demos/launcher/data.ts';
import { hasLocalRow, looksLikeSet, matchBody, matchCandidates, prefilter, readyBody, scopeBody, targetBody } from '../demos/launcher/engine.ts';
import { ARG_SLOTS, COMMAND_TREE, STOCK_QUERIES, argumentRequest, benchmarkTexts, destructiveBody, paletteText, treeBody } from '../demos/nl-palette/data.ts';
import { BY_ID, EXAMPLES as RERANK_EXAMPLES, bm25, rerankBodies } from '../demos/turbo-rerank/data.ts';

const examples: StockExample[] = [];
function add(demo: string, scenario: string, route: StockExample['route'], body: StockExample['body']) {
  examples.push({ demo, scenario, route, body });
}

const products = generateCatalog();
const productIndex = createIndex(products);
const productsById = new Map(products.map(product => [product.id, product]));
SEARCH_EXAMPLES.forEach((query, index) => {
  const bodies = searchRequestBodies(query, search(productIndex, productsById, query));
  const scenario = `search-${index + 1}`;
  add('instant-search', scenario, 'yes-no', bodies.relevance);
  add('instant-search', scenario, 'yes-no', bodies.intent);
  add('instant-search', scenario, 'classify', bodies.department);
});

LAUNCHER_EXAMPLES.forEach((query, index) => {
  const pre = prefilter(query, INDEX);
  if (!hasLocalRow(pre)) return;
  const scenario = `command-${index + 1}`;
  const { text, labels } = targetBody(query, pre.candidates);
  add('launcher', scenario, 'classify', { text, labels });
  add('launcher', scenario, 'yes-no', readyBody(query, pre.candidates));
  const members = matchCandidates(pre);
  if (looksLikeSet(query, pre.window) && members.length >= 2) {
    add('launcher', scenario, 'classify', scopeBody(query));
    if (!pre.windowOnly) add('launcher', scenario, 'yes-no', matchBody(query, pre.window, members));
  }
});

STOCK_QUERIES.forEach((query, index) => {
  const scenario = `command-${index + 1}`;
  add('nl-palette', scenario, 'classify-tree', treeBody(query));
  add('nl-palette', scenario, 'yes-no', destructiveBody(query));
  for (const slot of ARG_SLOTS) {
    const { route, body } = argumentRequest(slot, [paletteText(query)]);
    add('nl-palette', scenario, route, body);
  }
});
const texts = benchmarkTexts();
add('nl-palette', 'benchmark', 'classify-tree', { texts, tree: COMMAND_TREE });
for (const slot of ARG_SLOTS) {
  const { route, body } = argumentRequest(slot, texts, true);
  add('nl-palette', 'benchmark', route, body);
}

RERANK_EXAMPLES.forEach(({ query }, index) => {
  for (const count of [32, 50]) {
    const rows = bm25().search(query, count).map(hit => BY_ID.get(hit.id)!);
    for (const body of rerankBodies(query, rows)) {
      add('turbo-rerank', `question-${index + 1}-${count}-candidates`, 'yes-no', body);
    }
  }
});

export default examples;
