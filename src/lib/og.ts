// Build-time 1200 × 630 social artwork. Keep text and illustrations editable in code.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Resvg } from '@resvg/resvg-js';
import satori, { type Font } from 'satori';

export type OgCard = {
  eyebrow: string;
  title: string;
  description?: string;
  footer?: string;
  action?: string;
  visual?: { label: string; value: string; input?: string; image?: string };
};

const require = createRequire(import.meta.url);
let fonts: Font[] | undefined;
const ink = '#111114', paper = '#f4f1ed', purple = '#6d4aff', lime = '#dcff50';
const el = (type: string, style: Record<string, unknown>, children?: unknown) => ({ type, props: { style, children } });
const arrow = (color: string, size: number) => ({ type: 'img', props: { width: size, height: size, src: 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><path d="M10 38L38 10M10 10h28v28" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`).toString('base64') } });
const box = (style: Record<string, unknown>, children?: unknown) => el('div', { display: 'flex', ...style }, children);

function artwork(visual: NonNullable<OgCard['visual']>) {
  return box({ width: 354, height: 382, position: 'relative', flexShrink: 0 }, [
    box({ position: 'absolute', top: 6, left: 12, width: 334, height: 366, backgroundColor: purple, borderRadius: 12, transform: 'rotate(7deg)' }),
    visual.image
      ? { type: 'img', props: { src: visual.image, width: 322, height: 290, style: { position: 'absolute', top: 6, left: 12, objectFit: 'contain', transform: 'rotate(-6deg)' } } }
      : box({ position: 'absolute', top: 18, left: -8, width: 340, height: 188, backgroundColor: paper, color: ink, padding: '26px 28px', borderRadius: 6, flexDirection: 'column', transform: 'rotate(-5deg)' }, [
        el('span', { fontSize: 15, letterSpacing: '0.1em', marginBottom: 14 }, 'INPUT'),
        el('span', { fontSize: 31, fontWeight: 500, lineHeight: 1.14, letterSpacing: '-0.04em' }, visual.input || '“Losing sales, fix this today.”'),
      ]),
    box({ position: 'absolute', bottom: 8, left: 12, width: 330, height: 145, backgroundColor: lime, color: ink, padding: '20px 26px', borderRadius: 6, flexDirection: 'column', transform: 'rotate(3deg)' }, [
      el('span', { fontSize: 14, letterSpacing: '0.1em', marginBottom: 8 }, visual.label.toUpperCase()),
      box({ alignItems: 'center', justifyContent: 'space-between', width: '100%' }, [
        el('span', { fontSize: visual.value.length > 10 ? 34 : visual.value.length > 6 ? 42 : 66, fontWeight: 700, letterSpacing: '-0.055em', lineHeight: 1 }, visual.value),
        arrow(ink, 36),
      ]),
    ]),
  ]);
}

export async function render(card: OgCard): Promise<Uint8Array> {
  fonts ??= ([400, 500, 700] as const).map(weight => ({ name: 'Space', weight, style: 'normal' as const, data: readFileSync(require.resolve(`@fontsource/space-grotesk/files/space-grotesk-latin-${weight}-normal.woff`)) }));
  const visual = card.visual;
  const title = card.title.toUpperCase();
  const size = visual ? (title.length > 32 ? 68 : 82) : (title.length > 54 ? 68 : 84);
  const tree = box({ width: 1200, height: 630, padding: '44px 56px', backgroundColor: ink, color: paper, fontFamily: 'Space', flexDirection: 'column', justifyContent: 'space-between' }, [
    box({ alignItems: 'center', justifyContent: 'space-between' }, [
      el('span', { fontSize: 30, fontWeight: 700, letterSpacing: '-0.06em' }, 'milliseconds.ai'),
      el('span', { fontSize: 17, color: paper, letterSpacing: '0.08em', textTransform: 'uppercase' }, card.eyebrow),
    ]),
    box({ alignItems: 'center', justifyContent: 'space-between', gap: 42, flexGrow: 1 }, [
      box({ flexDirection: 'column', width: visual ? 672 : 1050, flexShrink: 0 }, [
        el('div', { display: 'flex', whiteSpace: 'pre-wrap', fontSize: size, fontWeight: 700, lineHeight: 0.97, letterSpacing: '-0.065em' }, title),
        card.description ? el('div', { marginTop: 26, fontSize: 25, lineHeight: 1.3, color: paper }, card.description) : null,
      ]),
      visual ? artwork(visual) : null,
    ]),
    box({ alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #343438', paddingTop: 18 }, [
      el('span', { color: '#b0adb9', fontSize: 18 }, card.footer || 'Text. Images. One fast API.'),
      box({ color: lime, fontSize: 21, fontWeight: 500, alignItems: 'center', gap: 12 }, [card.action || (visual ? 'Explore the API' : 'Read the story'), arrow(lime, 22)]),
    ]),
  ]);
  const svg = await satori(tree as never, { width: 1200, height: 630, fonts });
  return new Resvg(svg).render().asPng();
}
