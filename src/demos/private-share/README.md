# Private Share verification

One live `/entities` call per run, through the shared `dm1` client. Nothing calls the API until **Detect details live** is pressed. The initial sample uses labelled, curated spans without probabilities or live telemetry. All findings start selected; model probability never silently removes a low-confidence match.

## Checks

```sh
node --experimental-strip-types src/demos/private-share/check.mjs
pnpm exec tsc --noEmit
pnpm build
# Serve dist on 4335, or set QA_BASE to an existing server.
python3 -m http.server 4335 --bind 127.0.0.1 --directory dist
node src/demos/private-share/ui-check.mjs
```

The browser check uses the existing Playwright installation by default; `PLAYWRIGHT_MODULE` can override its absolute path. Its API responses are mocked, not live quality evidence. It exercises zero-call sample loading, selection changes, exact manual masking, Unicode source spans, source-edit invalidation, errors and retry, pending-request cancellation, late-response protection, literal rendering, text download, and 390px overflow. Screenshots default to `/tmp/ms-build-private-share-qa`.

## Live probes, 2026-09-19

Five serial requests: short contact details, an emoji/Unicode-name case, a negative transcript with only version/percentage numbers, repeated email mentions, and the shipped support transcript. Requested matches were returned in all five. `probe-results.json` preserves the actual shipped sample request and response (four matches). Emoji-prefix offsets confirmed Unicode code points; the browser converts them to UTF-16 before matching the exact source substring.

These are representative smoke probes, not a PII recall benchmark. No unsupported claim of comprehensive anonymization is made. Invalid shapes or mismatched offsets are rejected and disclosed. User review is required before copying/downloading, including an empty live finding list. Source edits discard all selections. Manual redaction covers every literal occurrence, and overlapping selections merge into one replacement. Export contains only the preview text, no original hidden layer or metadata.

Root live acceptance: open `/private-share/`, click `Detect details live`, wait for `4 model findings · review the entire transcript`; inspect four highlights. Toggle the `Name` finding to see Maya Chen reappear. Re-select it, check `I reviewed the full transcript and the remaining visible details.`, then download. The downloaded text should contain four `[REDACTED]` markers and preserve the reproduction steps.
