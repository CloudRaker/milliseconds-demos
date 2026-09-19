# Business demo quality gate

2026-09-19. Six original workflows added to the existing twenty. Six isolated implementation agents and three independent reviewers; root integrated and checked live API behavior. No new dependencies.

## Independent interface scores

Reviewers inspected rendered desktop 1440px, mobile 390px and narrow 320px pages. Scores equally weight purpose/action, useful outcome/evidence, visual/responsive design, interaction/accessibility and truthful states. A correctness blocker fails regardless of score. These scores are editorial interface judgments, not model accuracy measurements.

| Demo | Purpose | Outcome | Design | Interaction | Truthfulness | Final |
|---|---:|---:|---:|---:|---:|---:|
| Invoice Desk | 9.5 | 9.3 | 9.0 | 9.0 | 9.3 | **9.2 PASS** |
| Sales Intake | 9.2 | 9.1 | 9.0 | 9.0 | 9.2 | **9.1 PASS** |
| Catalog Studio | 9.5 | 9.2 | 9.1 | 9.1 | 9.3 | **9.2 PASS** |
| Evidence Check | 9.2 | 9.0 | 9.0 | 9.2 | 9.5 | **9.2 PASS** |
| Private Share | 9.3 | 9.4 | 9.2 | 9.3 | 9.5 | **9.3 PASS** |
| Returns Desk | 9.3 | 9.2 | 9.1 | 9.1 | 9.3 | **9.2 PASS** |

No remaining blockers in the reviewed scope. Reviewers tested zero-call sample previews, evidence inspection, keyboard controls, edited-input invalidation, mocked success/error/retry/cancellation, malformed responses and late-response suppression. Catalog CSV/JSON and Private Share text exports were checked. Invoice cent-level discrepancies and missing purchase orders remain review items. Returns dates, order identity and policy limits are explicit code checks.

Review artifacts: `/tmp/ms-review-business-gate.md`, `/tmp/ms-review-evidence-private-gate.md`, `/tmp/ms-review-sales-returns/review.md`; screenshots and runnable checks are linked inside those local reports. Per-demo retained check scripts and probe artifacts live alongside implementation files. Root fixed mobile Unavailable metric wrapping after review.

## Integrated verification

- TypeScript and full production build pass.
- All six retained logic checks pass: required fields, weighted unknowns, exact cents, calendar boundaries, source/Unicode offsets, response types, safe CSV and redaction overlap handling.
- Central telemetry regression passes, including incomplete usage, cancellation and retries.
- Existing spreadsheet, inbox and App Pilot browser regressions pass, including the prior false-completion/state refresh cases.
- `scripts/business-demos-check.mjs` passes: 26 cards, six new workflows first, category filters/counts, per-demo icons, original attribution rules, zero sample usage, no browser errors and no document overflow at 1440/390/320.
- Root ran all six integrated browser workflows against the real production API: **17 HTTP 200 responses**, **6,878 input tokens**, every token count and dollar display matching API headers. Sanitized measurements: `business-live-results.json`. One run per demo is functional verification, not a latency benchmark.
- Root inspected all six live mobile screenshots. Invoice produced the correct ten-field draft and no policy exceptions. Catalog produced four drafts with the incomplete fourth listing in review. Private Share located all four sample details. Returns produced Standard handling for the routine case. Sales kept conflicting intent signals in human review. Evidence showed one supported field and three review items, including a spurious candidate for an absent field.

## Model limits, separate from UI scores

| Demo | Measured evidence | Limitation retained in the UI |
|---|---|---|
| Invoice Desk | Four live capability probes; 30 offline policy fixtures, eight held out | Removing vendor and PO caused customer-to-vendor role confusion. Missing customer/PO keeps the draft in review. The 30 fixtures are not 30 model-evaluated invoices. |
| Sales Intake | Final intent winners 26/30, six held-out inputs correct; all four misses in review; 16/30 total review | Endpoint design changed after early evaluation, so held-out results are descriptive, not an untouched benchmark. Matching text does not prove roles or meaning. Arbitrary fit criteria need evaluation. |
| Catalog Studio | Category labels 26/30, held-out 7/10; all four misses in review | Missing-field expectations preserved in all 30 cases; whole-record semantic accuracy was not graded. Limited clothing/furniture/audio schema. |
| Evidence Check | Six live probes plus root four-field run | An absent field can yield unrelated wording. Different value is a review prompt, never proof of contradiction. Fixed four-field schema. |
| Private Share | Five live probes plus root sample; all four sample details located | Detection can miss personal details. Literal manual masking and whole-transcript acknowledgment remain necessary. Text only; no anonymity guarantee. |
| Returns Desk | Six representative final-label cases and source-ID probes; 23 policy fixtures | Intent is a model judgment; order facts are user supplied. Unreliable reason extraction was removed. Routing only, no refund authorization. |

Full sanitized probes and methodological limits are in each demo's QA/README/validation file. The examples are fictional. Review thresholds are demo policies, not calibrated accuracy estimates. Supported source offsets are converted from Unicode code points to browser UTF-16 indices and validated against actual source text.

## Scope and presentation

All six expose what the workflow does, editable examples, live request controls, the same performance/token/USD panel, source evidence and an integration example. Sample results never fabricate usage. Original work omits upstream attribution; existing adapted demos retain it. Icons are Phosphor SVGs. Brand fills use #3c11bd; accents use #6d4aff. No competitor comparisons or lavender overrides were added.

Analytics emit only fixed demo/action identifiers and strip URL query strings. No business text, model output or keys are sent to analytics. Actual iPhone hardware was not tested; responsive checks use Chromium. Existing App Pilot WebKit regression passes.

## Production verification

Deployed application commit `44a2b41` to https://demo.milliseconds.ai with Worker version `2a01afb9-661c-414e-8ef5-eb005357336a`. All six public live workflows passed again: 17 successful requests, 6,878 input tokens, matching displayed costs. Measurements are appended to `business-live-results.json`.

Independent public-page checks passed all 26 directory links (HTTP 200), category filtering, SVG icons and six new workflows at 1440/390/320. Initial samples made zero API calls and showed zero usage. No failed assets, browser errors or horizontal overflow were observed. Full-page capture uses instant scrolling: smooth scrolling can photograph an offscreen fixed skip link at an intermediate scroll position, which was verified as a capture artifact. The link remains outside the viewport until keyboard focus.
