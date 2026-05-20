# Gravity Spy Glitch Explorer - Project Mission

## Purpose

Gravity Spy Glitch Explorer helps volunteers, detector-characterization
researchers, and curious observers explore the landscape of LIGO detector
glitches. The app turns Gravity Spy machine-learning confidence vectors into an
interactive map where uncertainty is visible, searchable, and shareable.

The core question is practical: where does the classifier hesitate, and do those
regions contain coherent glitch morphologies that deserve a new label or a
closer instrument investigation?

## Current Implementation

The project is a static browser app served from `web/` and deployed through
GitHub Pages. It uses vanilla ES modules, custom CSS, and vendored browser
libraries:

- `regl`
- `pub-sub-es`
- `regl-scatterplot`

The data pipeline is Python:

- `pipeline/process_data.py` builds the real O1-O3 dataset from Zenodo record
  5649212.
- `pipeline/make_synthetic.py` builds a local development dataset with the same
  schema.
- `pipeline/publish_data.py` updates `meta.detail.base_url` when the detail tier
  moves to a CORS-enabled object store.
- `pipeline/vendor_libs.py` refreshes the vendored browser libraries.

The app uses the schema-v2 binary contract in [DATA_FORMAT.md](./DATA_FORMAT.md):

- `meta.json` and `glitches.bin` load eagerly for the overview.
- `conf.bin`, `ids.txt`, and `uuids.bin` load lazily for detail panels,
  galleries, and confidence-space nearest-neighbor search.

## Current Data

The committed real dataset contains **676,613 usable glitches** from O1, O2,
O3a, and O3b, covering the H1 and L1 detectors. The confidence model has
**22 classes** in the Zenodo CSV header order:

1. 1400Ripples
2. 1080Lines
3. Air_Compressor
4. Blip
5. Chirp
6. Extremely_Loud
7. Helix
8. Koi_Fish
9. Light_Modulation
10. Low_Frequency_Burst
11. Low_Frequency_Lines
12. No_Glitch
13. None_of_the_Above
14. Paired_Doves
15. Power_Line
16. Repeating_Blips
17. Scattered_Light
18. Scratchy
19. Tomte
20. Violin_Mode
21. Wandering_Line
22. Whistle

Spectrograms are referenced through public Zooniverse Panoptes URLs stored in
the source CSV fields `url1` through `url4`. The pipeline packs their UUIDs into
`uuids.bin`, with durations ordered as 0.5, 1.0, 2.0, and 4.0 seconds.

## User Workflows

### Explore The Map

- Pan and zoom the UMAP embedding.
- Hover points for class, confidence, SNR, peak frequency, detector, run, and
  entropy.
- Click a point to open the detail panel.

### Filter The Population

Filters are AND-combined:

- Class checkboxes with counts and color swatches
- Detector segmented control
- Observing-run checkboxes
- SNR log-range slider
- Peak-frequency log-range slider
- Assigned-class confidence range
- Entropy range
- Temporal window from the time scrubber

Filtered-out points remain as faint spatial context.

### Inspect A Glitch

The detail panel shows:

- Four spectrogram durations when available
- Gravity Spy ID
- ML class and assigned-class confidence
- Entropy, SNR, peak frequency, detector, observing run, GPS, and UTC
- 22-class confidence breakdown
- Pin/unpin for comparison
- Find-similar action using cosine similarity over the 22 confidence bytes

### Search For Candidate Classes

Discovery mode supports:

- Uncertainty highlighting by entropy threshold
- Lasso selection
- Spectrogram gallery for selected points
- Nearest-neighbor gallery in confidence space

The intended use is to lower the confidence range, raise the entropy range,
highlight uncertain points, and lasso coherent regions for visual comparison.

### Explore Time

The temporal view provides:

- GPS/UTC date window selection
- Activity histogram
- Play/pause animation through the observing span

## Operating Context

The LIGO-Virgo-KAGRA fourth observing run, O4, ended on November 18, 2025.
According to the [IGWN observing plan](https://observing.docs.ligo.org/plan/)
updated April 17, 2026, the collaboration is planning a six-month intermediate
run, IR1, beginning in late October or mid-November 2026. O5 planning is being
reassessed.

For this project, the practical implication is clear: O1-O3 data is already
explorable, and the pipeline/data contract should stay ready for future Gravity
Spy releases that add O4, IR1, or new classifier classes.

## Maintenance Commands

Run the app locally:

```bash
cd web
python -m http.server 8000
```

Generate synthetic development data:

```bash
pip install -r pipeline/requirements-min.txt
python pipeline/make_synthetic.py --n 150000 --out web/data
```

Rebuild the real dataset:

```bash
pip install -r pipeline/requirements-lock.txt
python pipeline/process_data.py --out web/data
```

Move detail files to a CORS-enabled bucket:

```bash
python pipeline/publish_data.py --src web/data --base-url https://<bucket-host>/gs/
```

Refresh vendored browser libraries:

```bash
pip install requests
python pipeline/vendor_libs.py
```

## Automation

- `.github/workflows/update-data.yml` checks the configured Zenodo record weekly
  and on manual dispatch. When the upstream timestamp changes, it rebuilds
  `web/data/`, commits the results, and triggers the deploy workflow.
- `.github/workflows/deploy-pages.yml` publishes `web/` to GitHub Pages.

## Remaining Work

- Polish touch/mobile interactions.
- Move the detail tier to CORS-enabled object storage when future datasets grow.
- Add volunteer-agreement metadata from Zenodo record 5911227 when it supports a
  concrete analysis workflow.
- Extend `process_data.py` for O4/IR1 Gravity Spy releases when compatible files
  are published.
- Add a small browser smoke test that loads the app, verifies `meta.json`, and
  checks that the scatter canvas draws non-empty pixels.

## Success Criteria

1. A researcher can open the app, see the O1-O3 glitch landscape, and identify
   class structure quickly.
2. A volunteer can click a point and inspect its spectrograms and confidence
   breakdown.
3. A user can isolate low-confidence or high-entropy points, lasso a cluster,
   and compare the selected spectrograms.
4. The data contract can absorb future Gravity Spy runs with minimal app changes.

## Relevant Links

- Gravity Spy: <https://www.zooniverse.org/projects/zooniverse/gravity-spy>
- Gravity Spy blog: <https://blog.gravityspy.org/>
- GravitySpy GitHub: <https://github.com/Gravity-Spy/GravitySpy>
- GravitySpy docs: <https://gravity-spy.github.io/>
- Zenodo ML classifications: <https://zenodo.org/records/5649212>
- Zenodo volunteer classifications: <https://zenodo.org/records/5911227>
- IGWN observing plans: <https://observing.docs.ligo.org/plan/>
- LIGO O4 completion news:
  <https://www.ligo.caltech.edu/WA/news/ligo20251118>
- Glanzer et al. 2023:
  <https://doi.org/10.1088/1361-6382/acb633>
- Zevin et al. 2024:
  <https://doi.org/10.1140/epjp/s13360-023-04795-4>
- GWpy documentation: <https://gwpy.github.io/>
