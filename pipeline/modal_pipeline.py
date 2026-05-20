#!/usr/bin/env python3
"""
Modal pipeline — build the REAL Gravity Spy dataset from Zenodo record 5649212,
in the two-tier layout this app uses (see ../DATA_FORMAT.md and ../docs/DATA_NOTES.md):

  * Overview tier  -> web/data/  (committed to the repo): glitches.bin + meta.json
  * Detail tier    -> a GitHub Release (CDN): conf.bin, ids.txt, uuids.bin

Run it (uses your Modal account for the heavy UMAP):

    modal run pipeline/modal_pipeline.py

Then pull the outputs locally:

    modal volume get gs-glitch-data out ./pipeline/_modal_out --force

…and the local driver `publish_data.py` places the overview in web/data/ and
uploads the detail files to a GitHub Release.

UMAP on ~710k x 22 needs real RAM/CPU — that's why this runs on Modal, not here.
"""
import json
import os

import modal

app = modal.App("gs-glitch-explorer")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        # Mutually-compatible stack: scikit-learn >=1.6 removed the
        # `force_all_finite` arg that umap-learn 0.5.6 still calls, so stay on 1.5.x.
        "numpy==1.26.4", "scipy==1.13.1", "scikit-learn==1.5.2", "numba==0.60.0",
        "umap-learn==0.5.6", "pandas==2.2.2", "pyarrow", "requests", "tqdm",
    )
)

vol = modal.Volume.from_name("gs-glitch-data", create_if_missing=True)

REC = "5649212"
FILES = ["H1_O1.csv", "L1_O1.csv", "H1_O2.csv", "L1_O2.csv",
         "H1_O3a.csv", "L1_O3a.csv", "H1_O3b.csv", "L1_O3b.csv"]
RUNS = ["O1", "O2", "O3a", "O3b"]
IFOS = ["H1", "L1"]
# The 22 ML confidence columns, in the EXACT Zenodo CSV header order.
CONF_COLS = [
    "1400Ripples", "1080Lines", "Air_Compressor", "Blip", "Chirp",
    "Extremely_Loud", "Helix", "Koi_Fish", "Light_Modulation", "Low_Frequency_Burst",
    "Low_Frequency_Lines", "No_Glitch", "None_of_the_Above", "Paired_Doves", "Power_Line",
    "Repeating_Blips", "Scattered_Light", "Scratchy", "Tomte", "Violin_Mode",
    "Wandering_Line", "Whistle",
]
# Parallel palette (matches pipeline/make_synthetic.py so the look is consistent).
PALETTE = [
    "#ffd60a", "#ff9f0a", "#8d6e63", "#ff5a5a", "#bf5af2",
    "#ff6fd8", "#2dd4a7", "#5b8def", "#a8e10c", "#ff7a45",
    "#c9a7ff", "#9aa0a6", "#6b7280", "#ff9ec7", "#e9e36b",
    "#ff7a7a", "#4cd964", "#c2c24e", "#5fb0e8", "#b06ed0",
    "#32d5e0", "#ffbf8a",
]
URL_PREFIX = "https://panoptes-uploads.zooniverse.org/production/subject_location/"
URL_SUFFIX = ".png"
GPS_BASE = 1126400000
DURATIONS = ["0.5", "1.0", "2.0", "4.0"]
ID_LEN = 10


@app.function(image=image, volumes={"/vol": vol}, timeout=7200, memory=32768, cpu=8.0)
def process(n_neighbors: int = 15, min_dist: float = 0.1):
    import numpy as np
    import pandas as pd
    import requests

    raw, out = "/vol/raw", "/vol/out"
    os.makedirs(raw, exist_ok=True)
    os.makedirs(out, exist_ok=True)

    # ---- download (cached in the Volume) + load ----
    frames = []
    for fn in FILES:
        path = f"{raw}/{fn}"
        if not os.path.exists(path) or os.path.getsize(path) == 0:
            url = f"https://zenodo.org/api/records/{REC}/files/{fn}/content"
            print("downloading", fn, flush=True)
            r = requests.get(url, timeout=1200)
            r.raise_for_status()
            with open(path, "wb") as fh:
                fh.write(r.content)
        run = fn.split("_")[1].split(".")[0]      # "H1_O3a.csv" -> "O3a"
        d = pd.read_csv(path)
        d["__run"] = run
        frames.append(d)
        print(f"  {fn}: {len(d):,} rows", flush=True)
    vol.commit()

    df = pd.concat(frames, ignore_index=True)
    N = len(df)
    print(f"total glitches: {N:,}", flush=True)

    missing = [c for c in CONF_COLS if c not in df.columns]
    if missing:
        raise RuntimeError(f"missing confidence columns {missing}; have {list(df.columns)}")

    # Drop rows with non-finite key scalars or all-zero confidence. Real Omicron
    # columns can carry NaN/inf (which would poison meta.json ranges -> invalid
    # JSON, and silently become gps_off=0); an all-zero confidence row would
    # argmax to class 0. The ML confidence row normally sums to ~1.
    _cm = df[CONF_COLS].to_numpy(dtype=np.float64)
    _ok = (np.isfinite(df["snr"].to_numpy(float))
           & np.isfinite(df["peak_frequency"].to_numpy(float))
           & np.isfinite(df["event_time"].to_numpy(float))
           & np.isfinite(_cm).all(axis=1)
           & (_cm.sum(axis=1) > 0))
    if not _ok.all():
        print(f"dropping {int((~_ok).sum()):,} of {len(df):,} rows (non-finite / all-zero confidence)", flush=True)
        df = df[_ok].reset_index(drop=True)
    N = len(df)

    # ---- confidence matrix (22-D), entropy, label ----
    conf = df[CONF_COLS].to_numpy(dtype=np.float64)
    rs = conf.sum(1, keepdims=True)
    rs[rs == 0] = 1.0
    conf = conf / rs
    with np.errstate(divide="ignore", invalid="ignore"):
        logc = np.where(conf > 0, np.log(conf), 0.0)
    entropy = (-(conf * logc).sum(1)).astype(np.float32)
    label_idx = conf.argmax(1).astype(np.uint8)
    confidence = conf.max(1).astype(np.float32)

    # ---- scalars ----
    snr = df["snr"].to_numpy(np.float32)
    freq = df["peak_frequency"].to_numpy(np.float32)
    gps = df["event_time"].to_numpy(np.float64)
    ifo_idx = (df["ifo"].astype(str).to_numpy() == "L1").astype(np.uint8)
    run_idx = df["__run"].map({r: i for i, r in enumerate(RUNS)}).to_numpy(np.uint8)

    # ---- UMAP (the reason we're on Modal) ----
    import umap
    print(f"UMAP on {N:,} x {len(CONF_COLS)} (cosine)…", flush=True)
    # No random_state -> UMAP keeps multithreading on (random_state forces
    # single-threaded). Non-deterministic layout is fine for a visualisation.
    reducer = umap.UMAP(n_neighbors=n_neighbors, min_dist=min_dist, metric="cosine",
                        low_memory=True, verbose=True)
    xy = reducer.fit_transform(conf.astype(np.float32)).astype(np.float32)
    x, y = xy[:, 0].copy(), xy[:, 1].copy()

    # ---- spectrogram UUIDs: ".../{uuid}.png" -> 16 packed bytes (0s if missing) ----
    def to16(val):
        if not isinstance(val, str):
            return b"\x00" * 16
        v = val.strip()
        if v in ("", "?"):
            return b"\x00" * 16
        h = v.rsplit("/", 1)[-1]
        if h.endswith(URL_SUFFIX):
            h = h[: -len(URL_SUFFIX)]
        h = h.replace("-", "")
        try:
            b = bytes.fromhex(h)
            return b if len(b) == 16 else b"\x00" * 16
        except ValueError:
            return b"\x00" * 16

    uuid_buf = bytearray()
    n_with_img = 0
    for col in ("url1", "url2", "url3", "url4"):
        if col not in df.columns:
            df[col] = ""
    for r in df[["url1", "url2", "url3", "url4"]].itertuples(index=False):
        any_img = False
        for val in r:
            packed = to16(val)
            uuid_buf += packed
            any_img = any_img or packed != b"\x00" * 16
        n_with_img += 1 if any_img else 0
    print(f"glitches with >=1 spectrogram URL: {n_with_img:,}/{N:,}", flush=True)

    # ---- ids (fixed 10-char) ----
    ids = "".join(str(s)[:ID_LEN].ljust(ID_LEN) for s in df["gravityspy_id"].tolist())

    # ---- write outputs ----
    def f32(a): return np.ascontiguousarray(a, dtype="<f4").tobytes()
    def u32(a): return np.ascontiguousarray(a, dtype="<u4").tobytes()
    def u8(a):  return np.ascontiguousarray(a, dtype="<u1").tobytes()

    gps_off = np.clip(np.rint(gps - GPS_BASE), 0, 2**32 - 1)
    with open(f"{out}/glitches.bin", "wb") as fh:   # OVERVIEW tier (31 B/glitch)
        for chunk in (f32(x), f32(y), f32(snr), f32(freq), f32(entropy), f32(confidence),
                      u32(gps_off), u8(label_idx), u8(run_idx), u8(ifo_idx)):
            fh.write(chunk)

    conf_u8 = np.rint(conf * 255).clip(0, 255).astype("<u1")  # DETAIL: 22 B/glitch
    with open(f"{out}/conf.bin", "wb") as fh:
        fh.write(np.ascontiguousarray(conf_u8).tobytes())
    with open(f"{out}/uuids.bin", "wb") as fh:                 # DETAIL: 64 B/glitch
        fh.write(bytes(uuid_buf))
    with open(f"{out}/ids.txt", "w", encoding="ascii") as fh:  # DETAIL: 10 B/glitch
        fh.write(ids)

    meta = {
        "schema_version": 2,
        "source": f"gravityspy-zenodo-{REC}",
        "total_glitches": int(N),
        "id_length": ID_LEN,
        "classes": CONF_COLS,
        "class_colors": PALETTE,
        "runs": RUNS,
        "ifos": IFOS,
        "bounds": {
            "xmin": float(np.floor(x.min())), "xmax": float(np.ceil(x.max())),
            "ymin": float(np.floor(y.min())), "ymax": float(np.ceil(y.max())),
        },
        "snr": {"min": float(np.floor(snr.min() * 1000) / 1000), "max": float(np.ceil(snr.max() * 1000) / 1000)},
        "freq": {"min": float(np.floor(freq.min() * 1000) / 1000), "max": float(np.ceil(freq.max() * 1000) / 1000)},
        "gps": {"min": int(np.floor(gps.min())), "max": int(np.ceil(gps.max()))},
        "gps_base": GPS_BASE,
        # Detail tier lives on a CDN (GitHub Release); base_url filled in by publish_data.py.
        "detail": {
            "base_url": "",
            "conf_file": "conf.bin",
            "ids_file": "ids.txt",
            "uuids_file": "uuids.bin",
            "uuid_bytes": 16,
        },
        "images": {
            "available": True,
            "prefix": URL_PREFIX,
            "suffix": URL_SUFFIX,
            "durations": DURATIONS,
        },
    }
    with open(f"{out}/meta.json", "w") as fh:
        json.dump(meta, fh, indent=2, allow_nan=False)
    vol.commit()

    sizes = {f: os.path.getsize(f"{out}/{f}") for f in ("meta.json", "glitches.bin", "conf.bin", "ids.txt", "uuids.bin")}
    print("OUTPUT SIZES:", {k: f"{v/1e6:.1f} MB" for k, v in sizes.items()}, flush=True)
    return {"N": int(N), "n_with_img": int(n_with_img), "sizes": sizes,
            "bounds": meta["bounds"], "classes_present": int((np.bincount(label_idx, minlength=len(CONF_COLS)) > 0).sum())}


@app.local_entrypoint()
def main(n_neighbors: int = 15, min_dist: float = 0.1):
    result = process.remote(n_neighbors=n_neighbors, min_dist=min_dist)
    print("\n=== DONE ===")
    print(json.dumps(result, indent=2))
    print("\nNext: modal volume get gs-glitch-data out ./pipeline/_modal_out --force")
