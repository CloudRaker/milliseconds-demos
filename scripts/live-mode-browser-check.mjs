// Build first. API responses are mocked; tests routing and displayed measurements, not model speed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.QA_BASE || 'http://127.0.0.1:4325';
const registry = JSON.parse(await readFile(new URL('../src/generated/examples.json', import.meta.url)));
const key = 'test_sk-browser-check-not-a-real-key-1234567890';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], personal = [], stock = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(key => localStorage.setItem('ms.apiKey', key), key);
await page.route('https://console.milliseconds.ai/**', route => route.fulfill({ status: 401, body: '{}' }));
function result(body) {
  const labels = Object.keys(body.labels);
  return { label: labels[0], probability: .9, scores: Object.fromEntries(labels.map((label, i) => [label, i ? .1 / (labels.length - 1) : .9])) };
}
await page.route('**/api/examples/**', async route => {
  const id = new URL(route.request().url()).pathname.slice('/api/examples/'.length);
  assert.ok(registry[id]); stock.push(id);
  assert.equal(route.request().headers()['x-ms-key'], undefined);
  await route.fulfill({ contentType: 'application/json', headers: { 'x-demo-source': 'cache', 'x-input-tokens': '1000', 'x-inference-ms': '500' }, body: JSON.stringify(result(registry[id].body)) });
});
let release;
await page.route('**/api/run', async route => {
  const request = route.request().postDataJSON(); personal.push(request);
  assert.equal(route.request().headers()['x-ms-key'], key);
  await new Promise(resolve => { release = resolve; });
  await route.fulfill({ contentType: 'application/json', headers: { 'x-demo-source': 'personal-live', 'x-input-tokens': '1100', 'x-inference-ms': '17' }, body: JSON.stringify(result(request.body)) });
});
try {
  await page.goto(`${base}/waste-sorter/`);
  const toggle = page.getByRole('checkbox', { name: 'Use my key for every request', exact: true });
  await toggle.waitFor(); assert.equal(await toggle.isChecked(), false);
  await page.getByRole('button', { name: 'Classify this image', exact: true }).click();
  await page.locator('.ic-scores').waitFor();
  assert.equal(stock.length, 1); assert.equal(personal.length, 0);
  await toggle.check();
  assert.equal(await page.locator('.run-metrics-grid dd').nth(0).innerText(), '—', 'cached latency excluded');
  assert.equal(await page.locator('.run-metrics-grid dd').nth(2).innerText(), '0', 'cached usage excluded');
  assert.match(await page.locator('.ic-key-note').innerText(), /uses your quota/);
  const started = page.waitForRequest('**/api/run');
  await page.getByRole('button', { name: 'Classify this image', exact: true }).click(); await started;
  assert.equal(await toggle.isDisabled(), true);
  assert.deepEqual(personal[0], { route: registry[stock[0]].route, body: registry[stock[0]].body });
  release();
  await page.waitForFunction(() => document.querySelector('.run-metrics-grid > div:nth-child(2) dd')?.textContent === '17 ms');
  assert.equal(await page.locator('.run-metrics-grid dd').nth(2).innerText(), '1,100');
  assert.equal(await page.locator('.run-metrics-grid dd').nth(3).innerText(), '$0.000044');
  assert.equal(stock.length, 1); assert.equal(personal.length, 1);
  await page.locator('.run-metrics').screenshot({ path: '/tmp/ms-live-mode-desktop.png' });
  await page.goto(`${base}/roast-check/`);
  await page.locator('.run-live-mode input:checked').waitFor();
  assert.equal(await toggle.isChecked(), true, 'preference survives navigation');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('.run-metrics').screenshot({ path: '/tmp/ms-live-mode-mobile.png' });
  await page.locator('.key-panel > summary').click();
  await page.getByRole('button', { name: 'Clear key', exact: true }).click();
  await page.locator('.key-panel > summary').click();
  await page.getByRole('button', { name: 'Classify this image', exact: true }).click();
  await page.locator('.ic-status.is-error').waitFor();
  assert.match(await page.locator('.ic-status').innerText(), /Live mode needs your API key/);
  assert.equal(personal.length, 1); assert.equal(stock.length, 1);
  assert.equal(await page.locator('.key-panel').getAttribute('open'), '');
  await page.locator('.key-panel > summary').click();
  await toggle.uncheck();
  await page.getByRole('button', { name: 'Classify this image', exact: true }).click();
  await page.locator('.ic-scores').waitFor();
  assert.equal(stock.length, 2, 'turning live mode off restores free stock access');
  assert.deepEqual(errors, []);
  console.log('PASS live-mode opt-in, exact stock payload + own key, cache-free metrics, busy state, tab persistence, missing-key isolation, free-mode restore, mobile/desktop.');
} finally { await browser.close(); }
