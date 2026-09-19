import fs from 'node:fs';
import { FIXTURES, SAMPLES } from './fixtures.ts';
import { SCHEMA, INTENTS, DEFAULT_CRITERIA, fitLabels, INTENT_STATEMENTS, intentFrom } from './logic.ts';
const key=process.env.MS_API_KEY;
if(!key) throw new Error('Set MS_API_KEY to run the optional live probe.');
const report=[];
async function call(route,body) { await new Promise(r=>setTimeout(r,3100)); const start=Date.now(); const response=await fetch('https://api.milliseconds.ai/v1/decision-machine-1/'+route,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+key},body:JSON.stringify(body)}); const data=await response.json(); if(!response.ok) throw new Error(`API status ${response.status}`); return {data,wallMs:Date.now()-start,tokens:response.headers.get('x-input-tokens')}; }
const intents=await call('yes-no',{texts:FIXTURES.map(r=>r.text),statements:INTENT_STATEMENTS});
report.push({name:'intent-30',...intents,accuracy:intents.data.results.filter((r,i)=>intentFrom(r).label===FIXTURES[i].intent).length+'/30',heldOut:intents.data.results.slice(24).filter((r,i)=>intentFrom(r).label===FIXTURES[24+i].intent).length+'/6'});
report.push({name:'facts-six',...await call('extract',{texts:SAMPLES.map(r=>r.text),schema:SCHEMA})});
for(const criterion of DEFAULT_CRITERIA) report.push({name:criterion,...await call('classify',{texts:SAMPLES.map(r=>r.text),labels:fitLabels(criterion)})});
fs.writeFileSync(new URL('./probe-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.map(({name,accuracy,heldOut,wallMs,tokens,data})=>({name,accuracy,heldOut,wallMs,tokens,labels:data.results?.map(r=>r.label),facts:name==='facts-six'?data:undefined})),null,2));
