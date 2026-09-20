# TrashNet sample provenance

Authors: Gary Thung and Mindy Yang. Original collection: <https://github.com/garythung/trashnet>.
The repository publishes the dataset under its MIT license; the full notice is retained in LICENSE.txt.

Downloaded 2026-09-20 from <https://raw.githubusercontent.com/garythung/trashnet/master/data/dataset-resized.zip>.
Archive Git blob: `4184b4e9d359026a49e5d34ac2cead944f53be88` (verified with the GitHub contents API).

The twelve JPEGs in samples.ts retain the original bytes, dimensions and source folder labels. No resizing, cropping, augmentation or generation was applied. `provenance.json` records each archive member, byte count and SHA-256. The fragment on each sourceUrl identifies the member inside the archive; GitHub does not preview individual members of a ZIP.

Selection: the first two numbered photos in each of the six source categories. This is a small illustrative selection, not an evaluation split. The category `trash` follows the dataset and does not specify local recycling rules. Captions and alt text describe the inspected photos.

Verification: `node scripts/source-waste-cracks-check.mjs`.
