// Run against pnpm dev/preview; mocked responses, no credentials or real inference.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base=process.env.QA_BASE || 'http://127.0.0.1:4324';
const output=process.env.QA_OUTPUT || '/tmp/ms-cost-estimate-qa';
const examples=JSON.parse(await readFile(new URL('../src/generated/examples.json',import.meta.url)));
await mkdir(output,{recursive:true});
const browser=await chromium.launch();
try {
 for(const [name,sources,tokens,expected] of [
  ['cached',['cache','cache'],[100,100],['200','$0.000008']],
  ['sponsored',['sponsored-live','sponsored-live'],[100,100],['200','$0.000008']],
  ['mixed',['cache','sponsored-live'],[100,100],['200','$0.000008']],
  ['partial',['cache','cache'],[100,null],['≥ 100','≥ $0.000004']],
  ['unknown',['cache','cache'],[null,null],['Unavailable','Unavailable']],
 ]) {
  const page=await browser.newPage();let n=0;const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
   const req=route.request(),path=new URL(req.url()).pathname;
   const kind=path==='/api/run'?req.postDataJSON().route:examples[path.split('/api/examples/')[1]].route;
   const index=n++;const token=tokens[index%2];
   await route.fulfill({status:200,contentType:'application/json',headers:{'x-demo-source':path==='/api/run'?'personal-live':sources[index%2],'x-inference-ms':'20','x-demo-generated-at':'2026-09-19T12:00:00.000Z',...(token===null?{}:{'x-input-tokens':String(token)})},body:JSON.stringify(kind==='classify'?{label:'return_or_exchange',probability:.99,scores:{return_or_exchange:.99}}:{results:[{answer:null}]})});
  });
  await page.goto(`${base}/returns-desk/`);await page.locator('#rd-request').waitFor();
  await page.getByRole('button',{name:'Check request',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.rd-status')?.textContent?.includes('Reading complete'));
  const values=await page.locator('.run-metrics-grid dd').allTextContents();assert.deepEqual(values.slice(2),expected,name);
  assert.equal(values[1], '20 ms', 'model compute stays visible');
  assert.match(await page.locator('.run-metrics-grid dt').last().innerText(),/Est. cost/);
  assert.match(await page.locator('.run-metrics').innerText(),/Examples are free/);
  if(name==='cached'){
   await page.evaluate(()=>localStorage.setItem('ms.apiKey','sk-ms-test-not-a-real-credential'));
   await page.locator('#rd-request').fill('A custom return request for order RD-1042.');
   await page.getByRole('button',{name:'Check request',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.run-metrics-details summary')?.textContent?.includes('4 successful requests'));
   assert.equal((await page.locator('.run-metrics-grid dd').allTextContents())[3],'$0.000016','cached + personal workload estimate');
   await page.locator('.run-metrics-details summary').click();
   assert.match(await page.locator('.run-metrics-secondary').innerText(),/Your key · estimated cost\n\$0\.000008/);
  }
  for(const width of [1440,390,320]){
   await page.setViewportSize({width,height:1000});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${name} page overflow ${width}`);
   const cells=await page.locator('.run-metrics-grid dd').evaluateAll(nodes=>nodes.map(n=>({width:n.clientWidth,scroll:n.scrollWidth})));
   assert(cells.every(c=>c.scroll<=c.width),`${name} values overflow ${width}`);
   if(width===390)await page.locator('.run-metrics').screenshot({path:`${output}/${name}-mobile.png`});
  }
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('Cost estimate checks passed: cached, sponsored, mixed, personal, partial/unknown usage and 1440/390/320px layouts.');
} finally {await browser.close();}
