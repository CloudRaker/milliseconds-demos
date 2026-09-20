# Bean Leaf Check source record

The [Makerere iBean authors](https://github.com/AI-Lab-Makerere/ibean) describe smartphone photos collected in Uganda with NaCRRI crop experts assigning the three labels during field collection. Their README explicitly licenses the data under MIT. The complete notice is in `LICENSE` and on the demo page.

The original Google Storage download currently returns 403. These images were obtained from the [authors' Hugging Face mirror](https://huggingface.co/datasets/AI-Lab-Makerere/beans/blob/main/data/test.zip), using the original `test.zip`. We selected files numbered 0, 1 and 2 in each of `healthy`, `angular_leaf_spot`, and `bean_rust`; no images were generated or relabeled. `provenance.json` records every original archive path and SHA-256 digest. Each sample source URL is the archive URL with its exact member path in the fragment.

Images are downsampled proportionally to 448 pixels and JPEG-encoded at quality 70. There is no crop, retouching or synthetic augmentation. Expected categories reflect the original expert labels; they are not a claim about this model's accuracy or a field diagnosis.

Regenerate both leaf and land samples with:

```sh
python3 scripts/source-leaf-land.py /path/to/ibeans-test.zip /path/to/EuroSAT_RGB.zip
node scripts/source-leaf-land-check.mjs
```

The one-time generation script needs Pillow. The check uses existing project dependencies only.
