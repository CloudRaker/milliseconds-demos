// Social cards (1200x630) rendered at build time, one per demo: satori lays out a plain object tree
// as SVG, resvg rasterises it. The endpoint src/pages/og/[slug].png.ts calls render()
// once per demo; Demo.astro points og:image at the matching file. Same renderer as milliseconds.ai.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Resvg } from '@resvg/resvg-js';
import satori, { type Font } from 'satori';

export type OgCard = { eyebrow: string; title: string; description?: string };

const require = createRequire(import.meta.url);
// satori reads fonts with opentype.js: WOFF yes, WOFF2 no. @fontsource ships both.
const font = (weight: 400 | 500 | 700): Font => ({
  name: 'Space',
  weight,
  style: 'normal',
  data: readFileSync(require.resolve(`@fontsource/space-grotesk/files/space-grotesk-latin-${weight}-normal.woff`)),
});
let fonts: Font[] | undefined;

const MARK = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="22" viewBox="6.8 8.8 22.4 14.4"><path d="M8 22V10l4 7 4-7 4 7 4-7v12" fill="none" stroke="#6d4aff" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/></svg>',
).toString('base64');

const el = (type: string, style: Record<string, unknown>, children?: unknown) => ({ type, props: { style, children } });

function tree({ eyebrow, title, description }: OgCard) {
  const long = title.length > 34;
  return el('div', { width: 1200, height: 630, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '64px 72px', backgroundColor: '#111114', color: '#f4f1ed', fontFamily: 'Space' }, [
    el('div', { display: 'flex', alignItems: 'center', gap: 12, fontSize: 30, fontWeight: 500, letterSpacing: '-0.05em' }, [
      { type: 'img', props: { src: MARK, width: 34, height: 22 } },
      el('span', { display: 'flex' }, ['milliseconds', el('span', { color: '#a19ca8', fontWeight: 400 }, '.ai')]),
    ]),
    el('div', { display: 'flex', flexDirection: 'column', maxWidth: 1000 }, [
      eyebrow ? el('div', { fontSize: 20, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#b0adb9', marginBottom: 24 }, eyebrow) : null,
      el('div', { fontSize: long ? 68 : 84, lineHeight: 1.0, letterSpacing: '-0.05em', fontWeight: 500, textWrap: 'balance' }, title),
      description ? el('div', { marginTop: 28, fontSize: 28, lineHeight: 1.35, color: '#b0adb9', maxWidth: 900 }, description) : null,
    ]),
    // ponytail: a gradient bar stands in for the hero beam; swap in the captured art if it matters.
    el('div', { height: 6, width: '100%', borderRadius: 3, backgroundImage: 'linear-gradient(90deg, #6d4aff 0%, #3c11bd 55%, #111114 100%)' }),
  ]);
}

export async function render(card: OgCard): Promise<Uint8Array> {
  fonts ??= [font(400), font(500), font(700)];
  const svg = await satori(tree(card) as never, { width: 1200, height: 630, fonts });
  return new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
}
