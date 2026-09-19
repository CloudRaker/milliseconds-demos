import type { Passage } from "../types.ts";
import { HANDBOOK, type SourceDoc } from "./handbook.ts";
import { HR_POLICIES } from "./hr.ts";
import { SERVICES, type ServiceSpec } from "./services.ts";

/** Deterministic PRNG so the generated corpus is identical on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, options: T[]): T {
  return options[Math.floor(rng() * options.length)];
}

const AUTH_TEXT = {
  "api-key": (s: ServiceSpec) =>
    `${s.name} authenticates requests with an API key sent as \`Authorization: Bearer nw_live_...\`. Keys are scoped to an organization and can be restricted to read-only. Test-mode keys (\`nw_test_\`) hit the same endpoints but never touch real ${s.resource}s. Keys are issued and rolled through the Auth Gateway; ${s.name} itself never stores them.`,
  oauth: (s: ServiceSpec) =>
    `${s.name} requires an OAuth 2.1 access token obtained from the Auth Gateway's \`/oauth/token\` endpoint, sent as \`Authorization: Bearer <token>\`. Tokens must carry the \`${s.slug.replace(/-/g, "_")}:read\` or \`${s.slug.replace(/-/g, "_")}:write\` scope. Access tokens expire after one hour; refresh them with the refresh_token grant rather than re-authenticating the user.`,
  mtls: (s: ServiceSpec) =>
    `${s.name} is an internal service reachable only over mutual TLS. Callers present a workload certificate issued by the service mesh; the certificate's SPIFFE identity determines the caller's role. There are no API keys or bearer tokens. Requests without a valid client certificate are rejected at the mesh sidecar with a TLS handshake failure, not an HTTP 401.`,
  hmac: (s: ServiceSpec) =>
    `Requests to ${s.name} are signed with HMAC-SHA256 over the request body and timestamp using the endpoint's signing secret, sent in the \`X-Signature\` header as \`t=<unix>,v1=<hex>\`. Requests with a timestamp more than 5 minutes old are rejected to prevent replay. Outbound deliveries to customers are signed the same way so customers can verify them.`,
};

function servicePassages(s: ServiceSpec, rng: () => number): Passage[] {
  const out: Passage[] = [];
  const api = `${s.slug}/api`;
  const runbook = `${s.slug}/runbook`;
  const arch = `${s.slug}/architecture`;
  const add = (doc: string, id: string, title: string, kind: Passage["kind"], text: string) =>
    out.push({ id: `${doc}/${id}`, doc, title, kind, text });

  // --- API reference ---
  add(api, "overview", `${s.name} API`, "api",
    `${s.name} ${s.purpose}. It is owned by the ${s.team} team and written in ${s.language}. The API is served at \`https://api.northwind.example/${s.slug}\` in ${s.regions.join(", ")}. This reference covers authentication, rate limits, every endpoint, error codes, and webhook events. All request and response bodies are JSON unless noted.`);

  add(api, "authentication", `${s.name} authentication`, "api", AUTH_TEXT[s.auth](s));

  add(api, "rate-limits", `${s.name} rate limits`, "api",
    pick(rng, [
      `${s.name} allows ${s.rateLimit} requests per minute per ${s.auth === "mtls" ? "calling service" : "organization"}, with bursts of up to ${s.burst} requests. Exceeding the limit returns 429 with a \`Retry-After\` header in seconds and the headers \`X-RateLimit-Limit\`, \`X-RateLimit-Remaining\`, and \`X-RateLimit-Reset\`. Limits are enforced per region. Contact ${s.team} to request a higher limit for a specific integration.`,
      `The default quota for ${s.name} is ${s.rateLimit} requests per minute with a burst allowance of ${s.burst}. When the quota is exhausted the service responds 429 Too Many Requests and sets \`Retry-After\`; clients should back off exponentially with jitter rather than retrying immediately. The remaining quota is reported on every response in \`X-RateLimit-Remaining\`.`,
    ]));

  add(api, "errors", `${s.name} error format`, "api",
    `Errors from ${s.name} follow RFC 9457 problem details: \`{"type": "https://api.northwind.example/errors/<name>", "title": "...", "status": <code>, "detail": "...", "request_id": "req_..."}\`. Quote the \`request_id\` when contacting support. The service-specific error names are: ${s.endpoints.flatMap((e) => e.errors.map((er) => `\`${er.name}\` (${er.code})`)).join(", ") || "none beyond the standard set"}.`);

  for (const e of s.endpoints) {
    const eid = e.path.replace(/[{}]/g, "").replace(/^\/v?\d?\/?/, "").replace(/\//g, "-").replace(/_/g, "-") + "-" + e.method.toLowerCase();
    const params = e.params.length
      ? " Parameters: " + e.params.map((p) => `\`${p.name}\` (${p.type}) — ${p.desc}`).join("; ") + "."
      : " It takes no parameters beyond the path.";
    add(api, eid, `${e.method} ${e.path}`, "api", `\`${e.method} ${e.path}\` — ${e.summary}.${params}`);
    if (e.errors.length) {
      add(api, `${eid}-errors`, `${e.method} ${e.path} errors`, "api",
        `Errors specific to \`${e.method} ${e.path}\`: ` +
          e.errors.map((er) => `${er.code} \`${er.name}\` — ${er.desc}`).join(". ") +
          `. Other errors (401, 403, 429, 5xx) follow the ${s.name} error format.`);
    }
  }

  add(api, "webhooks", `${s.name} webhook events`, "api",
    `${s.name} emits the following webhook events through the Webhook Relay: ${s.webhookEvents.map((w) => `\`${w}\``).join(", ")}. Subscribe by registering an endpoint with those event types. Each event payload contains the full ${s.resource} object at the time of the event and an \`event_id\` you should use to deduplicate, because deliveries are at-least-once.`);

  add(api, "idempotency-pagination", `${s.name} idempotency and pagination`, "api",
    pick(rng, [
      `POST endpoints of ${s.name} accept an \`Idempotency-Key\` header; a repeated request with the same key within 24 hours returns the stored response. List endpoints return at most 100 items and paginate with \`cursor\`/\`next_cursor\`; offset pagination is not supported.`,
      `${s.name} supports idempotent creates via the \`Idempotency-Key\` header (UUIDs recommended, retained 24 hours). Collections are paginated by opaque cursor: pass \`limit\` up to 100 and follow \`next_cursor\` until it is null. Cursors expire after 24 hours.`,
    ]));

  add(api, "changelog", `${s.name} changelog`, "api",
    `Recent changes to ${s.name}: ` + s.changelog.map((c) => `${c.version} — ${c.note}`).join("; ") + ". Breaking changes are announced 12 months ahead through the deprecation policy.");

  add(api, "sdk", `${s.name} SDKs`, "api",
    pick(rng, [
      `Official ${s.name} clients are generated from the OpenAPI spec for TypeScript, Python, Go, and Java, published as \`@northwind/${s.slug}\`, \`northwind-${s.slug.replace(/-/g, "_")}\`, \`github.com/northwind/${s.slug}-go\`, and \`com.northwind:${s.slug}\`. The SDKs handle retries with exponential backoff on 429 and 5xx, and set idempotency keys automatically on create calls.`,
      `SDKs for ${s.name} exist for TypeScript, Python, Go, and Java and are regenerated on every API release. They retry 429 and 5xx responses up to three times with jittered backoff, honor \`Retry-After\`, and expose typed errors named after the problem-details \`type\`. Pin the SDK minor version that matches the API version you target.`,
    ]));

  // --- Runbook ---
  add(runbook, "overview", `${s.name} runbook`, "runbook",
    `Operational runbook for ${s.name} (${s.team}). Dashboards: \`grafana/${s.slug}\`. On-call: PagerDuty service \`${s.slug}\`. SLO: ${s.availability} availability and p99 under ${s.latencyMs >= 1000 ? `${s.latencyMs / 1000} s` : `${s.latencyMs} ms`} over 28 days. Datastore: ${s.store}.${s.queue ? ` Messaging: ${s.queue}.` : ""} The CLI \`${s.slug.split("-")[0]}ctl\` is installed via \`nw bootstrap\` and requires VPN plus a production access grant.`);

  for (const a of s.alerts) {
    const aid = a.name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
    add(runbook, aid, `Alert: ${a.name}`, "runbook",
      `**${a.name}** fires when ${a.condition}. Likely cause: ${a.cause}. Remediation: ${a.remediation}.`);
  }

  add(runbook, "deploy", `${s.name} deploy notes`, "runbook",
    pick(rng, [
      `${s.name} deploys through the standard pipeline: merge to main deploys to staging, promotion runs the smoke suite and a 15-minute canary. Service-specific: ${s.queue ? "consumers drain in-flight messages before shutdown, so a rollout takes about 6 minutes." : "there are no background consumers, so rollouts complete in about 3 minutes."} Roll back from the deploy console; migrations are expand-and-contract and never need rolling back.`,
      `To deploy ${s.name}, promote the staging build in the deploy console. The canary runs for 15 minutes at 5% and aborts automatically on error-rate or latency regression. ${s.regions.length > 1 ? `Regions roll out sequentially: ${s.regions.join(" then ")}, with a 10-minute soak between.` : "It runs in a single region."} If you need to skip the canary for a SEV1 fix, the incident commander must approve in the incident channel.`,
    ]));

  add(runbook, "flags", `${s.name} operational flags`, "runbook",
    `Operational feature flags for ${s.name}, managed in Flagship and tagged \`ops\`: ` +
      s.flags.map((f) => `\`${f.name}\` (default ${f.def}) — ${f.desc}`).join("; ") +
      ". Flipping an ops flag takes effect within 10 seconds and is logged to the audit log.");

  add(runbook, "dependencies", `${s.name} dependencies`, "runbook",
    `${s.name} depends on ${s.dependencies.join(", ")}. ${pick(rng, [
      "When a dependency is degraded, check its status in the dependency panel before debugging locally; most incidents attributed to this service are upstream.",
      "Each dependency has a circuit breaker that opens after 50% failures over 30 seconds and half-opens after 20 seconds; breaker state is on the dashboard.",
      "Dependency timeouts are set to 2 seconds with one retry; a dependency outage degrades the specific features that use it rather than the whole service.",
    ])}`);

  add(runbook, "scaling", `${s.name} scaling`, "runbook",
    `Scaling ${s.name}: ${s.scaling}. Autoscaling is configured in the service's \`deploy.yaml\`; manual scaling for an incident uses \`kubectl scale deploy/${s.slug} --replicas=N\` and should be reverted in the postmortem action items.`);

  add(runbook, "logs", `${s.name} logs and traces`, "runbook",
    pick(rng, [
      `${s.name} logs are in the log explorer under \`service:${s.slug}\`. Useful fields: \`request_id\`, \`${s.resource}_id\`, \`trace_id\`. Traces are sampled at 10%; force a full trace for one request with the \`x-debug-trace: 1\` header from the VPN. Never log ${s.resource} payloads at INFO level.`,
      `Query logs for ${s.name} with \`service:${s.slug} level:error\` in the log explorer; every log line carries \`trace_id\` for jumping to the trace. The service logs one line per request at INFO with status and duration, and errors include the problem-details \`type\`. Debug-level logging is enabled per pod with the \`LOG_LEVEL=debug\` env var for at most one hour.`,
    ]));

  // --- Architecture ---
  add(arch, "overview", `${s.name} architecture`, "architecture",
    `${s.name} is a ${s.language} service ${s.purpose}. It runs as a Kubernetes deployment in ${s.regions.join(" and ")}, stores its data in ${s.store}${s.queue ? `, and publishes and consumes events via ${s.queue}` : ""}. ${s.cache ? `Caching: ${s.cache}.` : "It has no cache layer; reads go to the database."}`);

  add(arch, "data-model", `${s.name} data model`, "architecture",
    pick(rng, [
      `The central entity of ${s.name} is the ${s.resource}. Every ${s.resource} has an immutable id prefixed with \`${s.resource.slice(0, 3)}_\`, a \`created_at\` timestamp, a state machine column, and a \`version\` integer incremented on every write for optimistic concurrency. State transitions are recorded in a \`${s.resource}_events\` table that doubles as the source of webhook events.`,
      `${s.name} models ${s.resource}s as rows in a \`${s.resource}s\` table keyed by a prefixed ULID, with a companion \`${s.resource}_events\` append-only table capturing every transition. Foreign keys reference the owning organization; there are no cross-organization joins, which is what allows the tables to be partitioned or sharded by organization later.`,
    ]));

  add(arch, "retention", `${s.name} data retention`, "architecture",
    `Retention for ${s.name}: ${s.retention}. Deletion is performed by the nightly retention job and follows the company data handling policy; customer deletion requests are honored within 30 days via the privacy erasure workflow.`);

  add(arch, "failure-modes", `${s.name} failure modes`, "architecture",
    pick(rng, [
      `Known failure modes of ${s.name}: ${s.alerts.slice(0, 3).map((a) => a.cause).join("; ")}. Each has an alert and a runbook entry. The service is designed to fail closed for writes and open for reads: if the database is unavailable, reads may be served stale from cache but writes are rejected.`,
      `${s.name} degrades in predictable ways: ${s.alerts.slice(0, 2).map((a) => a.cause).join(", and ")}. Writes are never acknowledged before they are durable in ${s.store.split(" ")[0]}. Reads tolerate a stale cache. A full regional outage is handled by DNS failover to ${s.regions.length > 1 ? "the other region" : "a standby region"}, which takes about 5 minutes.`,
    ]));

  add(arch, "disaster-recovery", `${s.name} disaster recovery`, "architecture",
    `Disaster recovery for ${s.name}: recovery point objective ${pick(rng, ["5 minutes", "1 minute", "15 minutes"])}, recovery time objective ${pick(rng, ["30 minutes", "1 hour", "4 hours"])}. ${s.regions.length > 1 ? `Data replicates asynchronously to ${s.regions[1]}; failover is initiated by the data platform on-call with \`drctl failover ${s.slug}\`.` : "The service is single-region; recovery restores from point-in-time backups into the same region."} DR drills run every six months.`);

  // --- Developer guide ---
  const guide = `${s.slug}/guide`;
  const ctl = `${s.slug.split("-")[0]}ctl`;
  add(guide, "quickstart", `${s.name} quickstart`, "api",
    pick(rng, [
      `Quickstart for ${s.name}: obtain credentials (${s.auth === "api-key" ? "a test-mode API key from the developer console" : s.auth === "oauth" ? "an OAuth client from the developer console" : s.auth === "mtls" ? "a workload certificate from the mesh" : "a signing secret from the endpoint settings"}), install the SDK for your language, and call \`${s.endpoints[0].method} ${s.endpoints[0].path}\` against the sandbox at \`https://sandbox.northwind.example/${s.slug}\`. Sandbox ${s.resource}s behave like production but touch no real systems and are purged nightly.`,
      `To get started with ${s.name}, create a sandbox project in the developer console, copy its credentials into \`NW_${s.slug.replace(/-/g, "_").toUpperCase()}_CREDENTIALS\`, and run the example in the SDK README, which creates a ${s.resource} and polls it to completion. The sandbox mirrors production behavior including error codes and webhooks, but data is reset every night at 02:00 UTC.`,
    ]));

  add(guide, "local-development", `${s.name} local development`, "runbook",
    pick(rng, [
      `Run ${s.name} locally with \`make dev\`, which starts ${s.store.split(" ")[0]}${s.queue ? " and a single-node Kafka" : ""} in containers and the service with hot reload on port 8080. Seed data comes from \`fixtures/seed.sql\`. Dependencies are stubbed by the local mock server unless you set \`NW_UPSTREAMS=staging\`, which requires VPN.`,
      `Local development for ${s.name} uses the devcontainer in the repo: open it in your editor and run \`make dev\`. The service listens on http://localhost:8080 with the sandbox credentials pre-configured. Integration tests run with \`make test-integration\` and spin up ${s.store.split(" ")[0]} in Docker; they take about ${pick(rng, ["4", "6", "9"])} minutes.`,
    ]));

  add(guide, "configuration", `${s.name} configuration`, "runbook",
    `${s.name} reads configuration from environment variables injected by the deploy pipeline: \`DATABASE_URL\`, \`LOG_LEVEL\` (default info), \`PORT\` (default 8080), \`REGION\`${s.queue ? ", `KAFKA_BROKERS`" : ""}${s.cache ? ", `REDIS_URL`" : ""}, and \`FLAGSHIP_SDK_KEY\`. Secrets are mounted by the Vault sidecar; the service refuses to start if a required variable is missing and logs which one.`);

  add(guide, "permissions", `${s.name} roles and permissions`, "api",
    pick(rng, [
      `${s.name} distinguishes three roles: \`viewer\` can read ${s.resource}s and list collections; \`operator\` can additionally create and modify ${s.resource}s; \`admin\` can change configuration and ${s.auth === "api-key" ? "manage API keys" : "manage OAuth clients"}. Roles are assigned per organization in the admin console and enforced by the Auth Gateway before requests reach the service.`,
      `Access to ${s.name} is role-based. Read endpoints require the \`${s.slug.replace(/-/g, "_")}:read\` permission, write endpoints require \`${s.slug.replace(/-/g, "_")}:write\`, and destructive operations such as cancel, void, or delete additionally require \`${s.slug.replace(/-/g, "_")}:admin\`. Permissions are granted to roles in the admin console; the service returns 403 with \`missing_permission\` naming the required permission.`,
    ]));

  add(guide, "testing", `${s.name} testing and sandbox`, "api",
    pick(rng, [
      `Test integrations against the ${s.name} sandbox, which accepts special trigger values to simulate outcomes: for example a ${s.resource} with the metadata field \`test_scenario\` set to \`fail\` will move to a failed state, and \`slow\` adds a 30-second delay. Sandbox webhooks are delivered to your registered endpoints just like production, so you can test handlers end to end.`,
      `The ${s.name} sandbox supports deterministic test scenarios: set \`metadata.test_scenario\` on a ${s.resource} to \`succeed\`, \`fail\`, \`timeout\`, or \`retry\` to drive it through that outcome. Sandbox rate limits are 10x lower than production to catch missing backoff logic early. Nothing in the sandbox is billed or reported.`,
    ]));

  add(guide, "monitoring", `${s.name} dashboards and monitoring`, "runbook",
    `Dashboards for ${s.name} live in Grafana under the \`${s.slug}\` folder: an overview board with request rate, error rate, and latency percentiles per endpoint; a dependencies board with circuit breaker state; ${s.queue ? "a consumer board with lag per partition; " : ""}and an SLO board showing remaining error budget for the 28-day window. Alerts are defined alongside the dashboards in \`monitoring/alerts.yaml\` in the service repo.`);

  add(guide, "cost", `${s.name} cost and capacity`, "architecture",
    pick(rng, [
      `${s.name} costs about $${pick(rng, ["4,200", "11,500", "27,000", "63,000"])} per month, dominated by ${pick(rng, ["the database cluster", "compute", "storage", "network egress"])}. Cost is attributed to ${s.team} via the \`team\` label on every resource. Capacity is reviewed quarterly; the planning model assumes ${pick(rng, ["20%", "35%", "50%"])} annual growth in ${s.resource} volume.`,
      `Capacity planning for ${s.name} is based on peak ${s.resource} throughput, which last quarter was ${pick(rng, ["1,800", "4,500", "12,000", "40,000"])} per minute. Headroom target is 2x peak. Costs show up in the cloud billing dashboard under the \`${s.slug}\` tag and are reviewed monthly by ${s.team} with finance.`,
    ]));

  add(guide, "security-review", `${s.name} security posture`, "architecture",
    `${s.name} passed its last security review in ${pick(rng, ["March", "May", "July", "August"])} 2026. Data classification: ${pick(rng, ["Confidential", "Restricted", "Internal"])}. Threat model and pen-test findings are in the security repo under \`reviews/${s.slug}\`. Open findings are tracked with the standard 7-day (critical) and 30-day (high) remediation deadlines. The service enforces TLS 1.3 only and ${s.auth === "mtls" ? "mutual TLS between workloads" : "validates every token or key at the gateway"}.`);

  add(guide, "support", `${s.name} support and escalation`, "runbook",
    pick(rng, [
      `Questions about ${s.name} go to \`#${s.slug}\` in Slack, monitored by ${s.team} during business hours. Customer-impacting issues outside business hours go through the on-call via PagerDuty, not Slack. Bugs are filed in the \`${s.slug.toUpperCase().slice(0, 3)}\` Jira project; feature requests go through the product intake form.`,
      `For help with ${s.name}, post in \`#${s.slug}\` with the \`request_id\` of a failing request. ${s.team} triages within one business day. Escalate customer-impacting problems by paging the \`${s.slug}\` PagerDuty service. Do not DM individual engineers for production issues.`,
    ]));

  add(guide, "cli", `${ctl} command line`, "runbook",
    `The \`${ctl}\` CLI wraps common operational tasks for ${s.name}: \`${ctl} ${s.resource}s get <id>\` shows a ${s.resource} with its event history, \`${ctl} ${s.resource}s list --status <s>\` lists by state, and \`${ctl} whoami\` prints your current access grant. It authenticates with your SSO session and requires VPN plus an active production access grant from the Access Portal; every command is written to the audit log.`);

  return out;
}

function docPassages(docs: SourceDoc[]): Passage[] {
  return docs.flatMap((d) =>
    d.sections.map((s) => ({ id: `${d.slug}/${s.id}`, doc: d.slug, title: d.title, kind: d.kind, text: s.text })),
  );
}

let cached: Passage[] | null = null;

/** Builds the full ~600 passage corpus deterministically. */
export function buildCorpus(): Passage[] {
  if (cached) return cached;
  const rng = mulberry32(20260917);
  const passages = [
    ...docPassages(HANDBOOK),
    ...docPassages(HR_POLICIES),
    ...SERVICES.flatMap((s) => servicePassages(s, rng)),
  ];
  const ids = new Set<string>();
  for (const p of passages) {
    if (ids.has(p.id)) throw new Error(`duplicate passage id ${p.id}`);
    ids.add(p.id);
  }
  cached = passages;
  return passages;
}
