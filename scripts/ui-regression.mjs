import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.QA_BASE || 'http://127.0.0.1:4324';
const browser = await chromium.launch();
const page = await browser.newPage({viewport:{width:390,height:844}});
await page.addInitScript(() => localStorage.setItem('ms.apiKey','test-key-for-mocked-requests'));
let headerCalls = 0;
let releaseHeader;
await page.route('**/api/run', async route => {
  const { body } = route.request().postDataJSON();
  if (body.text) {
    const attempt = ++headerCalls;
    await new Promise(resolve => { releaseHeader = resolve; });
    await route.fulfill({ status: attempt === 1 ? 500 : 200, contentType: 'application/json', body: JSON.stringify(attempt === 1 ? {error:{code:'test_failure',message:'Header temporarily unavailable'}} : {label:'Urgency',probability:.95,confidence:.95,scores:{Urgency:.95}}) });
  } else {
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({results:body.texts.map(()=>({score:2,confidence:.95,probability:.95,label:'positive',scores:{positive:.95}}))})});
  }
});
await page.goto(`${base}/judge-sheets/`);
await page.locator('#js-header').fill('How urgently should we act?');
const rawHeaders = () => page.evaluate(() => Array.from({length:14},(_,i)=>window.judgeSheets.store.wb.getRaw('Reviews',0,i)));
const before = await rawHeaders();
let request = page.waitForRequest(r=>r.url().endsWith('/api/run'));
await page.locator('form.js-start').evaluate(form => {for(let i=0;i<10;i++)form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
await request;
assert.equal(headerCalls,1,'rapid submits must make one header request');
assert.equal(await page.getByRole('button',{name:'Reading column…'}).isDisabled(),true);
assert.deepEqual(await rawHeaders(),before,'pending classification must not reserve columns');
releaseHeader();
await page.locator('.js-error').filter({hasText:'Header temporarily unavailable'}).waitFor();
assert.deepEqual(await rawHeaders(),before,'failed classification must not reserve columns');
request = page.waitForRequest(r=>r.url().endsWith('/api/run'));
await page.getByRole('button',{name:'Fill column',exact:true}).click();
await request;
assert.equal(await page.locator('.js-error').count(),0,'retry clears previous header error');
releaseHeader();
await page.locator('.js-cardheader').filter({hasText:'How urgently should we act?'}).waitFor();
assert.equal(headerCalls,2,'one request for each deliberate attempt');
const after=await rawHeaders();
assert.equal(after.filter(h=>h==='How urgently should we act?').length,1,'success creates exactly one column');
assert.equal(await page.locator('.js-error').count(),0,'successful retry leaves no stale error');
await page.close();
console.log('PASS: delayed classification ignores rapid submits; failure reserves no column; retry creates one column and clears error.');

for (const width of [390, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await page.goto(`${base}/inbox-blitz/`);
  await page.locator('.ib-row.selected').waitFor();
  assert.equal(await page.evaluate(() => window.scrollY), 0, `initial page scroll at ${width}px`);
  for (let n = 0; n < 30; n++) await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => window.scrollY), 0, `keyboard navigation moves page at ${width}px`);
  assert.ok(await page.locator('.ib-list').evaluate(el => el.scrollTop > 0), 'inbox list must scroll');
  const within = await page.locator('.ib-list').evaluate(el => {
    const list = el.getBoundingClientRect();
    const row = el.querySelector('.ib-row.selected').getBoundingClientRect();
    return row.top >= list.top - 1 && row.bottom <= list.bottom + 1;
  });
  assert.ok(within, 'selected email must be visible inside its list');
  await page.close();
}
await browser.close();
console.log('PASS: fresh mobile/desktop pages stay at scrollY 0; keyboard selection scrolls only inbox list.');
