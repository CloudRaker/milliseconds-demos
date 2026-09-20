import { useSyncExternalStore } from "react";
import { estimatedUSD, formatUSD, getServerTelemetry, getTelemetry, median, subscribeTelemetry } from "../lib/telemetry";
import { getForceLive, getServerForceLive, subscribeLiveMode, setForceLive, hasKey, openKeyPanel } from '../lib/dm1';

const duration = (value: number | null) => value === null ? "—" : value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
const usage = (tokens: number, unknown: number, money = false) => unknown && tokens === 0 ? "Unavailable" : `${unknown ? "≥ " : ""}${money ? formatUSD(estimatedUSD(tokens)) : tokens.toLocaleString("en-US")}`;

export default function RunMetrics() {
  const s = useSyncExternalStore(subscribeTelemetry, getTelemetry, getServerTelemetry);
  const forceLive = useSyncExternalStore(subscribeLiveMode, getForceLive, getServerForceLive);
  const cacheOnly = !forceLive && s.cachedResponses > 0 && s.personalAttempts + s.sponsoredAttempts + s.exampleUnknownAttempts === 0;
  const shownTokens = (forceLive ? 0 : s.cachedTokens) + s.tokens;
  const shownUnknown = (forceLive ? 0 : s.cachedUnknownUsage) + s.unknownUsage;
  const unknownOnly = shownUnknown > 0 && shownTokens === 0;
  const modes = [!forceLive && s.cachedResponses && "Cached example · free", s.sponsoredAttempts && "Live example · free", s.personalAttempts && "Live · your key", !forceLive && s.exampleUnknownAttempts && "Example delivery unconfirmed · free"].filter(Boolean);
  const state = s.pending ? `${s.pending} request${s.pending === 1 ? "" : "s"} running` : s.failed ? "Finished with errors" : s.cancelled ? "Requests cancelled" : s.succeeded ? "Ready for another run" : "Ready to run";

  return (
    <section className="run-metrics" aria-label="Performance and cost">
      <div className="run-metrics-head">
        <div><h2>Performance & cost</h2><p>This session</p></div>
        <span className={`run-metrics-state${s.pending ? " is-running" : s.failed ? " is-error" : ""}`} role="status">{state}</span>
      </div>
      {modes.length > 0 && <p className="run-metrics-provenance">{modes.join(" · ")}</p>}
      <dl className={`run-metrics-grid${unknownOnly ? " has-unavailable" : ""}`}>
        <div><dt>{forceLive ? 'Live round trip' : 'Delivery time · median'}</dt><dd>{duration(median(forceLive ? s.liveElapsed : s.elapsed))}</dd></div>
        <div><dt>{cacheOnly ? 'Recorded model compute' : 'Live model compute'}</dt><dd>{duration(cacheOnly ? (s.cachedModelSamples ? s.cachedModelMs / s.cachedModelSamples : null) : (s.modelSamples ? s.modelMs / s.modelSamples : null))}</dd></div>
        <div><dt>{forceLive ? 'Live input tokens' : cacheOnly ? "Recorded input tokens" : s.cachedResponses ? "Input tokens · live + recorded" : "Live input tokens"}</dt><dd className={unknownOnly ? "is-unavailable" : undefined}>{usage(shownTokens, shownUnknown)}</dd></div>
        <div><dt>Est. cost · USD</dt><dd className={unknownOnly ? "is-unavailable" : undefined}>{usage(shownTokens, shownUnknown, true)}</dd></div>
      </dl>
      {!forceLive && (s.cachedResponses > 0 || s.sponsoredAttempts > 0 || s.exampleUnknownAttempts > 0) && <p className="run-metrics-note">Free example · estimated live cost.</p>}
      <div className="run-live-mode">
        <label><input type="checkbox" checked={forceLive} disabled={s.pending > 0} aria-describedby="live-mode-help" onChange={event => {
          setForceLive(event.target.checked);
          if (event.target.checked && !hasKey()) openKeyPanel();
        }} />Use my key for every request</label>
        <p id="live-mode-help">{forceLive
          ? 'Live API · your key and quota. Cached results excluded.'
          : 'Bypass examples to measure live inference. Uses your quota.'}</p>
      </div>
      <details className="run-metrics-details">
        <summary>Measurement details <span>· {s.succeeded} successful requests</span></summary>
        <dl className="run-metrics-secondary">
          {s.cachedResponses > 0 && !cacheOnly && <>
            <div><dt>Recorded model compute</dt><dd>{duration(s.cachedModelSamples ? s.cachedModelMs / s.cachedModelSamples : null)}</dd><p>Original processing time, averaged across cached deliveries.</p></div>
            <div><dt>Recorded input tokens</dt><dd>{usage(s.cachedTokens, s.cachedUnknownUsage)}</dd><p>{forceLive ? 'Excluded from live totals.' : 'Included in the estimate above; not new inference.'}</p></div>
            <div><dt>Recorded inference cost · USD</dt><dd>{usage(s.cachedTokens, s.cachedUnknownUsage, true)}</dd><p>Original run estimates across cached deliveries. No new charge.</p></div>
          </>}
          {s.personalAttempts > 0 && <div><dt>Your key · estimated cost</dt><dd>{usage(s.personalTokens, s.personalUnknownUsage, true)}</dd><p>Requests made with your key, including samples run in live mode.</p></div>}
          <div><dt>Successful requests</dt><dd>{s.succeeded.toLocaleString("en-US")}</dd><p>{s.attempts ? `${s.attempts} network attempt${s.attempts === 1 ? "" : "s"} · ${s.retries} retries` : "Run an example for free to see its measurements."}</p></div>
        </dl>
        {s.cachedGeneratedAt && <p className="run-metrics-note">Most recent cached result generated: <time dateTime={s.cachedGeneratedAt}>{s.cachedGeneratedAt.replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}</time>.</p>}
        <p className="run-metrics-note">Model compute is the average per measured request. Delivery time is the median browser time for successful requests, including queue, network, and retries. Cached delivery speed is not inference speed. Model compute can exceed browser time when one request processes many inputs.</p>
        <p className="run-metrics-note">Tokens come from response headers. Inference costs use $0.04 per million input tokens, before plan credits. {forceLive ? 'Live mode excludes cached tokens and delivery times from the primary measurements.' : 'The estimate includes live and recorded tokens at the same rate; cached examples are not charged again.'} Missing usage is unavailable or a partial total (≥). Demo resets keep these totals; reload to start a new session.</p>
      </details>
      {(s.failed > 0 || s.cancelled > 0 || s.unknownUsage > 0 || s.cachedUnknownUsage > 0) && <p className="run-metrics-warning">{s.failed} failed · {s.cancelled} cancelled{s.unknownUsage ? ` · Live usage unconfirmed for ${s.unknownUsage} network attempt${s.unknownUsage === 1 ? "" : "s"}.` : ""}{shownUnknown ? " The inference cost estimate is incomplete." : ""}{s.cachedUnknownUsage ? ` · Recorded usage unavailable for ${s.cachedUnknownUsage} cached response${s.cachedUnknownUsage === 1 ? "" : "s"}.` : ""}</p>}
    </section>
  );
}
