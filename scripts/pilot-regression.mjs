// Deterministic browser checks; API responses are mocked, no key or network calls required.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/pilot-regression.mjs
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch();
const base = process.env.QA_BASE || 'http://127.0.0.1:4324';
try {
  for (const scenario of ['completed', 'completed-fallback', 'safari', 'premature-done', 'custom-done', 'blocked', 'cancelled']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(() => localStorage.setItem('ms.apiKey', 'test-key-for-mocked-requests'));
    let calls = 0;
    let actions = 0;
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    await page.route('**/api/run', async route => {
      calls++;
      if (scenario === 'cancelled') {
        await pending;
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({error:{code:'test_error',message:'Delayed failure'}}) });
        return;
      }
      if (scenario === 'completed-fallback' && calls > 2) {
        await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{code:'test_error',message:'Model unavailable'}})});
        return;
      }
      const { body } = route.request().postDataJSON();
      let result;
      if (body.statements) {
        result = { results: [scenario.endsWith('done') ? .99 : .1, .1, scenario === 'blocked' ? .99 : .01].map(probability => ({ probability })) };
      } else {
        actions++;
        const label = scenario === 'safari'
          ? actions === 1 ? Object.keys(body.labels).find(label => label.includes("button 'New Tab'")) : ['type_text', 'press_key', 'Return'][actions - 2]
          : scenario.endsWith('done') ? 'done'
          : Object.keys(body.labels).find(label => label.includes(actions === 1 ? "row 'Appearance'" : "radio button 'Dark'"));
        assert.ok(label, 'mock action must exist in the current tree');
        assert.ok(label in body.labels, 'each decision must see the updated controls');
        if (scenario === 'safari' && actions === 2) {
          assert.match(body.text, /Focused: e4 text field/, 'new tab must be committed before reading its tree');
          assert.ok(Object.keys(body.labels).some(label => label.startsWith("e3 button 'New Tab'")));
        }
        result = { label, probability: .99, scores: { [label]: .99 } };
      }
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
    });
    await page.goto(`${base}/ax-pilot/`);
    await page.locator('#ax-goal').selectOption(scenario === 'safari' ? '2' : '4');
    if (scenario === 'custom-done') await page.getByRole('textbox', {name:'Custom pilot goal'}).fill('In System Settings keep Light Mode');
    await page.getByRole('button', {name:'Run the pilot', exact:true}).click();
    if (scenario === 'cancelled') {
      while (!calls) await page.waitForTimeout(10);
      await page.getByRole('button', {name:'Stop', exact:true}).click();
      release();
    }
    await page.getByRole('button', {name:'Run the pilot', exact:true}).waitFor();
    const status = await page.locator('.hud .status').innerText();
    if (scenario.startsWith('completed') || scenario === 'safari') {
      assert.match(status, /Goal completed/i);
      assert.match(await page.locator('.win').innerText(), scenario === 'safari' ? /milliseconds.ai — decisions/ : /Appearance: Dark/);
      assert.equal(await page.locator('.log li').count(), scenario === 'safari' ? 3 : 2);
      await page.waitForTimeout(800);
      assert.equal(calls, scenario === 'safari' ? 7 : 4, 'success must stop before asking for another action');
      assert.equal(await page.locator('.hud details[open]').count(), 0, 'old estimates are secondary');
      if (scenario === 'completed-fallback') {
        assert.equal(await page.locator('.controls .error').count(), 0, 'a recovered request error must not look like a failed goal');
        assert.match(await page.locator('.controls').innerText(), /Completed using a fallback after a model request failed/);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.getByRole('textbox', {name:'Custom pilot goal'}).fill('In System Settings use Auto');
      assert.match(await page.locator('.hud .status').innerText(), /Idle/);
      assert.equal(await page.locator('.log li').count(), 0, 'a changed goal clears the old result');
    } else if (scenario.endsWith('done')) {
      assert.match(status, /Completion not verified/i);
      assert.match(status, scenario === 'custom-done' ? /no independent app-state check/ : /check did not pass/);
      assert.doesNotMatch(status, /Goal completed/i);
    } else if (scenario === 'blocked') {
      assert.match(status, /Blocked/);
      assert.doesNotMatch(status, /Goal completed/i);
    } else {
      await page.waitForTimeout(800);
      assert.equal(await page.locator('.hud .status').innerText(), 'Stopped.');
      assert.equal(await page.locator('.controls .error').count(), 0, 'late errors must not overwrite a cancelled run');
    }
    await page.close();
    console.log(`PASS: App Pilot ${scenario}`);
  }
} finally {
  await browser.close();
}
