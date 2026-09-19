// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs QA_BASE=http://127.0.0.1:4399 node scripts/sdk-browser-check.mjs
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base=process.env.QA_BASE || 'http://127.0.0.1:4324',output=process.env.QA_OUTPUT || '/tmp/ms-sdk-browser-qa';
const registry=JSON.parse(await readFile('src/generated/examples.json','utf8'));
const demos=[...new Set(Object.values(registry).map(e=>e.demo))];
const browser=await chromium.launch();await mkdir(output,{recursive:true});
let copies=0;
try{
 for(const slug of demos){
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];let calls=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',route=>{calls++;return route.abort()});
  await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__copied=text}}}));
  await page.goto(`${base}/${slug}/`);await page.locator('.run-metrics').waitFor();
  const root=page.locator('#sdk-examples');await root.locator(':scope > summary').click();
  const routes=await root.locator('[data-sdk-route] option').evaluateAll(nodes=>nodes.map(n=>n.value));
  for(const route of routes){
   await root.locator('[data-sdk-route]').selectOption(route);
   for(const language of ['typescript','python','cli']){
    await root.locator(`[data-sdk-language="${language}"]`).click();
    const sample=root.locator(`[data-sdk-panel="${language}"] [data-sdk-sample="${route}"]`);
    assert(await sample.isVisible());assert.equal(await root.locator('[role="tabpanel"]:visible').count(),1);
    const code=await sample.locator('pre').textContent();assert(code.includes(language==='cli'?'dm1 ':language==='python'?'dm.':'await dm.'));
    const colors=await sample.locator('pre span[style]').evaluateAll(nodes=>[...new Set(nodes.map(n=>n.style.color))].filter(Boolean));assert(colors.length>=3,`${slug}/${route}/${language}: syntax colors`);
    await sample.locator('[data-sdk-copy]').click();assert.equal(await page.evaluate(()=>window.__copied),code);copies++;
   }
  }
  // Keyboard access follows the tabs pattern; language changes preserve the chosen API.
  await root.locator('[data-sdk-language="cli"]').focus();await page.keyboard.press('Home');
  assert.equal(await root.locator('[data-sdk-language="typescript"]').getAttribute('aria-selected'),'true');
  for(const width of [390,320]){
   await page.setViewportSize({width,height:900});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${slug} page overflow at ${width}`);
   assert(await root.locator('[data-sdk-copy]:visible').isVisible());
   if(width===390 && ['invoice-desk','sales-intake','ax-pilot','nl-palette'].includes(slug))await root.screenshot({path:`${output}/${slug}-mobile.png`});
  }
  if(slug==='invoice-desk'){
   await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw new Error('denied')}});
   await root.locator('[data-sdk-copy]:visible').click();assert.match(await root.locator('[role="status"]').innerText(),/Copy unavailable/);
   await page.setViewportSize({width:1440,height:1000});await root.screenshot({path:`${output}/invoice-desktop.png`});
   await root.locator(':scope > summary').click();await page.locator('.id-build summary').click();await page.locator('.id-build a[href="#sdk-examples"]').click();assert.equal(await root.getAttribute('open'),'');
  }
  assert.equal(calls,0,`${slug}: viewing code must not run inference`);assert.deepEqual(errors,[],slug);await page.close();
 }
 console.log(`PASS: ${demos.length} demos, ${copies} highlighted snippets; tabs, route selection, exact copy, denied clipboard, 390/320px, no inference.`);
}finally{await browser.close();}
