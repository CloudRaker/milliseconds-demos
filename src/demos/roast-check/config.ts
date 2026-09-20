import type { ImageDemoConfig } from '../../lib/image-demo';
import { samples } from './samples.ts';

export const config: ImageDemoConfig = {
  slug: 'roast-check',
  title: 'Roast Check',
  intro: 'Green, light, medium or dark: sort real coffee-bean photos by their visible roast level.',
  useCase: 'Give a roastery a first-pass visual sorting signal before a person checks the batch.',
  limitation: 'Lighting, bean variety and camera exposure affect color. A photo cannot measure roast temperature, flavor or batch consistency.',
  detail: 'low',
  labels: {
    green: 'An unroasted coffee bean, pale green, gray-green or beige in color.',
    light: 'A lightly roasted coffee bean, golden tan or light brown, with a mostly dry surface.',
    medium: 'A medium-roasted coffee bean, medium brown with a mostly dry surface.',
    dark: 'A dark-roasted coffee bean, deep brown to nearly black, often with an oily sheen.',
  },
  samples,
  dataset: {
    name: 'Coffee Bean Dataset Resized (224 × 224)',
    url: 'https://www.kaggle.com/datasets/gpiosenka/coffee-bean-dataset-resized-224-x-224',
    author: 'Sakdipat Ontoum, Thitaree Khemanantakul, Pornphat Sroison, Tuul Triyason and Bunthit Watanapa; resized by Gerry',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    note: 'Eight test photos, two per source roast label. Converted from 224 px PNG to JPEG. These adapted photographs remain CC BY-SA 4.0. Source: Coffee Roast Intelligence (2022), doi:10.48550/arXiv.2206.01841.',
  },
};
