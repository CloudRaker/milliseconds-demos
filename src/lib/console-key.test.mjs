// Offline: node --experimental-transform-types src/lib/console-key.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchConsoleTestKey, getKey, setKey, setConsoleKey, KEY_SHAPE, KEY_EVENT } from './dm1.ts';

const testKey = 'test_sk-offline-not-a-real-credential-1234567890';
const prodKey = 'prod_sk-offline-not-a-real-credential-1234567890';
const saved = new Map([['ms.apiKey', prodKey]]);
let writes = 0;
globalThis.localStorage = {
  getItem: name => saved.get(name) ?? null,
  setItem: (name, value) => { writes++; saved.set(name, value); },
  removeItem: name => saved.delete(name),
};
globalThis.window = new EventTarget();
const events = [];
window.addEventListener(KEY_EVENT, event => events.push(event.detail));
assert.equal(getKey(), prodKey, 'Manual workflow still loads saved keys');
assert(KEY_SHAPE.test(testKey));
assert(KEY_SHAPE.test(prodKey));
assert(KEY_SHAPE.test('sk-ms-offline-not-a-real-credential-1234567890'));
let requests = 0;
globalThis.fetch = async (url, init) => {
  requests++;
  assert.equal(url, 'https://console.milliseconds.ai/api/demo-test-key');
  assert.equal(init.method, 'POST');
  assert.equal(init.credentials, 'include');
  assert.deepEqual(init.headers, { 'X-Milliseconds-Demo': '1' });
  assert.equal(init.redirect, 'error');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.body, undefined);
  return Response.json({ key: testKey, display: 'masked', name: 'Demo', organizationId: 'org_test', organizationName: 'Test workspace' });
};
assert.equal(requests, 0, 'Importing the client must not fetch a key');
const sourced = await fetchConsoleTestKey();
assert.equal(sourced.organizationName, 'Test workspace');
setConsoleKey(sourced.key);
assert.equal(getKey(), testKey);
assert.equal(saved.has('ms.apiKey'), false, 'Sourcing removes the prior manual key');
assert.equal(writes, 0, 'The sourced credential is never persisted');
assert(events.every(event => Object.keys(event).join() === 'hasKey'), 'No key or organization reaches key events');
setKey('');
assert.equal(getKey(), '', 'Clearing must not restore the earlier production key');
assert.equal(writes, 0);
for (const status of [401, 409, 503]) {
  globalThis.fetch = async () => Response.json({ error: { code: 'secret-error', message: prodKey } }, { status });
  await assert.rejects(fetchConsoleTestKey(), error => error.status === status && !error.message.includes(prodKey));
  assert.equal(getKey(), '');
}
for (const body of [{ key: prodKey, organizationId: 'org_test' }, { key: testKey }, null]) {
  globalThis.fetch = async () => Response.json(body);
  await assert.rejects(fetchConsoleTestKey(), { code: 'invalid_test_key' });
  assert.equal(getKey(), '');
}
assert.throws(() => setConsoleKey(prodKey), { code: 'invalid_test_key' });
// Storage failures cannot resurrect an old paid key after a clear.
localStorage.removeItem = () => { throw new Error('storage blocked'); };
saved.set('ms.apiKey', prodKey);
setConsoleKey(testKey);
setKey('');
assert.equal(getKey(), '');
const panel = readFileSync(new URL('../components/KeyPanel.astro', import.meta.url), 'utf8');
assert(panel.includes('source.addEventListener("click", async () =>'));
assert(panel.includes('controller.signal.aborted'));
assert(panel.includes('cancelSource();'));
assert(!panel.includes('localStorage') && !panel.includes('sessionStorage'));
console.log('console key: explicit request, test-only response, sign-in/workspace errors, memory-only storage, and clearing passed');

// Automatic connection is shared, quietly ignores signed-out sessions, and cannot undo user choices.
let moduleId = 0;
const freshClient = () => import(`./dm1.ts?automatic=${++moduleId}`);
const response = () => Response.json({ key: testKey, organizationId: 'org_test' });
localStorage.removeItem = name => saved.delete(name);
saved.clear();
{
  const client = await freshClient();
  let finishLookup;
  let lookups = 0;
  let inferenceCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (url === 'https://console.milliseconds.ai/api/demo-test-key') {
      lookups++;
      return new Promise(resolve => { finishLookup = resolve; });
    }
    inferenceCalls++;
    assert.equal(init.headers['x-ms-key'], testKey);
    return Response.json({ answer: true });
  };
  const initial = client.initializeConsoleKey();
  assert.equal(client.initializeConsoleKey(), initial, 'One lookup shared by page and custom requests');
  const inference = client.dm1('yes-no', { text: 'custom', statement: 'Ready?' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(inferenceCalls, 0, 'Custom inference waits for the automatic key');
  finishLookup(response());
  await initial;
  await inference;
  assert.equal(lookups, 1);
  assert.equal(inferenceCalls, 1);
  assert.equal(client.getKey(), testKey);
  assert.equal(saved.size, 0, 'Automatic keys never reach persistent storage');
}
for (const chosenKey of ['', prodKey]) {
  const client = await freshClient();
  let finishLookup;
  globalThis.fetch = async () => new Promise(resolve => { finishLookup = resolve; });
  const initial = client.initializeConsoleKey();
  client.setKey(chosenKey);
  finishLookup(response()); // Even a transport that ignores abort cannot resurrect the automatic key.
  assert.equal(await initial, null);
  assert.equal(client.getKey(), chosenKey);
}
{
  const client = await freshClient();
  globalThis.fetch = async () => new Response(null, { status: 401 });
  assert.equal(await client.initializeConsoleKey(), null, 'Signed-out automatic lookup is silent');
}
{
  const client = await freshClient();
  globalThis.fetch = async () => new Response(null, { status: 503 });
  await assert.rejects(client.initializeConsoleKey(), { code: 'console_unavailable' });
}
console.log('automatic console key: readiness, deduplication, silent sign-out, failure retry state, manual override, and clear races passed');

for (const replacement of [prodKey, testKey]) {
  const client = await freshClient();
  globalThis.fetch = async () => response();
  await client.initializeConsoleKey();
  let rejectOldRequest;
  globalThis.fetch = async () => new Promise(resolve => { rejectOldRequest = resolve; });
  const oldRequest = client.dm1('yes-no', { text: 'custom', statement: 'Ready?' });
  await new Promise(resolve => setTimeout(resolve, 0));
  client.setKey(replacement);
  rejectOldRequest(Response.json({ error: { code: 'key_rejected', message: 'Rejected' } }, { status: 401 }));
  await assert.rejects(oldRequest, { code: 'key_rejected' });
  assert.equal(client.getKey(), replacement, 'An old 401 cannot clear a newer choice, even the same key');
}
console.log('console key: stale inference rejection preserves newer key choices');

// Execute the actual navigation script with a minimal DOM, including return-from-login transitions.
const { runInNewContext } = await import('node:vm');
const { stripTypeScriptTypes } = await import('node:module');
const site = readFileSync(new URL('../layouts/Site.astro', import.meta.url), 'utf8');
const navScript = site.slice(site.indexOf('      let sessionRequest = 0;'), site.indexOf('      const mobileMenu'));
const loginLinks = [{ style: {} }, { style: {} }];
const entryLinks = [{}, {}];
const listeners = new Map();
let authenticated = false;
runInNewContext(stripTypeScriptTypes(navScript), {
  AbortSignal,
  fetch: async (_url, init) => {
    assert.equal(init.credentials, 'include');
    assert.equal(init.cache, 'no-store');
    return Response.json({ authenticated });
  },
  document: { querySelectorAll: selector => selector === '[data-auth-out]' ? loginLinks : entryLinks },
  window: { addEventListener: (name, listener) => listeners.set(name, listener) },
});
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
await settle();
assert(entryLinks.every(link => link.textContent === 'Sign up'));
authenticated = true;
listeners.get('focus')();
await settle();
assert(loginLinks.every(link => link.style.display === 'none'));
assert(entryLinks.every(link => link.textContent === 'Console' && link.href === 'https://console.milliseconds.ai/'));
authenticated = false;
listeners.get('pageshow')();
await settle();
assert(loginLinks.every(link => link.style.display === ''));
assert(entryLinks.every(link => link.textContent === 'Sign up' && link.href.endsWith('/signup')));
console.log('navigation: initial guest, return after sign-in, and return after sign-out passed');
