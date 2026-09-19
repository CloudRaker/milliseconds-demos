# Catalog Studio acceptance evidence

## Verified locally

- `pnpm exec tsc --noEmit`
- `node --experimental-strip-types src/demos/catalog-studio/check.mjs`
- `QA_BASE=http://127.0.0.1:4333 node src/demos/catalog-studio/ui-check.mjs`
- Chromium at 1440 and 390 px: sample makes zero calls; review filtering, source highlighting, draft CSV download, no-key prompt, two-request live mock, input invalidation, failure/retry, cancellation and overflow checks pass.
- Screenshots viewed: `/tmp/ms-build-catalog-studio-qa/{1440,390}-{preview,evidence}.png`.

## Real model evaluation

`probe.mjs` evaluates 30 labelled fictional inputs, including ten held-out examples. It makes two HTTP batch requests: classify, then extract. `probe-results.json` contains sanitized captured outcomes and measured request metadata.

- Category labels: **26/30**, including **7/10** held out.
- Expected missing attributes remained absent: **30/30 cases**. Cases with no expected missing values pass this particular check trivially; this is not whole-record accuracy.
- Three category errors involved descriptions explicitly saying a fact was not supplied. One involved a bundle spanning two categories. All four errors went to review.
- Full semantic accuracy of every extracted field was **not** graded. Exact source matching locates actual wording; it cannot establish that the model assigned the wording to the correct field. The UI and exported records remain drafts.
- The fixed 75% category review threshold is a demo policy, not a calibrated accuracy estimate.
- No production system is connected. The schema covers clothing, furniture and audio, not a universal retail taxonomy.

## Root live QA

Open `/catalog-studio/`; initial four listings are labelled Sample preview. Save a valid key in the shell. Press **Structure catalog**: expect exactly **2 HTTP requests**, one `/classify` and one `/extract`, each containing the current listings. Final `.catalog-status` begins `Live draft`.

`Needs attention` filters the queue. Click a `.catalog-row` to inspect it, then an attribute button to show `.catalog-evidence mark`. `Original description` is the editable source. Editing clears all batch outputs and disables draft exports until a new successful run. **Add listing** supports up to eight descriptions, each 20,000 chars. **Stop** aborts work; late responses cannot restore output. **Reset sample** restores the clearly labelled curated preview.

**Draft CSV** and **Draft JSON** export originals, extracted fields, category, provenance, and review notes. Spreadsheet formula-leading cells are escaped. Only supported mm/inch dimensional forms get an additional centimeter conversion; originals always remain.
