import type { ImageDemoConfig } from '../../lib/image-demo';
import { samples } from './samples.ts';

export const config: ImageDemoConfig = {
  slug: 'produce-check',
  title: 'Produce Check',
  intro: 'Spot visible deterioration in bell peppers, tomatoes and bitter gourds from real produce photos.',
  useCase: 'Send produce with visible discoloration, wrinkling or damage to a person for a closer look.',
  limitation: 'This checks appearance only. It cannot determine edibility, freshness inside the produce or food safety. Ripening and lighting can resemble deterioration.',
  detail: 'low',
  labels: {
    sound: 'Produce with a visually sound exterior: typical color and shape, without obvious decay, extensive discoloration, mold or severe shriveling.',
    deteriorated: 'Produce with visible deterioration: brown or dark patches, mold, pronounced wrinkling, shriveling or substantial discoloration. Inspect the exterior appearance only.',
  },
  samples,
  dataset: {
    name: 'Fresh and Stale Images of Fruits and Vegetables',
    url: 'https://www.kaggle.com/datasets/raghavrpotdar/fresh-and-stale-images-of-fruits-and-vegetables',
    author: 'Raghav R Potdar, Adithya Shrivastava, Rahul Sohandani and Naren Khatwani (Food Aayush)',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    note: 'Six photographs from the bitter-gourd, capsicum and tomato classes. The publisher includes rotated/augmented photos; those borders are preserved. Fresh/stale source labels map to sound/deteriorated appearance for this demo and are not food-safety ground truth. Resized and JPEG-compressed.',
  },
};
