# Demo expansion strategy

2026-09-19. Accepted strategy, implemented on 2026-09-19: all six demos. See business-demo-quality-review.md for final scope and validation.

## Direction

Build three business-workflow demos first: Invoice Desk, Sales Intake, and Catalog Studio. They should make a visitor recognize work their company already does, see it happen, and understand how to integrate it.

The original twenty demos cover classification, scoring, routing, moderation, search, and interactive simulations well. Their metadata features classify, yes-no, rate and one classify-tree example. None advertises answer, entities, extract or verify. That leaves document understanding and source-backed records largely invisible.

Treat business value as a hypothesis to validate with prospects and usage, not a claim of measured savings. Priorities below are editorial judgments based on workflow clarity, repeated work, API fit, and how much new capability the demo reveals.

## Research that informed the recommendation

TypeSafe's [use-case map](https://docs.typesafe.ai/concepts/use-case-map) lists lead qualification, product catalog processing, support operations, document review, and AI-workflow checks. Its useful architectural patterns are [intent routing](https://docs.typesafe.ai/patterns/intent-routing), [composite scoring](https://docs.typesafe.ai/patterns/composite-scoring), and [confidence-gated routing](https://docs.typesafe.ai/patterns/confidence-routing). The opportunity for our demos is to turn such patterns into recognizable business outcomes.

These are research inputs, not evidence of buyer demand or model performance. Do not put competitor names, comparisons, or their performance claims into the demo UI. Use attribution only when code or creative work was actually adapted; original demos should not inherit the existing upstream attribution automatically.

Own-product feasibility was checked against the local `milliseconds-fern` documentation, including `capabilities/extract.mdx`, `capabilities/verify.mdx`, `capabilities/answer.mdx`, `capabilities/entities.mdx`, and the invoice and taxonomy recipes. The public documentation could not be retrieved by the research browser. Validate actual responses before designing around any behavior described in those files.

## Wave 1: three distinct business outcomes

### 1. Invoice Desk — turn invoice text into a reviewable record

- **Buyer:** finance operations, accounts payable, document-automation developers.
- **Value hypothesis:** less rekeying and a focused queue of missing or conflicting fields.
- **First interaction:** select an invoice, press Process, and watch a draft record fill beside the source text. Then change the amount in the draft or remove the purchase-order reference and rerun the check.
- **Visible result:** invoice number, vendor, billed company, total, currency, date and terms; source evidence where available; Ready for review / Missing information / Conflicting value lanes.
- **Model work:** extract fields; use answer for exact source offsets; verify selected critical field/value pairs. Keep vendor and billed company separate.
- **Code work:** validate required fields, compare against supplied purchase-order data, check duplicates, and perform arithmetic on structured values. No model-generated explanations of those checks.
- **Outcome counters:** records processed, required fields missing, discrepancies found, records needing review. A clean record is not a payment authorization.
- **V1 boundary:** pasted or supplied text, a small set of invoice headers. No PDF/OCR promise, accounting integration, payments, or variable-length line-item extraction.
- **Why first:** immediately understandable, visually concrete, and demonstrates several capabilities absent from the current gallery. Our existing invoice recipe provides a starting point and already documents vendor/customer confusion worth testing.

### 2. Sales Intake — turn inbound messages into a useful sales queue

- **Buyer:** revenue operations, sales operations, SaaS teams.
- **Value hypothesis:** fewer manual lookups and handoffs; faster identification of relevant inquiries.
- **First interaction:** run a mixed inbox containing purchase inquiries, existing-customer questions, job applications, vendor pitches and spam. Edit the target-customer criteria and see the queue reorder.
- **Visible result:** draft company/contact/use-case fields, stated timing and budget when present, fit dimensions, destination team, and missing facts.
- **Model work:** classify intent; extract stated facts; score explicit fit criteria; answer evidence questions about the message.
- **Code work:** transparent weighted fit score and routing rules. Changing weights recomputes the score from existing dimension results without another model call. Changing the criteria requires fresh evaluation.
- **Outcome counters:** sales inquiries, routed inquiries, missing required information, cases needing a person.
- **V1 boundary:** no fabricated firmographics, external enrichment, email sending, or CRM writes. A fit score is not a purchase probability. Unknown budget remains unknown, rather than becoming a negative fact.
- **Why second:** introduces a revenue-oriented story and shows how users can control the decision policy.

### 3. Catalog Studio — turn inconsistent listings into structured products

- **Buyer:** ecommerce operations, marketplaces, catalog software developers.
- **Value hypothesis:** less manual tagging and attribute cleanup before products become searchable.
- **First interaction:** process a small batch of differently written product descriptions. Watch category paths and attributes fill; select a row to see the supporting wording and missing required attributes.
- **Visible result:** category, brand, material, dimensions, color and other explicitly stated attributes; a review lane; downloadable draft CSV/JSON.
- **Model work:** classify or classify-tree for category, extract for fields, entities/answer for repeated mentions or evidence, narrow yes-no checks for defined listing rules.
- **Code work:** category-specific required fields, unambiguous unit conversion, enum validation and export. Preserve original values next to normalized ones.
- **Outcome counters:** listings categorized, required attributes filled, listings incomplete, listings needing review.
- **V1 boundary:** text descriptions only; no image understanding, counterfeit verdict, or invented attributes. Product Search remains the shopper-facing counterpart.
- **Why third:** strong batch visualization and a clear relationship between structured data and a business system.

## Wave 2: expand only after the first wave gets useful engagement

| Demo | Concrete experience | Business outcome | Reuse and boundary |
| --- | --- | --- | --- |
| Evidence Check | Compare a proposed record or short answer with a supplied source; deliberately alter an amount, date, or claim | Help reviewers find unsupported fields or assertions before reuse | Extend Document Reranker. Field/value checks use verify; sentence-level support uses separate narrow judgments. No universal truth-checking claim. |
| Private Share | Highlight personal/customer data in a support transcript and show a redaction preview the user can correct | Prepare text for sharing with a vendor or another team | Use entities with offsets and literal redaction code. Distinct from Send Guard's send/no-send decision. Missing detections must remain a tested limitation. |
| Returns Desk | Read a return request beside order facts and a stated policy; route to standard handling, missing information, or exception review | Make routine policy workflows easier to handle consistently | Extend Inbox Triage/Agent Assist. Code owns dates, amounts and policy thresholds; the model reads intent and evidence. No actual refund or claim of legal eligibility. |

Additional verticals, such as insurance intake or procurement exceptions, can reuse these patterns once prospect conversations identify demand. Avoid launching ten thin variations before learning which workflow people actually try.

## One consistent experience, without making every demo look identical

Each demo should answer four questions immediately: What work is this? What do I provide? What result do I get? What still needs a person?

1. A useful example is already loaded. Visitors can inspect a clearly labelled sample result without a key, then run live with their own key. Sample records never inflate live token, time or dollar metrics.
2. One primary action produces an understandable outcome. The app presents records, a queue or a redaction preview—not a wall of probability bars.
3. Users can inspect the input, returned fields, supporting spans, and exact rule behind a route. Evidence comes from returned source spans, not invented explanation text.
4. A deliberately ambiguous or incomplete example demonstrates review handling. Users can change a fact and see the result change.
5. The existing shared Performance & cost component stays authoritative. Business counters sit beside the workflow. Any extrapolated cost per 1,000 items must be labelled as an estimate from the measured sample; no invented hours or dollars saved.
6. “Build this workflow” exposes a small runnable request sequence, schema and routing policy. Use the existing proxy/client, Phosphor icons and brand tokens. No live business-system integrations are needed to prove the workflow.

Adapt layouts to the work: source plus fields for invoices; queues plus fit dimensions for leads; editable rows for catalogs. Extract shared components only after the first two demos reveal actual duplication.

## Technical decisions before implementation

- Make attribution optional in `DemoMeta` and the shared layout; the current layout unconditionally credits the source experiments.
- Add business-category metadata for discovery. Feature the three new workflows prominently and offer filters such as Documents & operations, Sales & commerce, Customer experience, and Developer & interactive. Keep existing URLs.
- Keep the first inputs text-based. The API reads text; adding file upload without a parsing pipeline would imply a capability the demo does not provide.
- Current extract documentation says arrays of objects are returned empty. Do not design invoice line-item tables around unsupported structured extraction.
- `extract` supplies no per-field probability or offsets. `verify` supplies matched strings, not offset citations or an independent guarantee of correctness. `answer` and `entities` provide offsets; check them against the submitted text.
- Do not reuse a single confidence threshold across endpoints or present probability as calibrated accuracy. Tune routing on labelled examples and inspect misses.
- Distinguish absent evidence, conflicting evidence, low-confidence output, transport failure and unprocessed input. Never turn these into a generic green success state.
- Respect the existing page-wide API queue. Multiple capability types require their actual requests; do not copy another API's promise of mixed questions in one flat-latency request.

## Delivery sequence and acceptance

**First: prove the three core flows.** Before polished UI, collect about 30 representative labelled inputs per workflow, reserve a subset for validation, and run the exact proposed API calls. Include missing fields, ambiguous names, contradictory values and irrelevant requests. Record correctness, latency, token use and failure modes. Reduce scope if the capability cannot support the experience honestly.

**Then: finish Invoice Desk end to end.** Use it to establish input, source evidence, review state and export conventions. Reuse the parts that fit Sales Intake and Catalog Studio. Ship one at a time so each has a complete story.

**Retain the 9/10 interface gate.** Independent reviewers assess purpose clarity, business usefulness, truthfulness of outcomes and metrics, responsive/accessibility quality, and interaction quality. Iterate below 9/10. A visual score cannot substitute for the labelled-input checks.

Functional checks must also pass: missing required values cannot be marked complete; model failures cannot count as processed successes; displayed totals must match actual returned records; cost and token totals must reconcile with API headers; retries and cancellation must leave honest states. Evaluate source/role confusion and routing errors against held-out labels and report the actual results separately.

**Measure whether to expand.** Track sample inspected, live run started/completed, own input tried, evidence opened, policy changed, code copied, and API-key CTA clicked. Record aggregate events, never submitted business text or API keys. Compare demos by successful own-input runs and integration intent, not raw clicks alone. Use early prospect conversations to validate the proposed operational value before making ROI claims.

## First build recommendation

Start with Invoice Desk. Its defining moment is a record filling from source text, a conflicting field moving into review, and a user correcting it with visible evidence. That makes the product's usefulness concrete without requiring a comparison or a complex animation.
