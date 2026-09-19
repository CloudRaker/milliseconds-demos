# Free stock examples: release verification

2026-09-19 · [Production demos](https://demo.milliseconds.ai/)

All 26 demos support anonymous stock examples. Custom model inputs require the visitor’s API key. Cached results show recorded tokens and original compute separately from current delivery time. The visitor’s cost is $0 for stock content, including when a personal key is saved.

## Delivered boundary

- 1,338 immutable requests, generated from the same fixtures and builders used by the UI. Each public request contains only `{}` and a registered content-digest ID. The server never accepts caller-provided model input on the sponsored route.
- A dedicated server-held sponsor key, one durable global result store, request deduplication, four concurrent fills, 180 fills/minute and 2,000 fills/day. Public traffic is limited separately to 600 requests/minute/IP.
- A five-minute edge cache and 24-hour result freshness. Existing successful results remain available during refresh or budget exhaustion. Errors are never stored as successful results.
- All 34 App Pilot request recordings are pinned real API results, covering five simulation goals and five recorded-tree examples. Swarm and Tower offer six bounded stock scenes; continuous interaction explicitly requires a personal key.
- Build, preview and deploy regenerate the catalog. The server JSON is an ignored build artifact; public manifests and the scenario coverage report are versioned. No added runtime dependency.

## Verification

The independent security reviewer scored the final boundary **9.4/10**, with no remaining blocker. Retained checks cover request/body overrides, malformed and oversized streams, exact response dimensions, duplicate fills, durable budgets, stale refresh, cooldown, missing credentials, personal-key rejection, cancellation and truthful usage accounting.

Production probes rejected text overrides, duplicate fields, query overrides, unknown IDs, unsupported methods, oversized bodies and unkeyed custom requests. A valid custom browser run made two personal requests with a measured 528 input tokens and an estimated $0.000021 cost. Restoring the stock case made two cached requests without sending the saved key; personal cost stayed unchanged. Invalid personal credentials returned 401 without sponsor fallback.

Team browser verification used actual API responses, fresh anonymous contexts and no response mocking. Across all 26 production demos, **374/374 requests succeeded: 348 cached and 26 sponsored live**. Every stock flow showed $0 visitor cost. Desktop and 390px mobile screenshots were inspected; no document overflow or browser JavaScript errors remained. Custom-input checks confirmed the prompt preserves edits and restoring examples returns to free access.

Full production warmup completed at 2026-09-19T16:53:42.735Z: **1,338/1,338 registered requests returned valid HTTP 200 responses**, with zero unavailable examples. The report accounts for every generated ID and checks source, generation time, token and model-time headers. See [the per-demo summary](stock-warmup-summary.json).

### Demo scores

Scores assess clarity, useful visible outcomes, truthful provenance, interaction and responsive layout. They are reviewer judgments, not model-accuracy claims. Long-running demos received bounded live browser checks; all published request variants additionally passed deterministic catalog checks. App Pilot’s five goals were each run to completion.

| Demo | Score |
| --- | ---: |
| Invoice Desk | 9.2/10 |
| Sales Intake | 9.0/10 |
| Catalog Studio | 9.3/10 |
| Evidence Check | 9.1/10 |
| Private Share | 9.3/10 |
| Returns Desk | 9.2/10 |
| Instant Search | 9.2/10 |
| Launcher | 9.1/10 |
| Natural-Language Palette | 9.1/10 |
| Turbo Rerank | 9.3/10 |
| Commit Sentry | 9.2/10 |
| Semantic Linter | 9.2/10 |
| Shell Guard | 9.0/10 |
| Send Guard | 9.2/10 |
| Judge Sheets | 9.1/10 |
| Chat Firehose | 9.0/10 |
| Inbox Triage | 9.1/10 |
| ModStream | 9.1/10 |
| Log Sentinel | 9.0/10 |
| Live Minutes | 9.1/10 |
| Agent Assist | 9.1/10 |
| Dispatch Console | 9.1/10 |
| Agent Swarm | 9.1/10 |
| Air Traffic Tower | 9.1/10 |
| Voice Turn | 9.1/10 |
| App Pilot | 9.2/10 |

### Iterations before sign-off

Review and real-runtime testing caught and resolved malformed response acceptance, a rating-response schema mismatch, the local native-fetch receiver, retry delays shorter than server cooldowns, key-panel overlap with the command palette, residual Launcher emoji indicators, and Dispatch labels that incorrectly called cached decisions live. All affected flows were retested successfully. A transient local Sheets failure cleared on retry; the final 20-request check and production run both passed.

Model uncertainty remains visible: source matches do not guarantee semantic correctness, incomplete evidence routes to review, and simulated actions do not execute in real systems. There is no fabricated success path when a stock request fails.

## Reproduction

```sh
pnpm build
pnpm exec tsc --noEmit
node src/lib/worker-stock-check.mjs
node --experimental-transform-types src/lib/stock-client-check.mjs
node --experimental-transform-types src/lib/telemetry.test.mjs
node src/examples/business.check.mjs
node src/examples/interactive.check.mjs
node src/examples/streams-check.mjs
node src/examples/simulations-check.mjs
node src/examples/tools-check.mjs
node --experimental-transform-types src/demos/ax-pilot/stock-check.mjs
# Public requests only; cold entries consume the configured sponsor quota.
node scripts/warm-examples.mjs https://demo.milliseconds.ai
```

[Coverage manifest](stock-example-coverage.json) · [Design and trust boundary](free-stock-examples-design.md)

Session screenshots, network evidence and browser scripts are retained locally in `/tmp/ms-production-business-qa`, `/tmp/ms-free-interactive-production`, `/tmp/ms-tools-prod-qa`, and `/tmp/ms-free-stream-sim-qa/production`. These temporary paths are evidence from this session, not permanent published artifacts. The final warmup summary is retained beside this report.
