import { useEffect, useRef, useState } from "react";
import { CheckCircleIcon, MagnifyingGlassIcon, WarningCircleIcon} from "@phosphor-icons/react";
import { trackDemoEvent } from "../../lib/demo-events";
import { dm1 } from "../../lib/dm1";
import { verificationRequest, assess, fields, labels, sampleResults, sampleSource, sampleValues, type Check } from "./logic";
import "./demo.css";

type Row = { state: "waiting" | "working" | "checked" | "failed" | "stopped"; check?: Check; error?: string };
const preview = (): Row[] => sampleResults.map((result, i) => ({ state: "checked", check: assess(sampleSource, sampleValues[i], result) }));

export default function Demo() {
  const [source, setSource] = useState(sampleSource);
  const [values, setValues] = useState([...sampleValues]);
  const [rows, setRows] = useState<Row[]>(preview);
  const [mode, setMode] = useState<"sample" | "edited" | "live">("sample");
  const [selected, setSelected] = useState(1);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("Sample preview. Curated results; no API calls have been made.");

  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => { trackDemoEvent("evidence-check", "sample_viewed"); return () => ctrl.current?.abort(); }, []);
  function invalidate() {
    if (ctrl.current) trackDemoEvent("evidence-check", "run_cancelled");
    ctrl.current?.abort(); ctrl.current = null; setRunning(false); setRows(fields.map(() => ({ state: "waiting" }))); setMode("edited");
    setStatus("Inputs changed. Check the record to see fresh results.");
  }
  function reset() {
    if (ctrl.current) trackDemoEvent("evidence-check", "run_cancelled");
    trackDemoEvent("evidence-check", "sample_viewed");
    ctrl.current?.abort(); ctrl.current = null; setRunning(false); setSource(sampleSource); setValues([...sampleValues]); setRows(preview()); setMode("sample"); setSelected(1);
    setStatus("Sample preview. Curated results; no API calls were made for this preview.");
  }
  function cancel() {
    trackDemoEvent("evidence-check", "run_cancelled");
    ctrl.current?.abort(); ctrl.current = null; setRunning(false);
    setRows(current => current.map(row => row.state === "waiting" || row.state === "working" ? { state: "stopped" } : row));
    setStatus("Stopped. Finished checks remain visible; other fields were not checked.");
  }
  async function run() {
    if (ctrl.current || !source.trim()) return;
    trackDemoEvent("evidence-check", "run_started");
    if (source !== sampleSource || values.some((v, i) => v !== sampleValues[i])) trackDemoEvent("evidence-check", "own_input_run");
    const controller = new AbortController(); ctrl.current = controller; setRunning(true); setMode("live");
    const next: Row[] = fields.map(() => ({ state: "waiting" })); setRows([...next]); setStatus("Checking the proposed record against your source…");
    let failed = 0;
    try {
      for (const [index, field] of fields.entries()) {
        if (controller.signal.aborted) return;
        if (!values[index].trim()) {
          next[index] = { state: "checked", check: assess(source, "", { matches: false, probability: 0, found: [] }) }; setRows([...next]); continue;
        }
        next[index] = { state: "working" }; setRows([...next]);
        try {
          const { data } = await dm1("verify", verificationRequest(source, field, values[index]), controller.signal);
          if (controller.signal.aborted || ctrl.current !== controller) return;
          next[index] = { state: "checked", check: assess(source, values[index], data) };
        } catch (error) {
          if (controller.signal.aborted || ctrl.current !== controller) return;
          failed++; next[index] = { state: "failed", error: error instanceof Error ? error.message : "This field check failed. Try again." };
        }
        setRows([...next]);
      }
      trackDemoEvent("evidence-check", failed ? "run_failed" : "run_completed");
      setStatus(failed ? `Finished with ${failed} failed field ${failed === 1 ? "check" : "checks"}. Retry to check the record again.` : "Check complete. Review the evidence before reusing this record.");
    } finally { if (ctrl.current === controller) { ctrl.current = null; setRunning(false); } }
  }
  const active = rows[selected];
  const evidence = active?.check?.evidence ?? [];
  const [span, setSpan] = useState(0);
  const highlight = evidence[span] ?? evidence[0];
  const supported = rows.filter(r => r.check?.verdict === "supported").length;
  const attention = rows.filter(r => r.check && r.check.verdict !== "supported").length;
  const completed = rows.filter(r => r.check && r.check.verdict !== "empty").length;
  return <div className="evidence-demo">
    <div className="ec-toolbar">
      <div><span className="tag">{mode === "sample" ? "Sample preview" : mode === "edited" ? "Ready to check" : "Model check"}</span><p>One source. Four proposed facts. See what holds up.</p></div>
      <div className="ec-actions"><button className="btn" onClick={reset}>Reset sample</button>{running ? <button className="btn" onClick={cancel}>Stop checking</button> : <button className="btn primary" disabled={!source.trim()} onClick={run}><MagnifyingGlassIcon size={18} aria-hidden="true"/>Check record</button>}</div>
    </div>
    <p role="status" className="ec-status">{status}</p>
    <div className="ec-workbench">
      <section className="ec-document panel" aria-labelledby="ec-source-heading">
        <div className="ec-section-head"><h2 id="ec-source-heading">Source document</h2><span className="muted">{source === sampleSource ? "Fictional example · text only" : "Your supplied text"}</span></div>
        <div className="ec-paper" aria-label="Source text with selected evidence">{highlight ? <>{source.slice(0, highlight.start)}<mark>{source.slice(highlight.start, highlight.end)}</mark>{source.slice(highlight.end)}</> : source || "Add source text below."}</div>
        <details className="ec-edit"><summary>Edit source text</summary><label htmlFor="ec-source">Source text <span className="muted">({source.length.toLocaleString()} / 20,000)</span></label><textarea id="ec-source" className="textarea" maxLength={20000} value={source} onChange={e => { invalidate(); setSource(e.target.value); }}/></details>
        <p className="ec-footnote">Highlights locate returned wording exactly. They do not establish that the model selected the correct field.</p>
      </section>
      <section className="ec-record panel" aria-labelledby="ec-record-heading">
        <div className="ec-section-head"><h2 id="ec-record-heading">Proposed record</h2><span className="muted">Editable values</span></div>
        <div className="ec-counts"><span><b>{supported}</b> supported</span><span><b>{attention}</b> to review</span><span><b>{completed}/{fields.length}</b> checked{mode === "sample" ? " in preview" : ""}</span></div>
        <div className="ec-fields">{fields.map((field, i) => {
          const row = rows[i]; const verdict = row?.check?.verdict;
          return <div className={`ec-field ${selected === i ? "is-selected" : ""}`} key={field.name}>
            <label htmlFor={`ec-${field.name}`}>{field.label}</label>
            <input id={`ec-${field.name}`} className="input" value={values[i]} maxLength={500} onChange={e => { invalidate(); setValues(old => old.map((v, j) => j === i ? e.target.value : v)); }}/>
            <button className={`ec-verdict ${verdict === "supported" ? "is-supported" : verdict ? "is-review" : ""}`} onClick={() => { setSelected(i); setSpan(0); trackDemoEvent("evidence-check", "evidence_opened"); }} aria-pressed={selected === i} aria-label={`Inspect ${field.label}: ${verdict ? labels[verdict] : row?.state ?? "waiting"}`}>
              {verdict === "supported" ? <CheckCircleIcon size={16} aria-hidden="true"/> : verdict ? <WarningCircleIcon size={16} aria-hidden="true"/> : <MagnifyingGlassIcon size={16} aria-hidden="true"/>}
              {verdict ? labels[verdict] : row?.state === "working" ? "Checking…" : row?.state === "failed" ? "Request failed" : row?.state === "stopped" ? "Not checked · stopped" : "Not checked"}
            </button>
          </div>;
        })}</div>
      </section>
    </div>
    <section className="ec-inspector panel" aria-labelledby="ec-evidence-heading">
      <div><p className="panel-title">Evidence inspector</p><h2 id="ec-evidence-heading">{fields[selected].label}</h2><p>{active?.check?.reason ?? active?.error ?? (active?.state === "working" ? "Reading this field from the source…" : "Check the record to inspect returned evidence for this field.")}</p></div>
      <div className="ec-evidence-list">{evidence.length > 0 ? <><p className="panel-title">{mode === "sample" ? "Example source wording" : "Returned source wording"}</p>{evidence.map((item, i) => <button className="ec-quote" aria-pressed={highlight === item} key={`${item.start}-${i}`} onClick={() => { setSpan(i); trackDemoEvent("evidence-check", "evidence_opened"); }}><span>“{item.text}”</span><small>Highlight in source</small></button>)}</> : <p className="muted">No source wording to highlight.</p>}
      {active?.check && active.check.verdict !== "empty" && <details className="ec-raw"><summary>{mode === "sample" ? "Sample response" : "API response"}</summary><pre>{JSON.stringify(active.check.result, null, 2)}</pre><p className="ec-footnote">Probability is span confidence, not the probability your record is true.</p></details>}</div>
    </section>
    <details className="ec-build panel"><summary>Workflow notes</summary><p>Check one field at a time, validate returned strings against the source, then send incomplete and uncertain matches to a reviewer. Full runs make up to four requests.</p><p><a href="#sdk-examples">See SDK and CLI examples</a></p></details>
  </div>;
}
