import type { ImageDemoConfig } from '../../lib/image-demo.ts';
import { samples } from './samples.ts';

export const config: ImageDemoConfig = {
  slug: 'land-cover',
  title: 'Satellite Land Cover',
  intro: 'Ten real Sentinel-2 tiles. Recognize the land cover in each tiny satellite image, from forest canopy to industrial roofs.',
  useCase: 'Organize an Earth-observation image library and route uncertain land-cover labels for map review.',
  limitation: 'Each original tile is only 64 × 64 pixels. This demo sees three RGB bands, not all 13 Sentinel-2 bands or a time series. Similar agricultural classes can be ambiguous; a single tile cannot establish a change over time.',
  labels: {
    'Annual crop': 'Satellite view of cultivated annual-crop fields: geometric agricultural parcels, often bare brown or muted green, with field boundaries.',
    Forest: 'Satellite view dominated by dense continuous tree canopy, with mottled dark green texture and few large open fields or buildings.',
    'Herbaceous vegetation': 'Satellite view of natural low-growing grasses and shrubs, with irregular vegetation texture rather than uniform planted rows or dense forest.',
    Highway: 'Satellite view containing a prominent wide road or highway corridor, often with parallel lanes, interchanges or long straight pavement.',
    Industrial: 'Satellite view of large industrial roofs, warehouses, paved yards and broad roads, with larger buildings than a residential neighborhood.',
    Pasture: 'Satellite view of grassy grazing land: green open fields separated by hedges or boundaries, without dense tree cover or strong crop-row texture.',
    'Permanent crop': 'Satellite view of orchards, vineyards or other long-lived crops: repeated planted rows or regular patterns within agricultural parcels.',
    Residential: 'Satellite view of a neighborhood with many small building roofs and streets, often interspersed with trees and gardens.',
    River: 'Satellite view of a long narrow or winding water channel with visible land along its banks.',
    'Sea or lake': 'Satellite view dominated by a broad expanse of open water, generally smooth dark blue or blue-green, with few visible land features.',
  },
  detail: 'low',
  samples,
  dataset: {
    name: 'EuroSAT RGB',
    url: 'https://zenodo.org/records/7711810',
    author: 'Patrick Helber, Benjamin Bischke, Andreas Dengel and Damian Borth; Copernicus Sentinel-2 imagery',
    license: 'MIT; Copernicus Sentinel data terms',
    licenseUrl: 'https://github.com/phelber/EuroSAT#license',
    note: 'One original RGB JPEG from each of the ten EuroSAT classes. Original 64 × 64 pixels and JPEG bytes are unchanged; display enlargement adds no detail. Source links identify each filename in EuroSAT_RGB.zip. Contains modified Copernicus Sentinel data in the authors’ RGB dataset.',
  },
};
