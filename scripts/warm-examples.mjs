// node scripts/warm-examples.mjs https://demo.milliseconds.ai
// Public endpoint only. Fills may consume the server's sponsored quota.
import {readFile,writeFile} from 'node:fs/promises';
const base=process.argv[2];
if(!base || !/^https?:\/\//.test(base))throw new Error('Supply the demo origin explicitly.');
const catalog=JSON.parse(await readFile(new URL('../src/generated/examples.json',import.meta.url)));
const report={startedAt:new Date().toISOString(),base,results:[]};
const output=process.env.QA_OUTPUT ?? '/tmp/milliseconds-stock-warmup.json';
const entries=Object.entries(catalog).filter(([id])=>!process.env.DEMO_FILTER||id.startsWith(process.env.DEMO_FILTER+'/'));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let next=0,last=0;
async function work(){
 for(;;){
  const index=next++;if(index>=entries.length)return;
  const [id,entry]=entries[index];
  let record;
  for(let attempt=0;attempt<3;attempt++){
   const at=Math.max(Date.now(),last+550);last=at;await sleep(Math.max(0,at-Date.now()));
   try{
    const response=await fetch(`${base.replace(/\/$/,'')}/api/examples/${id}`,{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(30000)});
    const data=await response.json();
    record={id,demo:entry.demo,status:response.status,source:response.headers.get('x-demo-source'),tokens:response.headers.get('x-input-tokens'),modelMs:response.headers.get('x-inference-ms'),generatedAt:response.headers.get('x-demo-generated-at'),attempts:attempt+1,...(!response.ok?{error:data.error?.code}: {})};
    if(response.ok)break;
   }catch(error){record={id,demo:entry.demo,status:0,error:error.message,attempts:attempt+1};}
   if(attempt<2)await sleep(31000);
  }
  report.results.push(record);
  if(record.status!==200)console.log(JSON.stringify(record));
  if(report.results.length%50===0){console.log(`${report.results.length}/${entries.length} checked; ${report.results.filter(r=>r.status!==200).length} unavailable`);await writeFile(output,JSON.stringify(report,null,2));}
 }
}
await Promise.all([work(),work()]);
report.finishedAt=new Date().toISOString();await writeFile(output,JSON.stringify(report,null,2));
const failed=report.results.filter(r=>r.status!==200);
console.log(`Finished: ${report.results.length} examples; ${failed.length} unavailable. Report: ${output}`);
if(failed.length)process.exitCode=1;
