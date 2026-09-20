# Roast Check photo provenance

The eight stock images are real photographs from version 1 of [Gerry's Coffee Bean Dataset Resized (224 × 224)](https://www.kaggle.com/datasets/gpiosenka/coffee-bean-dataset-resized-224-x-224). The Kaggle API and data card list **CC BY-SA 4.0**, checked 2026-09-20.

Original photographers/dataset authors: Sakdipat Ontoum, Thitaree Khemanantakul, Pornphat Sroison, Tuul Triyason and Bunthit Watanapa. Original dataset: [Coffee Bean Dataset Version 1](https://www.kaggle.com/datasets/sot2542/coffee-bean-dataset-v1), also CC BY-SA 4.0. Research citation: [Coffee Roast Intelligence (2022)](https://doi.org/10.48550/arXiv.2206.01841). Gerry resized the original photographs to 224 × 224 pixels.

These selected image adaptations remain licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). We converted the selected PNGs to RGB JPEG at quality 80, with no additional crop. No endorsement by the dataset authors is implied.

`provenance.json` records every original filename, source label, version-pinned public download URL, original SHA-256, output SHA-256 and transformation. `samples.ts` embeds those JPEG bytes and a per-file Kaggle source link. The original test-folder labels are preserved as `expected`. Two examples per class are demonstrations, not an evaluation set.

Rebuild from the public Kaggle API: `python3 scripts/source-coffee-produce.py` (Pillow required). Validate the checked-in samples without network: `python3 scripts/source-coffee-produce.py --check`.
