import type { ImageDemoConfig } from '../../lib/image-demo.ts';
import { samples } from './samples.ts';

export const config: ImageDemoConfig = {
  slug: 'leaf-check',
  title: 'Bean Leaf Check',
  intro: 'Nine field photos from Uganda. Sort each bean leaf into the visual categories supplied by the dataset’s crop experts.',
  useCase: 'Triage a crop-image collection: group healthy-looking leaves and visible symptom patterns for an agronomist to review.',
  limitation: 'These are dataset categories, not a diagnosis or treatment recommendation. Other pests, lighting and leaf age can look similar. Ask a crop expert to assess field conditions.',
  labels: {
    Healthy: 'A bean leaf that is mostly evenly green, with no prominent brown lesions or widespread rust-colored speckling. Minor blemishes may be present.',
    'Angular leaf spot': 'A bean leaf with distinct brown or gray lesions, often angular and bounded by veins, with possible yellowing and damaged areas.',
    'Bean rust': 'A bean leaf with numerous small rust-brown or reddish speckles or pustules scattered across its surface, sometimes surrounded by yellow tissue.',
  },
  detail: 'low',
  samples,
  dataset: {
    name: 'Makerere iBean',
    url: 'https://github.com/AI-Lab-Makerere/ibean',
    author: 'Makerere AI Lab and the National Crops Resources Research Institute (NaCRRI), Uganda',
    license: 'MIT',
    licenseUrl: 'https://github.com/AI-Lab-Makerere/ibean/blob/master/LICENSE',
    note: 'Nine photos from the original test split, three per expert-assigned category. Resized to 448 px and JPEG-compressed; no crops or retouching. Source links identify each original filename inside the archive.',
  },
};
