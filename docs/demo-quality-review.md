# Demo quality review — 2026-09-19

All twenty demos passed independent interface reviews after implementation and iteration. The original live site scored 4.0–6.5/10. Final scores are below. These are interface-quality judgments, not model-accuracy benchmarks.

## What changed

Each demo now leads with what it enables and a concrete first action. Comparison modes, simulated slow-model controls, competing scoreboards, and historical porting essays were removed. The author attribution remains linked. Existing URLs are unchanged.

The shared performance panel shows page-session request time, input tokens, and estimated USD cost. A native disclosure explains median timing, model compute, request counts, batching, retries, plan credits, and reset behavior. Unknown usage is explicitly incomplete. Individual demos retain their own meaningful outcomes rather than competing API-stat strips.

Responsive fixes include readable chat/log rows, contained tables and controls, visible spreadsheet inputs, stable inbox scrolling, and explicit pilot-step layout. Shell Guard distinguishes the model's suggestion from the application's final policy decision. Model fallbacks and unprocessed samples are identified.

## Independent scores

Each score uses five equally weighted dimensions: purpose clarity; understandable and truthful metrics; consistency; responsive layout; interaction and accessibility. Two independent reviewers each assessed ten demos, including desktop/mobile screenshots, populated results, error/no-key paths, and keyboard/focus spot checks. A separate code reviewer checked regressions and required the spreadsheet fixes before passing.

| Demo | Score / 10 |
| --- | ---: |
| Agent Assist | 9.3 |
| App Pilot | 9.1 |
| Commit Sentry | 9.3 |
| Dispatch Console | 9.2 |
| Chat Firehose | 9.2 |
| Inbox Triage | 9.2 |
| Product Search | 9.5 |
| Semantic Linter | 9.4 |
| Judge Sheets | 9.3 |
| Intent Launcher | 9.5 |
| Live Minutes | 9.3 |
| Log Sentinel | 9.1 |
| ModStream | 9.3 |
| Natural Language Commands | 9.4 |
| Send Guard | 9.3 |
| Shell Guard | 9.3 |
| Agent Swarm | 9.3 |
| Air Traffic Tower | 9.4 |
| Document Reranker | 9.7 |
| Voice Turn | 9.5 |

## Iteration gates

- ModStream distinguished twelve unchecked samples from actual queued requests.
- Inbox stopped scrolling the entire page when selecting the initial email.
- App Pilot separated mobile step badges and durations into explicit grid positions.
- Shell Guard moved the final decision above model probabilities and collapsed raw request data.
- Document Reranker expanded the first passage and labelled its disclosure.
- Judge Sheets guarded the complete header-prediction operation against duplicate submissions and cleared recovered errors.

Each blocking finding was fixed and rechecked. All twenty final scores exceed the required 9/10.

## Verification

- Built all 22 static pages, including the directory and 404 page; TypeScript and whitespace checks passed.
- Telemetry regression checks cover retries, missing headers, preflight/queued/backoff cancellation, timing scope, late subscription, and dollar precision.
- Retained browser regression check verifies ten rapid spreadsheet submissions produce one request, failed classification reserves no column, successful retry clears the error, and inbox keyboard scrolling stays inside the list at 390px and 1440px.
- Exercised a real API interaction on every demo through the production proxy, using a private test key and a shared throttle. Compared the rendered token and dollar totals with response headers. Paused Swarm after a separate cancellation test so exact and explicitly incomplete accounting were both exercised.
- Reviewed desktop (1440px) and mobile (390px) initial and populated views. Automated checks found no document overflow at 320, 390, 768, 1024, or 1440 pixels.

Local evidence: `/tmp/ms-live/`, `/tmp/ms-review-a/`, `/tmp/ms-review-b/`, `/tmp/ms-baseline/`, and `/tmp/ms-widths.json`. These artifacts contain screenshots and sanitized results, not API keys. Reproduce the retained checks using the commands in the README.

## Limits

The demos intentionally use fictional data, recorded app snapshots, and simulated actions. The review confirms presentation, interaction paths, and measurement accounting. It does not establish accuracy across arbitrary input, certify guards for production use, or benchmark model throughput. Existing model-quality limitations remain stated in the relevant demo scope notes.

## Production verification

Deployed on 2026-09-19 at 14:18 UTC. Cloudflare Worker version: `d4ddb5b1-f5ee-4b87-84e1-a1be2c51c0a8`.

All twenty public routes returned HTTP 200 and referenced the exact assets from the reviewed build. A fresh browser pass then exercised every demo directly on `https://demo.milliseconds.ai`, using its real proxy and a shared request throttle. The pass completed 156 API requests, all HTTP 200. Every demo's displayed input-token and estimated-dollar total matched the API headers and documented price. No browser errors or mobile document overflow occurred.

Sanitized per-demo evidence is retained in [demo-live-check.json](./demo-live-check.json). Production screenshots remain under `/tmp/ms-production/`. Credentials are excluded from both.


## App Pilot completion verification follow-up

The original interaction pass covered Calculator, not every App Pilot preset. A user screenshot exposed a missed case: Dark Mode was selected, but the run continued and presented a later fallback's `stuck` decision as an error.

Preset runs now stop immediately when their app-state check passes. A model's premature `done` cannot earn a verified-success badge. Custom-goal completion stays explicitly unverified. Historical model probabilities are collapsed and labelled as estimates before the last action; actual model and fallback provenance remains in the steps. Successful fallback after a failed request shows neutral recovery history instead of an active error.

The pass also corrected Safari verification (the new tab must finish loading), stale outcomes when goals change, late updates after cancellation, and DOM reads before React commits the prior action.

- Offline assertions cover all five initial states, Safari typed/loading/wrong-tab negatives, and Dark Mode selection.
- Seven retained browser scenarios cover success, recovered request failure, Safari's updated controls, premature completion, custom completion, blocked actions, and cancellation. Success stops without another request; goal edits clear the prior result.
- TypeScript, production build, and whitespace checks pass.
- Independent source and desktop/mobile review scores the revised completion UX **9.1/10**. This remains a UI and correctness review, not a model-accuracy benchmark.

Final public-site verification: all five preset goals completed in two or three steps, across 26 live API requests. Desktop and 390px screenshots showed the expected results, with no browser errors or mobile document overflow. All seven mocked regression scenarios also passed against the production bundle. All twenty demo routes returned HTTP 200.

Worker version: `b1ec6622-3850-4cb7-a957-66fb0c249039`. Sanitized results: [pilot-live-check.json](./pilot-live-check.json). Screenshots: `/tmp/ms-pilot-*-production.png` and `/tmp/ms-pilot-*-production-mobile.png`.
