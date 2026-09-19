# Free stock examples, personal keys for custom inputs

Approved design — 2026-09-19. Implemented with versioned content-digest request IDs; see the generated coverage manifest for the complete stock catalog.

## Product contract

Every published stock scenario can run without signup. A visitor can inspect evidence, navigate results, adjust local policy weights and export sample output. A request that changes model input, labels, questions, schema, criteria or any other inference parameter requires the visitor's own API key. Resetting to an exact published scenario restores free access.

Stock examples stay free even when a visitor has saved a personal key. Custom requests use that key. A rejected personal key never falls back to the sponsor key. A separate explicit “Run live with my key” action can bypass sample caching when a visitor wants their own measurement; omit this extra control from the initial release unless needed.

The current six business demos have curated, zero-call previews. Keep them as labelled previews, but make Run example execute the workflow using real captured API responses or a sponsored live run. Do not promote the curated preview values into a purported model cache.

## Confirmed starting point

- The website already holds PLAYGROUND_API_KEY on its Worker. Its source is `apps/milliseconds/src/worker.ts` in the cloudraker-spring-2026 repository. It accepts bounded caller-supplied requests after Turnstile and per-IP checks. Reuse the secret/service pattern, not its broader input permission.
- The demo Worker currently exposes only POST /api/run with a required visitor key. All demos use the shared `src/lib/dm1.ts` client and telemetry ledger.
- The six new demos also have early hasKey guards; those need to become stock-versus-custom checks.
- Older demos include batches, generated streams and requests derived from simulated app state. They need named stock scenarios, not an indiscriminate “no key means free” client change.

## Public request contract

Example:

```http
POST /api/examples/invoice-desk/stock-v1/<payload-sha256>
Content-Type: application/json

{}
```

The path identifies a published demo, fixture version and allowed step. It does not select an arbitrary upstream capability. A server-owned registry resolves that exact combination to its capability and complete payload, including source text, extraction schema, questions and all options. Return the real API response shape so existing parsers and rendering can be reused.

The free route rejects request bodies other than an empty object, unknown paths/steps, unexpected query parameters and unsupported methods before using the sponsor credential. Bound the actual request stream, including when Content-Length is absent or false. There is no public override, URL, prompt, schema, model selector or force-refresh parameter.

Custom input continues through POST /api/run using the visitor's x-ms-key. Keep its authentication and cache namespace separate. Do not put custom input or responses in the public cache.

The browser can use shared fixture definitions to choose an example ID. The server independently owns and resolves that ID. A forged isStock flag, hash, origin, referer or client-side equality check cannot authorize free inference. Public fixture IDs are intentionally discoverable, not secrets or bearer capabilities.

## One fixture definition, versioned results

Move stock data and request builders into modules usable by both the UI and Worker without React or browser globals. Avoid copying fixture text into a second allowlist that will drift.

Registry entries pin the capability and full request shape. Cache identity includes fixture version, capability, canonical payload digest and an explicit model/cache revision. An old example ID must never silently resolve to a newly edited payload.

For multi-step workflows, cache individual immutable calls where requests are independent. When later calls depend on earlier model output, the server constructs and stores the bounded workflow or trace. The client cannot supply that intermediate output to the sponsored route.

Coverage rules for all 26 demos:

- Fixed text/batch workflows: named fixtures and request steps, including each shipped example selector option.
- Streams: deterministic published data, order and chunk boundaries. Variable wall-clock timestamps remain presentation-only when possible.
- Search and editable tools: named stock queries/commands/formulas are free; arbitrary queries or formulas require a key.
- App Pilot and state-dependent simulations: a server-owned stock scenario and bounded recorded model trace, or server-reconstructed supported states. Never sponsor arbitrary browser-provided DOM, accessibility trees, histories or goals. Label a cached trace as a recorded example; do not show it as a fresh autonomous run.
- Local controls that make no inference request remain free. Changing sales weights, a redaction selection or an ordinary review filter does not require authentication.

Publish a coverage manifest listing every free scenario and expected steps. CI must ensure every default Run control and shipped stock selector has a complete free path, rather than prompting for a key halfway through a run.

## Live fill and caching

Cache hits serve a stored, successful model response. On a miss, execute only the registered request using a dedicated server-held playground key and the existing decision-machine service binding, validate the response, store it, then return it.

Use the edge cache for delivery and one small Durable Object as the shared result store and live-fill coordinator. Only misses/refreshes reach it. It deduplicates simultaneous fills, reserves the live-call budget before dispatch, limits concurrency and applies failure cooldowns. A finite registry bounds stored keys. This also avoids repeated live fills from independent edge locations.

Start with a 24-hour freshness policy. Serve a prior successful result while one permitted refresh runs. Prewarm published fixtures before release. If an uncached call fails, show a retryable unavailable state; never substitute a fabricated success. A failed refresh keeps the old result visibly marked with its generation time. Cache only validated success bodies and selected non-sensitive metadata, never error bodies or credentials.

Cloudflare's Cache API is local to a data center, and its rate-limit bindings are local/eventually consistent. Neither alone provides global fill deduplication or a strict global sponsor budget. See [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/) and [rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

Set a configurable global live-fill request budget and a maximum number of steps per scenario, chosen from the measured coverage manifest. On exhaustion, continue serving cached examples and decline new inference. Add ordinary edge/per-IP traffic limits for endpoint abuse. Turnstile can be added to suspicious live-fill traffic if observed abuse warrants it; it is not the authorization boundary and should not interrupt ordinary cached examples.

No public cache-busting or refresh endpoint. Fixture/model revision changes and administrative prewarming trigger deliberate invalidation. Expiring or flushing a cache does not broaden the allowed request set.

## Honest performance and cost

Return provenance metadata outside the upstream response body: source (cache or sponsored-live), fixture version, generation time and original run's input tokens/model time. The custom path remains personal-live.

The shared telemetry ledger must distinguish these modes before changing any UI gates:

| Mode | Visitor-facing state | Usage and timing |
|---|---|---|
| Curated initial preview | Sample preview | No network/model usage, unchanged from today |
| Cached stock response | Cached example · free | Current delivery time; original model tokens, estimated inference cost and compute time explicitly labelled Recorded run; no fresh inference billed |
| Sponsored live stock | Live example · free | Actual request timing and token/cost headers; visitor cost $0, inference covered by milliseconds |
| Custom personal run | Live · your key | Actual timing, input tokens and estimated inference cost against the visitor's account |

The main cost figure is estimated inference spend for the displayed workload, including cached records at the same input-token rate. A separate note explains that stock examples are free; expanded details separate usage charged to a personal key. Never use the visitor’s $0 demo charge as the main spend estimate.

Keep delivery time separate from model compute. Exclude cached records from live-model timing and newly processed token totals. Track cached deliveries separately; never count the original tokens as newly billed on each cache hit. Preserve incomplete-usage handling, cancellation and retries for actual dispatched model requests. A public client disconnect need not cancel a fill shared by other visitors, but it must not be reported as a completed client run.

Do not add artificial delay to make caching look like inference. Show the result as quickly as it is available. Keep normal UI transitions short and accessible.

## Visitor flow

- Replace the initial key banner with “Run the examples for free. Use your API key for your own inputs.”
- Stock primary action: Run example. Show Cached example or Live example when results arrive.
- Preserve edits without a key. At run time show “Use your own input” with Add API key and Restore example. Never quietly replace edits with stock text.
- Treat edits to a schema, question or criteria exactly like edits to source text when they affect an API request.
- Keep the main performance and cost panel, with provenance-aware labels rather than a second competing metric strip.
- Current preset parsing and source-evidence validations still apply to cached responses.

## Delivery sequence

1. Build the fixture registry, public route and adversarial Worker checks. Preserve the existing keyed path.
2. Add cache storage/fill coordination, a dedicated playground secret, quotas and warmup. Keep public access disabled until validation passes. Provision production resources through the established infrastructure workflow.
3. Update shared transport, telemetry and key-panel copy. Remove per-demo key gates only when the stock path is complete.
4. Register and verify all six business workflows, then remaining stock queries, streams and simulation traces. Coverage across all 26 is the completion criterion.
5. Prewarm and validate real model outputs, then run anonymous desktop/mobile QA and a valid-personal-key custom run. Check provenance and exact counters on miss, hit, stale refresh, errors and cancellation.
6. Independently review the sponsor-key boundary before enabling the public route in production.

## Required acceptance checks

- Every default stock scenario completes in a fresh browser with no localStorage key. Repeating it uses cached responses with correct labels and no new inference charge.
- Source, labels, schema, questions, options, custom URLs and fake intermediate state sent to a public path cause zero upstream calls.
- Unknown IDs, excessive payloads, malformed JSON, duplicate/extra fields, query overrides and force-refresh attempts fail closed.
- An edited input cannot invoke the sponsor key even when paired with a valid example ID. This is enforced by the server accepting no input override at all.
- Invalid personal credentials never retry under the sponsor credential. Custom responses cannot appear in a public cache entry.
- Sponsor keys are absent from bundles, HTML, responses, captured browser requests, logs and committed fixtures.
- Concurrent misses for one fixture produce one shared fill; retries after failure obey cooldown; requests from different edge locations obey the same global fill budget.
- Cold cache without a configured secret fails visibly. Warm cache can still serve legitimate recorded examples. No fake live result or bogus token measurement appears.
- Stock selection, local filters/weights and reset behavior remain useful without signup. Editing never destroys user input, and restoring the stock case restores free access.
- Existing API shapes, evidence checks, currency precision and late-response/cancellation guards continue to pass.
