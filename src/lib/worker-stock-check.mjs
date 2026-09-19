// node src/lib/worker-stock-check.mjs — no credentials, network or Cloudflare resources.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('astro/package.json'))('esbuild');
const bundle = await build({ stdin: { contents: `export {default as worker, sanitize} from './src/worker'; export * from './src/lib/example-store';`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const {worker, sanitize, ExampleStore, examples, validResult, validResponse, REVISION} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const id = `test-demo/stock-v1/${'a'.repeat(64)}`;
examples[id] = { demo: 'test-demo', scenario: 'stock', route: 'classify', body: { text: 'fixed example', labels: ['yes','no'] } };
const result = { label: 'yes', probability: .9, confidence: .8, scores: { yes: .9, no: .1 } };
function makeStorage() {
  const values = new Map(); let lock = Promise.resolve();
  const storage = { get: async key => structuredClone(values.get(key)), put: async (key,value) => { values.set(key,structuredClone(value)); }, delete: async key => values.delete(key), transaction(fn) { const next = lock.then(() => fn(storage)); lock = next.catch(() => {}); return next; } };
  return storage;
}
function setup({ budget='2000', secret='private-sponsor', failure, headers, body=result }={}) {
  let calls=0; const waits=[]; const storage=makeStorage();
  const api = { fetch: async (_url, init) => { calls++; assert.equal(init.headers.authorization, `Bearer ${secret}`); assert.deepEqual(JSON.parse(init.body),examples[id].body); await new Promise(resolve=>setTimeout(resolve,10)); return new Response(JSON.stringify(failure ? {error:{message:secret}} : body),{status:failure??200,headers:headers??{'x-input-tokens':'42','x-inference-ms':'75'}}); } };
  const store = new ExampleStore({storage, waitUntil:p=>waits.push(p)}, { PLAYGROUND_API_KEY:secret, EXAMPLE_DAILY_BUDGET:budget, API:api });
  const cache=new Map();globalThis.caches={default:{match:async key=>cache.get(key.url)?.clone(),put:async(key,value)=>{cache.set(key.url,value.clone());}}};
  const env={ ASSETS:{fetch:async()=>new Response('asset')}, PLAYGROUND_API_KEY:secret, API:api, EXAMPLES:{idFromName:name=>name,get:()=>({fetch:req=>store.fetch(req)})} };
  const ctx={waitUntil:p=>waits.push(p)};
  return {env,store,storage,waits,ctx,calls:()=>calls,run: async (request)=>worker.fetch(request,env,ctx)};
}
const req = (suffix=id,body='{}',extra={}) => new Request(`https://demo.milliseconds.ai/api/examples/${suffix}`,{method:'POST',body,...extra});
let s=setup();
for (const request of [req('missing'),req(id+'?force=true'),req(id,'{"text":"custom"}'),req(id,'{"x":1,"x":2}'),req(id,'null'),req(id,'[]'),req(id,''),req(id,'{}'+ ' '.repeat(300)),req(id,'{"schema":{}}'),new Request(`https://demo.milliseconds.ai/api/examples/${id}`)]) assert.ok((await s.run(request)).status>=400);
const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));controller.enqueue(new Uint8Array(300));controller.close();}});
assert.equal((await s.run(req(id,stream,{duplex:'half',headers:{'content-length':'1'}}))).status,413);
assert.equal(s.calls(),0,'all forged payloads fail before inference');
const cold=await Promise.all(Array.from({length:8},()=>s.run(req())));
assert.equal(s.calls(),1,'concurrent cold requests deduplicate globally');
for(const r of cold){assert.equal(r.status,200);assert.equal(r.headers.get('x-demo-source'),'sponsored-live');assert.equal(r.headers.get('x-input-tokens'),'42');assert.deepEqual(await r.json(),result);}
await Promise.all(s.waits);
const warm=await s.run(req()); assert.equal(warm.headers.get('x-demo-source'),'cache');assert.equal(warm.headers.get('x-inference-ms'),'75');assert.equal(s.calls(),1);
assert.equal((await s.store.fetch(new Request(`https://internal/${id}`,{method:'POST',body:'{}'}))).status,404);
assert.equal((await s.store.fetch(new Request(`https://internal/${id}?route=extract`))).status,404);
await s.storage.put(`${REVISION}:${id}`,{data:result,tokens:42,modelMs:75,generatedAt:new Date(Date.now()-90_000_000).toISOString()});
const stale=await s.store.fetch(new Request(`https://internal/${id}`)); assert.equal(stale.headers.get('x-demo-source'),'cache');await Promise.all(s.waits);assert.equal(s.calls(),2,'one background stale refresh');
s=setup({budget:'0'});assert.equal((await s.run(req())).status,429);assert.equal(s.calls(),0);
s=setup({secret:''});assert.equal((await s.run(req())).status,503);assert.equal(s.calls(),0);
await s.storage.put(`${REVISION}:${id}`,{data:result,tokens:42,modelMs:75,generatedAt:new Date().toISOString()});
assert.equal((await s.run(req())).status,200,'warm cache works without secret');
const moreIds=Array.from({length:5},(_,index)=>`test-demo/stock-v1/${String(index).repeat(64)}`);
for(const other of moreIds) examples[other]={...examples[id]};
s=setup({budget:'1'});assert.equal((await s.run(req())).status,200);assert.equal((await s.run(req(moreIds[0]))).status,429);assert.equal(s.calls(),1,'global budget spans fixture ids');
s=setup();const concurrent=await Promise.all(moreIds.map(other=>s.store.fetch(new Request(`https://internal/${other}`))));assert.equal(s.calls(),4,'at most four distinct live fills');assert.equal(concurrent.filter(response=>response.status===429).length,1);
s=setup();await s.storage.put('budget',{day:Math.floor(Date.now()/86400000),count:180,minute:Math.floor(Date.now()/60000),minuteCount:180});assert.equal((await s.run(req())).status,429);assert.equal(s.calls(),0,'durable minute budget enforced');
assert.equal(validResponse({route:'classify',body:{texts:['a','b']}},{results:[result]}),false,'partial batches never cache');
assert.equal(validResponse({route:'answer',body:{text:'sample',questions:['a','b']}},{results:[{answer:null}]}),false,'partial questions never cache');

for(const failure of [401,429,500]) {s=setup({failure});const res=await s.run(req());assert.equal(res.status,failure===429?429:503);assert.ok(!(await res.text()).includes('private-sponsor'));assert.equal((await s.run(req())).status,429);assert.equal(s.calls(),1,'failure cooldown prevents immediate retry');}
for(const config of [{body:{error:{message:'bad'}}},{body:{unexpected:true}},{headers:{'x-input-tokens':'NaN','x-inference-ms':'5'}},{headers:{'x-input-tokens':'42'}},{headers:{'x-input-tokens':'-1','x-inference-ms':'5'}}]) {s=setup(config);assert.equal((await s.run(req())).status,503);assert.equal(await s.storage.get(`${REVISION}:${id}`),undefined);}
s=setup({failure:401});
const personal=new Request('https://demo.milliseconds.ai/api/run',{method:'POST',headers:{'x-ms-key':`sk-ms-${'x'.repeat(25)}`},body:JSON.stringify({route:'classify',body:examples[id].body})});
s.env.API={fetch:async()=>{return new Response('{}',{status:401});}};
assert.equal((await s.run(personal)).status,401);assert.equal(s.calls(),0,'invalid personal credentials never fall back to sponsor');
assert.equal((await s.run(new Request('https://demo.milliseconds.ai/api/run',{method:'POST',body:'{}'}))).status,401);
examples[id].recorded={data:result,tokens:42,modelMs:75,generatedAt:'2020-01-01T00:00:00.000Z'};examples[id].pinned=true;
s=setup({secret:''});const pinned=await s.run(req());assert.equal(pinned.headers.get('x-demo-source'),'cache');assert.equal(pinned.status,200);assert.equal(s.calls(),0,'pinned traces never refresh, even when old');delete examples[id].recorded;delete examples[id].pinned;
assert.ok(validResult('classify',{...result,scores:{error:.9,warning:.1}}),'error is a valid classification label');
assert.equal(validResult('classify',{results:[{error:{message:'partial failure'}}]}),false);
assert.ok(validResponse({route:'answer',body:{text:'source',questions:['question']}},{results:[{answer:null}]}));assert.equal(validResult('verify',{matches:true,probability:Infinity,found:[]}),false);
const leaves = {
  'yes-no': {answer:true,probability:.9}, classify:result,
  'classify-tree':{path:['a'],label:'a',probability:.9,levels:[]},
  rate:{score:1,level:1,label:'high',confidence:.9,scores:[.1,.9]}, extract:{data:{field:'value'}},
  verify:{matches:true,probability:.9,found:['value']}, entities:{entities:[]}, answer:{answer:null},
};
for (const [route,leaf] of Object.entries(leaves)) {
  const scalar = {route,body:{text:'source'}};
  assert.ok(validResponse(scalar,leaf),`${route} scalar shape`);
  for(const wrong of [{results:[]},{results:[leaf]},{results:[[leaf]]},{...leaf,results:[]}]) assert.equal(validResponse(scalar,wrong),false,`${route} scalar rejects envelope`);
  const batched = {route,body:{texts:['first','second']}};
  assert.ok(validResponse(batched,{results:[leaf,leaf]}));
  for(const wrong of [leaf,{results:[]},{results:[leaf]},{results:[leaf,leaf,leaf]},{results:[{results:[leaf]},leaf]}]) assert.equal(validResponse(batched,wrong),false,`${route} batch depth and count`);
}
for(const [route,key] of [['yes-no','statements'],['answer','questions']]) {
  const leaf=leaves[route], inner={results:[leaf,leaf]};
  assert.ok(validResponse({route,body:{text:'source',[key]:['first','second']}},inner));
  const nested={route,body:{texts:['a','b'],[key]:['first','second']}};
  assert.ok(validResponse(nested,{results:[inner,inner]}));
  for(const wrong of [{results:[leaf,leaf]},{results:[inner]},{results:[inner,{results:[]}]},{results:[inner,{results:[leaf]}]},{results:[inner,{results:[leaf,{results:[leaf]}]}]}]) assert.equal(validResponse(nested,wrong),false,`${route} nested batch depth and count`);
}
for(const body of [null,[],{}, {text:'a',texts:['b']},{text:'x'.repeat(6001)},{text:''},{texts:['valid',false]},{texts:['x'.repeat(6001)]},{texts:[]},{texts:Array(33).fill('x')}]) assert.equal(sanitize('classify',body),null);
const personalBody={text:'full original text',labels:['a','b']};assert.deepEqual(sanitize('classify',personalBody),personalBody);assert.equal(sanitize('classify',personalBody).text,personalBody.text);
s=setup();
for(const body of [{text:'x'.repeat(6001)},{texts:['valid',false]}]) {
  const response=await s.run(new Request('https://demo.milliseconds.ai/api/run',{method:'POST',headers:{'x-ms-key':`sk-ms-${'x'.repeat(25)}`},body:JSON.stringify({route:'classify',body})}));
  assert.equal(response.status,400);assert.equal(s.calls(),0,'invalid personal text is rejected before inference');
}
console.log('Stock Worker checks passed: strict bodies/IDs, stream limits, singleflight, provenance, durable budget, stale refresh, cooldown, invalid results, private auth and pinned trace.');

// Workers' native fetch requires its global receiver in local/public fallback mode.
s=setup();delete s.env.API;const originalFetch=globalThis.fetch;
globalThis.fetch=async function(){assert.equal(this,globalThis);return new Response(JSON.stringify(result),{headers:{'x-input-tokens':'42','x-inference-ms':'75'}})};
assert.equal((await s.run(req())).status,200);
globalThis.fetch=originalFetch;

// Both current key modes and legacy keys reach the same authenticated custom-input proxy.
for (const prefix of ['test_sk', 'prod_sk', 'sk-ms']) {
  const key = `${prefix}-offline-not-a-real-credential-1234567890`;
  s = setup();
  let forwarded = false;
  s.env.API = { fetch: async (_url, init) => { forwarded = true; assert.equal(init.headers.authorization, `Bearer ${key}`); return Response.json(result); } };
  const response = await s.run(new Request('https://demo.milliseconds.ai/api/run', { method: 'POST', headers: { 'x-ms-key': key }, body: JSON.stringify({ route: 'classify', body: personalBody }) }));
  assert.equal(response.status, 200);
  assert(forwarded);
}
console.log('Custom proxy accepts test, production, and legacy key formats.');
