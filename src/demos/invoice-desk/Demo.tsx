import { useEffect, useRef, useState } from 'react';
import { CheckCircleIcon, WarningCircleIcon, MagnifyingGlassIcon, PlayIcon, StopIcon} from '@phosphor-icons/react';
import { trackDemoEvent } from '../../lib/demo-events';
import { dm1 } from '../../lib/dm1';
import { FIELDS, extractionRequest, evidenceRequest, totalRequest, parseDraft, parseEvidence, parseVerification, checks, evidenceMatches, type Draft, type Evidence, type Field, type Verification } from './logic';
import { SAMPLES, REFERENCE, invoice, previewEvidence, unexpectedStockTotal } from './data';
import './demo.css';
const first=SAMPLES[0], firstSource=invoice(first.draft);
export default function Demo(){
 const [sample,setSample]=useState(0),[source,setSource]=useState(firstSource),[draft,setDraft]=useState<Draft|null>({...first.draft});
 const [evidence,setEvidence]=useState<Evidence>(previewEvidence(first.draft,firstSource)),[verification,setVerification]=useState<Verification|null>({matches:true,probability:1,found:[first.draft.total],value:first.draft.total});
 const [reference,setReference]=useState({...REFERENCE}),[mode,setMode]=useState<'preview'|'idle'|'running'|'live'|'stopped'|'error'>('preview');
 const [provenance,setProvenance]=useState<'preview'|'live'|null>('preview');
 const [status,setStatus]=useState('Sample preview. No API calls have been made.'),[selected,setSelected]=useState<Field>('total');
 const controller=useRef<AbortController|null>(null);
 useEffect(()=>{trackDemoEvent('invoice-desk','sample_viewed');return ()=>controller.current?.abort();},[]);
 const running=mode==='running';
 function cancel(){trackDemoEvent('invoice-desk','run_cancelled');controller.current?.abort();controller.current=null;setMode('stopped');setStatus('Stopped. The current draft is incomplete; process again to finish all checks.');}
 function load(index:number){trackDemoEvent('invoice-desk','sample_viewed');setProvenance('preview');controller.current?.abort();controller.current=null;const s=SAMPLES[index],text=invoice(s.draft);setSample(index);setSource(text);setDraft({...s.draft});setEvidence(previewEvidence(s.draft,text));setVerification({matches:true,probability:1,found:[s.draft.total],value:s.draft.total});setReference({...REFERENCE});setMode('preview');setStatus('Sample preview. No API calls have been made.');}
 function editSource(value:string){setProvenance(null);controller.current?.abort();controller.current=null;setSource(value);setDraft(null);setEvidence({});setVerification(null);setMode('idle');setStatus('Source changed. Process the invoice to create a fresh draft.');}
 async function run(amountOnly=false){
  if(controller.current || !source.trim() || (amountOnly&&!draft?.total.trim()))return;
  trackDemoEvent('invoice-desk','run_started');if(source!==invoice(SAMPLES[sample].draft))trackDemoEvent('invoice-desk','own_input_run');
  const control=new AbortController();controller.current=control;setMode('running');setStatus(amountOnly?'Checking the edited total against the source…':'Reading invoice headers…');
  if(!amountOnly){setProvenance(null);setDraft(null);setEvidence({});setVerification(null);}
  try {
   let current=draft;
   let uncheckedStockTotal=false;
   if(!amountOnly){
    const extracted=await dm1<{data:unknown}>('extract',extractionRequest(source),control.signal);
    if(controller.current!==control)return;
    current=parseDraft(extracted.data.data);setProvenance('live');setDraft(current);setStatus('Finding source evidence for each field…');
    const answer=await dm1<unknown>('answer',evidenceRequest(source),control.signal);
    if(controller.current!==control)return;
    setEvidence(parseEvidence(answer.data,source));
   }
   if(current?.total.trim() && !amountOnly && unexpectedStockTotal(source,current.total)){
    uncheckedStockTotal=true;setVerification(null);
   } else if(current?.total.trim()){
    setStatus('Checking the total against the source…');
    const verified=await dm1<unknown>('verify',totalRequest(source,current.total),control.signal);
    if(controller.current!==control)return;
    setVerification(parseVerification(verified.data,current.total,source));
   }
   trackDemoEvent('invoice-desk','run_completed');setMode('live');setStatus(uncheckedStockTotal?'Draft extracted, but the model total differs from this stock invoice. Review the source; no amount check was run.':amountOnly?'Amount check complete. Other draft fields retain their existing source evidence.':'Processing complete. Review the draft and any exceptions below.');
  }catch(error){if(controller.current===control){trackDemoEvent('invoice-desk','run_failed');setMode('error');setStatus(`Could not finish: ${error instanceof Error?error.message:'request failed'}. Retry to finish processing.`);}}
  finally{if(controller.current===control)controller.current=null;}
 }
 const review=draft?checks(draft,evidence,verification,reference):[];
 const missing=review.filter(c=>c.kind==='missing'),conflicts=review.filter(c=>c.kind==='conflict'),uncertain=review.filter(c=>c.kind==='review'),issues=review.filter(c=>c.kind!=='pass');
 const span=evidence[selected];
 const ready=!!draft&&!issues.length&&(mode==='preview'||mode==='live');
 return <div className="invoice-desk">
  <div className="id-toolbar"><label>Example<select aria-label="Invoice example" value={sample} onChange={e=>load(Number(e.target.value))} disabled={running}>{SAMPLES.map((s,i)=><option key={s.name} value={i}>{s.name}</option>)}</select></label><div className="id-actions">{running?<button className="btn" onClick={cancel}><StopIcon size={17}/>Stop processing</button>:<button className="btn primary" disabled={!source.trim()} onClick={()=>run()}><PlayIcon size={17}/>Process invoice</button>}<span className="muted">Text in. Reviewable record out.</span></div></div>
  <div className={`id-status ${mode==='error'?'id-error':''}`} role="status"><span className="tag">{mode==='preview'?'Sample preview':mode==='live'?(provenance==='preview'?'Sample + amount check':'Model result'):mode==='running'?'Processing':mode==='idle'?'Not processed':mode==='stopped'?'Stopped':'Incomplete'}</span>{status}</div>
  <div className="id-workspace">
   <section className="id-source"><div className="id-section-head"><div><p className="id-eyebrow">Source document</p><h2>The invoice</h2></div><span className="muted">{source===invoice(SAMPLES[sample].draft)?'Fictional sample':'Your source text'}</span></div>
    <div className="id-paper"><div className="id-paper-top"><span>INVOICE TEXT</span><span>{source.length.toLocaleString()} characters</span></div><pre aria-label="Invoice source with selected evidence">{span?<>{source.slice(0,span.start)}<mark>{source.slice(span.start,span.end)}</mark>{source.slice(span.end)}</>:source}</pre></div>
    <details className="id-edit"><summary>Edit invoice text</summary><label htmlFor="id-source-text">Paste invoice headers</label><textarea id="id-source-text" maxLength={20000} value={source} onChange={e=>editSource(e.target.value)} rows={14}/><p className="muted">Text only, up to 20,000 characters. No files or payments are sent.</p></details>
    <details className="id-reference"><summary>Purchase order & prior record</summary><p className="muted">Supplied comparison data, checked by code. Edit these values to model your review policy.</p><div className="id-reference-fields">{([['po','Expected PO'],['total','Expected total'],['currency','Expected currency'],['priorInvoice','Prior invoice number'],['priorVendor','Prior vendor']] as const).map(([key,label])=><label key={key}>{label}<input value={reference[key]} maxLength={200} onChange={e=>{setReference({...reference,[key]:e.target.value});trackDemoEvent('invoice-desk','policy_changed');}}/></label>)}</div></details>
   </section>
   <section className="id-record"><div className="id-section-head"><div><p className="id-eyebrow">Draft record</p><h2>{ready?'Ready for human review':draft?'Review exceptions':'Awaiting processing'}</h2></div>{ready?<CheckCircleIcon className="id-good" size={25}/>:<WarningCircleIcon size={25} className="id-warning"/>}</div>
    <p className="id-record-note">Edit a field to test the checks. This draft never authorizes payment.</p>
    <div className="id-fields">{FIELDS.map(f=><div key={f.key} className={`id-field ${selected===f.key?'id-selected':''}`}><label htmlFor={`id-${f.key}`}>{f.label}</label><input id={`id-${f.key}`} value={draft?.[f.key]??''} disabled={!draft||running} placeholder={draft?'Missing':'Not processed'} maxLength={500} onChange={e=>{if(draft){setDraft({...draft,[f.key]:e.target.value});setStatus(provenance==='preview'?'Edited sample preview. Local checks updated; no API calls made.':'Draft edited. Source evidence and local checks update immediately; recheck a changed total.');}}}/><button className="id-evidence-button" type="button" aria-label={`Inspect ${f.label.toLowerCase()} evidence`} onClick={()=>{setSelected(f.key);trackDemoEvent('invoice-desk','evidence_opened');}} disabled={!draft}><MagnifyingGlassIcon size={17}/><span>{!draft?'—':!draft[f.key]?'Missing':evidenceMatches(f.key,draft[f.key],evidence[f.key])?'Source':'Review'}</span></button></div>)}</div>
    <div className="id-evidence"><p className="id-eyebrow">{FIELDS.find(f=>f.key===selected)?.label} / Source evidence</p>{span?<><blockquote>{span.answer}</blockquote><p className="muted">{provenance==='preview'?'Curated sample evidence':`Model span score ${Math.round(span.probability*100)}% · characters ${span.start}–${span.end}`}. {draft&&evidenceMatches(selected,draft[selected],span)?'Matches the draft value.':'Does not match the current draft value.'}</p></>:<p className="muted">No validated source span available. Review this field in the original text.</p>}</div>
    <div className="id-amount-action"><button className="btn" disabled={running||!draft?.total.trim()} onClick={()=>run(true)}>Recheck total</button><span className="muted">Stock totals are free. A custom amount requires your key.</span></div>
   </section>
  </div>
  <section className="id-checks"><div className="id-section-head"><div><p className="id-eyebrow">Review queue</p><h2>{draft?`${issues.length} ${issues.length===1?'item':'items'} to review`:'Process an invoice to see checks'}</h2></div><div className="id-counts"><span><b>{missing.length}</b> missing</span><span><b>{conflicts.length}</b> discrepancies</span><span><b>{uncertain.length}</b> source checks</span></div></div>
   {draft&&<><div className="id-check-list">{(issues.length?issues:[{kind:'pass',title:'No exceptions in these checks',detail:'All required draft fields are present, source spans match and the supplied purchase order agrees. A person still reviews the invoice.'}]).map((check,i)=><div className="id-check" key={`${check.title}-${i}`}>{check.kind==='pass'?<CheckCircleIcon size={21} className="id-good"/>:<WarningCircleIcon size={21} className="id-warning"/>}<div><strong>{check.title}</strong><p>{check.detail}</p></div></div>)}</div><details className="id-passed"><summary>{review.filter(c=>c.kind==='pass').length} passing checks · inspect the rules</summary>{review.filter(c=>c.kind==='pass').map(c=><p key={c.title}><strong>{c.title}:</strong> {c.detail}</p>)}</details></>}
  </section>
  <details className="id-build"><summary>Workflow notes</summary><p>Extract a draft, locate supporting text, then verify the total. Code owns required fields, exact decimal comparisons and purchase-order checks.</p><p><a href="#sdk-examples">See SDK and CLI examples</a></p></details>
 </div>;
}
