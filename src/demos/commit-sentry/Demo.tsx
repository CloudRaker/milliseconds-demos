/**
 * Commit Sentry: a pre-commit hook that reads the staged diff instead of matching it.
 *
 * One run is six batched requests (see runSentry in data.ts). The seed diff, the
 * policy thresholds and the regex baseline are plain code; the model only supplies
 * the judgments. Nothing runs until the visitor presses Run check.
 */
import { useMemo, useRef, useState } from "react";
import { dm1, Dm1Error, type Route } from "../../lib/dm1";
import {
  COMMIT_MESSAGE, COVERAGE_MIN, FINDING_IDS, FINDING_LABELS, HUNKS, RISK_LEVELS, RULES, STATEMENTS, STEP_LABELS,
  allMessageClaims, addedLines, evaluate, runSentry, summariseFiles,
  type Call, type CallMeta, type Finding, type Hunk, type Judgment, type MessageJudgment, type Step,
} from "./data";
import "./demo.css";

const RUN_TIMEOUT_MS = 60_000;

const pct = (p: number) => `${Math.round(p * 100)}%`;
const files = [...new Set(HUNKS.map((h) => h.file))];
/** Added lines that carry text; the per-line pass skips the blank ones. */
const SCORED_LINES = HUNKS.reduce((a, h) => a + addedLines(h).filter((l) => l.t.trim()).length, 0);
/** risk, kind, the per-hunk checks, one batch per 32 scored lines, and two for the message. */
const TOTAL_STEPS = 4 + Math.ceil(SCORED_LINES / 32) + Math.ceil(allMessageClaims(HUNKS).length / 32);

interface StepRow {
  step: Step;
  route: string;
  meta: CallMeta;
}

export default function Demo() {
  const [message, setMessage] = useState(COMMIT_MESSAGE);
  const [strict, setStrict] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [judgments, setJudgments] = useState<Judgment[] | null>(null);
  const [msgJudgment, setMsgJudgment] = useState<MessageJudgment | null>(null);
  const [offending, setOffending] = useState<Record<string, number | null>>({});
  const [openFile, setOpenFile] = useState(files[0]!);
  const abort = useRef<AbortController | null>(null);

  const result = useMemo(
    () => (judgments ? evaluate(HUNKS, judgments, msgJudgment, strict) : null),
    [judgments, msgJudgment, strict],
  );
  const summaries = useMemo(
    () => summariseFiles(HUNKS, judgments ?? [], result?.findings ?? []),
    [judgments, result],
  );

  function stop() {
    abort.current?.abort();
    abort.current = null;
    setRunning(false);
  }

  async function run() {
    if (running) return stop();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const guard = setTimeout(() => ctrl.abort(), RUN_TIMEOUT_MS);
    setRunning(true);
    setError(null);
    setSteps([]);
    setJudgments(null);
    setMsgJudgment(null);
    setOffending({});

    const call: Call = async (route, body) => dm1(route as Route, body, ctrl.signal);
    try {
      for await (const ev of runSentry(call, HUNKS, message)) {
        setSteps((s) => [...s, { step: ev.step, route: ev.route, meta: ev.meta }]);
        setJudgments(ev.judgments);
        setMsgJudgment(ev.message);
        setOffending(Object.fromEntries(ev.judgments.map((j) => [j.hunkId, j.offendingLineIndex])));
      }
    } catch (err) {
      if (ctrl.signal.aborted) {
        // stopped on purpose, or the 60 s guard fired
      } else {
        setError(err instanceof Dm1Error ? `${err.code}: ${err.message}` : String(err));
      }
    } finally {
      clearTimeout(guard);
      abort.current = null;
      setRunning(false);
    }
  }

  const verdict = result?.verdict ?? "idle";
  const openHunks = HUNKS.filter((h) => h.file === openFile);

  return (
    <div className="d-commit-sentry">
      <div className="panel">
        <div className="cs-controls">
          <div className="cs-field">
            <label htmlFor="cs-msg">Commit message</label>
            <input
              id="cs-msg"
              className="input"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void run();
              }}
              placeholder="chore: tidy up logging and small fixes"
            />
          </div>
          <div className="cs-actions">
            <label className="cs-toggle">
              <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
              Stricter review
            </label>
            <button className="btn primary" onClick={() => void run()}>
              {running ? "Stop" : "Run check"}
            </button>
          </div>
        </div>
        <p className="cs-hint" style={{ marginTop: 10, marginBottom: 0 }}>
          Review {HUNKS.length} sample code changes across {files.length} files. Run check to find risky changes and assess the commit message.
        </p>
        {(running || steps.length > 0) && (
          <div className="cs-progress" style={{ marginTop: 12 }}>
            <span>
              {steps.length}/{TOTAL_STEPS} requests
            </span>
            <span className="bar">
              <i style={{ width: `${(steps.length / TOTAL_STEPS) * 100}%` }} />
            </span>
            <span>{steps.length ? STEP_LABELS[steps[steps.length - 1]!.step] : "starting…"}</span>
          </div>
        )}
        {error && (
          <p className="error" style={{ marginBottom: 0 }}>
            {error} — the seed diff below stays readable; press Run check to try again.
          </p>
        )}


      </div>

      <div className="cs-verdict" data-verdict={verdict}>
        <b>
          {verdict === "block"
            ? "commit blocked"
            : verdict === "warn"
              ? "commit allowed with warnings"
              : verdict === "pass"
                ? "commit allowed"
                : "not run yet"}
        </b>
        <span>
          {result
            ? `${result.blocking.length} blocking · ${result.warnings.length} warnings${strict ? " · strict" : ""}`
            : "The staged diff is already parsed. Press Run check to judge it."}
        </span>
      </div>

      <div className="cs-cols">
        <div className="cs-stack">
          <div className="panel">
            <p className="panel-title">Staged files</p>
            <div className="cs-table-scroll" tabIndex={0} role="region" aria-label="Staged files">
            <table className="cs-files">
              <thead>
                <tr>
                  <th>File</th>
                  <th className="cs-num">Hunks</th>
                  <th>Risk</th>
                  <th>Kind</th>
                  <th>Findings</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((s) => (
                  <tr key={s.file} data-on={s.file === openFile ? "1" : "0"} onClick={() => setOpenFile(s.file)}>
                    <td className="cs-path"><button className="cs-file-button" onClick={() => setOpenFile(s.file)} aria-pressed={s.file === openFile}>{s.file}</button></td>
                    <td className="cs-num">{s.hunks}</td>
                    <td>
                      <RiskCell risk={s.maxRisk} scored={!!judgments} />
                    </td>
                    <td className="cs-hint">{s.kinds.join(" / ") || "—"}</td>
                    <td>
                      {!judgments ? (
                        <span className="cs-hint">—</span>
                      ) : s.findings === 0 ? (
                        <span className="tag good">clean</span>
                      ) : (
                        <>
                          {s.blocking > 0 && <span className="tag hot">{s.blocking} block</span>}{" "}
                          {s.findings - s.blocking > 0 && <span className="tag warn">{s.findings - s.blocking} warn</span>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>

          <div className="panel">
            <p className="panel-title">Diff · {openFile}</p>
            {openHunks.map((h) => (
              <HunkView key={h.id} hunk={h} offending={offending[h.id] ?? null} judgment={judgments?.find((j) => j.hunkId === h.id)} />
            ))}
          </div>
        </div>

        <div className="cs-stack">
          <div className="panel">
            <p className="panel-title">Findings</p>
            {!result && <p className="muted" style={{ margin: 0 }}>Run check to see risky changes, the affected lines and why each finding matters.</p>}
            {result && result.findings.length === 0 && <p className="muted" style={{ margin: 0 }}>No finding crossed a threshold.</p>}
            {result && groupByHunk(result.findings).map(([hunkId, fs]) => (
              <FindingGroup key={hunkId} findings={fs} />
            ))}
          </div>

          <div className="panel">
            <p className="panel-title">Commit message</p>
            <dl className="cs-kv">
              <dt>message</dt>
              <dd>{message || "(empty)"}</dd>
              <dt>covers the changes</dt>
              <dd>
                {msgJudgment ? (
                  <b style={{ color: msgJudgment.matchesChanges < 0.35 ? "#ff8a8a" : "#6fdc8c" }}>
                    {msgJudgment.claims.filter((c) => c.probability >= COVERAGE_MIN).length} of {msgJudgment.claims.length}
                    {" · "}
                    {pct(msgJudgment.matchesChanges)}
                  </b>
                ) : (
                  "—"
                )}{" "}
                <span className="muted">
                  (below 35% suggests the message may omit changes; this produces a warning)
                </span>
              </dd>
              <dt>quality</dt>
              <dd>
                {msgJudgment ? `${msgJudgment.qualityLevel} · ${msgJudgment.quality.toFixed(2)}/3 · confidence ${pct(msgJudgment.qualityConfidence)}` : "—"}
              </dd>
            </dl>
            {msgJudgment && (
              <ul className="cs-claims">
                {msgJudgment.claims.map((c) => (
                  <li key={c.statement} data-on={c.probability >= COVERAGE_MIN ? "1" : "0"}>
                    <b>{pct(c.probability)}</b>
                    <span>{c.statement}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>


        </div>
      </div>
    </div>
  );
}

function RiskCell({ risk, scored }: { risk: number; scored: boolean }) {
  const level = Math.max(0, Math.min(4, Math.round(risk)));
  return (
    <span className="cs-riskcell">
      <span className="bar">
        <i data-level={level} style={{ width: scored ? `${(risk / 4) * 100}%` : "0%" }} />
      </span>
      <em data-level={level}>{scored ? RISK_LEVELS[level] : "—"}</em>
    </span>
  );
}

function HunkView({ hunk, offending, judgment }: { hunk: Hunk; offending: number | null; judgment?: Judgment }) {
  const adds = addedLines(hunk);
  const offLine = offending !== null ? adds[offending] : undefined;
  const hot = judgment ? FINDING_IDS.filter((id) => judgment.findings[id] >= RULES[id].report) : [];
  return (
    <div className="cs-hunk">
      <div className="cs-hunkhead">
        <span>
          @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
        </span>
        <span>{hunk.language}</span>
        {judgment && <span className="tag purple">{judgment.kind}</span>}
        {hot.map((id) => (
          <span key={id} className="tag hot">
            {FINDING_LABELS[id]} {pct(judgment!.findings[id])}
          </span>
        ))}
      </div>
      <pre className="cs-diff">
        {hunk.lines.map((l, i) => (
          <div key={i} data-k={l.k} data-off={offLine && l === offLine ? "1" : "0"}>
            <i>{l.n ?? ""}</i>
            <span>
              {l.k}
              {l.t || " "}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
}

function FindingGroup({ findings }: { findings: Finding[] }) {
  const first = findings[0]!;
  const blocking = findings.some((f) => f.severity === "block");
  return (
    <div className="cs-finding">
      <div className="cs-findhead">
        <span className={blocking ? "tag hot" : "tag warn"}>{blocking ? "block" : "warn"}</span>
        <code>
          {first.file}
          {first.line !== null ? `:${first.line}` : ""}
        </code>
      </div>
      <p className="cs-labels">
        {findings.map((f) => (
          <span key={f.id}>
            <b data-sev={f.severity}>{f.label}</b> {pct(f.probability)}
          </span>
        ))}
      </p>
      {first.quoted.slice(0, 3).map((q, i) => (
        <p className="cs-quote" key={i}>
          {q}
        </p>
      ))}
    </div>
  );
}

function groupByHunk(findings: Finding[]): Array<[string, Finding[]]> {
  const map = new Map<string, Finding[]>();
  for (const f of findings) map.set(f.hunkId, [...(map.get(f.hunkId) ?? []), f]);
  return [...map.entries()].sort((a, b) => score(b[1]) - score(a[1]));
}
const score = (fs: Finding[]) => (fs.some((f) => f.severity === "block") ? 10 : 0) + Math.max(...fs.map((f) => f.probability));
