# Gravity Spy Glitch Explorer

**An interactive, zero-backend map of LIGO's gravitational-wave detector
glitches.** Pan and zoom a WebGL scatter plot of ~100k+ glitches projected from
their machine-learning classification vectors, click any point to inspect its
spectrograms, filter by a dozen parameters, and — the point of the whole thing —
*discover potential new glitch classes* by hunting for clusters where the model
is uncertain.

Every published view of this embedding space has been a static figure in a
paper. This makes it live, in a browser, for free.

> **Status: under active construction.** The app currently runs on a realistic
> **synthetic** dataset so every feature is usable end-to-end today. The
> pipeline that builds the *real* dataset from the public Gravity Spy data on
> Zenodo is included and designed to run on an ordinary machine. See
> [Data](#data) for which is which.

## Why it matters

LIGO's sensitivity is limited by noise transients called *glitches*. The
[Gravity Spy](https://www.zooniverse.org/projects/zooniverse/gravity-spy)
project sorts them into ~23 morphological classes using citizen science (2.7M
Zooniverse volunteers) plus machine learning. Each newly identified class whose
cause can be tracked down is a class LIGO can mitigate — directly improving the
detector. Today that discovery loop is slow and ad hoc. A tool that shows *where
the model is uncertain* turns "this glitch looks weird" into a visual,
shareable, reproducible search. O4 just ended (Nov 2025); O4c data is arriving;
a new run starts summer 2026. Good timing.

## Quick start (local)

No build step, no Node, no install — it's static files. You just need any web
server (Python's built-in one is perfect):

```bash
cd web
python -m http.server 8000
# open http://localhost:8000
```

## Repository layout

```
gs-glitch-explorer/
├── web/                  # the deployable static site (this is what GitHub Pages serves)
│   ├── index.html
│   ├── css/
│   ├── js/               # vanilla ES modules
│   ├── vendor/           # regl-scatterplot et al., vendored (no build step)
│   └── data/             # meta.json + glitches.bin (overview, committed); detail tier on a Release
├── pipeline/             # Python: build web/data/ from source
│   ├── make_synthetic.py # realistic synthetic dataset (numpy only)
│   ├── modal_pipeline.py # build the REAL dataset from Zenodo via Modal (cloud UMAP)
│   ├── fetch_volume.py   # pull the Modal outputs locally
│   ├── publish_data.py   # deploy: overview -> repo, detail -> GitHub Release
│   └── requirements*.txt
├── docs/                 # research notes (data layout, spectrogram URLs, ...)
├── DATA_FORMAT.md        # the pipeline <-> app data contract
└── LICENSE               # MIT
```

## Data

The data is split into two tiers (full contract in
[`DATA_FORMAT.md`](./DATA_FORMAT.md)): an **overview** (`meta.json` +
`glitches.bin`) committed under `web/data/` and loaded eagerly, and a **detail**
tier (`conf.bin`, `ids.txt`, `uuids.bin`) loaded lazily from `meta.detail.base_url`
— a GitHub Release for the real dataset, so the repo stays small as the data grows.

**Regenerate the synthetic dataset** (pure NumPy, runs anywhere):

```bash
pip install -r pipeline/requirements-min.txt
python pipeline/make_synthetic.py --n 150000 --out web/data
```

**Build the real dataset** (~677k O1–O3 glitches) from the public Gravity Spy
data on [Zenodo record 5649212](https://zenodo.org/records/5649212). UMAP on
~677k×22 needs real RAM/CPU, so it runs on [Modal](https://modal.com):

```bash
pip install -r pipeline/requirements.txt
modal run pipeline/modal_pipeline.py           # cloud: download + UMAP -> Modal volume
python pipeline/fetch_volume.py                # pull outputs -> pipeline/_data_real/
python pipeline/publish_data.py --tag data-v1  # overview -> repo, detail -> a Release
# (or: python pipeline/publish_data.py --local-only   to test the real data locally)
```

## Deploy (GitHub Pages)

Because it's pure static files, deployment is just publishing `web/`. The repo
includes a minimal GitHub Actions workflow that uploads `web/` to Pages with no
build step. Target URL:
**https://asystemoffields.github.io/gs-glitch-explorer/**

## Roadmap

- [x] Project scaffold + data contract
- [ ] Synthetic dataset generator
- [ ] Core WebGL scatter (color by class, zoom/pan, hover, click)
- [ ] Filters (class, detector, run, SNR, frequency, confidence, entropy)
- [ ] Detail panel (spectrograms, metadata, 23-class confidence breakdown)
- [ ] Discovery mode (uncertainty highlight, lasso → gallery, 23-D kNN)
- [ ] Temporal view (scrub GPS time, activity histogram)
- [ ] Stats sidebar
- [ ] Real Zenodo pipeline + spectrogram URL resolution
- [ ] Polish + deploy

## Credits & references

Built on the open data and tooling of the Gravity Spy collaboration and the
2.7M Zooniverse volunteers who classified these glitches.

- Gravity Spy: https://www.zooniverse.org/projects/zooniverse/gravity-spy · https://blog.gravityspy.org/
- ML classifications (Zenodo): https://zenodo.org/records/5649212
- Volunteer classifications (Zenodo): https://zenodo.org/records/5911227
- Glanzer et al. 2023, *Data quality up to the third observing run*: https://doi.org/10.1088/1361-6382/acb633
- Zevin et al. 2024, *Gravity Spy: lessons learned*: https://doi.org/10.1140/epjp/s13360-023-04795-4
- Wu et al. 2025, O4 classifier: https://arxiv.org/abs/2401.12913
- [regl-scatterplot](https://github.com/flekschas/regl-scatterplot) — the WebGL engine

## License

[MIT](./LICENSE) — free to use, modify, host, and build on.
