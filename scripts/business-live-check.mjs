// Uses a visitor key supplied in MS_API_KEY. Never records credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.QA_BASE || 'http://127.0.0.1:4324';
const proxy = process.env.QA_API || 'https://demo.milliseconds.ai/api/run';
const output = process.env.QA_OUTPUT || '/tmp/ms-business-live';
const key = process.env.MS_API_KEY;
assert.ok(key, 'MS_API_KEY is required');
await fs.mkdir(output, { recursive: true });
const cases = [
  ['invoice-desk', 'Process invoice', 3, '.id-status'],
  ['sales-intake', 'Run inbox live', 5, '.si-toolbar'],
  ['catalog-studio', 'Structure catalog', 2, '.catalog-status'],
  ['evidence-check', 'Check record live', 4, '.ec-status'],
  ['private-share', 'Detect details live', 1, '.ps-status'],
  ['returns-desk', 'Check request live', 2, '.rd-status'],
];
const browser = await chromium.launch();
const results = [];
try {
  for (const [slug, action, count, status] of cases) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(key => localStorage.setItem('ms.apiKey', key), key);
    const page = await context.newPage();
    const errors = [], calls = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/run', async route => {
      const response = await context.request.post(proxy, {
        headers: { 'content-type': 'application/json', 'x-ms-key': key },
        data: route.request().postData(),
      });
      calls.push({ route: route.request().postDataJSON().route, status: response.status(), tokens: response.headers()['x-input-tokens'], modelMs: response.headers()['x-inference-ms'], data: await response.json() });
      await route.fulfill({ response });
    });
    await page.goto(`${base}/${slug}/`);
    await page.locator('.demo-workspace astro-island > div').waitFor();
    await page.getByRole('button', { name: action, exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.run-metrics-state')?.textContent === 'Ready for another run', null, { timeout: 90000 });
    // A complete sequential workflow has returned to its idle action.
    await page.getByRole('button', { name: action, exact: true }).waitFor();
    await page.waitForFunction(expected => document.querySelector('.run-metrics-details summary')?.textContent?.includes(`${expected} successful requests`), count, { timeout: 90000 });
    assert.equal(calls.length, count, `${slug}: request count`);
    assert.ok(calls.every(call => call.status === 200 && /^\d+$/.test(call.tokens)), `${slug}: status and usage headers`);
    const tokens = calls.reduce((sum, call) => sum + Number(call.tokens), 0);
    const metrics = await page.locator('.run-metrics-grid dd').allTextContents();
    assert.equal(metrics[1], tokens.toLocaleString('en-US'));
    assert.equal(metrics[2], `$${(tokens * 0.04 / 1e6).toFixed(6)}`);
    assert.deepEqual(errors, []);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(async () => { window.scrollTo({ top: 0, behavior: "instant" }); await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${slug}: overflow`);
      await page.screenshot({ path: `${output}/${slug}-${width}.png`, fullPage: true });
    }
    results.push({ slug, status: await page.locator(status).innerText(), metrics, calls, workspace: await page.locator('.demo-workspace').innerText() });
    console.log(`${slug}: ${count} successful requests; ${tokens} tokens; ${metrics[2]}`);
    await fs.writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
    await context.close();
  }
} finally { await browser.close(); }
