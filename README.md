# milliseconds.ai demos

28 interactive examples of decision-machine-1, live at [demo.milliseconds.ai](https://demo.milliseconds.ai).

Static Astro pages with React islands. A small Cloudflare Worker proxies API calls. Twenty demos adapt ideas from [dabit3/jev-experiments](https://github.com/dabit3/jev-experiments); seven business workflows and one image classifier are original.

## Run

```sh
pnpm install
pnpm dev        # localhost:4324, no API proxy
pnpm preview    # build + wrangler dev on localhost:8787, with the API proxy
```

Locally the Worker calls `https://api.milliseconds.ai` directly. In production it uses a service binding to the API Worker.

## Deploy

Plausible reports production pageviews and demo events to the main `milliseconds.ai` dashboard. Event URLs retain the `demo.milliseconds.ai` hostname. Development builds do not initialize analytics.

```sh
CLOUDFLARE_ACCOUNT_ID=<account> pnpm run deploy
```

| Setting | Where | Purpose |
| --- | --- | --- |
| `PLAYGROUND_API_KEY` | Wrangler secret | Sponsors free stock examples. Never in source or fixtures. |
| `EXAMPLE_DAILY_BUDGET` | `wrangler.jsonc` var | Sponsored fills per day (default 2,000). |
| `CLOUDFLARE_ACCOUNT_ID` | Shell env | Target account for `wrangler deploy`. |

After a deploy, `node scripts/warm-examples.mjs https://demo.milliseconds.ai` pre-fills the example cache.

## How requests work

**Stock examples are free.** The browser sends only an immutable example ID to `POST /api/examples/<demo>/stock-v1/<digest>` with an empty body. The Worker resolves the registered payload itself, so callers cannot change it. A Durable Object fills cache misses with the sponsor key, validates responses, and enforces budgets. Cached results stay available when the budget runs out.

**Custom input needs your key.** Any edit to text, labels, schemas, or options is custom. The key travels only in the `x-ms-key` header to `POST /api/run`. Signed-in console users get their test key automatically. Pasted `test_sk-` and `prod_sk-` keys are stored in `localStorage`. Keys never appear in URLs, logs, analytics, or code samples.

**Images.** Two demos send an image: `receipt-reader` posts the receipt PNG with `image` and `detail` to `/extract` and shows the extracted record beside it, and `hot-dog` posts each of its fourteen Wikimedia Commons photos to `/classify` at `low` detail. Its photos, with their sources and licences, live in `src/demos/hot-dog/samples.ts` and `credits.ts`. Limits live in `src/lib/image.ts` and the Worker enforces them: one JPEG, PNG or WebP of at most 5 MB, never a URL, base64 excluded from the character count. `node scripts/generate-receipt.mjs` rebuilds the stock receipt, which changes its example ID.

**Every page shows the same metrics panel:** median delivery time, input tokens, and estimated inference cost at $0.04 per million tokens. Unknown usage is shown as `Unavailable` or `≥`, never as zero.

**SDK tabs.** Each demo shows TypeScript, Python, and `dm1` CLI samples generated from the same request catalog as the demo. They run against the public API with the reader's `MS_API_KEY`, not the demo proxy.

**Live mode.** Enable “Use my key for every request” in the performance panel to bypass the demo cache, including for supplied text and image samples. Every request uses your key and quota. The choice lasts for the current browser tab. Live timing and usage exclude cached deliveries; turn the option off to restore free samples.

## Add a demo

1. Create `src/demos/<slug>/meta.ts` (`DemoMeta`: slug, title, summary, instruction, routes, category).
2. Build the React island and its scoped `demo.css`. Call the API only through `src/lib/dm1.ts`. Batch up to 32 inputs.
3. Add stock request builders to `src/examples/`. `pnpm build` regenerates the registry and fails if a demo is missing.
4. Create `src/pages/<slug>.astro` with the shared `Demo` layout.
5. Add an icon entry in `src/components/DemoIcon.astro`.
6. Check initial, running, completed, and error states at desktop and mobile widths.

Keep one metrics panel per page. Use the product colors from `src/styles/site.css`: `#3c11bd` fills, `#6d4aff` accents.

## Checks

```sh
pnpm exec tsc --noEmit
pnpm build && pnpm check:seo
node --experimental-transform-types src/lib/telemetry.test.mjs
node --experimental-transform-types src/lib/stock-client-check.mjs
node src/lib/worker-stock-check.mjs
node src/demos/ax-pilot/check.mjs
for d in invoice-desk sales-intake catalog-studio evidence-check private-share returns-desk receipt-reader hot-dog; do
  node --experimental-strip-types src/demos/$d/check.mjs
done
```

Browser checks need Playwright (`PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs`) and a running site (`QA_BASE`, default `http://127.0.0.1:4324`). They use mocked API responses and no real key.

```sh
node scripts/ui-regression.mjs
node scripts/cost-estimate-check.mjs
node scripts/pilot-regression.mjs
node scripts/business-demos-check.mjs
node scripts/sdk-browser-check.mjs
MS_API_KEY=... node scripts/business-live-check.mjs   # live, spends quota
```

## Docs

- [Free stock examples design](docs/free-stock-examples-design.md)
- [Demo quality review](docs/demo-quality-review.md)
- [Business demo review](docs/business-demo-quality-review.md)
- [Stock example coverage](docs/stock-example-coverage.json)

## License

MIT.
