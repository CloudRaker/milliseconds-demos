import type { ImageDemoConfig } from '../../lib/image-demo.ts';
import { samples } from './samples.ts';

export const config: ImageDemoConfig = {
  slug: 'waste-sorter',
  title: 'Waste Sorter',
  intro: 'A bottle, a can, a cardboard box: route waste photos into six material categories.',
  useCase: 'Triage incoming material photos before a person checks the sorting decision.',
  limitation: 'Material labels follow TrashNet. They do not determine what your local recycling service accepts; coated packaging and mixed materials need review.',
  labels: {
    glass: 'A glass bottle, jar, drinking glass or other glass object.',
    paper: 'Ordinary paper, newspaper, office paper or a paper flyer.',
    cardboard: 'A cardboard box, corrugated board or thick cardboard packaging.',
    plastic: 'A plastic bottle, rigid plastic container or plastic packaging.',
    metal: 'A metal food can, drink can, lid or other metal object.',
    trash: 'Other waste or mixed-material packaging, such as a coated disposable coffee cup or flexible food pouch.',
  },
  detail: 'low',
  samples,
  dataset: {
    name: 'TrashNet',
    url: 'https://github.com/garythung/trashnet',
    author: 'Gary Thung and Mindy Yang',
    license: 'MIT',
    licenseUrl: 'https://github.com/garythung/trashnet/blob/master/LICENSE',
    note: 'Twelve original 512 × 384 JPEGs from dataset-resized.zip, two per source category. Images are unchanged; source links identify archive members.',
  },
};
