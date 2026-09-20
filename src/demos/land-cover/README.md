# Satellite Land Cover source record

[EuroSAT RGB, Zenodo record 7711810](https://zenodo.org/records/7711810) is the original archive linked by the [authors' repository](https://github.com/phelber/EuroSAT). The repository explicitly states the dataset is MIT-licensed, subject also to [Copernicus Sentinel data terms](https://sentinel.esa.int/documents/247904/690755/Sentinel_Data_Legal_Notice). The complete MIT notice is in `LICENSE` and on the demo page.

Credit: Patrick Helber, Benjamin Bischke, Andreas Dengel and Damian Borth. EuroSAT: A Novel Dataset and Deep Learning Benchmark for Land Use and Land Cover Classification, IEEE JSTARS (2019), DOI [10.1109/JSTARS.2019.2918242](https://doi.org/10.1109/JSTARS.2019.2918242). Contains modified Copernicus Sentinel data in the authors' RGB dataset; the source record does not state an acquisition year for these individual files.

We use `<Class>_1.jpg` from each of the ten original classes in `EuroSAT_RGB.zip`. All files remain the original 64 × 64 RGB JPEG bytes: no upsampling, sharpening, crops or synthesized content. The UI can enlarge their display but cannot add resolution. `provenance.json` records every original path and SHA-256 digest. Each sample source URL is the original archive URL with its exact member path in the fragment. Expected labels match source directories; no predictions or benchmark claims are pre-recorded.

Regeneration and verification commands are in the sibling leaf-check README. The published ZIP MD5 is `f46e308c4d50d4bf32fedad2d3d62f3b`.
