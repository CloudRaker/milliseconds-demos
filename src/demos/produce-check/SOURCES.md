# Produce Check photo provenance

The six stock images come from version 1 of [Fresh and Stale Images of Fruits and Vegetables](https://www.kaggle.com/datasets/raghavrpotdar/fresh-and-stale-images-of-fruits-and-vegetables), published by Raghav R Potdar with Adithya Shrivastava, Rahul Sohandani and Naren Khatwani for Food Aayush. The Kaggle API and data card list **CC0: Public Domain**, checked 2026-09-20. [CC0 1.0 terms](https://creativecommons.org/publicdomain/zero/1.0/).

We selected the bitter-gourd, capsicum and tomato classes, whose photo filenames reflect the team's image collection. The publisher describes camera photography, video-frame extraction and image augmentation. The dataset's rotations and black corner borders are preserved; these are augmented real photographs, not generated subjects. The selected samples are converted to RGB JPEG, reduced to a maximum edge of 512 pixels, at JPEG quality 80.

The source also credits a separate dataset for some classes. We excluded its screenshot-named apple, banana and orange classes. The initially considered [Mukhiddinov fruits and vegetables dataset](https://www.kaggle.com/datasets/muhriddinmuxiddinov/fruits-and-vegetables-dataset) was not copied: its card describes mixed Google/Bing image sources without per-image ownership details.

`provenance.json` records every original filename, source label, version-pinned public download URL, original SHA-256, output SHA-256 and transformation. `samples.ts` embeds those JPEG bytes and per-file Kaggle source links. Original `fresh_*` labels map to `sound`, and `stale_*` labels map to `deteriorated`. These labels indicate the source's visual categories, not edibility or microbiological safety. Natural ripening can also cause discoloration.

Rebuild from the public Kaggle API: `python3 scripts/source-coffee-produce.py` (Pillow required). Validate the checked-in samples without network: `python3 scripts/source-coffee-produce.py --check`.
