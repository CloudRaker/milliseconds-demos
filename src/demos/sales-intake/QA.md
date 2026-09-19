# Sales Intake verification

2026-09-19. Synthetic examples only. UI quality and model correctness are separate.

## Live model checks

Twenty serial HTTP requests were made across initial probes and wording revisions, with at least three seconds between starts. `probe-results.json` retains the final implemented response sequence: one yes-no intent batch over all 30 labels, extraction over six visible examples, and three fit classifications over those six examples. The records combine independent endpoint probes; they are not a browser performance measurement.

- Final intent winner matches 26 of 30 manual labels, including 6 of 6 held-out examples (IDs25–30).
- The four missed intents are IDs12,13,14,21, returned as unclear. All enter Human review.
- The conservative uncertainty rule marks 16/30 for review. All14 remaining suggested destinations match the labels in this small set. This does not establish production accuracy.
- Competing high yes-no signals are common: legitimate purchase inquiries also trigger vendor-pitch signals. The UI exposes review instead of treating one as definitive.
- The initial classify-only design matched20/30; the stronger intent-signal design replaced it. Held-out inputs were not edited. Because the endpoint design changed after initial evaluation,6/6 is descriptive and not a clean untouched-model benchmark.
- Extraction gets all six fields of Northstar correct. It omits Cedar's stated use case and the applicant's name; the vendor's contact becomes "sales director" and its offered price becomes a budget. Non-sales records display only contact/company/email. All fields remain editable drafts; exact source matches are explicitly not semantic verification.
- Fit classifiers can confuse missing facts with negative evidence. Missing source-backed need or timing forces the corresponding dimension to Unknown. Known fit uses only the remaining weight; coverage is displayed separately, including in the queue.
- Timing wording matters. "Within the next three months" failed on "next month" in the first probe. The default is now the narrower "Is planning a project or purchase soon, such as next month". Arbitrary edited criteria require fresh evaluation and remain model judgments.
- On the visible sales examples, final policy yields Northstar match/match/match; Cedar unknown/match/unknown; Brightside not-fit/match/unknown. The clearly labelled curated preview includes the intended Brightside timing interpretation; live outputs are never replaced by these fixtures.

Run the optional five-request probe with `MS_API_KEY` in the environment: `node --experimental-strip-types src/demos/sales-intake/probe.mjs`. It overwrites the sanitized result artifact. No key is logged or stored.

## Deterministic and browser checks

- `node --experimental-strip-types src/demos/sales-intake/check.mjs`: weighted unknowns, zero weights, missing required fields, source substring validation, malformed batches/types, weak and contradictory intent signals,30 fixtures.
- `node --experimental-strip-types src/demos/sales-intake/ui-check.mjs`: mocked real browser; zero-call preview; no-key prompt; source highlight; local weights without requests; live five-call sequence; criteria/source invalidation; transport failure and retry; cancellation with late-response guard; malformed results;390px overflow.
- `pnpm exec tsc --noEmit` and `pnpm run build`.
- Screenshots inspected: `/tmp/ms-build-sales-intake-qa/desktop.png` and `mobile.png` (1440 and390 widths). Browser QA uses Chromium, not Safari/iOS.

UI check accepts `QA_BASE` and `PLAYWRIGHT_MODULE`. Worker dev server is port4332. Worktree QA needs Vite fs.allow to include shared node_modules; a temporary uncommitted config handles that.

## Reviewer / live browser selectors

1. Open `/sales-intake/`; inspect Sample preview and zero API metrics.
2. `Run inbox live`: exactly5 HTTP calls for the6-message inbox (yes-no,extract,classify,classify,classify).
3. `#si-weight-0`: reorders locally; metrics remain unchanged.
4. `#si-criterion-0` or `#si-source`: clears existing results and requires a new run.
5. `Show source for Company`: validated literal highlight; absent wording reports a review state.
6. `#si-email`: edit draft email. Missing email remains a handoff issue.
7. `Stop` during a run; retry must not restore old or partial results.
8. `Add your message`: editable source, maximum8 messages,20,000 characters each.

No CRM write, email send, background enrichment, purchase probability, saved-time claim or production accuracy claim is made.
