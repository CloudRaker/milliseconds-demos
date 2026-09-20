// Check generated HTML, not templates. Run after astro build.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const origin = 'https://demo.milliseconds.ai';
const xml = await read('dist/sitemap.xml');
assert.match(xml, /<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
const pages = (await readdir(new URL('src/pages/', root))).filter(name => name.endsWith('.astro') && name !== '404.astro');
const expected = pages.map(name => `${origin}/${name === 'index.astro' ? '' : `${name.replace('.astro', '')}/`}`);
assert.deepEqual([...urls].sort(), expected.sort(), 'Sitemap must cover every public page exactly once');
const robots = await read('dist/robots.txt');
assert.match(robots, /^User-agent: \*$/m);
assert.match(robots, /^Allow: \/$/m);
assert.match(robots, /^Disallow: \/api\/$/m);
assert.ok(robots.includes(`Sitemap: ${origin}/sitemap.xml`));
const titles = new Set();
const descriptions = new Set();
const home = await read('dist/index.html');
for (const url of urls) {
  const pathname = new URL(url).pathname;
  const html = await read(`dist${pathname}index.html`);
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  const description = html.match(/<meta name="description" content="([^"]+)"/)?.[1];
  assert.ok(title && description, `Missing metadata: ${url}`);
  assert.ok(!titles.has(title) && !descriptions.has(description), `Duplicate metadata: ${url}`);
  titles.add(title); descriptions.add(description);
  assert.ok(html.includes(`<link rel="canonical" href="${url}"`), `Wrong canonical: ${url}`);
  assert.ok(!/<meta name="robots"[^>]*noindex/.test(html), `Public page excluded: ${url}`);
  assert.equal([...html.matchAll(/<h1(?:\s[^>]*)?>/g)].length, 1, `Expected one static heading: ${url}`);
  for (const tag of ['og:title', 'og:description', 'og:url', 'og:image', 'og:image:alt']) {
    assert.ok(html.includes(`property="${tag}"`), `Missing ${tag}: ${url}`);
  }
  const socialPath = new URL(html.match(/<meta property="og:image" content="([^"]+)"/)?.[1]).pathname;
  const social = await readFile(new URL(`dist${socialPath}`, root));
  assert.equal(social.toString('hex', 0, 8), '89504e470d0a1a0a', `Invalid PNG: ${url}`);
  assert.equal(social.readUInt32BE(16), 1200, `OG width: ${url}`);
  assert.equal(social.readUInt32BE(20), 630, `OG height: ${url}`);
  const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(json, `Missing structured data: ${url}`);
  const schema = JSON.parse(json);
  assert.equal(schema['@context'], 'https://schema.org');
  if (pathname === '/') {
    assert.equal(schema['@type'], 'CollectionPage');
    assert.equal(schema.mainEntity.numberOfItems, urls.length - 1);
    assert.deepEqual(schema.mainEntity.itemListElement.map(item => item.url).sort(), urls.filter(item => item !== `${origin}/`).sort());
  } else {
    assert.equal(schema['@type'], 'BreadcrumbList');
    assert.equal(schema.itemListElement[1].item, url);
    assert.ok(home.includes(`href="${pathname}"`), `Missing crawlable directory link: ${url}`);
    assert.ok(html.includes('demo-summary') && html.includes('demo-notes'), `Missing static demo context: ${url}`);
  }
}
const missing = await read('dist/404.html');
assert.match(missing, /<meta name="robots" content="noindex, follow"/);
assert.ok(!missing.includes('rel="canonical"'), '404 must not advertise an indexable canonical');
const image = await readFile(new URL('dist/og.png', root));
assert.equal(image.toString('hex', 0, 8), '89504e470d0a1a0a');
assert.equal(image.readUInt32BE(16), 1200);
assert.equal(image.readUInt32BE(20), 630);
console.log(`SEO checks passed: ${urls.length} indexable pages, sitemap, robots, structured data, social image, and noindex 404.`);
