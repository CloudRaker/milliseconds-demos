import { useSyncExternalStore } from "react";
import { estimatedUSD, formatUSD, getServerTelemetry, getTelemetry, median, subscribeTelemetry } from "../lib/telemetry";

const duration = (value: number | null) => value === null ? "—" : value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
const usage = (tokens: number, unknown: number, money = false) => unknown && tokens === 0 ? "Unavailable" : `${unknown ? "≥ " : ""}${money ? formatUSD(estimatedUSD(tokens)) : tokens.toLocaleString("en-US")}`;

export default function RunMetrics() {
  const s = useSyncExternalStore(subscribeTelemetry, getTelemetry, getServerTelemetry);
  const cacheOnly = s.cachedResponses > 0 && s.personalAttempts + s.sponsoredAttempts + s.exampleUnknownAttempts === 0;
  const shownTokens = s.cachedTokens + s.tokens;
  const shownUnknown = s.cachedUnknownUsage + s.unknownUsage;
  const unknownOnly = shownUnknown > 0 && shownTokens === 0;
  const modes = [s.cachedResponses && "Cached example · free", s.sponsoredAttempts && "Live example · free", s.personalAttempts && "Live · your key", s.exampleUnknownAttempts && "Example delivery unconfirmed · free"].filter(Boolean);
  const state = s.pending ? `${s.pending} request${s.pending === 1 ? "" : "s"} running` : s.failed ? "Finished with errors" : s.cancelled ? "Requests cancelled" : s.succeeded ? "Ready for another run" : "Ready to run";

  return (
    <section className="run-metrics" aria-label="Performance and cost">
      <div className="run-metrics-head">
        <div><h2>Performance & cost</h2><p>This page session · since page load</p></div>
        <span className={`run-metrics-state${s.pending ? " is-running" : s.failed ? " is-error" : ""}`} role="status">{state}</span>
      </div>
      {modes.length > 0 && <p className="run-metrics-provenance">{modes.join(" · ")}</p>}
      <dl className={`run-metrics-grid${unknownOnly ? " has-unavailable" : ""}`}>
        <div><dt>Typical delivery time</dt><dd>{duration(median(s.elapsed))}</dd></div>
        <div><dt>{cacheOnly ? "Recorded input tokens" : s.cachedResponses ? "Input tokens · live + recorded" : "Live input tokens"}</dt><dd className={unknownOnly ? "is-unavailable" : undefined}>{usage(shownTokens, shownUnknown)}</dd></div>
        <div><dt>Estimated inference cost · USD</dt><dd className={unknownOnly ? "is-unavailable" : undefined}>{usage(shownTokens, shownUnknown, true)}</dd></div>
      </dl>
      {(s.cachedResponses > 0 || s.sponsoredAttempts > 0 || s.exampleUnknownAttempts > 0) && <p className="run-metrics-note">Stock examples are free to try. The estimate shows what equivalent live inference would cost.{s.cachedResponses > 0 && ` ${s.cachedResponses} cached response${s.cachedResponses === 1 ? "" : "s"}; recorded usage is not new inference.`}{s.sponsoredAttempts > 0 && ` Live example inference is covered by milliseconds.`}</p>}
      <details className="run-metrics-details">
        <summary>How these numbers work <span>· {s.succeeded} successful requests</span></summary>
        <dl className="run-metrics-secondary">
          {!cacheOnly && <div><dt>Live model compute</dt><dd>{duration(s.modelSamples ? s.modelMs / s.modelSamples : null)}</dd><p>Average per measured successful live request.</p></div>}
          {s.cachedResponses > 0 && <>
            <div><dt>Recorded model compute</dt><dd>{duration(s.cachedModelSamples ? s.cachedModelMs / s.cachedModelSamples : null)}</dd><p>Original processing time, averaged across cached deliveries.</p></div>
            {!cacheOnly && <div><dt>Recorded input tokens</dt><dd>{usage(s.cachedTokens, s.cachedUnknownUsage)}</dd><p>Included in the estimate above; not new inference.</p></div>}
            <div><dt>Recorded inference cost · USD</dt><dd>{usage(s.cachedTokens, s.cachedUnknownUsage, true)}</dd><p>Original run estimates across cached deliveries. No new charge.</p></div>
          </>}
          {s.personalAttempts > 0 && <div><dt>Your key · estimated cost</dt><dd>{usage(s.personalTokens, s.personalUnknownUsage, true)}</dd><p>Only requests made with your own key, excluding free stock examples.</p></div>}
          <div><dt>Successful requests</dt><dd>{s.succeeded.toLocaleString("en-US")}</dd><p>{s.attempts ? `${s.attempts} network attempt${s.attempts === 1 ? "" : "s"} · ${s.retries} retries` : "Run an example for free to see its measurements."}</p></div>
        </dl>
        {s.cachedGeneratedAt && <p className="run-metrics-note">Most recent cached result generated: <time dateTime={s.cachedGeneratedAt}>{s.cachedGeneratedAt.replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}</time>.</p>}
        <p className="run-metrics-note">Delivery time is the median browser time for successful requests, including queue, network, and retries. Cached delivery speed is not inference speed. Model compute can exceed browser time when one request processes many inputs.</p>
        <p className="run-metrics-note">Tokens come from response headers. Inference costs use $0.04 per million input tokens, before plan credits. The estimate includes live and recorded tokens at the same rate; cached examples are not charged again. Missing usage is unavailable or a partial total (≥). Demo resets keep these totals; reload to start a new session.</p>
      </details>
      {(s.failed > 0 || s.cancelled > 0 || s.unknownUsage > 0 || s.cachedUnknownUsage > 0) && <p className="run-metrics-warning">{s.failed} failed · {s.cancelled} cancelled{s.unknownUsage ? ` · Live usage unconfirmed for ${s.unknownUsage} network attempt${s.unknownUsage === 1 ? "" : "s"}.` : ""}{shownUnknown ? " The inference cost estimate is incomplete." : ""}{s.cachedUnknownUsage ? ` · Recorded usage unavailable for ${s.cachedUnknownUsage} cached response${s.cachedUnknownUsage === 1 ? "" : "s"}.` : ""}</p>}
    </section>
  );
}
