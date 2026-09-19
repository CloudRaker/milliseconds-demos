import type { DocKind } from "../types.ts";

export interface SourceDoc {
  slug: string;
  title: string;
  kind: DocKind;
  sections: { id: string; text: string }[];
}

/**
 * Hand-written engineering handbook for the fictional company "Northwind Systems".
 * Written so that many passages share vocabulary (review, rotation, budget, leave,
 * deploy, window) while answering different questions — keyword search alone
 * cannot tell them apart.
 */
export const HANDBOOK: SourceDoc[] = [
  {
    slug: "handbook/code-review",
    title: "Code review",
    kind: "handbook",
    sections: [
      {
        id: "approvals",
        text: "Every pull request into a protected branch needs approval from at least one reviewer who is not the author, and from a code owner for any path listed in CODEOWNERS. Reviews are expected within one business day; if you cannot get to a review in that window, hand it off in the team channel rather than letting it sit. Approving your own PR with a second account is grounds for losing merge rights.",
      },
      {
        id: "size",
        text: "Keep pull requests under roughly 400 changed lines. Larger changes should be split into a stack: a refactor-only PR with no behavior change, then the behavior change, then the cleanup. Reviewers are allowed to bounce a PR that mixes refactoring with functional changes and ask for the split, even if the code itself is fine.",
      },
      {
        id: "comments",
        text: "Prefix review comments with their weight: `nit:` for optional style points, `question:` when you want to understand a choice, and `blocking:` when the PR must not merge until it is addressed. Unprefixed comments are treated as non-blocking suggestions. Resolve threads yourself only if you authored the comment or applied the exact change requested.",
      },
      {
        id: "generated-code",
        text: "Generated files (protobuf stubs, OpenAPI clients, lockfiles, database snapshots) must be committed in a separate commit from hand-written changes, with the generator command in the commit message. Reviewers skip diffs of generated files and instead check that the generator was run from the committed sources.",
      },
    ],
  },
  {
    slug: "handbook/branching",
    title: "Branching and commits",
    kind: "handbook",
    sections: [
      {
        id: "naming",
        text: "Branch names follow `<user>/<ticket>-<short-description>`, for example `mira/NW-4821-payout-retries`. Long-lived shared branches are discouraged; if a feature needs one, name it `feature/<name>` and rebase it on main at least weekly. Release branches are cut by the release captain as `release/YYYY.MM.DD` and only receive cherry-picked fixes.",
      },
      {
        id: "commit-messages",
        text: "Commit subjects are imperative, at most 72 characters, and reference the ticket in the body rather than the subject: `Retry failed payouts with jittered backoff`. Squash merging is the default for pull requests, so the PR title becomes the commit subject on main; edit the title before merging if the review changed the scope.",
      },
      {
        id: "main-protection",
        text: "Direct pushes to main are blocked for everyone including administrators. Force pushes are permitted only on your own personal branches. A broken main is treated as a SEV3 incident: whoever notices it posts in #eng-main-health and either reverts the offending commit or gets the author to fix forward within 30 minutes.",
      },
    ],
  },
  {
    slug: "handbook/ci",
    title: "Continuous integration",
    kind: "handbook",
    sections: [
      {
        id: "required-checks",
        text: "The required checks on every PR are lint, typecheck, unit tests, and the license scan. Integration tests run only when the PR touches a service directory or a shared library. A red required check blocks merge; you cannot override it, but you can ask a build cop to re-run a job that failed on infrastructure rather than on code.",
      },
      {
        id: "flaky-tests",
        text: "A test that fails and then passes on retry without a code change is flaky. Flaky tests are quarantined by adding the `@flaky` tag, which moves them to a non-blocking job, and a ticket is opened against the owning team with a two-week deadline. A quarantined test that is not fixed within two weeks is deleted, not left in quarantine forever.",
      },
      {
        id: "caching",
        text: "CI caches dependency downloads keyed on the lockfile hash and build outputs keyed on the content hash of source inputs. If a build behaves differently in CI than locally, first clear the cache for your branch using the `Re-run without cache` button; corrupt caches account for most unreproducible CI failures.",
      },
    ],
  },
  {
    slug: "handbook/deploys",
    title: "Deployment process",
    kind: "handbook",
    sections: [
      {
        id: "pipeline",
        text: "Merging to main deploys automatically to the staging environment. Production deploys are promoted from staging by clicking Promote in the deploy console, which runs the smoke suite and then rolls out as a canary to 5% of pods for 15 minutes before completing. Anyone on the owning team can promote; you do not need a manager's approval.",
      },
      {
        id: "freeze",
        text: "A deploy freeze is in effect from the last business day before a public holiday until the first business day after, and during the annual end-of-year freeze from December 20 to January 3. During a freeze, only fixes for SEV1 and SEV2 incidents may be deployed, and they require sign-off from the incident commander in the incident channel.",
      },
      {
        id: "rollback",
        text: "To roll back a production deploy, open the deploy console, select the previous green release, and click Rollback; it takes about 90 seconds and does not require a new build. Roll back first and investigate second. Database migrations are not rolled back automatically, which is why migrations must be backward compatible with the previous release.",
      },
      {
        id: "canary",
        text: "The canary stage compares error rate and p99 latency between canary pods and the baseline fleet. A rollout is aborted automatically if the canary's 5xx rate exceeds the baseline by more than 0.5 percentage points or its p99 latency regresses by more than 20% over the 15-minute window. You can lengthen the window for low-traffic services in the service's deploy config.",
      },
      {
        id: "windows",
        text: "Production deploys are allowed between 08:00 and 17:00 in the service owner's local time on business days. Deploying outside that window requires a second person online who has agreed to watch the rollout. The restriction exists so that a bad deploy is noticed by people who are awake, not to limit how often you ship.",
      },
    ],
  },
  {
    slug: "handbook/feature-flags",
    title: "Feature flags",
    kind: "handbook",
    sections: [
      {
        id: "usage",
        text: "Wrap any user-visible behavior change in a feature flag so that shipping code and enabling behavior are separate decisions. Flags are created in the Flagship console and default to off in every environment. Roll out by percentage of users, by organization ID, or by internal-staff-only, in that order of caution.",
      },
      {
        id: "cleanup",
        text: "A flag that has been at 100% for 30 days is stale. The flag linter opens a PR to remove stale flags and their dead branches; the owning team must merge or justify it within two weeks. Long-lived operational flags (kill switches) are exempt if they are tagged `permanent` and have an owner.",
      },
    ],
  },
  {
    slug: "handbook/incidents",
    title: "Incident management",
    kind: "handbook",
    sections: [
      {
        id: "severity",
        text: "SEV1: a customer-facing outage or data loss affecting many customers; page everyone needed, executive update every 30 minutes. SEV2: major functionality degraded for a subset of customers or a full outage of an internal system that blocks work. SEV3: minor degradation with a workaround, or a broken main branch. SEV4: cosmetic or single-customer issues handled in normal business hours.",
      },
      {
        id: "declaring",
        text: "Anyone can declare an incident by running `/incident declare` in Slack, which creates a channel, pages the on-call for the affected service, and starts the timeline bot. Do not wait to confirm the root cause before declaring; downgrading a severity later is free, while a late declaration is the most common finding in postmortems.",
      },
      {
        id: "roles",
        text: "Each incident has an incident commander who coordinates and makes decisions, a communications lead who updates the status page and stakeholders, and one or more responders who investigate. The commander should not be debugging. If the on-call engineer is alone, they are the commander until someone else joins and takes the role explicitly.",
      },
      {
        id: "status-page",
        text: "The public status page is updated by the communications lead within 15 minutes of a SEV1 or SEV2 being declared, and at least every 60 minutes until resolution. Use the templates in the status tool; never speculate about the cause publicly. Internal stakeholders are updated in #incident-updates, not by direct message.",
      },
    ],
  },
  {
    slug: "handbook/postmortems",
    title: "Postmortems",
    kind: "handbook",
    sections: [
      {
        id: "when",
        text: "A written postmortem is required for every SEV1 and SEV2 incident and for any SEV3 that recurs within a quarter. The draft is due within five business days of resolution, and the review meeting happens within ten. Postmortems are blameless: they describe what the system and process allowed to happen, and never name an individual as a cause.",
      },
      {
        id: "action-items",
        text: "Each postmortem action item has an owner, a ticket, and a due date no more than 90 days out. Items are tracked on the reliability board and reviewed monthly by the reliability lead; an action item cannot be closed as won't-fix without the incident commander agreeing in the ticket.",
      },
    ],
  },
  {
    slug: "handbook/on-call",
    title: "On-call",
    kind: "handbook",
    sections: [
      {
        id: "rotation",
        text: "Each service has a primary and secondary on-call rotation of one week each, handing off on Tuesdays at 10:00 local time. Rotations are managed in PagerDuty; swap shifts by creating an override rather than editing the schedule. A rotation must have at least four people; teams smaller than that share a rotation with a neighboring team.",
      },
      {
        id: "response-times",
        text: "The primary on-call acknowledges a page within 5 minutes and begins investigating within 15. If a page is not acknowledged in 5 minutes it escalates to the secondary, and after a further 10 minutes to the engineering manager. Acknowledging a page means you are actively working it, not that you have seen it.",
      },
      {
        id: "compensation",
        text: "Engineers receive an on-call stipend of $500 per primary week and $250 per secondary week, paid with the following month's salary. If you are paged and work outside business hours for more than two hours in a night, you take the following morning off; if you handle a SEV1 overnight, you take the whole next day off. This time off is not deducted from vacation.",
      },
      {
        id: "handoff",
        text: "At handoff, the outgoing primary posts a summary in the team channel covering open alerts, anything silenced, and risky changes scheduled for the coming week. The incoming primary confirms they have the PagerDuty app installed with critical alerts enabled and that their phone will bypass do-not-disturb for it.",
      },
    ],
  },
  {
    slug: "handbook/reliability",
    title: "SLOs and error budgets",
    kind: "handbook",
    sections: [
      {
        id: "slos",
        text: "Every customer-facing service defines an availability SLO and a latency SLO measured over a rolling 28-day window. The default targets are 99.9% of requests succeeding and 99% of requests completing under the service's declared latency threshold. SLOs are defined in the service's `slo.yaml` and rendered on the reliability dashboard.",
      },
      {
        id: "error-budget",
        text: "The error budget is the amount of unreliability the SLO permits: at 99.9% availability that is about 40 minutes of full downtime per 28 days. When a service has consumed its entire error budget, feature work pauses and the team works only on reliability until the budget is positive again. The reliability lead can grant a one-time exception for a contractual deadline.",
      },
      {
        id: "alerting",
        text: "Page-worthy alerts are based on burn rate, not raw error counts: page when the service is burning its 28-day error budget at a rate that would exhaust it within 2 hours (fast burn) or within 3 days (slow burn, ticket rather than page). Alerts on CPU, memory, or disk are tickets, not pages, unless they indicate imminent customer impact.",
      },
    ],
  },
  {
    slug: "handbook/observability",
    title: "Logging and metrics",
    kind: "handbook",
    sections: [
      {
        id: "structured-logs",
        text: "Logs are emitted as single-line JSON with at minimum `timestamp`, `level`, `service`, `trace_id`, and `message`. Never log request bodies, authorization headers, or anything that could contain personal data; the log pipeline drops fields named `password`, `token`, `secret`, and `authorization` but that is a backstop, not permission.",
      },
      {
        id: "log-retention",
        text: "Application logs are retained for 30 days in hot storage and 13 months in cold storage. Audit logs from the auth gateway and admin tooling are retained for 7 years. Log rotation on hosts is handled by the agent, which ships and deletes files once they exceed 256 MB or 24 hours; do not configure logrotate yourself.",
      },
      {
        id: "metric-naming",
        text: "Metric names are `<service>_<subsystem>_<measure>_<unit>` in snake_case, e.g. `ledger_payout_duration_seconds`. Labels must have bounded cardinality: never use a user ID, request ID, or email as a label. Histograms are preferred over summaries because they can be aggregated across pods.",
      },
      {
        id: "tracing",
        text: "All services propagate the W3C `traceparent` header and export spans to the tracing backend at a 10% sample rate in production and 100% in staging. Set the sample rate to 100% for a specific request by adding the header `x-debug-trace: 1`, which works only for requests originating from the corporate VPN.",
      },
    ],
  },
  {
    slug: "handbook/secrets",
    title: "Secrets management",
    kind: "handbook",
    sections: [
      {
        id: "storage",
        text: "Secrets live in Vault and are injected into workloads as environment variables at start-up by the secrets sidecar. Never commit a secret to a repository, put one in a Slack message, or paste it into a ticket, even a private one. The pre-commit hook and the CI secret scanner both block known key formats, but they cannot recognize every secret.",
      },
      {
        id: "rotation",
        text: "Database credentials and third-party API keys are rotated automatically every 90 days by the rotation job, which writes the new value to Vault and restarts dependents in a rolling fashion. Rotation of a secret that is not automated must be done manually at least once a year and recorded in the service's security checklist.",
      },
      {
        id: "leak",
        text: "If you suspect a secret has leaked, rotate it immediately from Vault using `Rotate now`, then declare a SEV2 incident and notify #security. Do not first try to figure out whether the leak was real; rotation is cheap and a leaked credential is expensive. The security team will handle scanning for misuse.",
      },
    ],
  },
  {
    slug: "handbook/access",
    title: "Access and accounts",
    kind: "handbook",
    sections: [
      {
        id: "requests",
        text: "Request access to systems through the Access Portal, which routes the request to the resource owner and grants time-boxed access: 8 hours for production databases and 90 days for everything else, after which access expires and must be re-requested. Emergency production access can be self-granted for 1 hour with a justification, and each use is reviewed by security the next business day.",
      },
      {
        id: "mfa",
        text: "All accounts require multi-factor authentication with a hardware security key; SMS and voice codes are not accepted. New hires receive two security keys on their first day and should register both, keeping one at home as a backup. If you lose both keys, identity verification with the IT desk over video is required to enroll a new one.",
      },
      {
        id: "vpn",
        text: "The corporate VPN is required to reach internal dashboards, staging environments, and the admin consoles. Install the client from the IT self-service portal and authenticate with your SSO account plus security key. The VPN disconnects automatically after 12 hours; production systems are never reachable from the VPN directly, only through the bastion.",
      },
      {
        id: "offboarding-access",
        text: "When someone leaves, their SSO account is disabled at 17:00 on their last day, which revokes VPN, email, and all SSO-integrated apps. Managers must file a ticket for any shared credentials the person had access to so that those are rotated within 24 hours of departure.",
      },
    ],
  },
  {
    slug: "handbook/data",
    title: "Data handling",
    kind: "handbook",
    sections: [
      {
        id: "classification",
        text: "Data is classified as Public, Internal, Confidential, or Restricted. Restricted covers payment card numbers, government IDs, health information, and authentication secrets and may only be stored in systems that have passed a security review for that class. Confidential covers customer PII such as names, emails, and addresses.",
      },
      {
        id: "retention",
        text: "Customer data is retained for the life of the account plus 90 days, after which it is hard-deleted by the retention job. Backups containing that data age out within a further 35 days. Financial records required for tax purposes are kept for 7 years in the archival store regardless of account status.",
      },
      {
        id: "deletion-requests",
        text: "A customer's request to delete their personal data (GDPR Article 17, CCPA) is handled through the privacy queue, not by engineers directly. The privacy team verifies identity, then triggers the erasure workflow, which must complete within 30 days of the request. Engineers who receive such a request by email forward it to privacy@ and do not reply to the customer.",
      },
      {
        id: "production-data",
        text: "Production data may not be copied to laptops or to staging. Use the anonymized snapshot, refreshed nightly, which replaces names, emails, and free-text fields with generated values while preserving referential integrity. If a bug can only be reproduced with real data, debug against production through the read-only replica with time-boxed access.",
      },
    ],
  },
  {
    slug: "handbook/api-design",
    title: "API design",
    kind: "handbook",
    sections: [
      {
        id: "versioning",
        text: "Public APIs are versioned in the URL path (`/v1/`, `/v2/`). Additive changes such as new optional fields or new endpoints do not require a new version. Removing a field, changing a type, or changing the meaning of a status code does. Internal service-to-service APIs use protobuf and evolve by adding fields, never reusing field numbers.",
      },
      {
        id: "deprecation",
        text: "A deprecated API version stays available for at least 12 months after its replacement ships. Deprecation is announced in the changelog, by email to affected API key owners, and by the `Deprecation` and `Sunset` response headers. Usage of the old version is tracked per customer so account managers can reach out to the last holdouts before shutdown.",
      },
      {
        id: "errors",
        text: "Error responses use RFC 9457 problem details: a JSON body with `type`, `title`, `status`, `detail`, and a `request_id` that customers can quote to support. Use 400 for malformed requests, 422 for well-formed but semantically invalid ones, 409 for conflicts with current state, and 429 for rate limiting, always with a `Retry-After` header.",
      },
      {
        id: "idempotency",
        text: "Every endpoint that creates or mutates money-related state accepts an `Idempotency-Key` header. Keys are stored for 24 hours; a replay with the same key and same body returns the original response, and a replay with the same key but a different body returns 422. Clients should generate a UUID per logical operation, not per HTTP attempt.",
      },
      {
        id: "pagination",
        text: "List endpoints paginate with opaque cursors: pass `limit` (max 200, default 50) and `cursor`, and read `next_cursor` from the response. Offset pagination is not offered because it produces duplicates or gaps when rows are inserted during iteration. Cursors expire after 24 hours.",
      },
    ],
  },
  {
    slug: "handbook/databases",
    title: "Databases and migrations",
    kind: "handbook",
    sections: [
      {
        id: "migrations",
        text: "Schema migrations are expand-and-contract: add the new column or table in one release, backfill and dual-write in the next, and drop the old structure only after the code that reads it is gone. A migration must be safe to run while the previous release is still serving traffic, because deploys roll out gradually and roll back without reverting migrations.",
      },
      {
        id: "locking",
        text: "Adding an index on a table over 1 million rows must use `CREATE INDEX CONCURRENTLY`; adding a NOT NULL column with a default must be split into add-nullable, backfill in batches of 10,000, then set NOT NULL. The migration linter rejects statements that take an ACCESS EXCLUSIVE lock on large tables.",
      },
      {
        id: "schema-review",
        text: "Any migration to a Tier 1 database (ledger, identity, billing) needs a schema review from the data platform team in addition to normal code review. Request it by adding the `schema-review` label; the SLA is two business days. Reviews focus on lock behavior, index bloat, and whether the change is reversible.",
      },
      {
        id: "backups",
        text: "Tier 1 databases take continuous WAL backups with point-in-time recovery to any second in the last 35 days, plus a daily snapshot retained for 1 year. Restore drills run quarterly; the last drill restored the ledger database in 41 minutes. To request a restore, page the data platform on-call — do not attempt it yourself.",
      },
    ],
  },
  {
    slug: "handbook/testing",
    title: "Testing",
    kind: "handbook",
    sections: [
      {
        id: "pyramid",
        text: "Aim for many fast unit tests, a moderate number of integration tests that exercise real databases and queues in containers, and a small set of end-to-end tests against staging. End-to-end tests are owned by the platform QA guild and must complete within 20 minutes total, so new ones must replace or merge with an existing one.",
      },
      {
        id: "coverage",
        text: "There is no hard coverage threshold, but the coverage bot comments on PRs that reduce coverage of a package by more than 2 percentage points, and the reviewer should ask why. Tests that only assert that mocks were called are discouraged; assert on observable outputs instead.",
      },
      {
        id: "load-testing",
        text: "Load tests run against the perf environment, never against staging or production. Book a slot on the perf calendar, tag the run with your ticket, and stop at the agreed request rate; the perf environment shares a payment sandbox with other teams. Results are attached to the launch checklist for any feature expected to add more than 10% traffic.",
      },
    ],
  },
  {
    slug: "handbook/dependencies",
    title: "Dependencies and licenses",
    kind: "handbook",
    sections: [
      {
        id: "upgrades",
        text: "Dependency update PRs are opened weekly by the bot, grouped by ecosystem. Patch and minor updates auto-merge if CI passes; major updates need a human reviewer. Pin exact versions in application lockfiles. A new dependency should have been published for at least 7 days before we adopt it, to avoid picking up a compromised release.",
      },
      {
        id: "licenses",
        text: "Permitted licenses for dependencies are MIT, BSD, Apache 2.0, ISC, and MPL 2.0. GPL and AGPL dependencies are not permitted in any shipped code, and LGPL requires a legal review. The license scan in CI fails on unknown or forbidden licenses; request an exception through the legal-review ticket type.",
      },
      {
        id: "vulnerabilities",
        text: "Critical and high CVEs in dependencies must be patched within 7 days and 30 days respectively, measured from when the advisory appears in the scanner. If no fixed version exists, document the compensating control in the service's security checklist. The security team publishes a weekly digest of open findings by team.",
      },
    ],
  },
  {
    slug: "handbook/architecture",
    title: "Architecture decisions",
    kind: "handbook",
    sections: [
      {
        id: "adrs",
        text: "Decisions that affect more than one team are recorded as Architecture Decision Records in the `adr/` directory of the platform repo, numbered sequentially, with Context, Decision, and Consequences sections. An ADR is proposed in a PR, discussed for at least one week, and accepted when two members of the architecture group approve.",
      },
      {
        id: "service-ownership",
        text: "Every service has exactly one owning team listed in `catalog.yaml`, which drives paging, cost attribution, and dashboards. Orphaned services (owner team dissolved) are assigned to the platform team temporarily and flagged on the catalog dashboard until a new owner is found or the service is decommissioned.",
      },
      {
        id: "new-service",
        text: "Before creating a new service, write a one-page proposal covering why it cannot live in an existing service, its owning team, its SLO, and its data classification. The template in the platform repo generates the repository, CI, deploy pipeline, dashboards, and on-call rotation; do not hand-roll any of these.",
      },
    ],
  },
  {
    slug: "handbook/laptops",
    title: "Devices and workstation",
    kind: "handbook",
    sections: [
      {
        id: "setup",
        text: "New laptops are provisioned by IT with disk encryption, the endpoint agent, and the SSO-managed browser profile. Run `nw bootstrap` from the internal CLI to install the toolchain, clone the repos you have access to, and configure git signing. The bootstrap script is idempotent; re-run it whenever the toolchain manifest changes.",
      },
      {
        id: "lost-device",
        text: "If a laptop or phone with company access is lost or stolen, report it immediately to the IT desk by phone or in #it-help, at any hour. IT will remotely wipe the device and revoke its sessions. You will not be charged for a lost device and reporting promptly is never held against you; a delay in reporting is the only thing that causes problems.",
      },
      {
        id: "refresh",
        text: "Laptops are refreshed every three years or when a repair would cost more than half the replacement price. You may choose between the standard configurations listed in the IT portal; non-standard requests require manager approval and a justification. Old devices are wiped and either recycled or donated through the IT program.",
      },
    ],
  },
];
