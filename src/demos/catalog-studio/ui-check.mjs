// Deterministic browser regression; mocks API responses, never uses a real key.
import { chromium } from '/Users/blaget/.agents/skills/gstack/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const report=JSON.parse(fs.readFileSync(new URL('./probe-results.json', import.meta.url),'utf8'));
const rows=report.results.slice(0,4).map(r=>r.actual);
const browser=await chromium.launch({headless:true});
fs.mkdirSync('/tmp/ms-build-catalog-studio-qa',{recursive:true});
for(const width of [1440,390]){
const page=await browser.newPage({viewport:{width,height:1000}});
let requests=0;let mode='good';
await page.route('**/api/run',async route=>{requests++;if(mode==='delay')await new Promise(r=>setTimeout(r,1200));if(mode==='fail'){await route.fulfill({status:500,json:{error:{message:'Temporary test failure'}}});return;}
const req=route.request().postDataJSON();
const results=req.route==='classify'?rows.map(r=>({label:r.category,probability:r.probability})):rows.map(r=>({data:Object.fromEntries(Object.entries(r.attributes).map(([k,v])=>[k,v.value]))}));
await route.fulfill({status:200,headers:{'x-input-tokens':'220','x-inference-ms':'40'},json:{results}});});
await page.goto(`${process.env.QA_BASE ?? 'http://127.0.0.1:4333'}/catalog-studio/`);await page.locator('.catalog-row').first().waitFor();
assert.equal(requests,0);assert.equal(await page.locator('.catalog-row').count(),4);
await page.screenshot({path:`/tmp/ms-build-catalog-studio-qa/${width}-preview.png`,fullPage:true});
await page.getByRole('button',{name:'Needs attention (1)'}).click();assert.equal(await page.locator('.catalog-row').count(),1);
await page.locator('.catalog-row').click();await page.getByRole('button',{name:'blue',exact:true}).click();assert.equal(await page.locator('.catalog-evidence mark').textContent(),'blue');
await page.getByRole('button',{name:'All listings',exact:true}).click();await page.locator('.catalog-row').first().click();
const download=page.waitForEvent('download');await page.getByRole('button',{name:'Draft CSV'}).click();assert.equal((await download).suggestedFilename(),'catalog-draft.csv');
await page.getByRole('button',{name:'Structure catalog'}).click();assert.equal(requests,0);assert(await page.locator('.key-panel').getAttribute('open')!==null);
await page.evaluate(()=>localStorage.setItem('ms.apiKey','sk-ms-qa0000000000000000000000'));
await page.locator('.key-panel > summary').click();
await page.getByRole('button',{name:'Structure catalog'}).click();await page.getByRole('status').filter({hasText:'Live draft'}).waitFor();assert.equal(requests,2);
await page.getByLabel('Original description').fill('Edited cotton shirt');assert.equal(await page.locator('.catalog-attributes').count(),0);assert(await page.getByRole('button',{name:'Draft CSV'}).isDisabled());
await page.getByRole('button',{name:'Reset sample'}).click();
mode='fail';await page.getByRole('button',{name:'Structure catalog'}).click();await page.getByRole('alert').filter({hasText:'Temporary test failure'}).waitFor();assert.equal(await page.locator('.catalog-attributes').count(),0);
mode='good';await page.getByRole('button',{name:'Structure catalog'}).click();await page.getByRole('status').filter({hasText:'Live draft'}).waitFor();assert.equal(await page.getByRole('alert').count(),0);
mode='delay';await page.getByRole('button',{name:'Structure catalog'}).click();await page.getByRole('button',{name:'Stop',exact:true}).click();await page.waitForTimeout(1500);assert.match(await page.locator('.catalog-status').innerText(),/Stopped/);assert.equal(await page.locator('.catalog-attributes').count(),0);
await page.getByRole('button',{name:'Reset sample'}).click();await page.locator('.catalog-row').nth(1).click();await page.getByRole('button',{name:'45 x 40 x 55 cm'}).click();
await page.screenshot({path:`/tmp/ms-build-catalog-studio-qa/${width}-evidence.png`,fullPage:true});
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
console.log(width,'passed preview, filters, evidence, CSV, key prompt, live mock, edit invalidation, failure/retry, cancel and overflow');
await page.close();}
await browser.close();
