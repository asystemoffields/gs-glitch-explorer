# Gravity Spy Glitch Explorer

Interactive WebGL map of **676,613 O1-O3 Gravity Spy glitches** from Zenodo
record 5649212. Pan and zoom the UMAP embedding, filter by class, detector,
observing run, SNR, peak frequency, confidence, entropy, and time, then click
any point to inspect spectrograms and the 22-class confidence breakdown.

The discovery workflow is built around uncertainty: lower the ML-confidence
range, raise the entropy range, highlight uncertain points, lasso a cluster, and
open a gallery of spectrograms that share the same morphology. The app also
supports nearest-neighbor search in the original 22-dimensional confidence
space, giving users both the 22-D model view and the 2D map for comparison.

## Status

The published app ships the real O1-O3 Gravity Spy ML dataset from
[Zenodo record 5649212](https://zenodo.org/records/5649212), using schema v2 of
the binary data contract in [DATA_FORMAT.md](./DATA_FORMAT.md). A NumPy-only
synthetic generator remains available for local development, demos, and tests.

The LIGO-Virgo-KAGRA fourth observing run ended on November 18, 2025. The
[IGWN observing plan](https://observing.docs.ligo.org/plan/) update from
April 17, 2026 names a six-month intermediate run, IR1, planned for late October
or mid-November 2026, with O5 timing under reassessment. This project is ready
for future Gravity Spy releases by updating the pipeline file list and the
data contract metadata.

## Quick Start

Serve the static app over HTTP from `web/`:

```bash
cd web
python -m http.server 8000
```

Open <http://localhost:8000>.

## Repository Layout

```text
gs-glitch-explorer/
|-- .github/workflows/     # data rebuild and GitHub Pages deploy workflows
|-- web/                   # deployable static site
|   |-- index.html
|   |-- css/
|   |-- js/                # vanilla ES modules
|   |-- vendor/            # vendored regl-scatterplot stack
|   `-- data/              # current schema-v2 dataset
|-- pipeline/              # Python data builders and publishing helpers
|   |-- make_synthetic.py  # local synthetic dataset generator
|   |-- process_data.py    # real Zenodo -> binary web/data build
|   |-- publish_data.py    # same-origin or object-store detail hosting helper
|   |-- vendor_libs.py     # refresh vendored browser libraries
|   `-- requirements*.txt
|-- docs/
|   `-- DATA_NOTES.md      # source-data notes and field mapping
|-- DATA_FORMAT.md         # pipeline <-> app data contract
|-- GRAVITY_SPY_GLITCH_EXPLORER_MISSION.md
`-- LICENSE
```

## Data

The app uses two tiers:

- **Overview tier:** `meta.json` and `glitches.bin`, loaded on startup from
  `web/data/`. This contains coordinates and scalar columns for the scatter
  plot, filters, discovery highlight, temporal view, and stats.
- **Detail tier:** `conf.bin`, `ids.txt`, and `uuids.bin`, loaded lazily from
  `meta.detail.base_url`. The committed dataset serves these files same-origin
  from `web/data/`; a CORS-enabled object store can host them for larger future
  releases.

Current committed build:

- Source: `gravityspy-zenodo-5649212`
- Glitches: `676,613`
- Confidence classes: `22`
- Spectrograms: public Zooniverse Panoptes PNG URLs packed as UUIDs
- Approximate data size: 86 MB across overview and detail files

### Generate Synthetic Data

```bash
pip install -r pipeline/requirements-min.txt
python pipeline/make_synthetic.py --n 150000 --out web/data
```

Synthetic data has the same schema as the real build and includes a hidden
high-entropy cluster for exercising the discovery workflow.

### Build The Real Dataset

```bash
pip install -r pipeline/requirements-lock.txt
python pipeline/process_data.py --out web/data
```

`process_data.py` downloads and validates the eight CSV files in Zenodo record
5649212, builds a 22-dimensional confidence matrix, computes entropy, runs UMAP,
packs spectrogram UUIDs, and writes the schema-v2 files into `web/data/`.

### Host Detail Data Off-Repo

For larger future datasets, move the detail tier to a public bucket with CORS
allowing `GET` from the site origin:

```bash
python pipeline/publish_data.py --src web/data --base-url https://<bucket-host>/gs/
```

Then upload `conf.bin`, `ids.txt`, and `uuids.bin` to that base URL and commit
the updated `web/data/meta.json` plus `web/data/glitches.bin`.

Minimal bucket CORS policy:

```json
[{ "AllowedOrigins": ["https://asystemoffields.github.io"],
   "AllowedMethods": ["GET"], "AllowedHeaders": ["range"] }]
```

The browser fetches `meta.json` fresh and appends `?v=<meta.version>` to large
data files, so a new pipeline build invalidates cached bytes.

## Automation And Deploy

- `.github/workflows/update-data.yml` checks the configured Zenodo record weekly
  and on manual dispatch. When the upstream timestamp changes, it rebuilds
  `web/data/`, commits the updated data, and triggers the Pages deploy workflow.
- `.github/workflows/deploy-pages.yml` publishes `web/` to GitHub Pages.

Target URL: <https://asystemoffields.github.io/gs-glitch-explorer/>

To track a future Gravity Spy record, update `REC` and `FILES` in
`pipeline/process_data.py` so the workflow reads the new Zenodo file set.

## Feature Checklist

- [x] Static app scaffold and schema-v2 binary data contract
- [x] Synthetic dataset generator
- [x] Real Zenodo pipeline with UMAP and spectrogram URL packing
- [x] Vendored WebGL scatter stack
- [x] Core scatter interactions: color by class, zoom, pan, hover, click
- [x] Filters: class, detector, run, SNR, frequency, confidence, entropy
- [x] Detail panel: spectrograms, metadata, and 22-class confidence breakdown
- [x] Discovery tools: uncertainty highlight, lasso gallery, 22-D kNN
- [x] Temporal view with scrubber and activity histogram
- [x] Stats sidebar and theme toggle
- [ ] Mobile interaction polish
- [ ] Scalable off-repo detail hosting for larger future releases
- [ ] O4/IR1 data ingestion when compatible Gravity Spy releases are available

## Credits And References

Built on open data and tooling from Gravity Spy, Zooniverse, and the LIGO
Scientific Collaboration.

- Gravity Spy: <https://www.zooniverse.org/projects/zooniverse/gravity-spy>
- Gravity Spy blog: <https://blog.gravityspy.org/>
- ML classifications: <https://zenodo.org/records/5649212>
- Volunteer classifications: <https://zenodo.org/records/5911227>
- Glanzer et al. 2023, *Data quality up to the third observing run*:
  <https://doi.org/10.1088/1361-6382/acb633>
- Zevin et al. 2024, *Gravity Spy: lessons learned*:
  <https://doi.org/10.1140/epjp/s13360-023-04795-4>
- IGWN observing plans: <https://observing.docs.ligo.org/plan/>
- LIGO O4 completion news: <https://www.ligo.caltech.edu/WA/news/ligo20251118>
- regl-scatterplot: <https://github.com/flekschas/regl-scatterplot>

## License

- Code, UI, and pipeline scripts: [MIT](./LICENSE).
- Generated Gravity Spy data and image URLs: CC-BY-4.0 from Gravity Spy and the
  LIGO Scientific Collaboration. Attribute Gravity Spy and cite Glanzer et al.
  2023 when reusing the dataset.
