# milliseconds.ai style map for a sibling Astro demos project

Source root: `/Users/blaget/projects/cloudraker-spring-2026/apps/milliseconds` (call it `$MS` below). No file was modified.

## 1. Files to copy verbatim

| Copy from `$MS` | Size | Notes |
|---|---|---|
| `src/styles/site.css` | 40,242 B (2,122 lines) | Whole design system. Copy whole. Drop hero/shader sections later if desired. |
| `src/layouts/Site.astro` | 5,097 B | Copy, then edit nav/footer (section 3). Imports `../../../web/src/components/chrome/Brand.astro`; that path breaks outside the monorepo. |
| `src/components/TextReveal.astro` | 523 B | Letter-by-letter reveal. Its CSS is inside `site.css` (`.text-reveal`, `@keyframes cult-calm-in`). Copy `CULT-UI-LICENSE.md` (1,071 B) with it. |
| `public/fonts/SpaceGrotesk-Variable.woff2` | 22,288 B | Sans, weight 300 to 700. |
| `public/fonts/IoskeleyMono-Regular.woff2` | 96,552 B | Only mono weight `site.css` references. |
| `public/fonts/IoskeleyMono-LICENSE.txt` | 4,300 B | Keep with the font. |
| `public/fonts/IoskeleyMono-Light.woff2`, `-Medium.woff2`, `-SemiBold.woff2` | 96,128 / 96,204 / 96,416 B | Not referenced by any `@font-face`. Skip them. |
| `public/favicon.svg` | 253 B | Black rounded square with purple `M` path stroke `#a089ff`. Reuse as-is. |
| `public/_headers` | 62 B | `/fonts/*` immutable cache. Copy. |
| `public/og.png` | 247,533 B | 1200x630 hero capture. Reuse, or regenerate with `scripts/og.mjs` (needs puppeteer plus Chrome). |
| `public/images/badge-soc2-type2.svg` | 4,610 B | Footer badge. Copy if you keep the footer. |
| `/Users/blaget/projects/cloudraker-spring-2026/apps/web/src/components/chrome/Brand.astro` | ~5 KB | CloudRaker wordmark SVG in the footer. Copy into `src/components/Brand.astro` and fix the import in `Site.astro`. |
| `astro.config.mjs` | 228 B | Change `site` to `https://demo.milliseconds.ai`. |
| `tsconfig.json` | 109 B | `extends astro/tsconfigs/strict`. |
| `src/worker.ts` | 5,463 B | The `/api/run` proxy. Copy, then extend `CAPABILITIES` for the new demos. |
| `wrangler.jsonc` | 1,844 B | Template. Rename worker, change routes to `demo.milliseconds.ai`. |
| `.dev.vars.example` | 184 B | `PLAYGROUND_API_KEY`, `TURNSTILE_SECRET`. |

The root `/Users/blaget/projects/cloudraker-spring-2026/DESIGN.md` (5,594 B) describes the CloudRaker light teal system. The milliseconds site does not follow it. It is dark, purple, sans only. Do not copy it.

## 2. Tokens and utility classes for demo pages

`:root` in `site.css` lines 12 to 31:

```
color-scheme: dark;
--ink: #111114;            /* page background */
--surface: #19191e;        /* raised band */
--white: #f4f1ed;          /* text */
--muted: #b0adb9;          /* secondary text */
--line: #ffffff24;         /* hairline */
--purple: #3c11bd;         /* fills only, light text on top */
--purple-on-dark: #6d4aff; /* purple as foreground on --ink */
--sans: Space, sans-serif;
--mono: Ioskeley, monospace;
--heading-size: clamp(42px, 4.8vw, 76px);
--gutter: clamp(24px, 5vw, 88px);
--section: clamp(80px, 8vw, 144px);
--ease: cubic-bezier(0.16, 1, 0.3, 1);
```

Mobile override at `@media (max-width: 760px)`: `--gutter: 24px; --section: 76px; --heading-size: clamp(40px, 8vw, 46px); --header-h: 82px`.

Base: `body` is 16px `var(--sans)` weight 400 on `var(--ink)`. `h1, h2, h3` weight 400, `letter-spacing: -0.045em`. `h2` uses `var(--heading-size)`. `h3` is 24px. `pre, code` use `var(--mono)`, `pre` is 12px line-height 1.85.

Classes to reuse:

- Container: `.shell` (`max-width: 1600px; padding: 0 var(--gutter); margin: 0 auto`).
- Section rhythm: any section gets `padding: var(--section) 0` (see `.capabilities-section`, `.pricing-section`). Alternate bands with `.surface-section` (`background: var(--surface); border-block: 1px solid var(--line)`).
- Section header: `.section-marker` (flex, 12px, muted, two spans, second hidden on mobile) then `.section-title` (flex with `h2` and a muted 15px `p`).
- Label: `.micro-label` (mono 12px uppercase, `letter-spacing: 0.1em`, muted).
- Buttons: `.button` plus `.button-primary` (purple fill), `.button-secondary` (1px `#ffffff3a` border), `.button-dark` (same as primary with `margin-top: 28px`). `.button` is `min-height: 52px; padding: 15px 22px; border-radius: 2px; font-size: 14px; font-weight: 500`. Small run button: `.play-run` (purple, 13px, `padding: 11px 16px`, `:disabled` opacity 0.55 cursor wait). Ghost text button: `.play-raw`. Text link: `.text-link` (underline border, 14px).
- Card: there is no `.card` class. The card pattern is `.integration-code` (`background: var(--surface); border: 1px solid var(--line); padding: 28px 30px; border-radius: 2px`) with `.code-heading` inside. Use this for demo panels.
- Input: `.play-input` (textarea, mono 13px/1.9, `background: #ffffff05`, 1px `var(--line)` border, focus border `var(--purple-on-dark)`, `field-sizing: content`).
- Result display: `.example-result` (left border, `padding-left: 32px`), `.result-value` (mono, `clamp(36px, 4vw, 60px)`, purple-on-dark), `.result-value-long` (smaller), `.probability` (label plus mono `strong`), `.distribution` and `.distribution-row` (bar chart: `<span>label</span><i style="--value:74%"></i><span>0.74</span>`, bar animates with `bar-enter`), `.result-fields` (dl grid, 14px).
- Status: `.play-status` (mono 12px), `.play-status[data-tone="error"]` is `#ff9a9a`.
- Raw JSON: `<details class="raw-response"><summary>View JSON response <span>+</span></summary><pre><code>…` .
- Two-column layouts: `.explorer` (260px list plus content, becomes horizontal tab strip on mobile), `.example-body` (1.05fr 1fr grid, collapses under 1100px).
- Dark band: the whole site is dark. The footer band is `.site-footer` with `background: #151218`.
- Reveal on scroll: add `data-reveal` to any element. `Site.astro` adds `.revealed`, which runs `hero-enter` 0.8s.
- Hero (optional): `.hero`, `.hero-inner`, `.hero-line`, `.hero-copy`, `.hero-actions`, `.hero-bottom`. Copy is offset with `margin-left: 48%`. `#decision-field` is the shader canvas; skip `src/scripts/experience.ts`, `convergence.ts`, and `@paper-design/shaders` if you drop the animated hero.
- Utility: `.sr-only`, `.skip-link`.
- Reduced motion: global `animation: none !important; transition: none !important`.

## 3. Header, nav, footer, and what to change

Header in `Site.astro` lines 36 to 44. `header.site-header` is `position: absolute; top: 0` (fixed with blur under 760px). Inside: `div.shell.header-inner` (104px tall, bottom hairline) with:

1. `a.wordmark` with inline `M` SVG (`stroke="var(--purple-on-dark)"`) and `<span>milliseconds<span class="domain">.ai</span></span>`.
2. `nav.desktop-nav` with plain `<a>` links (14px, purple hover).
3. `a.header-cta` (bordered pill, "Sign up").
4. `details.mobile-menu` with a two-span hamburger `summary` and a duplicate `nav`.

Because the header is absolute, every page must start with a section that has top padding of at least 104px (the hero uses `padding-top: 160px`). Demo pages without a hero need this, or change `.site-header` to `position: sticky` or `relative`.

Footer lines 46 to 52: `footer.site-footer > div.shell` with `.footer-top` (paragraph plus `<CloudRakerBrand class="cloudraker-brand" />`), `.footer-word` (giant "milliseconds" at `#423749`), `.footer-bottom` (SOC 2 badge, copyright, city, trust link, back to top).

Changes for the demos subsite:

- Wordmark `href` becomes `https://milliseconds.ai/`. Add a `demo` suffix, for example `<span>milliseconds<span class="domain">.ai/demo</span></span>`.
- Replace the anchor links `#model #capabilities #pricing` with demo routes. Keep external links: `https://docs.milliseconds.ai/` (Docs), `https://console.milliseconds.ai/` (Login), `https://console.milliseconds.ai/signup` (Sign up CTA). All use `target="_blank" rel="noopener noreferrer"`.
- Duplicate the same links in `details.mobile-menu nav`.
- Fix canonical: line 6 hardcodes `https://milliseconds.ai`. Change to `https://demo.milliseconds.ai`. Also change `og:image` URLs (lines 27, 31) and `og:site_name`.
- Replace the `CloudRakerBrand` import path with a local copy.
- Footer paragraph can stay. Add a link back to `https://milliseconds.ai/`.
- The `<script>` at lines 53 to 68 handles Plausible, `data-reveal`, and mobile menu close. Keep it.

## 4. How `playground.ts` calls `/api/run`

File: `$MS/src/scripts/playground.ts` (13,707 B). Proxy: `$MS/src/worker.ts`.

Request:

```ts
const res = await fetch("/api/run", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ capability: path.slice(1), body, turnstile }),
});
```

`capability` is one of `yes-no classify rate answer extract entities verify`. `body` is the raw API body (`text` plus per-capability params). `turnstile` is a Cloudflare Turnstile token obtained from `getToken()`.

Worker forwards to `https://api.milliseconds.ai/v1/decision-machine-1/<capability>` with `authorization: Bearer ${env.PLAYGROUND_API_KEY}`. Guard order: Turnstile verify, per-IP rate limits (`PLAY_IP_LIMIT` 10/60s, `PLAY_IP_BURST` 3/10s via wrangler `ratelimits`), then `sanitize()` which keeps `text` (max 2,000 chars) plus the whitelisted keys in `CAPABILITIES`, 8 KB total. Errors come back as `{ error: { code, message } }` with status 400/403/404/405/413/429/503/504. Upstream 401/403 becomes 503 `playground_unavailable`; upstream 5xx becomes 503 `model_busy`; timeout 15 s becomes 504.

Headers passed through from upstream: `x-input-chars`, `x-input-tokens`, `x-inference-ms`. Client reads `x-input-tokens` and `x-inference-ms`.

Rendering: `render(path, req, res)` returns an HTML string per capability, built with `value()` (`.micro-label` plus `.result-value`), `score()` (`.probability`), `rows()` (`.distribution`), `fields()` (`.result-fields`). Result goes into `.example-result` via `innerHTML`. Raw JSON goes into `.raw-response code`. The heading `.example-heading > span:last-child` gets class `example-live` and metrics `<b>412 ms</b> round trip · <b>38 ms</b> inference · <b>12</b> input tokens · <b>$0.00000048</b> cost`. Cost is `tokens * usdPerMillion / 1e6` with `data-usd-per-million="0.04"` on `.explorer`.

Loading and error conventions: `button.disabled = true; say("Running…")` before fetch. `say(text, tone)` writes to `.play-status` (`role="status" aria-live="polite"`) and sets `data-tone`. On error `say(message, "error")`. `finally` re-enables the button. Cmd/Ctrl+Enter in the textarea triggers run. Plausible event `track("Playground Run", { props: { capability, status, inference_ms } })`.

Turnstile: sitekey from `data-sitekey` on `.explorer`, set in `index.astro` from `import.meta.env.PUBLIC_TURNSTILE_SITEKEY ?? '1x00000000000000000000AA'` (test key). Widget renders once into `#play-turnstile` with `appearance: "interaction-only"` when the explorer nears the viewport (`rootMargin: "600px"`). Tokens are single use; `getToken()` returns the cached one and resets the widget. Test secret is `1x0000000000000000000000000000000AA`.

For React islands, port `getToken()`, the fetch call, header reads, and `say()` semantics. The `render()` switch is capability specific and can be replaced per demo.

## 5. Fonts

Self-hosted. `site.css` lines 1 to 11:

```css
@font-face { font-family: Space; src: url("/fonts/SpaceGrotesk-Variable.woff2") format("woff2"); font-weight: 300 700; font-display: swap; }
@font-face { font-family: Ioskeley; src: url("/fonts/IoskeleyMono-Regular.woff2") format("woff2"); font-weight: 400; font-display: swap; }
```

`Site.astro` line 16 preloads Space only: `<link rel="preload" href="/fonts/SpaceGrotesk-Variable.woff2" as="font" type="font/woff2" crossorigin />`. No Google Fonts. `public/_headers` sets immutable cache on `/fonts/*`.

## 6. Plausible

Package `@plausible-analytics/tracker@^0.4.6` (installed 0.4.6). In `Site.astro` line 54:

```ts
import { init } from "@plausible-analytics/tracker";
init({ domain: "milliseconds.ai" });
```

Custom events use `import { track } from "@plausible-analytics/tracker"` in `playground.ts`. For the demos site, set `domain: "demo.milliseconds.ai"` and add that site in Plausible, or keep `milliseconds.ai` to merge stats. No script tag, no proxy.

## 7. Astro specifics before adding React

- Astro `^6.1.7`, `output: 'static'`, no integrations, no adapter. `astro.config.mjs` is 228 B. Cloudflare Worker serves `./dist` as static assets with `run_worker_first: ["/api/*"]`.
- Dependencies are only `astro`, `@plausible-analytics/tracker`, `@paper-design/shaders`. No Tailwind, no React, no MDX. Package manager is pnpm 9 in a workspace. The new repo needs its own `package.json`; `vite ^7` override exists at the monorepo root.
- All client code is inline `<script>` in `.astro` files (Astro bundles them as modules) plus `src/scripts/*.ts` imported from `index.astro`. Scripts are plain DOM code that queries by class name.
- Tabs in the explorer use `role="tab"` buttons with `aria-selected` and `.capability-panel[hidden]`. The tab switching logic is in `experience.ts` (not read in full; it also mounts the shader). Check that file if you want the tab pattern.
- `TextReveal.astro` and `Brand.astro` are Astro components. They work with no changes.
- To add React: `pnpm astro add react` installs `@astrojs/react`, `react`, `react-dom`, and adds `integrations: [react()]`. `tsconfig` must add `"jsx": "react-jsx", "jsxImportSource": "react"` (the `astro add` command does this). Islands need `client:load` or `client:visible`. The Plausible `track` import works inside React the same way.
- `Site.astro` reads `Astro.url.pathname` for canonical. Static build works.
- Env: only `PUBLIC_TURNSTILE_SITEKEY` at build time. Secrets are `PLAYGROUND_API_KEY` and `TURNSTILE_SECRET` on the Worker (`wrangler secret put`).
- `public/robots.txt` and `src/pages/sitemap.xml.ts`, `llms.txt.ts`, `pricing.md.ts` hardcode `https://milliseconds.ai`. Rewrite for the demos domain or skip.
- `src/data/capabilities.ts` (2,964 B) holds seven recorded request and response pairs for `/yes-no /classify /rate /answer /extract /entities /verify`. Useful seed data for demos.