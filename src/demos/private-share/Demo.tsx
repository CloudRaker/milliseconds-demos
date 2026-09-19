import { useEffect, useRef, useState } from "react";
import { CopyIcon, DownloadSimpleIcon, PencilSimpleIcon, ShieldCheckIcon, XIcon } from "@phosphor-icons/react";
import { trackDemoEvent } from "../../lib/demo-events";
import { dm1 } from "../../lib/dm1";
import { detectionRequest, SAMPLE, SAMPLE_FINDINGS, literalFindings, mergedRanges, parseFindings, redact, type Finding } from "./logic";
import "./demo.css";

type Mode = "sample" | "edited" | "running" | "live" | "stopped" | "error";
const LABELS: Record<string, string> = { person: "Name", email: "Email", phone: "Phone", account_id: "Account / order", address: "Address", manual: "Added by you" };

export default function PrivateShare() {
  const [source, setSource] = useState(SAMPLE);
  const [findings, setFindings] = useState<Finding[]>(SAMPLE_FINDINGS);
  const [selected, setSelected] = useState(new Set(SAMPLE_FINDINGS.map((f) => f.id)));
  const [mode, setMode] = useState<Mode>("sample");
  const [editing, setEditing] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [manual, setManual] = useState("");
  const [notice, setNotice] = useState("");
  const [rejected, setRejected] = useState(0);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => { trackDemoEvent("private-share", "sample_viewed"); return () => active.current?.abort(); }, []);
  const running = mode === "running";
  const available = mode === "sample" || mode === "live" || findings.some((f) => f.manual);
  const chosen = findings.filter((f) => selected.has(f.id));
  const ranges = mergedRanges(source, chosen);
  const preview = redact(source, chosen);
  const detected = findings.filter((f) => !f.manual).length;

  function invalidate(value: string) {
    active.current?.abort(); active.current = null;
    setSource(value); setFindings([]); setSelected(new Set()); setReviewed(false);
    setMode("edited"); setError(""); setRejected(0); setNotice("");
  }
  function reset() {
    trackDemoEvent("private-share", "sample_viewed");
    active.current?.abort(); active.current = null;
    setSource(SAMPLE); setFindings(SAMPLE_FINDINGS); setSelected(new Set(SAMPLE_FINDINGS.map((f) => f.id)));
    setMode("sample"); setReviewed(false); setEditing(false); setRejected(0); setError(""); setNotice(""); setManual("");
  }
  async function run() {
    if (active.current || !source.trim()) return;
    trackDemoEvent("private-share", "run_started");
    if (source !== SAMPLE) trackDemoEvent("private-share", "own_input_run");
    const controller = new AbortController(); active.current = controller;
    setMode("running"); setFindings([]); setSelected(new Set()); setReviewed(false); setRejected(0); setError(""); setNotice(""); setEditing(false);
    try {
      const result = await dm1("entities", detectionRequest(source), controller.signal);
      if (active.current !== controller || controller.signal.aborted) return;
      const checked = parseFindings(source, result.data);
      setFindings(checked.findings); setSelected(new Set(checked.findings.map((f) => f.id)));
      setRejected(checked.rejected); setMode("live"); trackDemoEvent("private-share", "run_completed");
    } catch (e) {
      if (active.current !== controller || controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : "Detection failed. Try again."); setMode("error"); trackDemoEvent("private-share", "run_failed");
    } finally { if (active.current === controller) active.current = null; }
  }
  function cancel() {
    trackDemoEvent("private-share", "run_cancelled");
    active.current?.abort(); active.current = null; setMode("stopped"); setNotice("Stopped. No detection results were applied. Run again or add redactions manually.");
  }
  function addManual() {
    const matches = literalFindings(source, manual);
    if (!matches.length) { setNotice("That exact text was not found. Copy the wording from the transcript, including its spacing."); return; }
    setFindings((old) => [...old.filter((f) => !matches.some((m) => m.id === f.id)), ...matches].sort((a, b) => a.start - b.start));
    setSelected((old) => new Set([...old, ...matches.map((f) => f.id)]));
    trackDemoEvent("private-share", "policy_changed");
    setReviewed(false); setNotice(`${matches.length} matching occurrence${matches.length === 1 ? "" : "s"} selected for redaction.`); setManual("");
  }
  async function copy(value: string, what: string) {
    try { await navigator.clipboard.writeText(value); setNotice(`${what} copied.`); trackDemoEvent("private-share", "exported"); }
    catch { setNotice("Copy was unavailable. Select the text directly, or download the preview."); }
  }
  function download() {
    trackDemoEvent("private-share", "exported");
    const url = URL.createObjectURL(new Blob([preview], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "reviewed-transcript.txt"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Reviewed preview downloaded. Nothing was sent to a recipient.");
  }
  const status = mode === "sample" ? "Sample preview · curated selections, no API calls" : mode === "running" ? "Detecting personal details…" : mode === "live" ? `${detected} model finding${detected === 1 ? "" : "s"} · review the entire transcript` : mode === "edited" ? "Edited transcript · not yet checked by the model" : mode === "stopped" ? "Detection stopped" : "Detection unavailable · try again";

  return <div className="ps">
    <div className="ps-toolbar">
      <div><span className="ps-eyebrow">Vendor handoff</span><h2>Share the issue.<br />Keep the details private.</h2></div>
      <div className="ps-actions"><button className="btn" onClick={reset}>Load sample</button>{running ? <button className="btn" onClick={cancel}><XIcon size={17} />Stop detection</button> : <button className="btn primary" disabled={!source.trim()} onClick={() => void run()}>Detect details</button>}</div>
    </div>
    <p className="ps-status" role="status"><span className={`tag ${mode === "error" ? "warn" : "purple"}`}>{mode === "sample" ? "Sample" : mode === "live" ? "Model result" : mode === "edited" ? "Unprocessed" : mode}</span>{status}</p>
    {error && <p className="error" role="alert">{error}</p>}
    {rejected > 0 && <p className="ps-warning">{rejected} returned span{rejected === 1 ? "" : "s"} could not be matched to the source and were not applied. Inspect the transcript and add missed text manually.</p>}
    <div className="ps-desk">
      <section className="ps-document" aria-labelledby="ps-source-heading">
        <header><div><p className="ps-eyebrow">01 · Original</p><h3 id="ps-source-heading">Support transcript</h3></div><button className="btn ps-edit" aria-pressed={editing} onClick={() => { setEditing(!editing); if (editing) trackDemoEvent("private-share", "evidence_opened"); }}><PencilSimpleIcon size={16} />{editing ? "View source" : "Edit transcript"}</button></header>
        {editing ? <><label className="ps-sr" htmlFor="ps-source">Transcript</label><textarea id="ps-source" className="textarea ps-source" value={source} maxLength={20000} onChange={(e) => invalidate(e.target.value)} /><p className="ps-footnote">{source.length.toLocaleString()} / 20,000 characters · editing clears previous results</p></> : <div className="ps-transcript" data-testid="source-highlight">{ranges.length ? (() => { let cursor = 0; const chunks = ranges.flatMap((r) => { const parts = [<span key={`text-${r.start}`}>{source.slice(cursor, r.start)}</span>, <mark key={`mark-${r.start}`}>{source.slice(r.start, r.end)}</mark>]; cursor = r.end; return parts; }); return <>{chunks}{source.slice(cursor)}</>; })() : source || <span className="muted">Add a transcript to begin.</span>}</div>}
        <p className="ps-footnote">Highlighted text is selected for removal. The sample uses fictional details.</p>
      </section>
      <section className="ps-preview" aria-labelledby="ps-preview-heading">
        <header><div><p className="ps-eyebrow">02 · Prepared copy</p><h3 id="ps-preview-heading">Redaction preview</h3></div><ShieldCheckIcon size={26} aria-hidden="true" /></header>
        <div className={`ps-transcript ${!available ? "ps-empty" : ""}`} data-testid="redaction-preview">{available ? preview : <><strong>{running ? "Looking for details to review" : "Your preview starts with a review"}</strong><p>{running ? "The original text stays in place. Stop at any time." : "Run detection or add an exact phrase below. Previous results are cleared whenever you edit the source."}</p></>}</div>
        <div className="ps-export">
          <label className="ps-review"><input type="checkbox" checked={reviewed} disabled={!available || running} onChange={(e) => setReviewed(e.target.checked)} /><span>I reviewed the full transcript and the remaining visible details.</span></label>
          <div className="ps-actions"><button className="btn" disabled={!reviewed || !available || running} onClick={() => void copy(preview, "Reviewed preview")}><CopyIcon size={16} />Copy preview</button><button className="btn" disabled={!reviewed || !available || running} onClick={download}><DownloadSimpleIcon size={16} />Download .txt</button></div>
          <p className="ps-footnote">Nothing is sent. Detection can miss sensitive details.</p>
        </div>
      </section>
    </div>
    <section className="ps-review-desk" aria-labelledby="ps-review-heading">
      <div className="ps-review-heading"><div><p className="ps-eyebrow">03 · Your decision</p><h3 id="ps-review-heading">Choose what leaves the transcript</h3></div><p className="ps-count"><b>{selected.size}</b> selected · <b>{ranges.length}</b> redacted ranges</p></div>
      <p className="ps-help">All returned findings start selected, including low-confidence matches. Uncheck anything you want to keep.</p>
      <div className="ps-findings">{findings.map((f) => <label className={`ps-finding ${selected.has(f.id) ? "is-selected" : ""}`} key={f.id}><input type="checkbox" checked={selected.has(f.id)} disabled={running} onChange={(e) => { const on = e.target.checked; setSelected((old) => { const next = new Set(old); if (on) next.add(f.id); else next.delete(f.id); return next; }); setReviewed(false); trackDemoEvent("private-share", "policy_changed"); }} /><span><span className="ps-kind">{LABELS[f.type]}{f.probability !== undefined && <small title="Raw model span confidence; not a guarantee of correctness"> · {Math.round(f.probability * 100)}% model confidence</small>}</span><strong>{f.text}</strong><span className="ps-location">Characters {[...source.slice(0, f.start)].length + 1}–{[...source.slice(0, f.end)].length}{f.manual ? " · manual selection" : mode === "sample" ? " · sample selection" : " · exact source match"}</span></span></label>)}</div>
      {!findings.length && <p className="ps-no-findings">{mode === "live" ? "No requested details were detected. This does not mean the transcript contains no sensitive information." : running ? "Findings will appear here after detection." : "No current selections. Detect details or add exact text below."}</p>}
      <form className="ps-manual" onSubmit={(e) => { e.preventDefault(); addManual(); }}><label htmlFor="ps-manual">Missed something? Add exact text to remove.</label><div><input id="ps-manual" className="input" maxLength={20000} value={manual} disabled={running} placeholder="Paste a phrase from the transcript" onChange={(e) => setManual(e.target.value)} /><button className="btn" disabled={!manual || running}>Redact all matches</button></div><p className="ps-footnote">Matches are literal and case-sensitive. Every occurrence is selected; overlapping selections are combined.</p></form>
    </section>
    {notice && <p className="ps-notice" role="status">{notice}</p>}
    <details className="ps-build"><summary>Workflow notes</summary><p>One /entities request finds spans. Your code validates offsets, your user reviews the choices, and literal replacements create the preview. No generated rewrite.</p><p><a href="#sdk-examples">See SDK and CLI examples</a></p></details>
  </div>;
}
