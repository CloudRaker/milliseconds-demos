import type { Detail } from '../../lib/image.ts';

export interface Sample {
  id: string;
  /** What a person would write under the photo. */
  caption: string;
  /** The caption a person would write. Absent on an uploaded photo. */
  expected?: 'hot dog' | 'not hot dog';
  alt: string;
  width: number;
  height: number;
  /** A subject people themselves argue about, such as a corn dog. */
  edge?: boolean;
  dataUrl: string;
}

/** The two labels of the joke. Each description tells the model where the line sits. */
export const LABELS = {
  'hot dog': 'a cooked frankfurter or wiener served in a sliced bun, with or without toppings',
  'not hot dog': 'anything else, including burgers, sausages without a bun, corn dogs, an empty bun, other food and animals',
} as const;

/** A hot dog needs no resolution, so every sample runs at the cheapest tier. */
export const DETAIL: Detail = 'low';

/** One classify call over one image. No text: the photo is the whole input. */
export const classifyRequest = (image: string, detail: Detail = DETAIL) => ({ image, detail, labels: LABELS });

export interface Verdict { label: string; probability: number; scores: Record<string, number> }

const probability = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/** Read one classify response, rejecting anything that is not a two-label distribution. */
export function parseVerdict(raw: unknown): Verdict {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The model did not return a verdict. Try again.');
  const body = raw as { label?: unknown; probability?: unknown; scores?: unknown };
  if (typeof body.label !== 'string' || !Object.hasOwn(LABELS, body.label)) throw new Error('The model returned an unknown label. Try again.');
  if (!probability(body.probability)) throw new Error('The model returned no probability. Try again.');
  if (!body.scores || typeof body.scores !== 'object' || Array.isArray(body.scores)) throw new Error('The model returned no scores. Try again.');
  const scores: Record<string, number> = {};
  for (const label of Object.keys(LABELS)) {
    const score = (body.scores as Record<string, unknown>)[label];
    if (!probability(score)) throw new Error('The model returned an incomplete distribution. Try again.');
    scores[label] = score;
  }
  return { label: body.label, probability: body.probability, scores };
}

/** The verdict is the label above the 0.5 line. With two labels the scores sum to one. */
export const isHotDog = (verdict: Verdict) => verdict.scores['hot dog'] >= 0.5;

/** How many verdicts match the caption a person wrote. */
export const agreement = (results: Map<string, Verdict>, samples: Sample[]) =>
  samples.filter(sample => {
    const verdict = results.get(sample.id);
    return verdict && sample.expected && (isHotDog(verdict) ? 'hot dog' : 'not hot dog') === sample.expected;
  }).length;
