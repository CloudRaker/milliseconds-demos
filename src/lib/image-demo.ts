import type { Detail } from './image.ts';

export interface ImageSample {
  id: string;
  caption: string;
  alt: string;
  expected: string;
  width: number;
  height: number;
  dataUrl: string;
  sourceUrl: string;
}

export interface ImageDemoConfig {
  slug: string;
  title: string;
  intro: string;
  useCase: string;
  limitation: string;
  labels: Record<string, string>;
  detail: Detail;
  samples: ImageSample[];
  dataset: { name: string; url: string; author: string; license: string; licenseUrl: string; note: string };
}

export const imageClassifyRequest = (config: ImageDemoConfig, image: string) => ({
  image, detail: config.detail, labels: config.labels,
});

export interface ImageVerdict { label: string; probability: number; scores: Record<string, number> }

/** Reject incomplete responses before displaying model results beside dataset annotations. */
export function parseImageVerdict(raw: unknown, labels: Record<string, string>): ImageVerdict {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The model did not return a classification. Try again.');
  const body = raw as Partial<ImageVerdict>;
  const probability = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
  if (typeof body.label !== 'string' || !Object.hasOwn(labels, body.label) || !probability(body.probability)) {
    throw new Error('The model returned an invalid label or probability. Try again.');
  }
  if (!body.scores || typeof body.scores !== 'object' || Array.isArray(body.scores)) throw new Error('The model returned no label scores. Try again.');
  const scores: Record<string, number> = {};
  for (const label of Object.keys(labels)) {
    if (!Object.hasOwn(body.scores, label) || !probability(body.scores[label])) throw new Error('The model returned incomplete label scores. Try again.');
    scores[label] = body.scores[label];
  }
  return { label: body.label, probability: body.probability, scores };
}
