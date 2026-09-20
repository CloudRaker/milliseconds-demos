// node --experimental-transform-types src/lib/stock-client-check.mjs — no network or credentials.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dm1, setForceLive, getForceLive, setKey} from './dm1.ts';
import {getTelemetry} from './telemetry.ts';
const catalog=JSON.parse(await readFile(new URL('../generated/examples.json',import.meta.url)));
const [id,entry]=Object.entries(catalog).find(([,v])=>v.demo==='returns-desk');
let slug=entry.demo,key='',opened=false,failManifest=false,source='cache',status=200;
const calls=[];
globalThis.document={querySelector(selector){return selector==='[data-demo-slug]'?{dataset:{demoSlug:slug}}:{set open(value){opened=value},querySelector(){return {focus(){}}}}}};
globalThis.window={dispatchEvent(){}};
globalThis.localStorage={getItem(){return key},removeItem(){key=''}};
const session=new Map();
globalThis.sessionStorage={getItem(name){return session.get(name)??null},setItem(name,value){session.set(name,value)}};
globalThis.fetch=async(url,init)=>{
 if(url==='https://console.milliseconds.ai/api/demo-test-key')return new Response(null,{status:401});
 if(url.startsWith('/examples/')){if(failManifest)return new Response('',{status:503});return new Response(await readFile(new URL(`../../public/examples/${slug}.json`,import.meta.url)));}
 calls.push({url,...init});
 return new Response(JSON.stringify(status===200?{ok:true}:{error:{code:'key_rejected',message:'Rejected'}}),{status,headers:{'x-demo-source':source,'x-input-tokens':'123','x-inference-ms':'45','x-demo-generated-at':'2026-09-19T12:00:00Z'}});
};
await dm1(entry.route,entry.body);
assert.equal(calls.at(-1).url,`/api/examples/${id}`);assert.equal(calls.at(-1).body,'{}');assert(!('x-ms-key' in calls.at(-1).headers));
assert.equal(getTelemetry().cachedTokens,123);assert.equal(getTelemetry().personalTokens,0);
assert.equal(getTelemetry().liveElapsed.length,0,'cache delivery is not live latency');
key='sk-ms-private-key-never-sponsor';
await dm1(entry.route,entry.body);assert(!('x-ms-key' in calls.at(-1).headers),'saved keys are not sent for stock');
const custom={...entry.body,text:'My custom input must survive unchanged.'};
key='';const before=calls.length;
await assert.rejects(dm1(entry.route,custom),e=>e.code==='no_key');assert(opened);assert.equal(calls.length,before);assert.equal(custom.text,'My custom input must survive unchanged.');
key='sk-ms-private-key-never-sponsor';source='personal-live';
await dm1(entry.route,custom);assert.equal(calls.at(-1).url,'/api/run');assert.equal(calls.at(-1).headers['x-ms-key'],key);assert.deepEqual(JSON.parse(calls.at(-1).body).body,custom);
status=401;const rejected=calls.length;await assert.rejects(dm1(entry.route,custom),e=>e.code==='key_rejected');assert.equal(key,'');assert.equal(calls.length,rejected+1,'rejected custom call never retries sponsor');
status=200;source='';await assert.rejects(dm1(entry.route,entry.body),e=>e.code==='unconfirmed_example');
slug='invoice-desk';failManifest=true;key='sk-ms-private-key-never-sponsor';const failed=calls.length;
await assert.rejects(dm1('classify',custom),/catalog is unavailable/);assert.equal(calls.length,failed,'failed manifest never silently charges a saved key');
const abort=new AbortController();abort.abort();await assert.rejects(dm1(entry.route,entry.body,abort.signal),{name:'AbortError'});assert.equal(calls.length,failed);

// Explicit live mode bypasses even a broken manifest, and never falls back to sponsored inference.
setForceLive(true);assert.equal(getForceLive(),true);
assert.equal((await import('./dm1.ts?navigation')).getForceLive(),true,'choice persists across page navigation in this tab');
setKey('sk-ms-private-key-never-sponsor');source='personal-live';
const image=Object.values(catalog).find(entry=>entry.demo==='waste-sorter');
for(const sample of [entry,image]){
 const beforeLive=getTelemetry().liveElapsed.length;
 await dm1(sample.route,sample.body);
 assert.equal(calls.at(-1).url,'/api/run');
 assert.equal(calls.at(-1).headers['x-ms-key'],'sk-ms-private-key-never-sponsor');
 assert.deepEqual(JSON.parse(calls.at(-1).body),{route:sample.route,body:sample.body});
 assert.equal(getTelemetry().liveElapsed.length,beforeLive+1);
}
status=401;let liveCalls=calls.length;
await assert.rejects(dm1(entry.route,entry.body),e=>e.code==='key_rejected');
assert.equal(calls.length,liveCalls+1,'rejected live sample never falls back to sponsor');
liveCalls=calls.length;status=200;
await assert.rejects(dm1(entry.route,entry.body),e=>e.code==='no_key'&&e.message.includes('Live mode'));
assert.equal(calls.length,liveCalls,'no key means no live or sponsored request');
setForceLive(false);slug=entry.demo;failManifest=false;source='cache';
await dm1(entry.route,entry.body);
assert.equal(calls.at(-1).url,`/api/examples/${id}`);assert(!('x-ms-key' in calls.at(-1).headers));
console.log('Stock client checks passed: free defaults, live text/image samples, tab preference, no-key/rejected-key isolation, cache-independent live routing, telemetry and cancellation.');
