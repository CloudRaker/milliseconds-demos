// SDK_PACKAGE=/path/to/@cloudraker/milliseconds SDK_PYTHON=/path/to/python node scripts/sdk-samples-check.mjs
// Uses installed published SDKs with mocked transports. No real key or network calls.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const sdk=process.env.SDK_PACKAGE, py=process.env.SDK_PYTHON;
assert(sdk&&py,'Set SDK_PACKAGE and SDK_PYTHON to installed SDK paths.');
const {build}=createRequire(import.meta.resolve('wrangler'))('esbuild');
const temp=await mkdtemp(join(tmpdir(),'ms-sdk-samples-'));
await build({entryPoints:['src/lib/sdk-samples.ts'],bundle:true,platform:'node',format:'esm',outfile:join(temp,'samples.mjs'),logLevel:'silent'});
const {sdkCode}=await import(pathToFileURL(join(temp,'samples.mjs')));
const registry=JSON.parse(await readFile('src/generated/examples.json','utf8'));
const unique=new Map();for(const entry of Object.values(registry))if(!unique.has(entry.demo+'/'+entry.route))unique.set(entry.demo+'/'+entry.route,entry);
const cases=[...unique].map(([id,entry])=>({id,...entry,code:sdkCode(entry)}));
const casesPath=join(temp,'cases.json');await writeFile(casesPath,JSON.stringify(cases));
// Real SDK parsing needs the two array axes and the capability's result envelope.
function reply(route,body){
 const leaf={answer:route==='answer'?null:true,statement:'example',question:'example',probability:.9,confidence:.8,label:'example',scores:route==='rate'?[.1,.9]:{example:.9},score:1,level:1,start:null,end:null,matches:true,found:[],path:['example'],levels:[],data:{},entities:[]};
 const inner=body.statements??body.questions;
 const row=()=>Array.isArray(inner)?{results:inner.map(()=>leaf)}:leaf;
 return Array.isArray(body.texts)?{results:body.texts.map(row)}:row();
}
const headers={'content-type':'application/json','x-input-tokens':'100','x-inference-ms':'10'};
const {DecisionMachine}=await import(pathToFileURL(join(sdk,'dist/index.js')));
const original=globalThis.fetch;process.env.MS_API_KEY='sk-ms-sample-test-not-a-real-key';
for(const c of cases){
 let calls=0;
 globalThis.fetch=async(url,init)=>{calls++;assert.equal(new URL(url).pathname,'/v1/decision-machine-1/'+c.route);assert.deepEqual(JSON.parse(init.body),c.body,c.id);return new Response(JSON.stringify(reply(c.route,c.body)),{headers});};
 const code=c.code.typescript.replace(/^import[^\n]+\n/,'');
 await new Function('DecisionMachine','console',`return (async()=>{${code}})()`)(DecisionMachine,{log(){}});
 assert.equal(calls,1,c.id);
 await writeFile(join(temp,c.id.replace('/','-')+'.ts'),c.code.typescript);
}
globalThis.fetch=original;
await writeFile(join(temp,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',strict:true,noEmit:true,skipLibCheck:true,paths:{'@cloudraker/milliseconds':[join(sdk,'dist/index.d.ts')]}},include:['*.ts']}));
await writeFile(join(temp,'package.json'),'\n{"type":"module"}\n');
execFileSync(process.execPath,['node_modules/typescript/bin/tsc','-p',join(temp,'tsconfig.json')],{stdio:'pipe'});
const pyScript=`import os,json,httpx,contextlib,io\nfrom milliseconds import DecisionMachine\ncases=json.load(open(${JSON.stringify(casesPath)}))\nos.environ['MS_API_KEY']='sk-ms-sample-test-not-a-real-key'\nClient=httpx.Client\nfor c in cases:\n calls=[]\n def respond(request):\n  body=json.loads(request.content)\n  assert body==c['body'],c['id']\n  assert request.url.path=='/v1/decision-machine-1/'+c['route']\n  calls.append(body)\n  leaf=dict(answer=None if c['route']=='answer' else True,statement='example',question='example',probability=.9,confidence=.8,label='example',scores=[.1,.9] if c['route']=='rate' else {'example':.9},score=1,level=1,start=None,end=None,matches=True,found=[],path=['example'],levels=[],data={},entities=[])\n  inner=body.get('statements',body.get('questions'))\n  row={'results':[leaf for _ in inner]} if isinstance(inner,list) else leaf\n  data={'results':[row for _ in body['texts']]} if 'texts' in body else row\n  return httpx.Response(200,json=data,headers={'x-input-tokens':'100','x-inference-ms':'10'})\n httpx.Client=lambda:Client(transport=httpx.MockTransport(respond))\n scope={}\n with contextlib.redirect_stdout(io.StringIO()):exec(c['code']['python'],scope)\n scope['dm'].close()\n assert len(calls)==1,c['id']\nprint('Python: '+str(len(cases))+' snippets passed')\n`;
const pyFile=join(temp,'check.py');await writeFile(pyFile,pyScript);console.log(execFileSync(py,[pyFile],{encoding:'utf8'}).trim());
const mock=join(temp,'mock.mjs');await writeFile(mock,`import fs from 'node:fs';import assert from 'node:assert/strict';const c=JSON.parse(fs.readFileSync(process.env.SDK_CASE));const reply=${reply.toString()};globalThis.fetch=async(url,init)=>{assert.equal(new URL(url).pathname,'/v1/decision-machine-1/'+c.route);assert.deepEqual(JSON.parse(init.body),c.body);fs.appendFileSync(process.env.SDK_CALLS,'1');return new Response(JSON.stringify(reply(c.route,c.body)),{headers:${JSON.stringify(headers)}})};`);
const bin=join(temp,'bin');await mkdir(bin);
await writeFile(join(bin,'dm1'),`#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(sdk,'dist/cli.js'))} "$@"\n`,{mode:0o755});
for(const c of cases){
 const path=join(temp,'current.json'),calls=join(temp,'calls.txt');await writeFile(path,JSON.stringify(c));await writeFile(calls,'');
 execFileSync('/bin/bash',['-c',c.code.cli],{env:{...process.env,PATH:bin+':'+process.env.PATH,NODE_OPTIONS:`--import=${mock}`,SDK_CASE:path,SDK_CALLS:calls},stdio:'pipe'});
 assert.equal(await readFile(calls,'utf8'),'1',c.id);
}
console.log(`PASS: ${cases.length} request examples across ${new Set(cases.map(c=>c.demo)).size} demos × TypeScript, Python and dm1; exact SDK payloads, TypeScript compile, no network.`);
