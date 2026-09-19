import { useEffect, useRef, useState } from 'react';
import { ArrowRightIcon, CheckCircleIcon, MagnifyingGlassIcon, PlusIcon, SlidersHorizontalIcon, StopIcon } from '@phosphor-icons/react';
import { dm1 } from '../../lib/dm1';
import { trackDemoEvent } from '../../lib/demo-events';
import { intentRequest, factsRequest, fitRequest, batch, DEFAULT_CRITERIA, destination, DIMENSIONS, factsFrom, groundedFit, FIELDS, fitFrom, intentFrom, missing, score, snippet, TEAMS, type Field, type Lead, type Match } from './logic';
import { SAMPLES, sampleLeads } from './fixtures';
import './demo.css';
const event = (action: Parameters<typeof trackDemoEvent>[1]) => trackDemoEvent('sales-intake',action);
type Phase = 'sample'|'edited'|'running'|'complete'|'stopped'|'error';

export default function Demo() {
 const [messages,setMessages]=useState(SAMPLES.map(({id,subject,text})=>({id,subject,text})));
 const [leads,setLeads]=useState<(Lead|null)[]>(sampleLeads);
 const [selected,setSelected]=useState('01');
 const [criteria,setCriteria]=useState([...DEFAULT_CRITERIA]);
 const [weights,setWeights]=useState([50,30,20]);
 const [phase,setPhase]=useState<Phase>('sample');
 const [status,setStatus]=useState('Sample preview · curated results. No API calls have been made.');
 const [evidence,setEvidence]=useState<Field|null>(null);
 const controller=useRef<AbortController|null>(null);
 const ownInput=useRef(false);
 const busy=phase==='running';
 useEffect(()=>{ event('sample_viewed'); return ()=>controller.current?.abort(); },[]);
 const index=messages.findIndex(m=>m.id===selected), message=messages[index], lead=leads[index];
 const sorted=messages.map((m,i)=>({message:m,lead:leads[i]})).sort((a,b)=>{
  const aSales=a.lead?.intent==='sales', bSales=b.lead?.intent==='sales';
  return Number(bSales)-Number(aSales) || (bSales ? (score(b.lead!.fit,weights).value??-1)-(score(a.lead!.fit,weights).value??-1):0);
 });
 const knownLeads=leads.filter((v):v is Lead=>!!v);
 const sales=knownLeads.filter(l=>l.intent==='sales');
 const reviews=knownLeads.filter(l=>l.routeReview || missing(l).length || (l.intent==='sales'&&l.fit.includes('unknown'))).length;
 const selectedScore=lead?score(lead.fit,weights):null;
 const span=evidence&&lead?snippet(message.text,lead.facts[evidence].value):null;
 function invalidate() { if(controller.current)event('run_cancelled'); controller.current?.abort(); controller.current=null; setLeads(messages.map(()=>null)); setPhase('edited'); setEvidence(null); setStatus('Inputs changed. Run the inbox to create fresh results.'); }
 function reset() { controller.current?.abort(); controller.current=null; setMessages(SAMPLES.map(({id,subject,text})=>({id,subject,text})));setLeads(sampleLeads());setSelected('01');setCriteria([...DEFAULT_CRITERIA]);setWeights([50,30,20]);setEvidence(null);setPhase('sample');setStatus('Sample preview · curated results. No new API calls.'); ownInput.current=false;event('sample_viewed'); }
 async function run() {
  if(controller.current) return;
  if(messages.some(m=>!m.text.trim()) || criteria.some(c=>!c.trim())) {setStatus('Enter text for every message and all three criteria before running.');return;}
  const ctrl=new AbortController();controller.current=ctrl;setPhase('running');setLeads(messages.map(()=>null));setEvidence(null);event('run_started');if(ownInput.current)event('own_input_run');
  try {
   const texts=messages.map(m=>m.text);
   setStatus('1 of 5 · Finding the purpose of each message…');
   const intents=batch((await dm1('yes-no',intentRequest(texts),ctrl.signal)).data,texts.length).map(intentFrom);
   setStatus('2 of 5 · Extracting only stated facts…');
   const facts=batch((await dm1('extract',factsRequest(texts),ctrl.signal)).data,texts.length).map((row,i)=>factsFrom(row,texts[i]));
   const fits: Match[][]=[];
   for(let d=0;d<criteria.length;d++) {setStatus(`${d+3} of 5 · Evaluating ${DIMENSIONS[d].toLowerCase()}…`);fits.push(batch((await dm1('classify',fitRequest(texts,criteria[d]),ctrl.signal)).data,texts.length).map(row=>fitFrom(row,criteria[d])));}
   if(controller.current!==ctrl||ctrl.signal.aborted)return;
   setLeads(intents.map((intent,i)=>({intent:intent.label as Lead['intent'],routeReview:intent.uncertain||intent.label==='other',facts:facts[i],fit:groundedFit(fits.map(d=>d[i]),facts[i])})));
   setPhase('complete');setStatus(`Run complete · ${texts.length} messages processed. Review the drafts before using them.`);event('run_completed');
  } catch(error) {if(controller.current!==ctrl)return;if(ctrl.signal.aborted){setPhase('stopped');setStatus('Stopped. No incomplete results were added to the queue. Run again to retry.');event('run_cancelled');}else{setPhase('error');setStatus(error instanceof Error?error.message:'The run failed. Retry the inbox.');event('run_failed');}}
  finally {if(controller.current===ctrl)controller.current=null;}
 }
 function editFact(field:Field,value:string) {setLeads(current=>current.map((row,i)=>i===index&&row?{...row,facts:{...row.facts,[field]:{value,verified:!!value&&message.text.includes(value),edited:true}}}:row));setEvidence(null);}
 return <div className="sales-intake">
  <div className="si-toolbar"><div><span className={`tag ${phase==='sample'?'purple':phase==='error'?'warn':''}`}>{phase==='sample'?'Sample preview':phase==='complete'?'Model results':phase==='edited'?'Needs a new run':phase==='running'?'Working':phase==='stopped'?'Stopped':'Run failed'}</span><p role="status" className={phase==='error'?'error':'muted'}>{status}</p></div><div className="si-actions"><button className="btn" onClick={reset} disabled={busy}>Reset sample</button>{busy?<button className="btn" onClick={()=>controller.current?.abort()}><StopIcon size={16}/> Stop</button>:<button className="btn primary" onClick={run}>Run inbox <ArrowRightIcon size={16}/></button>}</div></div>
  <div className="si-outcomes"><span><b>{knownLeads.length}</b> {phase==='sample'?'sample messages':'processed messages'}</span><span><b>{sales.length}</b> sales inquiries</span><span><b>{reviews}</b> need review</span><span className="muted">Suggested destinations only. Nothing is sent.</span></div>
  <div className="si-workspace">
   <aside className="si-queue" aria-label="Inbound message queue"><div className="si-queue-title"><h2>Inbound queue</h2><span>{messages.length} messages</span></div><div className="si-queue-rows">{sorted.map(({message:m,lead:l})=><button key={m.id} className={`si-row ${selected===m.id?'selected':''}`} aria-pressed={selected===m.id} onClick={()=>{setSelected(m.id);setEvidence(null);}}><span className="si-row-title">{m.subject}</span><span className="si-row-meta"><span>{l?destination(l):busy?'Processing':'Not processed'}</span>{l?.intent==='sales'&&<b>{score(l.fit,weights).value??'—'}<small> fit · {score(l.fit,weights).coverage}% known</small></b>}</span></button>)}</div><button className="btn si-add" disabled={messages.length>=8||busy} onClick={()=>{invalidate();const id=`custom-${Date.now()}`;setMessages([...messages,{id,subject:'Your message',text:''}]);setLeads([...messages.map(()=>null),null]);setSelected(id);ownInput.current=true;}}><PlusIcon size={16}/> Add your message</button><p className="si-small">Sales first, then highest known fit. Up to 8 messages.</p></aside>
   <section className="si-detail" aria-label="Selected message"><div className="si-detail-heading"><div><p className="panel-title">Selected message</p><h2>{message.subject}</h2></div>{lead&&<span className={`tag ${destination(lead)==='Human review'?'warn':'purple'}`}>{destination(lead)}</span>}</div>
    {lead?.routeReview&&<p className="si-routing-note"><strong>Review the route.</strong> Strongest intent: {TEAMS[lead.intent]}. Signals are weak or conflicting; no team is confirmed.</p>}
    <label className="si-source-label" htmlFor="si-source">Source message <span>Editable · changing it clears the queue results</span></label><textarea id="si-source" className="textarea si-source" maxLength={20000} value={message.text} onChange={e=>{invalidate();setMessages(messages.map((m,i)=>i===index?{...m,text:e.target.value}:m));ownInput.current=true;}}/>
    {lead ? <>
     <div className="si-fit-heading"><h3>{lead.intent==='sales'?'Fit against your criteria':'Outside the sales queue'}</h3>{lead.intent==='sales'&&<p><b>{selectedScore?.value??'—'}</b><span>/ 100 known fit · {selectedScore?.coverage}% coverage</span></p>}</div>
     {lead.intent==='sales'?<><div className="si-dimensions">{DIMENSIONS.map((label,d)=><div key={label}><span>{label}</span><strong className={lead.fit[d]==='unknown'?'si-unknown':''}>{lead.fit[d]==='match'?'Matches':lead.fit[d]==='not_fit'?'Does not fit':'Unknown'}</strong><small>Weight {weights[d]}</small></div>)}</div><p className="si-small">Fit is a weighted policy score, not a purchase probability. Unknown criteria do not count as a rejection. Coverage shows how much of the policy could be evaluated.</p></>:<p className="si-small">Intent suggests {destination(lead).toLowerCase()}. Non-sales messages are not assigned a sales fit score.</p>}
     <div className="si-facts-heading"><h3>Draft facts</h3><span className="si-small">Select the search icon to inspect source wording.</span></div>
     <div className="si-facts">{(lead.intent==='sales'?Object.keys(FIELDS) as Field[]:['company','contact','email'] as Field[]).map(field=><div className="si-field" key={field}><label htmlFor={`si-${field}`}>{FIELDS[field]} <small>{lead.facts[field].edited?'Edited draft':!lead.facts[field].value?'Unknown':lead.facts[field].verified?'Source text found':'Check wording'}</small></label><div><input id={`si-${field}`} className="input" value={lead.facts[field].value} placeholder="Not established" maxLength={20000} onChange={e=>editFact(field,e.target.value)}/><button className="btn" aria-label={`Show source for ${FIELDS[field]}`} disabled={!lead.facts[field].value} onClick={()=>{setEvidence(field);event('evidence_opened');}}><MagnifyingGlassIcon size={17}/></button></div></div>)}</div>
     {evidence&&<div className="si-evidence" role="status"><b>{FIELDS[evidence]} · exact source wording</b>{span?<p>{span.before}<mark>{span.match}</mark>{span.after}</p>:<p>No exact wording found. This draft value needs a person to check it.</p>}<small>A matching span does not verify its meaning or the sender's identity.</small></div>}
     <p className="si-review"><CheckCircleIcon size={18}/>{missing(lead).length?`Sales handoff needs: ${missing(lead).join(', ')}.`:lead.intent==='sales'?'Company, email and need have source wording. A person should confirm the draft.':'Suggested team only. Review the message before forwarding.'}</p>
     <p className="si-small">Draft edits do not change intent or fit. Edit the source or criteria and run again to reevaluate. Budget and timing can remain unknown.</p>
    </>:<div className="si-empty"><h3>{busy?'Building a fresh queue…':'Ready for a fresh evaluation'}</h3><p>Run the inbox to extract facts and evaluate these messages against your criteria. Partial or failed runs never appear as completed records.</p></div>}
   </section>
  </div>
  <section className="si-policy" aria-label="Fit policy"><div className="si-policy-title"><h2><SlidersHorizontalIcon size={22}/> Your fit policy</h2><p>Change weights to reorder instantly. Change criteria to require a fresh run.</p></div><div className="si-policies">{DIMENSIONS.map((label,d)=><div key={label}><label htmlFor={`si-criterion-${d}`}>{label}</label><textarea id={`si-criterion-${d}`} className="textarea" maxLength={500} value={criteria[d]} onChange={e=>{invalidate();setCriteria(criteria.map((v,i)=>i===d?e.target.value:v));event('policy_changed');}}/><label className="si-weight" htmlFor={`si-weight-${d}`}>Weight <b>{weights[d]}</b><input id={`si-weight-${d}`} type="range" min="0" max="100" step="5" value={weights[d]} onChange={e=>{setWeights(weights.map((v,i)=>i===d?Number(e.target.value):v));event('policy_changed');}}/></label></div>)}</div><p className="si-small">Routing uses intent, independent of fit. A strongest intent signal below 0.8, or multiple signals at 0.8 and above, goes to human review; an uncertain fit dimension becomes unknown. Missing source wording for need or timing also makes that dimension unknown. This demo policy is not a calibrated accuracy guarantee.</p></section>
  <details className="si-build"><summary>Workflow notes</summary><p>Five API requests process the inbox. Classify intent, extract stated facts, then evaluate each fit criterion.</p><p><a href="#sdk-examples">See SDK and CLI examples</a></p></details>
 </div>;
}
