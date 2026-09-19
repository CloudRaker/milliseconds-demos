# Returns Desk validation

2026-09-19. Scope: text request + manually supplied order facts + simple configurable store policy. Two API requests per complete run (`classify`, then `answer`). No external actions.

## Live capability probes

`probe-results.json` preserves 16 sanitized serial calls using fictional text. Initial fine-grained return/exchange labels caused a return to compete with delivery status. The final broad return-or-exchange labels correctly identified six representative positive, delivery and ambiguous cases (scores .967–.999). This small set does not establish general accuracy.

A reason question returned null for “too small” and “unused” as the reason for an exchange. That feature was removed. The shipped `answer` request only asks for the order number. Held-out missing-ID input returned null; Unicode-prefixed input returned the correct ID and code-point offsets. Source matching normalizes code points to browser UTF-16 offsets and discards unmatched spans.

No model score authorizes a refund. Scores under .80 send the draft to a person; this threshold is an explicit demo routing choice, not calibrated accuracy. The model can still assign the wrong intent or extract the wrong matching span. Supplied facts need human confirmation, particularly condition and final-sale status.

## Runnable checks

- `node --experimental-strip-types src/demos/returns-desk/check.mjs`: 23 routing fixtures; inclusive date and amount boundaries; missing/invalid facts; contradictory ID; unknown/low-score intent; final sale; used/damaged conditions; calendar, DST, runtime response-shape and Unicode/source checks.
- `PLAYWRIGHT_MODULE=/Users/blaget/.agents/skills/gstack/node_modules/playwright/index.mjs QA_BASE=http://127.0.0.1:4338 node src/demos/returns-desk/browser-check.mjs`: mocked API only. Zero-call previews, all four routes/examples, source highlighting, edit invalidation, two-request live flow, cancellation/late-result suppression, failure/retry, desktop/mobile overflow, no browser runtime errors.
- `pnpm exec tsc --noEmit` and `pnpm run build` passed.
- Screenshots inspected: `/tmp/ms-build-returns-desk-qa/desktop.png`, `desktop-live.png`, `mobile.png` at 1440 and 390 CSS pixels.

## Root live browser steps

1. Open `/returns-desk/`. Initial `Sample preview` / `Standard handling` must have zero requests.
2. Set a test key using the shared key panel. Click button `Check request live`. Wait for `.rd-status` to say `Live reading complete`; `[data-testid="return-route"]` should read `Standard handling`. Expected: exactly 2 calls.
3. Click `View order evidence: “RD-1042”`; `.rd-source mark` must match submitted wording.
4. Click `Order mismatch`, then `Check request live`. Expect `Exception review` with RD-3001 vs RD-3002. Exactly 2 more calls.
5. Click `Missing facts`, then `Check request live`. Expect `Missing information`; not a transport failure. Exactly 2 more calls.
6. Edit `Return window (days, inclusive)` or `Order value (USD)`: stale result clears immediately. Running again applies new rules. No live result is repainted as a sample.

No independent score is claimed here; root coordinates independent review and final live verification.
