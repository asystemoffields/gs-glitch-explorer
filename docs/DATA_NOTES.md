# Data Notes - Real Gravity Spy Data

These notes summarize the source data used by `pipeline/process_data.py` and the
schema in [DATA_FORMAT.md](../DATA_FORMAT.md).

## Summary

- Source record: Gravity Spy ML classifications,
  [Zenodo 5649212](https://zenodo.org/records/5649212), DOI
  `10.5281/zenodo.5649212`, CC-BY-4.0.
- Current committed build: **676,613 usable glitches** after filtering rows with
  non-finite scalars, non-finite confidence values, or all-zero confidence.
- Runs and detectors: O1, O2, O3a, O3b for H1 and L1.
- Confidence space: **22 columns** in fixed CSV header order, including
  `None_of_the_Above`.
- Spectrogram URLs: public Zooniverse Panoptes PNG URLs in `url1` through
  `url4`; the pipeline stores their opaque UUIDs in `uuids.bin`.
- Volunteer classifications in
  [Zenodo 5911227](https://zenodo.org/records/5911227) remain optional for this
  app. They can add volunteer agreement metadata through a join on
  `gravityspy_id`.

## Record 5649212 - ML Classifications

Download through the Zenodo REST API:

```text
https://zenodo.org/api/records/5649212/files/{filename}/content
```

The pipeline reads these eight CSVs:

| File | Approx. MB | File | Approx. MB |
|------|------------|------|------------|
| `H1_O1.csv` | 16.0 | `H1_O3a.csv` | 90.2 |
| `L1_O1.csv` | 27.2 | `L1_O3a.csv` | 142.3 |
| `H1_O2.csv` | 73.1 | `H1_O3b.csv` | 111.6 |
| `L1_O2.csv` | 65.8 | `L1_O3b.csv` | 216.1 |

The file naming pattern is `{IFO}_{ERA}.csv`. The pipeline validates cached
downloads against Zenodo-provided size and checksum metadata before reading.

## CSV Schema

Each CSV has 43 columns:

- Omicron metadata:
  `event_time`, `ifo`, `peak_time`, `peak_time_ns`, `start_time`,
  `start_time_ns`, `duration`, `peak_frequency`, `central_freq`, `bandwidth`,
  `channel`, `amplitude`, `snr`, `q_value`
- Identifier:
  `gravityspy_id`
- ML confidence columns, in this exact order:
  `1400Ripples`, `1080Lines`, `Air_Compressor`, `Blip`, `Chirp`,
  `Extremely_Loud`, `Helix`, `Koi_Fish`, `Light_Modulation`,
  `Low_Frequency_Burst`, `Low_Frequency_Lines`, `No_Glitch`,
  `None_of_the_Above`, `Paired_Doves`, `Power_Line`, `Repeating_Blips`,
  `Scattered_Light`, `Scratchy`, `Tomte`, `Violin_Mode`, `Wandering_Line`,
  `Whistle`
- ML label fields:
  `ml_label`, `ml_confidence`
- Image URLs:
  `url1`, `url2`, `url3`, `url4`

Field mapping used by the app:

| App field | CSV source |
|-----------|------------|
| GPS time | `event_time` |
| detector | `ifo` |
| observing run | filename era |
| SNR | `snr` |
| peak frequency | `peak_frequency` |
| confidence vector | 22 confidence columns above |
| label index | argmax of the normalized confidence vector |
| image UUIDs | `url1` through `url4` |

The argmax label keeps color, entropy, and kNN in the same 22-dimensional model
space. `ml_label` and `ml_confidence` can be preserved in a future schema if
exact provenance labels become useful in the UI.

## Spectrogram URLs

The CSV image fields point to PNGs like:

```text
https://panoptes-uploads.zooniverse.org/production/subject_location/{UUID}.png
```

The UUID is an opaque 36-character Panoptes subject-location identifier. The
pipeline strips the constant prefix and suffix, packs the 16 raw UUID bytes, and
uses all-zero bytes for missing values such as `""` or `"?"`.

Duration mapping:

| CSV column | Duration |
|------------|----------|
| `url1` | 0.5 s |
| `url2` | 1.0 s |
| `url3` | 2.0 s |
| `url4` | 4.0 s |

The current `uuids.bin` is 43,303,232 bytes:
`676,613 glitches * 4 durations * 16 bytes`.

The Zooniverse-hosted images are public PNGs. The app fetches them lazily in
detail and gallery views.

## Record 5911227 - Volunteer Classifications

The volunteer record contains
`retired_fulldata_min2_max50_ret0p9.hdf5` (about 1.08 GB), loadable with:

```python
pd.read_hdf("retired_fulldata_min2_max50_ret0p9.hdf5", key="image_db")
```

Relevant fields include 22 ML scores, `ml_label`, `ml_confidence`,
`final_label`, `final_score`, `Nclassifications`, `retired`, `tracks`,
`gravityspy_id`, and project `id`. Join to record 5649212 on `gravityspy_id` for
spectrogram URLs.

The HDF5 `id` to Panoptes subject-id relationship needs confirmation before it
is used for API lookups.

## Pipeline Notes

`pipeline/process_data.py` performs the real build:

1. Fetch and validate the eight CSV files into the raw cache directory.
2. Concatenate frames and tag run from the filename.
3. Drop rows with non-finite `snr`, `peak_frequency`, `event_time`, non-finite
   confidence values, or all-zero confidence.
4. Normalize the 22 confidence columns row-wise.
5. Compute Shannon entropy and assigned-class confidence.
6. Run UMAP with `n_neighbors=15`, `min_dist=0.1`, and `metric="cosine"`.
7. Pack the schema-v2 overview columns into `glitches.bin`.
8. Pack confidence bytes into `conf.bin`, fixed-width IDs into `ids.txt`, and
   spectrogram UUIDs into `uuids.bin`.
9. Write `meta.json`, including a content hash in `version`.

`pipeline/make_synthetic.py` writes the same schema for development data. Its
`images.available` flag is false, so it writes `meta.json`, `glitches.bin`,
`conf.bin`, and `ids.txt`.

## Attribution

Data: Gravity Spy (Zooniverse) and the LIGO Scientific Collaboration,
CC-BY-4.0. Cite Glanzer et al. 2023, *Classical and Quantum Gravity* 40 065004,
doi: [10.1088/1361-6382/acb633](https://doi.org/10.1088/1361-6382/acb633).
Spectrograms are served from Zooniverse Panoptes.

## Future Data Work

- Add volunteer agreement fields from Zenodo 5911227 when the UI needs them.
- Update `CONF_COLS`, `PALETTE`, and `FILES` when a future Gravity Spy release
  adds observing runs or model classes.
- Move the detail tier to a CORS-enabled object store when dataset size grows
  beyond the practical GitHub Pages repository budget.
