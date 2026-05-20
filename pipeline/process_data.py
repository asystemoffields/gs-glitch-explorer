#!/usr/bin/env python3
"""
process_data.py — build the REAL Gravity Spy dataset from Zenodo record 5649212,
writing the two-tier files directly into an output dir (default web/data/).

Runs on a local machine with a few GB of RAM. The GitHub Actions workflow in
.github/workflows/update-data.yml can run the current O1-O3 UMAP build on the
standard public runner. For larger future datasets, run the same script on a
bigger machine; the output format is identical.

  pip install -r pipeline/requirements-lock.txt
  python pipeline/process_data.py --out web/data
"""
import argparse
import hashlib
import json
import os
import tempfile
from pathlib import Path

import numpy as np

REC = os.environ.get("GS_ZENODO_RECORD", "5649212")
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


def fetch_zenodo_file_info(requests, record: str) -> dict:
    url = f"https://zenodo.org/api/records/{record}"
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    files = {}
    for item in r.json().get("files", []):
        key = item.get("key")
        if key:
            files[key] = {
                "size": item.get("size"),
                "checksum": item.get("checksum"),
                "url": f"https://zenodo.org/api/records/{record}/files/{key}/content",
            }
    missing = [fn for fn in FILES if fn not in files]
    if missing:
        raise RuntimeError(f"Zenodo record {record} is missing files: {missing}")
    return files


def checksum_ok(path: Path, checksum: str | None) -> bool:
    if not checksum:
        return True
    if ":" in checksum:
        algo, expected = checksum.split(":", 1)
    else:
        algo, expected = "md5", checksum
    h = hashlib.new(algo)
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest().lower() == expected.lower()


def cached_file_ok(path: Path, info: dict) -> bool:
    if not path.exists() or path.stat().st_size == 0:
        return False
    size = info.get("size")
    if size is not None and path.stat().st_size != int(size):
        return False
    return checksum_ok(path, info.get("checksum"))


def ensure_cached_file(requests, fn: str, path: Path, info: dict) -> None:
    if cached_file_ok(path, info):
        return
    print("downloading", fn, flush=True)
    tmp = path.with_name(path.name + ".tmp")
    try:
        with requests.get(info["url"], stream=True, timeout=1800) as r:
            r.raise_for_status()
            with open(tmp, "wb") as fh:
                for chunk in r.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        fh.write(chunk)
        if not cached_file_ok(tmp, info):
            raise RuntimeError(f"downloaded {fn} failed size/checksum validation")
        tmp.replace(path)
    finally:
        if tmp.exists():
            tmp.unlink()


def build(out_dir: Path, raw_dir: Path, record: str, n_neighbors: int,
          min_dist: float, random_state: int | None):
    import pandas as pd
    import requests
    import umap

    out_dir.mkdir(parents=True, exist_ok=True)
    raw_dir.mkdir(parents=True, exist_ok=True)

    zenodo_files = fetch_zenodo_file_info(requests, record)
    frames = []
    for fn in FILES:
        path = raw_dir / fn
        ensure_cached_file(requests, fn, path, zenodo_files[fn])
        d = pd.read_csv(path)
        d["__run"] = fn.split("_")[1].split(".")[0]
        frames.append(d)
        print(f"  {fn}: {len(d):,} rows", flush=True)

    df = pd.concat(frames, ignore_index=True)
    missing = [c for c in CONF_COLS if c not in df.columns]
    if missing:
        raise RuntimeError(f"missing confidence columns {missing}; have {list(df.columns)}")

    # Drop rows with non-finite key scalars or all-zero confidence (real Omicron
    # columns can carry NaN/inf -> would poison meta.json ranges / gps; an all-zero
    # confidence row would argmax to class 0).
    cm = df[CONF_COLS].to_numpy(dtype=np.float64)
    ok = (np.isfinite(df["snr"].to_numpy(float))
          & np.isfinite(df["peak_frequency"].to_numpy(float))
          & np.isfinite(df["event_time"].to_numpy(float))
          & np.isfinite(cm).all(axis=1)
          & (cm.sum(axis=1) > 0))
    if not ok.all():
        print(f"dropping {int((~ok).sum()):,} of {len(df):,} rows (non-finite / all-zero)", flush=True)
        df = df[ok].reset_index(drop=True)
    N = len(df)
    print(f"glitches: {N:,}", flush=True)

    conf = df[CONF_COLS].to_numpy(dtype=np.float64)
    rs = conf.sum(1, keepdims=True); rs[rs == 0] = 1.0
    conf = conf / rs
    with np.errstate(divide="ignore", invalid="ignore"):
        logc = np.where(conf > 0, np.log(conf), 0.0)
    entropy = (-(conf * logc).sum(1)).astype(np.float32)
    label_idx = conf.argmax(1).astype(np.uint8)
    confidence = conf.max(1).astype(np.float32)

    snr = df["snr"].to_numpy(np.float32)
    freq = df["peak_frequency"].to_numpy(np.float32)
    gps = df["event_time"].to_numpy(np.float64)
    ifo_idx = (df["ifo"].astype(str).to_numpy() == "L1").astype(np.uint8)
    run_idx = df["__run"].map({r: i for i, r in enumerate(RUNS)}).to_numpy(np.uint8)

    print(f"UMAP on {N:,} x {len(CONF_COLS)} (cosine)…", flush=True)
    reducer = umap.UMAP(n_neighbors=n_neighbors, min_dist=min_dist, metric="cosine",
                        low_memory=True, verbose=True, random_state=random_state)
    xy = reducer.fit_transform(conf.astype(np.float32)).astype(np.float32)
    x, y = np.ascontiguousarray(xy[:, 0]), np.ascontiguousarray(xy[:, 1])

    def to16(val):
        if not isinstance(val, str):
            return b"\x00" * 16
        v = val.strip()
        if v in ("", "?"):
            return b"\x00" * 16
        h = v.rsplit("/", 1)[-1]
        if h.endswith(URL_SUFFIX):
            h = h[: -len(URL_SUFFIX)]
        try:
            b = bytes.fromhex(h.replace("-", ""))
            return b if len(b) == 16 else b"\x00" * 16
        except ValueError:
            return b"\x00" * 16

    for col in ("url1", "url2", "url3", "url4"):
        if col not in df.columns:
            df[col] = ""
    uuid_buf = bytearray()
    n_img = 0
    for row in df[["url1", "url2", "url3", "url4"]].itertuples(index=False):
        any_img = False
        for val in row:
            packed = to16(val)
            uuid_buf += packed
            any_img = any_img or packed != b"\x00" * 16
        n_img += 1 if any_img else 0
    print(f"glitches with >=1 spectrogram: {n_img:,}/{N:,}", flush=True)

    ids = "".join(str(s)[:ID_LEN].ljust(ID_LEN) for s in df["gravityspy_id"].tolist())

    def f32(a): return np.ascontiguousarray(a, dtype="<f4").tobytes()
    def u32(a): return np.ascontiguousarray(a, dtype="<u4").tobytes()
    def u8(a):  return np.ascontiguousarray(a, dtype="<u1").tobytes()

    gps_base = int(np.floor(gps.min()))
    gps_off = np.rint(gps - gps_base)
    if gps_off.min() < 0 or gps_off.max() > 2**32 - 1:
        raise RuntimeError(f"GPS offsets do not fit uint32 for gps_base={gps_base}")

    glitch_chunks = (
        f32(x), f32(y), f32(snr), f32(freq), f32(entropy), f32(confidence),
        u32(gps_off), u8(label_idx), u8(run_idx), u8(ifo_idx),
    )
    glitches_bytes = b"".join(glitch_chunks)
    (out_dir / "glitches.bin").write_bytes(glitches_bytes)

    conf_u8 = np.rint(conf * 255).clip(0, 255).astype("<u1")
    conf_bytes = np.ascontiguousarray(conf_u8).tobytes()
    uuid_bytes = bytes(uuid_buf)
    ids_bytes = ids.encode("ascii")
    (out_dir / "conf.bin").write_bytes(conf_bytes)
    (out_dir / "uuids.bin").write_bytes(uuid_bytes)
    (out_dir / "ids.txt").write_bytes(ids_bytes)

    version = hashlib.sha1(glitches_bytes + conf_bytes + ids_bytes + uuid_bytes).hexdigest()[:12]

    meta = {
        "schema_version": 2,
        "version": version,
        "source": f"gravityspy-zenodo-{record}",
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
        "gps_base": gps_base,
        "detail": {"base_url": "", "conf_file": "conf.bin", "ids_file": "ids.txt",
                   "uuids_file": "uuids.bin", "uuid_bytes": 16},
        "images": {"available": True, "prefix": URL_PREFIX, "suffix": URL_SUFFIX, "durations": DURATIONS},
    }
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2, allow_nan=False))
    print(f"wrote {N:,} glitches to {out_dir} (version {version})", flush=True)
    return {"N": int(N), "n_img": int(n_img), "version": version}


def main():
    ap = argparse.ArgumentParser(description="Build the real Gravity Spy dataset.")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "web" / "data")
    ap.add_argument("--raw", type=Path, default=Path(tempfile.gettempdir()) / "gs_raw")
    ap.add_argument("--record", default=REC)
    ap.add_argument("--n-neighbors", type=int, default=15)
    ap.add_argument("--min-dist", type=float, default=0.1)
    ap.add_argument("--random-state", type=int, default=42,
                    help="fixed seed for deterministic UMAP coordinates")
    a = ap.parse_args()
    build(a.out, a.raw, a.record, a.n_neighbors, a.min_dist, a.random_state)


if __name__ == "__main__":
    main()
