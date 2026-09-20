import type { ImageDemoConfig } from '../../lib/image-demo.ts';
import { samples } from './samples.ts';

export const config: ImageDemoConfig = {
  slug: 'crack-check',
  title: 'Crack Check',
  intro: 'Screen concrete photos for a visible crack, then send flagged images to an inspector.',
  useCase: 'Prioritize surface photos in a maintenance inspection queue.',
  limitation: 'This is a visual screen, not a structural safety assessment. A no-crack result cannot establish that a structure is safe; an inspector must assess condition and severity.',
  labels: {
    crack: 'A concrete surface with a visible crack: a narrow or wide irregular fracture line, possibly branching.',
    no_crack: 'A concrete surface without a visible fracture line. Ordinary texture, pores, isolated pits, stains and lighting variation are not cracks.',
  },
  detail: 'low',
  samples,
  dataset: {
    name: 'Concrete Crack Images for Classification, version 2',
    url: 'https://data.mendeley.com/datasets/5y9wdsg2zt/2',
    author: 'Çağlar Fırat Özgenel',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    note: 'Eight unchanged 227 × 227 JPEG crops from METU campus buildings: four Positive and four Negative source images. Source links identify archive members.',
  },
};
