# milliseconds.ai demos

Twenty-six interactive examples of decision-machine-1 at [demo.milliseconds.ai](https://demo.milliseconds.ai). Each demo leads with a capability, a short instruction, and a working example. The original twenty include adaptations inspired by [dabit3](https://github.com/dabit3/jev-experiments); the six business workflows are original demos.

## Run and deploy

```sh
pnpm install
pnpm dev              # Astro at localhost:4324; API proxy is not available here
pnpm preview          # build + Wrangler at localhost:8787, with the API proxy
pnpm build
pnpm exec tsc --noEmit
node --experimental-transform-types src/lib/telemetry.test.mjs
node --experimental-transform-types src/lib/stock-client-check.mjs
node src/lib/worker-stock-check.mjs
CLOUDFLARE_ACCOUNT_ID=<account> pnpm run deploy   # build + deploy the production demo Worker
```

Static Astro pages contain React demo islands. `src/worker.ts` proxies `POST /api/run` to the API through the production service binding, with a public-API fallback for local development.

Supplied examples run for free without a key. The browser matches the complete request against a generated per-demo manifest and sends only its immutable ID to `POST /api/examples/<demo>/stock-v1/<digest>` with `{}`. The Worker independently resolves the registered payload; caller overrides are rejected. A server-only playground credential sponsors cache misses. One Durable Object deduplicates fills, stores validated responses, and enforces global budgets; edge caches handle repeated delivery. App Pilot uses pinned real recordings so its multi-step traces remain consistent. Swarm and Tower use bounded stock scenes.

Custom input requires the visitor’s own key and sends it only to `/api/run` in `x-ms-key`. On each page load, demos automatically call the console’s `/api/demo-test-key` endpoint with the signed-in console session. Custom requests wait for this initial lookup. The header’s **Use my test key** button retries the connection. Signed-in navigation shows **Console** instead of Login and Sign up. The returned test key stays in page memory only and replaces any saved manual key. Clear it after signing out or changing workspaces, then reconnect. The automatic lookup stays quiet for signed-out visitors; an explicit retry offers a sign-in link. a visitor without a workspace gets a console link. Production keys returned by this endpoint are rejected. Manually pasted `test_sk-`, `prod_sk-`, and legacy `sk-ms-` keys retain the existing `ms.apiKey` localStorage workflow. No key is placed in a URL, log, analytics event, or code sample. A rejected key is removed and never falls back to the sponsor credential. Stock calls remain free when a personal key is saved. Changes to source text, labels, schemas, questions and model options all count as custom input. The key prompt preserves edits.

After deployment, `node scripts/warm-examples.mjs https://demo.milliseconds.ai` walks the published catalog with bounded concurrency. It requires no client key; cache misses consume the configured sponsor quota. The default report is `/tmp/milliseconds-stock-warmup.json`.

Configure the Worker secret `PLAYGROUND_API_KEY` through Wrangler. Never put it in fixtures, browser bundles, or source control. `EXAMPLE_DAILY_BUDGET` defaults to 2,000 sponsored fills; global limits also allow at most 180 fills/minute and four concurrent fills. Cached results remain available when the fill budget is exhausted. Ordinary responses refresh after 24 hours while their previous result remains available. See [the design](docs/free-stock-examples-design.md) and [generated coverage](docs/stock-example-coverage.json).

## Performance and cost

Every demo uses the same `RunMetrics` panel and the same `src/lib/dm1.ts` client. The panel shows **this page session**, starting at page load. Resetting an individual demo does not erase usage; reloading starts a new session.

- **Typical delivery time:** median duration of successful calls, from client entry through the response. Includes the local queue, network, and retry delays. It is not a frame rate or the duration of a whole multi-call task.
- **Input tokens:** live and recorded input tokens for the displayed workload, labelled by source. Cached tokens are not newly processed usage. One request may contain many inputs or statements.
- **Estimated inference cost · USD:** all displayed input tokens, including cached records, × $0.04 / 1,000,000, before plan credits. This shows what equivalent live inference would cost. Stock examples remain free to try; estimated usage on a personal key appears separately in the expanded details.
- **How these numbers work:** expands model compute, successful requests, attempts, retries, and definitions. Model compute is the mean of reported `x-inference-ms` values on successful calls. It sums processing across a batch and can exceed browser elapsed time.
- **Missing usage:** a response without a valid token header, or a request interrupted after dispatch, is unknown. Display `Unavailable` when no usage is known, or `≥` before the known total. Never present unknown usage as a measured zero.

Telemetry is recorded centrally before each caller handles its result. Successful sibling calls, stale UI results, and retries cannot disappear from totals. Sample replays and local fallback decisions do not fabricate API usage. Requests cancelled before dispatch do not count as network attempts.

## Add or update a demo

1. Create `src/demos/<slug>/meta.ts` satisfying `DemoMeta`: `slug`, `title`, a one-sentence capability `summary`, a concrete first-action `instruction`, API `routes`, a `category`, and optional `order`. Set `origin` only for adapted work; original demos omit it.
2. Create the React island and its scoped `demo.css`. Use `src/lib/dm1.ts` for every API call. It paces the page at three calls per second with at most four in flight, and retries rate limits. Batch up to 32 inputs when possible.
3. Add stock request builders to `src/examples/`; derive payloads from the same fixture modules as the UI. `pnpm build` regenerates the server registry, public manifests and coverage report, and fails if a demo is missing. Then create `src/pages/<slug>.astro` with the shared `Demo` layout and `<Island client:only="react" />`. Add concise “How it works” and practical scope notes.
4. Do not add a second performance, token, or dollar strip. Keep domain outcomes near the interaction: messages reviewed, actions taken, findings, or assigned units. Explain scores and pending states.
5. Show what the model enables. Omit alternative-provider comparisons, synthetic slow modes, and historical porting notes. The shared layout supplies author attribution when `origin` is present.
6. Verify initial, running, completed, and error states at desktop and mobile widths. Keep text readable inside rows, controls reachable, and tables intentionally scrollable. Preserve visible focus, labelled fields, and reduced-motion support.

Demo cards and headings use distinct Phosphor icons, matching `rakerone-web`. The mapping lives in `src/components/DemoIcon.astro`; add an entry for each new demo. Icons and navigation arrows render as static SVG through `@phosphor-icons/react/ssr`, without client hydration or emoji glyphs.

Shared styles live in `src/styles/demos.css`, using the product tokens from `site.css`. Match the website and console: `#3c11bd` for primary fills, `#6d4aff` for icons, focus rings and chart accents, and light foreground text for readable labels on dark surfaces. Do not override these accents with lavender. The index and sitemap discover each demo's metadata automatically. Internal folder names and existing route URLs remain stable.

## Browser regression checks

With the site running, use an existing Playwright installation (or set `PLAYWRIGHT_MODULE` to its module path):

```sh
QA_BASE=http://127.0.0.1:4324 node scripts/ui-regression.mjs
QA_BASE=http://127.0.0.1:4324 node scripts/cost-estimate-check.mjs
QA_BASE=http://127.0.0.1:4324 node scripts/pilot-regression.mjs
node src/demos/ax-pilot/check.mjs
```

The browser checks use mocked API responses and no real key. They verify spreadsheet submissions and recovery, inbox scrolling, and App Pilot completion, recovered failures, premature completion, custom goals, blocked actions, cancellation, and goal changes. The offline pilot check covers action decisions and preset verification. Full live verification and independent design scores are recorded in `docs/demo-quality-review.md`.

App Pilot stops immediately when a preset's app-state check passes. This verified outcome is distinct from the model's earlier probability estimates. Custom goals have no independent check; a model or fallback completion report remains explicitly unverified. Steps retain their actual model or fallback source.

## Business workflows

The directory leads with Invoice Desk, Sales Intake, Catalog Studio, Evidence Check, Private Share and Returns Desk. Visitors can filter all 26 demos by business category. Each new workflow starts with a labelled, curated sample that makes no API calls. Supplied runs use cached or sponsored model responses for free; edited input uses the visitor’s key. Results remain drafts; no payment, message, CRM update or publishing action occurs.

All six include source evidence, cancellation/retry and workflow notes. Every demo includes the shared SDK examples below its interactive workspace. Each also links to relevant CloudRaker Paperwork API capabilities: document extraction, parsing, citations, file redaction or form filling. A shared-account note links to CloudRaker and Paperwork key setup; it does not imply interchangeable API keys or automatic document transfer. Private Share and Catalog Studio export local drafts. Policy checks use deterministic code; source matches and model scores are never presented as guarantees of meaning or correctness.

Workflow analytics contain only fixed demo/action identifiers, with query parameters removed. They never include source text, output text or keys. Event definitions are in `src/lib/demo-events.ts`.

```sh
for demo in invoice-desk sales-intake catalog-studio evidence-check private-share returns-desk; do
  node --experimental-strip-types src/demos/$demo/check.mjs
done
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/business-demos-check.mjs
# Optional live check: consumes the supplied key's API quota.
MS_API_KEY=... PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/business-live-check.mjs
```

`QA_BASE` changes the site URL; `QA_API` changes the live proxy URL; `QA_OUTPUT` changes the artifact directory. The live check writes fictional response data but never credentials. [Business demo review](docs/business-demo-quality-review.md) separates independent interface scores, deterministic checks and measured model limitations.

## SDK and CLI samples

All 26 demos include TypeScript, Python and `dm1` tabs, with a selector for each API capability used on that page. The 61 request examples come from the same stock request catalog as the running demos. They use public SDK methods, preserve batch and statement dimensions, and run with the reader’s `MS_API_KEY`; they do not call the sponsored demo proxy. These are API building blocks, not complete implementations of the surrounding simulation, policy or evidence checks.

`src/lib/sdk-samples.ts` owns sample generation. `src/components/SdkExamples.astro` uses Astro’s built-in Shiki renderer with `@pierre/theme`’s `pierre-dark-soft`, matching `rakerone-web`. Highlighting happens at build time; no highlighter or SDK runtime is shipped to the browser. Copy buttons copy plain code, language tabs support arrow/Home/End navigation, and long code scrolls inside its panel. The original business integration snippets have been replaced by this shared surface; their workflow notes remain.

The release was checked against published TypeScript/CLI and Python SDK version 0.1.1. All 183 generated snippets execute against mocked transports and produce the exact expected stock payload; TypeScript snippets also typecheck. To reproduce, install the SDKs in an isolated directory/environment, then run:

```sh
SDK_PACKAGE=/path/to/node_modules/@cloudraker/milliseconds SDK_PYTHON=/path/to/venv/bin/python node scripts/sdk-samples-check.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs QA_BASE=http://127.0.0.1:4324 node scripts/sdk-browser-check.mjs
```

## Search indexing

`/robots.txt` allows public pages, excludes `/api/`, and advertises `/sitemap.xml`.
The sitemap is generated from demo metadata; it includes the directory and every demo.
Pages ship crawlable HTML titles, descriptions, instructions, notes, and links even
before React loads. Each demo has a canonical URL, social metadata, and breadcrumb
JSON-LD. The directory exposes its demos as a CollectionPage/ItemList. The custom
404 page is `noindex` and Cloudflare serves missing routes with HTTP 404.

Run `pnpm build && pnpm check:seo` to check the actual generated pages, crawl files,
canonical URLs, structured data, and social image. No last-modified timestamps or
ratings are invented. Publishing and search-engine submission are separate steps.
