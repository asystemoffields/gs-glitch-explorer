# Data Format - Pipeline/App Contract (Schema v2)

The pipeline writes static files and the browser decodes them with `TypedArray`
views. The current schema splits the dataset into two tiers:

- **Overview:** committed under `web/data/` and loaded eagerly. This tier powers
  the scatter plot, filters, discovery highlight, temporal view, and stats.
- **Detail:** loaded lazily from `meta.detail.base_url` on detail, gallery, and
  nearest-neighbor interactions. An empty `base_url` resolves to same-origin
  `web/data/`; a CORS-enabled object store can host the same files at scale.

Multi-byte numbers are little-endian. The Python pipeline writes NumPy arrays
with explicit `<` dtypes, matching the byte order that browser typed arrays use
on mainstream platforms.

## Files

| Tier | File | Location | Loaded | Purpose |
|------|------|----------|--------|---------|
| overview | `meta.json` | `web/data/` | eager | schema, version, class list/colors, ranges, detail/image config |
| overview | `glitches.bin` | `web/data/` | eager | per-glitch scalar columns for scatter, filters, discovery, temporal views |
| detail | `conf.bin` | `base_url` | lazy | `N x C` confidence matrix for detail bars and 22-D kNN |
| detail | `ids.txt` | `base_url` | lazy | fixed-width `gravityspy_id` strings |
| detail | `uuids.bin` | `base_url` | lazy/ranged | packed spectrogram UUIDs when `images.available` is true |

The committed real build contains 676,613 glitches. Its file sizes are
deterministic from the schema: `glitches.bin` is `31N`, `conf.bin` is `22N`,
`ids.txt` is `10N`, and `uuids.bin` is `64N`.

## `meta.json`

```jsonc
{
  "schema_version": 2,
  "version": "088035d3f1c6",              // content hash used for cache-busting
  "source": "gravityspy-zenodo-5649212",  // or "synthetic"
  "total_glitches": 676613,               // = N
  "id_length": 10,

  "classes": [
    "1400Ripples", "1080Lines", "Air_Compressor", "Blip",
    "...", "Whistle"
  ],
  "class_colors": ["#ffd60a", "#ff9f0a", "...", "#ffbf8a"],
  "runs": ["O1", "O2", "O3a", "O3b"],
  "ifos": ["H1", "L1"],

  "bounds": { "xmin": -15, "xmax": 34, "ymin": -19, "ymax": 26 },
  "snr":  { "min": 7.5, "max": 156629.938 },
  "freq": { "min": 10.008, "max": 2047.107 },
  "gps":  { "min": 1126402868, "max": 1269029954 },
  "gps_base": 1126400000,

  "detail": {
    "base_url": "",
    "conf_file": "conf.bin",
    "ids_file": "ids.txt",
    "uuids_file": "uuids.bin",
    "uuid_bytes": 16
  },
  "images": {
    "available": true,
    "prefix": "https://panoptes-uploads.zooniverse.org/production/subject_location/",
    "suffix": ".png",
    "durations": ["0.5", "1.0", "2.0", "4.0"]
  }
}
```

Synthetic builds may also include `generated_at` and `synthetic_info`. The app
uses the shared schema fields above and ignores extra metadata.

Adding classes means extending `classes`, `class_colors`, and the confidence
matrix width together. The UI derives class controls, colors, bars, and kNN
dimension from `meta.classes.length`.

## `glitches.bin` - Overview, Column-Major

A single buffer of column-major arrays, each length `N`, concatenated in order.

| # | Column | Type | Notes |
|---|--------|------|-------|
| 1 | `x` | Float32 | UMAP x |
| 2 | `y` | Float32 | UMAP y |
| 3 | `snr` | Float32 | signal-to-noise ratio |
| 4 | `peak_freq` | Float32 | Hz |
| 5 | `entropy` | Float32 | Shannon entropy of the confidence vector |
| 6 | `confidence` | Float32 | assigned-class confidence, `row max` |
| 7 | `gps_off` | Uint32 | `gps - gps_base` |
| 8 | `label_idx` | Uint8 | index into `classes` |
| 9 | `run_idx` | Uint8 | index into `runs` |
| 10 | `ifo_idx` | Uint8 | index into `ifos` |

The layout is **31 bytes/glitch**. The six Float32 columns occupy `[0, 24N)`,
the Uint32 column occupies `[24N, 28N)`, and the three Uint8 columns occupy
`[28N, 31N)`. All 4-byte columns are 4-byte aligned.

```js
const buf = await (await fetch('data/glitches.bin')).arrayBuffer();
let o = 0;
const f32 = (n) => { const a = new Float32Array(buf, o, n); o += n * 4; return a; };
const u32 = (n) => { const a = new Uint32Array(buf, o, n); o += n * 4; return a; };
const u8  = (n) => { const a = new Uint8Array(buf, o, n);  o += n;     return a; };
const col = {
  x: f32(N),
  y: f32(N),
  snr: f32(N),
  peakFreq: f32(N),
  entropy: f32(N),
  confidence: f32(N),
  gpsOff: u32(N),
  labelIdx: u8(N),
  runIdx: u8(N),
  ifoIdx: u8(N),
};
```

## `conf.bin` - Detail Confidence Matrix

`N x C` Uint8 row-major matrix, where `C = meta.classes.length`. For the current
real build, `C = 22`.

Glitch `i`'s vector is `conf[i*C : i*C+C]`, and column `j` maps to
`meta.classes[j]`. Each byte stores `round(p * 255)`; divide by 255 in the
browser to recover an approximate probability. The current real build uses
**22 bytes/glitch**.

## `ids.txt` - Fixed-Width IDs

`N * id_length` fixed-width ASCII characters.

```js
const id = ids.slice(i * idLength, (i + 1) * idLength).trim();
```

## `uuids.bin` - Packed Spectrogram UUIDs

Present when `images.available` is true. The file is `N x D x 16` bytes,
row-major, where `D = meta.images.durations.length` and the current duration
order is `0.5`, `1.0`, `2.0`, `4.0` seconds. An all-zero UUID marks a missing
image.

The current app can fetch a single glitch record with HTTP Range before the full
UUID file has loaded:

```js
const recordBytes = meta.images.durations.length * meta.detail.uuid_bytes;
const start = i * recordBytes;
const end = start + recordBytes - 1;
fetch(uuidUrl, { headers: { Range: `bytes=${start}-${end}` } });
```

Rebuild a spectrogram URL from the 16 raw UUID bytes:

```js
const off = (i * 4 + d) * 16;
let hex = '';
let any = false;
for (let k = 0; k < 16; k++) {
  const b = uuids[off + k];
  if (b) any = true;
  hex += b.toString(16).padStart(2, '0');
}
const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
const url = any ? meta.images.prefix + uuid + meta.images.suffix : null;
```

The UUIDs come from Zenodo CSV columns `url1` through `url4`; see
[docs/DATA_NOTES.md](./docs/DATA_NOTES.md).
