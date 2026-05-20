# Data Format — the pipeline ⇄ app contract (schema v2)

The pipeline writes static files; the web app fetches and decodes them. This is
the **single source of truth** for that contract. The data is split into **two
tiers**:

- **Overview** — committed to the repo under `web/data/`, loaded **eagerly**.
  Everything the scatter, filters, discovery highlight, and temporal view need.
- **Detail** — loaded **lazily**, on the first detail/gallery/kNN interaction,
  from `meta.detail.base_url`. Empty `base_url` ⇒ same-origin `web/data/` (the
  synthetic dataset, and local testing). For the real dataset it points at a
  CDN (a GitHub Release), so the dataset can grow without bloating the Pages
  repo or blocking initial render.

All multi-byte numbers are **little-endian** (what browser `TypedArray` views
assume on mainstream platforms; the pipeline writes `<`-typed NumPy arrays).

## Files

| Tier | File | Location | Loaded | Purpose |
|------|------|----------|--------|---------|
| overview | `meta.json` | `web/data/` | eager | schema, class list + colors, ranges, detail/image config |
| overview | `glitches.bin` | `web/data/` | eager | per-glitch scalar columns (scatter / filters / discovery / temporal) |
| detail | `conf.bin` | `base_url` | lazy | 22-D confidence matrix (detail bar chart + 22-D kNN) |
| detail | `ids.txt` | `base_url` | lazy | fixed-width `gravityspy_id`s |
| detail | `uuids.bin` | `base_url` | lazy | packed spectrogram UUIDs (only if `images.available`) |

## `meta.json`

```jsonc
{
  "schema_version": 2,
  "source": "gravityspy-zenodo-5649212",   // or "synthetic"
  "total_glitches": 676613,                 // = N
  "id_length": 10,
  "classes":     ["1400Ripples", "1080Lines", "...", "Whistle"],  // 22; CSV confidence-column order
  "class_colors":["#ffd60a", "#ff9f0a", "...", "#ffbf8a"],         // parallel to classes
  "runs": ["O1", "O2", "O3a", "O3b"],
  "ifos": ["H1", "L1"],
  "bounds": { "xmin": -.., "xmax": .., "ymin": .., "ymax": .. },   // for normalising x/y to [-1,1]
  "snr":  { "min": .., "max": .. },          // floored/ceiled so the full-range filter encloses all
  "freq": { "min": .., "max": .. },
  "gps":  { "min": .., "max": .. },
  "gps_base": 1126400000,                    // gps_off in glitches.bin is (gps - gps_base)

  "detail": {                                // where the lazy detail tier lives
    "base_url": "",                          // "" => same-origin web/data/ (current); else a CORS-enabled CDN/object-store URL
    "conf_file": "conf.bin",
    "ids_file": "ids.txt",
    "uuids_file": "uuids.bin",
    "uuid_bytes": 16
  },
  "images": {                                // spectrograms; false => metadata-only detail panel
    "available": true,
    "prefix": "https://panoptes-uploads.zooniverse.org/production/subject_location/",
    "suffix": ".png",
    "durations": ["0.5", "1.0", "2.0", "4.0"]  // url1=0.5s … url4=4.0s
  }
}
```

A new glitch class is just one more entry in `classes` + `class_colors` (and one
more `conf.bin` column). No app code changes — the UI is data-driven.

## `glitches.bin` — overview, column-major

A single buffer of column-major arrays, each length `N`, concatenated in order.

| # | Column | Type | Notes |
|---|--------|------|-------|
| 1 | `x` | Float32 | UMAP x |
| 2 | `y` | Float32 | UMAP y |
| 3 | `snr` | Float32 | signal-to-noise ratio |
| 4 | `peak_freq` | Float32 | Hz |
| 5 | `entropy` | Float32 | Shannon entropy of the confidence vector |
| 6 | `confidence` | Float32 | assigned-class confidence (= row max) |
| 7 | `gps_off` | Uint32 | `gps - gps_base` |
| 8 | `label_idx` | Uint8 | index into `classes` |
| 9 | `run_idx` | Uint8 | index into `runs` |
| 10 | `ifo_idx` | Uint8 | index into `ifos` |

**31 bytes/glitch.** The six Float32 columns occupy `[0, 24N)`, the Uint32
`[24N, 28N)`, the three Uint8 columns `[28N, 31N)` — every 4-byte column is
4-byte aligned, so these JS views are valid:

```js
const buf = await (await fetch('data/glitches.bin')).arrayBuffer();
let o = 0;
const f32 = (n) => { const a = new Float32Array(buf, o, n); o += n*4; return a; };
const u32 = (n) => { const a = new Uint32Array(buf, o, n); o += n*4; return a; };
const u8  = (n) => { const a = new Uint8Array(buf, o, n);  o += n;   return a; };
const col = { x:f32(N), y:f32(N), snr:f32(N), peakFreq:f32(N), entropy:f32(N),
              confidence:f32(N), gpsOff:u32(N), labelIdx:u8(N), runIdx:u8(N), ifoIdx:u8(N) };
```

## `conf.bin` — detail: confidence matrix, row-major

`N × C` **Uint8** (`C = classes.length`, normally 22), row-major: glitch `i`'s
vector is `conf[i*C : i*C+C]`, column `j` ↔ `classes[j]`, each byte `round(p*255)`
(divide by 255 to recover). **22 bytes/glitch.**

## `ids.txt` — detail: fixed-width ids

`N * id_length` ASCII chars, no delimiters. `gravityspy_id` of glitch `i` =
`ids.slice(i*L, (i+1)*L).trim()`.

## `uuids.bin` — detail: packed spectrogram UUIDs

Present only when `images.available`. **`N × 4 × 16` bytes**, row-major with 4
entries per glitch (durations in `images.durations` order). A UUID is stored as
its 16 raw bytes (hyphens dropped, hex → bytes); **all-zero = no image**. Rebuild
the URL:

```js
const off = (i*4 + d) * 16;                       // glitch i, duration index d
let hex = '', any = false;
for (let k = 0; k < 16; k++) { const b = uuids[off+k]; if (b) any = true; hex += b.toString(16).padStart(2,'0'); }
const url = any
  ? meta.images.prefix +
    `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}` +
    meta.images.suffix
  : null;                                          // -> "image unavailable" placeholder
```

(16 bytes/UUID × 4 = **64 bytes/glitch** — half the size of storing the 36-char
text form. Source URLs are the Zenodo CSV `url1..url4` columns; see
`docs/DATA_NOTES.md`. `<img>` loads them cross-origin without CORS.)
