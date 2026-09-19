import { useEffect, useRef, useState } from "react";
import { ArrowUUpLeft, CheckCircle, CircleDashed, WarningCircle, Stop, Play } from "@phosphor-icons/react";
import { dm1 } from "../../lib/dm1";
import { trackDemoEvent } from "../../lib/demo-events";
import { DEFAULT_POLICY, EXAMPLES, preview } from "./data";
import { intentRequest, evidenceRequest, readResponses, routeReturn, type Order, type Policy, type Reading } from "./logic";
import "./demo.css";
const intentName = { return_or_exchange: "Return or exchange", delivery_status: "Delivery question", other: "Other / unclear" };
const track = (action: Parameters<typeof trackDemoEvent>[1]) => trackDemoEvent("returns-desk", action);

export default function ReturnsDesk() {
  const [selected, setSelected] = useState<number | null>(0);
  const [text, setText] = useState<string>(EXAMPLES[0].text);
  const [order, setOrder] = useState<Order>({ ...EXAMPLES[0].order });
  const [policy, setPolicy] = useState<Policy>({ ...DEFAULT_POLICY });
  const [reading, setReading] = useState<Reading | null>(preview(0));
  const [mode, setMode] = useState<"sample" | "edited" | "running" | "live" | "stopped" | "error">("sample");
  const [status, setStatus] = useState("Sample preview. Curated reading; no API calls made.");
  const [highlight, setHighlight] = useState(false);

  const controller = useRef<AbortController | null>(null);
  const decision = reading ? routeReturn(order, policy, reading) : null;
  useEffect(() => { track("sample_viewed"); return () => controller.current?.abort(); }, []);

  function invalidate() {
    if (controller.current) { controller.current.abort(); controller.current = null; track("run_cancelled"); }
    setReading(null); setMode("edited"); setStatus("Inputs changed. Check the request again to create a fresh draft route."); setHighlight(false); setSelected(null);
  }
  function editOrder(key: keyof Order, value: string) { invalidate(); setOrder(o => ({ ...o, [key]: value })); }
  function editPolicy(next: Policy) { invalidate(); setPolicy(next); track("policy_changed"); }
  function selectExample(index: number) {
    invalidate(); const example = EXAMPLES[index];
    setSelected(index); setText(example.text); setOrder({ ...example.order }); setPolicy({ ...DEFAULT_POLICY }); setReading(preview(index)); setMode("sample"); setStatus("Sample preview. Curated reading; no API calls made."); track("sample_viewed");
  }
  async function run() {
    if (controller.current) return;
    if (!text.trim()) { setStatus("Add a customer request before running."); return; }
    const abort = new AbortController(); controller.current = abort;
    setMode("running"); setReading(null); setHighlight(false); setStatus("Reading customer intent…"); track("run_started"); if (selected === null) track("own_input_run");
    try {
      const classification = await dm1("classify", intentRequest(text), abort.signal);
      if (abort.signal.aborted) return;
      setStatus("Finding the order number in the request…");
      const answers = await dm1("answer", evidenceRequest(text), abort.signal);
      if (controller.current !== abort || abort.signal.aborted) return;
      const result = readResponses(classification.data, answers.data, text);
      setReading(result); setMode("live"); setStatus("Reading complete. Policy checks applied to your supplied facts."); track("run_completed");
    } catch (error) {
      if (controller.current !== abort || abort.signal.aborted) return;
      setMode("error"); setStatus(error instanceof Error ? error.message : "The request failed. Try again."); track("run_failed");
    } finally { if (controller.current === abort) controller.current = null; }
  }
  function stop() { controller.current?.abort(); controller.current = null; setMode("stopped"); setReading(null); setStatus("Stopped. No draft route was created. You can run the request again."); track("run_cancelled"); }
  const evidence = reading?.order;
  return <div className="returns-desk">
    <div className="rd-examples" aria-label="Sample requests">
      <span className="panel-title">Try a case</span>
      {EXAMPLES.map((example, i) => <button type="button" key={example.name} className={`btn ${selected === i ? "rd-selected" : ""}`} aria-pressed={selected === i} onClick={() => selectExample(i)}>{example.name}</button>)}
    </div>
    <div className="rd-workbench">
      <section className="rd-inputs panel" aria-label="Request and order facts">
        <div className="rd-section-head"><span className="rd-step">01</span><h2>The request</h2></div>
        <label className="rd-label" htmlFor="rd-request">Customer message <span>{selected === null ? "Your text · editable" : "Fictional sample · editable"}</span></label>
        <textarea id="rd-request" className="textarea" value={text} maxLength={20000} onChange={e => { invalidate(); setText(e.target.value); }} />
        
        <div className="rd-subhead"><h3>Supplied order facts</h3><span>Not verified by the model</span></div>
        <div className="rd-fields">
          <label>Order ID<input className="input" value={order.id} maxLength={100} onChange={e => editOrder("id", e.target.value)} placeholder="e.g. RD-1042" /></label>
          <label>Order value (USD)<input className="input" inputMode="decimal" value={order.amount} maxLength={16} onChange={e => editOrder("amount", e.target.value)} placeholder="e.g. 89.00" /></label>
          <label>Delivered on<input className="input" type="date" value={order.delivered} onChange={e => editOrder("delivered", e.target.value)} /></label>
          <label>Request received on<input className="input" type="date" value={order.requested} onChange={e => editOrder("requested", e.target.value)} /></label>
          <label>Item condition<select className="select" value={order.condition} onChange={e => editOrder("condition", e.target.value)}><option value="unknown">Not confirmed</option><option value="unused">Unused</option><option value="used">Used</option><option value="damaged">Damaged</option></select></label>
          <label>Final-sale item?<select className="select" value={order.finalSale} onChange={e => editOrder("finalSale", e.target.value)}><option value="unknown">Not confirmed</option><option value="no">No</option><option value="yes">Yes</option></select></label>
        </div>
        <div className="rd-actions"><button className="btn primary" type="button" disabled={mode === "running" || !text.trim()} onClick={run}><Play size={17} aria-hidden="true" />{mode === "error" ? "Retry check" : "Check request"}</button>{mode === "running" && <button className="btn" type="button" onClick={stop}><Stop size={16} aria-hidden="true" />Stop</button>}<span>2 API requests per complete run</span></div>
        <p className={`rd-status ${mode === "error" ? "error" : ""}`} role="status">{status}</p>
      </section>
      <section className="rd-result panel" aria-label="Draft routing result">
        <div className="rd-section-head"><span className="rd-step">02</span><h2>The next step</h2><span className="tag">{mode === "sample" ? "Sample preview" : mode === "live" ? "Model reading" : mode === "running" ? "Working" : "Not checked"}</span></div>
        {decision && reading ? <>
          <div className={`rd-route ${decision.route === "Standard handling" ? "rd-standard" : "rd-review"}`}><ArrowUUpLeft size={25} aria-hidden="true" /><div><p className="rd-kicker">Draft route</p><h3 data-testid="return-route">{decision.route}</h3></div></div>
          <p className="rd-next">{decision.next}</p>
          <div className="rd-reading"><span>Request reading</span><strong>{intentName[reading.intent]}</strong>{mode === "live" && <small>Model label score: {Math.round(reading.probability * 100)}% · not an approval probability</small>}{evidence ? <button type="button" className="rd-evidence" aria-expanded={highlight} onClick={() => { setHighlight(v => !v); track("evidence_opened"); }}>View order evidence: <q>{evidence.answer}</q></button> : <small>No usable order-number evidence found. Ask the customer to supply it.</small>}{highlight && evidence && <div className="rd-source" aria-label="Highlighted source evidence">{text.slice(0, evidence.start)}<mark>{text.slice(evidence.start, evidence.end)}</mark>{text.slice(evidence.end)}</div>}</div>
          <div className="rd-check-head"><span>Policy checks</span><span>{decision.checks.filter(c => c.state === "pass").length} of {decision.checks.length} clear</span></div>
          <ul className="rd-checks">{decision.checks.map((check, i) => <li key={`${check.name}-${i}`} data-state={check.state}>{check.state === "pass" ? <CheckCircle size={20} aria-label="Clear" /> : check.state === "missing" ? <CircleDashed size={20} aria-label="Missing" /> : <WarningCircle size={20} aria-label="Review" />}<div><strong>{check.name}<span>{check.state === "pass" ? "Clear" : check.state === "missing" ? "Missing" : "Review"}</span></strong><p>{check.detail}</p></div></li>)}</ul>
        </> : <div className="rd-empty"><CircleDashed size={32} aria-hidden="true" /><h3>{mode === "running" ? "Reading the request" : mode === "stopped" ? "Run stopped" : mode === "error" ? "Check could not finish" : "Ready for a fresh check"}</h3><p>{mode === "running" ? "The model reads the message; the rules below decide the draft route." : "Run the check to see the next step and each supporting policy check."}</p></div>}
        <p className="rd-footnote">Routing only. No refund, return label or customer message is created.</p>
      </section>
    </div>
    <section className="rd-policy" aria-labelledby="rd-policy-heading"><div><p className="panel-title">Your rules, in code</p><h2 id="rd-policy-heading">Store policy</h2><p>Adjust the limits and run again.<br />Damaged and final-sale items always need review.</p></div><div className="rd-policy-fields"><label>Return window (days, inclusive)<input className="input" type="number" min="0" max="365" step="1" value={policy.days} onChange={e => editPolicy({ ...policy, days: e.target.value })} /></label><label>Standard-handling ceiling (USD)<input className="input" inputMode="decimal" maxLength={16} value={policy.ceiling} onChange={e => editPolicy({ ...policy, ceiling: e.target.value })} /></label><label className="rd-checkbox"><input type="checkbox" checked={policy.unusedOnly} onChange={e => editPolicy({ ...policy, unusedOnly: e.target.checked })} />Require an unused item</label></div></section>
    <details className="rd-build"><summary>Workflow notes</summary><p>Two model reads, followed by explicit policy checks. Preserve source evidence and keep the final action with your team.</p><p>Intent scores below 0.80 enter review. This demo threshold is a routing choice, not calibrated accuracy. Validate it on your own cases.</p><p><a href="#sdk-examples">See SDK and CLI examples</a></p></details>
  </div>;
}
