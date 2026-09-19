// Offline checks: exact outbound requests match the catalog. No real inference or credentials.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('wrangler'))('esbuild');
const dir = await mkdtemp(join(tmpdir(), 'ms-simulations-check-'));
try {
  await build({ stdin: { contents: `
    import examples from './simulations';
    import { canonical } from '../lib/example-contract';
    import { stockPlan } from '../lib/stock-batch';
    import * as assist from '../demos/agent-assist/data';
    import * as dispatch from '../demos/dispatch/triage';
    import { STOCK_REPORTS, STOCK_TEXTS, STOCK_PAIRS } from '../demos/dispatch/stock';
    import { generateSurge, distance } from '../demos/dispatch/data';
    import { DEFAULT_SEED } from '../demos/dispatch/sim';
    import { Swarm } from '../demos/swarm/swarm';
    import { Controller, newTelemetry } from '../demos/tower/controller';
    import { stockSector, STOCK_SCENES } from '../demos/tower/stock';
    import { SEEDS } from '../demos/tower/data';
    import { calls } from '../lib/dm1';
    import assert from 'node:assert/strict';
    const registered = new Set(examples.map(entry => canonical({route:entry.route,body:entry.body})));
    function check(route,body) { assert(registered.has(canonical({route,body})), 'Unregistered '+route+' '+JSON.stringify(body).slice(0,160)); }
    function grouped(route,body,stock) { for(const group of stockPlan(body.texts,stock)) check(route,{...body,texts:group.texts}); }
    for (const script of assist.SCRIPTS) {
      const messages=[];
      for (const message of script.messages) {
        messages.push({role:'customer',text:message.text});
        const text=assist.transcript(messages,script.customer);
        grouped('classify',{texts:[text],labels:assist.MACRO_LABELS},assist.STOCK_TRANSCRIPTS);
        grouped('classify',{texts:[text],labels:assist.INTENT_LABELS},assist.STOCK_TRANSCRIPTS);
        grouped('rate',{texts:[text],scale:assist.CHURN_SCALE},assist.STOCK_TRANSCRIPTS);
        grouped('rate',{texts:[message.text],scale:assist.FRUSTRATION_SCALE},assist.STOCK_LATEST);
        grouped('yes-no',{texts:[text],statements:assist.STATEMENTS},assist.STOCK_TRANSCRIPTS);
        messages.push({role:'agent',text:'A changing suggested reply must not affect customer-only analysis.'});
      }
    }
    for (const report of [...STOCK_REPORTS,...generateSurge(DEFAULT_SEED,17.83,23000)]) {
      const text=dispatch.composeText(report);
      grouped('classify',{texts:[text],labels:dispatch.CATEGORY_LABELS},STOCK_TEXTS);
      grouped('rate',{texts:[text],scale:dispatch.SEVERITY_SCALE},STOCK_TEXTS);
      grouped('classify',{texts:[text],labels:dispatch.PACKAGE_LABELS},STOCK_TEXTS);
      grouped('yes-no',{texts:[text],statements:dispatch.STATEMENTS,...dispatch.HINTS},STOCK_TEXTS);
      for(const original of STOCK_REPORTS.filter(item=>distance(item.loc,report.loc)<=dispatch.MERGE_RADIUS_M)) {
        const pair=dispatch.composePair({id:'inc-999',category:'medical',summary:original.text.slice(0,140),address:original.address,age_seconds:73,distance_m:89,units_dispatched:4},report);
        grouped('yes-no',{texts:[pair],statements:[dispatch.DUPLICATE_STATEMENT],...dispatch.DUPLICATE_HINTS},STOCK_PAIRS);
      }
    }
    for(const agentCount of [8,16,24,32]) {
      const swarm=new Swarm({agentCount}); swarm.start(0);
      for(let scene=0;scene<6;scene++) await swarm.runStockScene(scene*8000);
      swarm.stop();
    }
    for(const {seed} of SEEDS) for(const rush of [false,true]) for(let scene=0;scene<STOCK_SCENES;scene++) {
      const controller=new Controller('api',stockSector(seed,rush,scene),newTelemetry());
      await controller.stockDecision(); controller.dispose();
    }
    for (const call of calls) check(call.route,call.body);
    for(const entry of examples) if(entry.body.texts) assert(entry.body.texts.length>0&&entry.body.texts.length<=32);
    console.log('All scripted customer prefixes, report/surge pairs, and '+calls.length+' actual simulation requests match '+examples.length+' catalog entries.');
    export default examples;
  `, resolveDir: new URL('.', import.meta.url).pathname, loader:'ts' }, bundle:true, platform:'node', format:'esm', outfile:join(dir,'check.mjs'), plugins:[{name:'offline-api', setup(build) { build.onLoad({filter:/\/lib\/dm1\.ts$/},()=>({loader:'js',contents:`
    export const calls=[];
    export class Dm1Error extends Error {}
    export async function dm1(route,body,signal) {
      signal?.throwIfAborted(); calls.push({route,body});
      const row=()=>route==='classify'?{label:Object.keys(body.labels)[0],scores:Object.fromEntries(Object.keys(body.labels).map((label,index)=>[label,index===0?1:0])),confidence:1,probability:1}:route==='rate'?{level:0,score:0,probability:1,scores:body.scale.map((_,index)=>index===0?1:0)}:{probability:0.1};
      return {data:{results:body.texts.map(row)},meta:{tokens:10,inferenceMs:1,wallMs:1}};
    }
    export async function classifyMany(texts,labels,signal) {const r=await dm1('classify',{texts,labels},signal);return {results:r.data.results,meta:r.meta};}
    export async function rateMany(texts,scale,signal) {const r=await dm1('rate',{texts,scale},signal);return {results:r.data.results,meta:r.meta};}
  `})); }}] });
  const { default: examples } = await import(join(dir,'check.mjs'));
  assert.equal(new Set(examples.map(entry=>entry.demo)).size,5);
} finally { await rm(dir,{recursive:true,force:true}); }
