// Run with a local site and PLAYWRIGHT_MODULE pointing at an existing Playwright installation.
// Covers discovery, attribution, sample telemetry and responsive rendering without API credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.QA_BASE || 'http://127.0.0.1:4324';
const output = process.env.QA_OUTPUT || '/tmp/ms-business-qa';
await fs.mkdir(output, { recursive: true });
const slugs = ['invoice-desk', 'sales-intake', 'catalog-studio', 'evidence-check', 'private-share', 'returns-desk'];
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  const cards = page.locator('.demo-card');
  assert.equal(await cards.count(), 26);
  assert.deepEqual(await cards.evaluateAll(nodes => nodes.slice(0, 6).map(node => node.getAttribute('href'))), slugs.map(slug => `/${slug}/`));
  for (const button of await page.locator('[data-demo-filter]').all()) {
    const category = await button.getAttribute('data-demo-filter');
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    const visible = await cards.evaluateAll(nodes => nodes.filter(node => !node.hidden).map(node => node.dataset.category));
    assert.ok(visible.length > 0);
    if (category !== 'all') assert.ok(visible.every(value => value === category));
    else assert.equal(visible.length, 26);
    assert.match(await page.locator('.demo-filter-count').innerText(), new RegExp(`Showing ${visible.length} demos`));
  }
  await page.locator('[data-demo-filter="all"]').click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `directory overflow at ${width}`);
    await page.screenshot({ path: `${output}/directory-${width}.png`, fullPage: true });
  }
  await page.close();
  for (const slug of slugs) {
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(`${slug}: ${error.message}`));
    let apiCalls = 0;
    await page.route('**/api/run', async route => { apiCalls++; await route.abort(); });
    await page.goto(`${base}/${slug}/`);
    await page.locator('.demo-workspace astro-island > div').waitFor();
    await page.locator('.run-metrics').waitFor();
    assert.equal(await page.locator('.demo-origin').count(), 0, 'original demos must not invent attribution');
    assert.equal(await page.locator('.demo-title svg.demo-icon').count(), 1);
    assert.match(await page.locator('.demo-workspace').innerText(), /sample/i, `${slug}: preview must be labelled`);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${slug} overflow at ${width}`);
      await page.screenshot({ path: `${output}/${slug}-${width}.png`, fullPage: true });
    }
    assert.equal(apiCalls, 0, `${slug}: inspecting a sample must not call the API`);
    const values = await page.locator('.run-metrics-grid dd').allTextContents();
    assert.equal(values[1], '0', 'samples do not incur input tokens');
    assert.equal(values[2], '$0.00', 'samples do not incur API cost');
    if (slug === 'private-share') {
      await page.evaluate(() => localStorage.setItem('ms.apiKey', 'sk-ms-browser-test-not-a-real-key'));
      await page.getByRole('button', { name: 'Detect details live', exact: true }).click();
      const unknown = page.locator('.run-metrics-grid dd.is-unavailable');
      await unknown.first().waitFor();
      const sizes = await unknown.evaluateAll(nodes => nodes.map(node => ({ width: node.clientWidth, scroll: node.scrollWidth, height: node.clientHeight, line: parseFloat(getComputedStyle(node).lineHeight) })));
      assert.ok(sizes.every(size => size.scroll <= size.width && size.height <= size.line + 1), 'unknown usage must fit without mid-word wrapping at 320px');
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: all six workflows, 26-demo discovery, category filters, original attribution, sample telemetry, icons and responsive widths.');
} finally {
  await browser.close();
}
