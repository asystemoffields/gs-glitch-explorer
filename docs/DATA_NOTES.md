# Data Notes — authoritative facts about the real Gravity Spy data

Compiled from primary sources (Zenodo REST API, the dataset README, the GravitySpy
package source, GWpy's downloader, and the live Panoptes API). These facts drive
the pipeline (`pipeline/process_data.py`) and the data contract in `../DATA_FORMAT.md`.

> **Two corrections to the original mission spec are baked in here:** the
> confidence vectors are **22-dimensional, not 23** (and the class set differs);
> and spectrogram URLs are **stored opaque UUIDs**, not a template over the id.

## TL;DR

- **Spectrogram URLs are present and public.** Record 5649212's CSVs have
  `url1..url4` → `https://panoptes-uploads.zooniverse.org/production/subject_location/{UUID}.png`.
  Verified `200 / image/png`, no auth, 800×600. License **CC-BY-4.0** (cite Glanzer
  et al. 2023). UUIDs are opaque ⇒ must be stored per glitch (no template).
- **22 confidence classes**, in a fixed CSV column order, including
  `None_of_the_Above`; **not** `Fast_Scattering` / `Low_Frequency_Blip`.
- The 8 CSVs (~742 MB, ~710k glitches) carry everything we need; the 1.08 GB
  volunteer HDF5 is optional for v1.

## Record 5649212 — ML classifications (O1–O3) · CC-BY-4.0

DOI `10.5281/zenodo.5649212`. Download a file:
`https://zenodo.org/api/records/5649212/files/{filename}/content`

| File | MB | | File | MB |
|------|----|-|------|----|
| H1_O1.csv | 16.0 | | H1_O3a.csv | 90.2 |
| L1_O1.csv | 27.2 | | L1_O3a.csv | 142.3 |
| H1_O2.csv | 73.1 | | H1_O3b.csv | 111.6 |
| L1_O2.csv | 65.8 | | L1_O3b.csv | 216.1 |

Naming `{IFO}_{ERA}.csv`, IFO ∈ {H1, L1}, ERA ∈ {O1, O2, O3a, O3b}. **No Virgo.**
~710k rows total (size-based estimate, not exact).

### CSV schema — 43 columns, exact order

- **Omicron metadata (0–13):** `event_time, ifo, peak_time, peak_time_ns,
  start_time, start_time_ns, duration, peak_frequency, central_freq, bandwidth,
  channel, amplitude, snr, q_value`
- **ID (14):** `gravityspy_id` (e.g. `AznPHIC56V`)
- **22 ML confidence columns (15–36), sum to 1, this exact order:**
  `1400Ripples, 1080Lines, Air_Compressor, Blip, Chirp, Extremely_Loud, Helix,
  Koi_Fish, Light_Modulation, Low_Frequency_Burst, Low_Frequency_Lines, No_Glitch,
  None_of_the_Above, Paired_Doves, Power_Line, Repeating_Blips, Scattered_Light,
  Scratchy, Tomte, Violin_Mode, Wandering_Line, Whistle`
- **ML label (37–38):** `ml_label, ml_confidence`
- **Image URLs (39–42):** `url1, url2, url3, url4`

Field mapping vs. the original spec: `peakGPS` → use **`event_time`** (float GPS)
or `peak_time` (int s); `snr` → `snr`; `peak_frequency` → `peak_frequency`;
`Label` → `ml_label`. The mission spec's "23 classes incl. Fast_Scattering /
Low_Frequency_Blip" does **not** match these confidence columns — use the 22 above
(README: *"use the original 22 classes in all cases"*).

## Record 5911227 — volunteer classifications · CC-BY-4.0

One file `retired_fulldata_min2_max50_ret0p9.hdf5` (1.08 GB), `key='image_db'`:
22 ML scores + `ml_label`, `ml_confidence`, `final_label`, `final_score`,
`Nclassifications`, `retired`, `tracks`, `gravityspy_id`, project `id`.
**No image URLs.** Join to 5649212 on `gravityspy_id` for images. (Whether the
HDF5 `id` equals a Panoptes subject_id is **unconfirmed** — don't rely on it.)
Optional for v1: only needed for volunteer-agreement metadata.

## Spectrogram URLs

- Pattern: `https://panoptes-uploads.zooniverse.org/production/subject_location/{UUID}.png`
  — `{UUID}` is a random 36-char Zooniverse-assigned id, **not** derivable from
  anything. GravitySpy captured it from the Panoptes subject after upload; GWpy's
  downloader just **reads** `url1..url4`, it does not construct them.
- Duration mapping (Zenodo README + GWpy `DURATIONS=(0.5,1.0,2.0,4.0)`):
  **url1 = 0.5 s, url2 = 1.0 s, url3 = 2.0 s, url4 = 4.0 s.**
- Missing URLs: some rows have `""` or `"?"` — treat as "no image".
- Public, no auth. No documented numeric rate limit, but the README warns against
  bulk-downloading many images; the app fetches lazily from the CDN on demand.
- Storage: persist the 4 UUIDs/glitch (strip the constant prefix/suffix). Across
  ~710k glitches that's ~100 MB of URL data, so subsample and/or store UUIDs only.

## Pipeline implementation (`process_data.py`)

1. Download the 8 CSVs (cache to `pipeline/data_raw/`); concat with an `ifo`/`run`
   tag (run from the filename, not GPS — more reliable, though GPS works too).
2. Confidence matrix = the 22 columns **in header order** → `classes` list.
3. `label_idx` = **argmax of the 22 confidence columns** (v1 choice — keeps the
   colour/label space identical to the confidence/entropy/kNN space). `ml_label`
   is available if exact provenance is ever preferred; a future stray class
   (e.g. `Fast_Scattering`) would be appended to `classes` as colour-only.
4. entropy = Shannon entropy of each 22-vector.
5. UMAP (`n_neighbors=15, min_dist=0.1, metric='cosine'`) on the 22-vectors → x,y.
6. gps from `event_time`; run from filename; ifo from `ifo`.
7. Extract `url1..url4` → strip prefix/suffix, hex → **16 bytes** each → 4 packed
   UUIDs/glitch (all-zero = missing).
8. No subsample needed — the two-tier layout serves all ~677k (overview in the
   repo, detail on a Release; shard detail by run when it outgrows Pages' caps).
9. Emit the `DATA_FORMAT.md` files into `web/data/`.

## Attribution (must appear in README + app footer)

Data: Gravity Spy (Zooniverse) & the LIGO Scientific Collaboration, CC-BY-4.0.
Cite **Glanzer et al. 2023**, *Class. Quantum Grav.* 40 065004,
doi:10.1088/1361-6382/acb633. Spectrograms © their respective sources, served
from Zooniverse Panoptes.

## Open uncertainties

- Exact total row count (~710k is size-estimated).
- Whether HDF5 `id` == Panoptes subject_id (unconfirmed).
- Exact `ml_label` value set (22 vs a few extra) — resolve from the data at runtime.
