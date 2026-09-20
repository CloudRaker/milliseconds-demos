#!/usr/bin/env python3
"""Rebuild the two licensed photo subsets, or validate them with --check. Requires Pillow."""
import base64
import hashlib
import io
import json
from pathlib import Path
import sys
from urllib.parse import quote
from urllib.request import urlopen
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
COFFEE = 'gpiosenka/coffee-bean-dataset-resized-224-x-224'
PRODUCE = 'raghavrpotdar/fresh-and-stale-images-of-fruits-and-vegetables'
SELECTIONS = {
    'roast-check': [(COFFEE, f'test/{level}/{level.lower()} ({i}).png', f'{level.lower()}-{i}',
                     f'{level} bean · sample {i}', f'A single {level.lower()} coffee bean on a pale background.', level.lower())
                    for level in ['Green', 'Light', 'Medium', 'Dark'] for i in [1, 50]],
    'produce-check': [
        (PRODUCE, 'fresh_bitter_gourd/IMG_20200822_223831.jpg_0_1039.jpg', 'fresh-bitter-gourd', 'Bitter gourd · fresh', 'Green bitter gourd on white paper.', 'sound'),
        (PRODUCE, 'stale_bitter_gourd/IMG_20200824_182208.jpg_0_2930.jpg', 'stale-bitter-gourd', 'Bitter gourd · stale', 'Bitter gourd with yellow-orange discoloration and dark patches.', 'deteriorated'),
        (PRODUCE, 'fresh_capsicum/Day1A.jpg_0_1118.jpg', 'fresh-capsicum', 'Bell pepper · fresh', 'A green bell pepper with smooth skin on white paper.', 'sound'),
        (PRODUCE, 'stale_capsicum/IMG_20200901_181735.jpg_0_1126.jpg', 'stale-capsicum', 'Bell pepper · stale', 'A green bell pepper with a large brown patch.', 'deteriorated'),
        (PRODUCE, 'fresh_tomato/DSCN4068.jpg_0_112.jpg', 'fresh-tomato', 'Tomato · fresh', 'A red tomato with smooth skin on a pale background.', 'sound'),
        (PRODUCE, 'stale_tomato/Copy of IMG_20200727_223202.jpg_0_1614.jpg', 'stale-tomato', 'Tomato · stale', 'A tomato with wrinkled, uneven skin on white paper.', 'deteriorated'),
    ],
}

for slug, selections in SELECTIONS.items():
    directory = ROOT / 'src/demos' / slug
    target = directory / 'samples.ts'
    if '--check' in sys.argv:
        samples = json.loads(target.read_text().split('export const samples: ImageSample[] = ', 1)[1].rsplit(';', 1)[0])
        provenance = json.loads((directory / 'provenance.json').read_text())
        assert len(samples) == len(selections) == len(provenance)
        assert len({sample['id'] for sample in samples}) == len(samples)
        for sample, record, selection in zip(samples, provenance, selections):
            image_bytes = base64.b64decode(sample['dataUrl'].split(',', 1)[1], validate=True)
            image = Image.open(io.BytesIO(image_bytes))
            assert image.format == 'JPEG' and max(image.size) <= 512 and len(image_bytes) < 60000
            assert image.size == (sample['width'], sample['height'])
            assert sample['id'] == selection[2] and sample['expected'] == selection[5]
            assert record['originalFilename'] == selection[1]
            assert record['sampleSha256'] == hashlib.sha256(image_bytes).hexdigest()
        print(f'{slug}: {len(samples)} real photo samples validated')
        continue
    samples, provenance = [], []
    for ref, filename, id_, caption, alt, expected in selections:
        dataset_url = 'https://www.kaggle.com/datasets/' + ref
        download = 'https://www.kaggle.com/api/v1/datasets/download/' + ref + '/' + quote(filename, safe='') + '?datasetVersionNumber=1'
        original = urlopen(download).read()
        image = Image.open(io.BytesIO(original)).convert('RGB')
        image.thumbnail((512, 512), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        image.save(output, format='JPEG', quality=80, optimize=True)
        encoded = output.getvalue()
        assert len(encoded) < 60000
        samples.append(dict(id=id_, caption=caption, alt=alt, expected=expected, width=image.width, height=image.height,
                            dataUrl='data:image/jpeg;base64,' + base64.b64encode(encoded).decode(),
                            sourceUrl=dataset_url + '?select=' + quote(filename, safe='')))
        provenance.append(dict(id=id_, originalFilename=filename, datasetVersion=1, downloadUrl=download,
                               originalSha256=hashlib.sha256(original).hexdigest(), sampleSha256=hashlib.sha256(encoded).hexdigest(),
                               sourceLabel=filename.rsplit('/', 1)[0], transformation='RGB conversion; longest edge at most 512 px; JPEG quality 80.'))
    target.write_text("import type { ImageSample } from '../../lib/image-demo';\n\n// Real dataset photographs; see SOURCES.md and provenance.json.\nexport const samples: ImageSample[] = " + json.dumps(samples, indent=2) + ';\n')
    (directory / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print(f'{slug}: wrote {len(samples)} samples')
