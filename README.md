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
│   ├── process_data.py   # build the REAL dataset from Zenodo (UMAP; runs free on Actions)
│   ├── publish_data.py   # deploy helper (same-origin / R2 base_url / Release)
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
— served same-origin from Pages today; a CORS object store (R2) can host it
off-repo at scale (see *Hosting note* below).

**Regenerate the synthetic dataset** (pure NumPy, runs anywhere):

```bash
pip install -r pipeline/requirements-min.txt
python pipeline/make_synthetic.py --n 150000 --out web/data
```

**Build the real dataset** (~677k O1–O3 glitches) from the public Gravity Spy
data on [Zenodo record 5649212](https://zenodo.org/records/5649212). UMAP on
~677k×22 needs a few GB of RAM — the **free GitHub Actions runner** does it (see
*Auto-update* below), or run it on any machine with enough RAM:

```bash
pip install -r pipeline/requirements.txt
python pipeline/process_data.py --out web/data   # download + UMAP -> web/data/
# then commit web/data/ and push — GitHub Pages deploys it.
```

> **Hosting note:** the detail tier is currently committed and served
> **same-origin** from Pages, because GitHub *Release* assets don't send CORS
> headers (so a browser can't `fetch()` them cross-origin). `publish_data.py
> --tag` (detail → a Release) is kept for reference; the scalable path for a
> much larger dataset is a CORS-enabled object store (e.g. Cloudflare R2) set as
> `meta.detail.base_url`.

To move the detail tier off-repo at scale: create a public bucket (e.g. Cloudflare
R2) with a CORS rule allowing `GET` from the site origin, then:

```bash
python pipeline/publish_data.py --base-url https://<bucket-host>/gs/
# upload pipeline/_data_real/{conf.bin,ids.txt,uuids.bin} to that base URL, then:
git add web/data && git commit -m "data: host detail tier on R2" && git push
```

Minimal bucket CORS policy:

```json
[{ "AllowedOrigins": ["https://asystemoffields.github.io"],
   "AllowedMethods": ["GET"], "AllowedHeaders": ["range"] }]
```

The app requests detail with `?v=<meta.version>`, so the bucket can cache aggressively.

### Auto-update (free)

`.github/workflows/update-data.yml` checks the upstream Zenodo record weekly (and
on manual dispatch); if it changed, it rebuilds the dataset **on the free GitHub
Actions runner** — UMAP and all, no paid service and no secrets — republishes,
and redeploys. To track a new observing run, set `REC` + `FILES` in
`pipeline/process_data.py`.

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
