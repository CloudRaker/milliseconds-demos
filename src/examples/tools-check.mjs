// Offline request-boundary regression. Run: node src/examples/tools-check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('astro/package.json'))('esbuild');
const result = await build({ stdin: { contents: `
export { default as examples } from './src/examples/tools.ts';
export { canonical } from './src/lib/example-contract.ts';
export * as commit from './src/demos/commit-sentry/data.ts';
export * as sheets from './src/demos/judge-sheets/sheets.ts';
export { planChunks } from './src/demos/judge-sheets/runner.ts';
export { bodyFor } from './src/demos/judge-sheets/predict.ts';
`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
const { examples, canonical, commit, sheets, planChunks, bodyFor } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const key = (demo, route, body) => canonical({ demo, route, body });
const registered = new Set(examples.map(e => key(e.demo, e.route, e.body)));
const covered = (demo, route, body) => assert(registered.has(key(demo, route, body)), `Unregistered ${demo} ${route}: ${JSON.stringify(body).slice(0, 90)}`);
const mock = (route, body, p = 0.2) => {
  const one = () => route === 'yes-no' ? body.statements ? { results: body.statements.map(statement => ({ statement, probability: p, answer: p > .5 })) } : { probability: p, answer: p > .5 }
    : route === 'classify' ? { label: Object.keys(body.labels)[0], confidence: p, probability: p, scores: {} }
    : { score: p, level: 0, confidence: p, probability: p, scores: [p] };
  return { data: body.texts ? { results: body.texts.map(one) } : one(), meta: { inferenceMs: 1, tokens: 1, wallMs: 1 } };
};
for (const probability of [0, 0.2, 0.8, 1]) {
  let calls = 0;
  for await (const _ of commit.runSentry(async (route, body) => { covered('commit-sentry', route, body); calls++; return mock(route, body, probability); }, commit.HUNKS, commit.COMMIT_MESSAGE)) {}
  assert.equal(calls, 6, 'Model outcomes do not change the six stock request bodies');
}
for (const sheet of ['Reviews', 'Leads']) {
  const wb = sheets.buildWorkbook(); sheets.applySeed(wb, sheet);
  for (const c of planChunks(wb.recalc().pending)) {
    const { route, body } = bodyFor(c.specs[0]);
    covered('judge-sheets', route, { texts: c.texts, ...body });
  }
}
for (const e of examples) {
  assert(e.body.text || e.body.texts, 'Every request has source input');
  if (e.body.texts) assert(e.body.texts.length > 0 && e.body.texts.length <= 32);
  if (e.body.statements) assert(e.body.statements.length > 0 && e.body.statements.length <= 32);
  const changed = e.body.text ? { ...e.body, text: e.body.text + '\nCustom input' } : { ...e.body, texts: [...e.body.texts, 'Custom input'] };
  assert(!registered.has(key(e.demo, e.route, changed)), 'Custom input cannot match stock');
}
const counts = Object.fromEntries([...new Set(examples.map(e => e.demo))].map(demo => [demo, new Set(examples.filter(e => e.demo === demo).map(e => key(e.demo, e.route, e.body))).size]));
assert.equal(Object.keys(counts).length, 5);
console.log('Stock request checks passed:', counts);
if (process.argv.includes('--catalog')) console.log(JSON.stringify(examples));

if (process.argv.includes('--browser')) {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ headless: true });
  const misses = [], errors = [], requests = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem('ms.apiKey', 'sk-ms-offline-test-only-not-a-real-key'));
  await context.route('**/api/run', async route => {
    const { route: capability, body } = route.request().postDataJSON();
    const demo = new URL(route.request().headers().referer).pathname.split('/')[1];
    requests.push(demo);
    if (!registered.has(key(demo, capability, body))) misses.push({ demo, capability, body });
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'x-input-tokens': '100', 'x-inference-ms': '10' }, body: JSON.stringify(mock(capability, body).data) });
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const open = async slug => { await page.goto(`${process.env.DEMO_BASE || 'http://127.0.0.1:4393'}/${slug}/`); await page.locator('astro-island[ssr]').count().then(async n => { if (n) await page.waitForFunction(() => !document.querySelector('astro-island[ssr]')); }); };
  const wait = async predicate => { for (let i = 0; i < 300; i++) { if (await predicate()) return; await page.waitForTimeout(100); } throw new Error('UI did not settle'); };
  try {
    await open('commit-sentry'); await page.getByRole('button', { name: 'Run check', exact: true }).click();
    await wait(() => page.getByRole('button', { name: 'Run check', exact: true }).count());
    assert.equal(requests.filter(d => d === 'commit-sentry').length, 6);
    console.log('Browser: commit default covered');
    await open('jev-lint');
    for (let i = 0; i < 6; i++) {
      await page.locator('.jl-tab').nth(i).click();
      await page.getByRole('button', { name: 'Scan file', exact: true }).click();
      await wait(() => page.getByRole('button', { name: 'Scan file', exact: true }).count());
    }
    await page.locator('.jl-tab').first().click();
    await page.getByRole('button', { name: 'Type it for me', exact: true }).click();
    await wait(() => page.getByRole('button', { name: 'Already typed', exact: true }).count());
    await page.waitForTimeout(2000);
    console.log('Browser: six lint languages plus typed stock snippet covered');
    await open('shell-guard');
    for (const button of await page.locator('.sg-chips .sg-chip').all()) {
      await button.click(); await wait(() => page.getByRole('textbox', { name: 'shell command' }).isEnabled());
      if ((await page.locator('.sg-prompt').last().innerText()).includes('[y/N]')) await page.getByRole('textbox', { name: 'shell command' }).press('n');
    }
    await page.getByRole('button', { name: /^Check commands/ }).click();
    await wait(() => page.getByRole('button', { name: /^Check commands/ }).isEnabled().catch(() => false));
    console.log('Browser: all shell chips and batch covered');
    await open('judge-sheets');
    await page.getByRole('button', { name: /^Run \d+ judgments$/ }).click(); await wait(() => page.getByRole('button', { name: 'Nothing queued', exact: true }).count());
    await page.getByRole('button', { name: 'Leads', exact: true }).click();
    await page.getByRole('button', { name: /^Run \d+ judgments$/ }).click(); await wait(() => page.getByRole('button', { name: 'Nothing queued', exact: true }).count());
    await page.getByRole('button', { name: 'Fill column', exact: true }).click(); await wait(() => page.getByRole('button', { name: 'Nothing queued', exact: true }).count());
    console.log('Browser: both spreadsheets and default Urgency column covered');
    await open('send-guard'); await page.getByRole('button', { name: 'Start replay', exact: true }).click();
    await page.getByRole('button', { name: 'Start replay', exact: true }).waitFor({ timeout: 95000 });
    assert.equal(requests.filter(d => d === 'send-guard').length, 21, 'Stock replay checks seven completed drafts, not timing-dependent prefixes');
    console.log('Browser: seven send-guard drafts covered');
    const beforeStop = requests.length;
    await page.getByRole('button', { name: 'Start replay', exact: true }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.getByText('Replay paused', { exact: true }).waitFor();
    await page.waitForTimeout(2000);
    assert.equal(requests.length, beforeStop, 'Stopping stock typing does not submit a partial custom draft');
    await page.setViewportSize({ width: 390, height: 844 });
    for (const slug of Object.keys(counts)) {
      await open(slug);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${slug}: no mobile page overflow`);
    }
    assert.deepEqual(misses, [], 'Every browser stock request exists in the server catalog');
    assert.deepEqual(errors, [], 'No browser runtime errors');
    console.log('Browser stock coverage passed:', requests.length, 'mocked requests');
  } finally { await browser.close(); }
}
