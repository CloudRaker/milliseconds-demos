# Invoice Desk verification

## Scope and known limit

Ten text header fields, source spans, an amount field/value check, and deterministic required-field, arithmetic, purchase-order and duplicate checks. No line items, OCR, payment approval, accounting integration or locale-aware number parsing. All checks prepare a draft for human review. A model can confuse document roles; matching text alone does not prove semantic correctness.

## Model probe

`probe.json` records four serial requests against the real API on 2026-09-19, with no credentials. This is a bounded capability probe, not a 30-invoice model benchmark.

1. Complete fictional invoice: all ten extracted fields match the supplied record.
2. Ten answer questions: all ten spans point to the correct exact source substrings; scores range 0.970–0.999.
3. Total verification: matches=true, probability=0.979; found includes total, subtotal and tax. Application code requires an exact cent match, not substring containment.
4. Source with vendor and PO removed: PO is null, but extraction incorrectly places the customer in vendor and leaves customer null. Required-field checks keep this record in review. This is an observed model limitation, not patched with fixture values.

## Retained check

`node --experimental-strip-types src/demos/invoice-desk/check.mjs`

30 labelled offline policy cases, including eight held-out edge cases. They cover ten missing fields, amount disagreement, wrong PO/currency, duplicate records, incomplete comparison data, absent/weak evidence, no verification evidence versus disagreement, containment false positives, stale verification, malformed decimals, identical party roles and uncertain verification. Additional assertions check response types and exact span offsets. These cases validate application logic; they do not measure extraction accuracy.

## Browser acceptance

`/tmp/ms-invoice-ui.mjs` uses actual successful probe response shapes as mocked API responses. It checks zero-call initial preview, edited total review, missing PO, three-call live run, source highlight, sample/live provenance after amount-only verification, API failure, cancellation/late response, retry, mobile overflow, and clearing stale draft on source edits.

Screenshots: `/tmp/ms-build-invoice-desk-qa/desktop.png` and `/tmp/ms-build-invoice-desk-qa/mobile.png`.

## Root coordinated live QA

Open `/invoice-desk/`, choose `Complete invoice`, then click `Process invoice`. Expect three calls: extract, answer, verify. Inspect `#id-vendor` = Northstar Studio and `#id-customer` = Harbor Works. Click `Inspect total due evidence`; the marked source should equal the answer span. Change `#id-total` to 2820: arithmetic and PO checks enter review immediately with no call. `Recheck total live` performs one verify call. Choose `Missing PO`: initial sample has a missing-field exception without a request. Cancel leaves Stopped rather than a completed result.

A 0.9 source-span/verify score is a demo review threshold, not calibrated financial accuracy. Every extraction remains an editable draft. Edits never rewrite the source evidence to match the visitor's value.
