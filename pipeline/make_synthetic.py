#!/usr/bin/env python3
"""
make_synthetic.py -- generate a realistic *synthetic* Gravity Spy dataset that
conforms to the contract in DATA_FORMAT.md for local demos, development, and
tests using only NumPy.

The synthetic data deliberately mimics the qualitative structure of the real
Gravity Spy embedding so the tool feels familiar to people who know the data:

  * Blip / Scattered_Light / Koi_Fish dominate the population.
  * Morphologically confusable classes are placed next to each other.
  * A fraction of points are "confused": flatter confidence vectors (higher
    entropy) that bridge neighbouring clusters -- the raw material for the
    confidence/entropy discovery knobs.
  * A small, tight, high-entropy "mystery" cluster is hidden in an empty region
    to simulate an undiscovered glitch class, so Discovery mode has a real
    target to find (lower confidence -> show uncertain -> lasso -> gallery).

Only dependency: numpy.

Usage:
    python make_synthetic.py                       # 150k glitches -> ../web/data
    python make_synthetic.py --n 50000 --seed 7
    python make_synthetic.py --out /tmp/data
"""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

# --- The 22 confidence classes, in the EXACT column order of the real Zenodo
# CSVs (record 5649212). index == label_idx == conf.bin column. The 2021 ML
# dataset uses the original 22-class model, including "None_of_the_Above".
# Future classes, such as O4's Vibration, slot in through meta.json. -----------
CLASSES = [
    "1400Ripples", "1080Lines", "Air_Compressor", "Blip", "Chirp",
    "Extremely_Loud", "Helix", "Koi_Fish", "Light_Modulation", "Low_Frequency_Burst",
    "Low_Frequency_Lines", "No_Glitch", "None_of_the_Above", "Paired_Doves", "Power_Line",
    "Repeating_Blips", "Scattered_Light", "Scratchy", "Tomte", "Violin_Mode",
    "Wandering_Line", "Whistle",
]

# 22 colours, parallel to CLASSES (chosen to read well on a near-black bg; the
# two catch-all classes No_Glitch / None_of_the_Above get neutral greys).
PALETTE = [
    "#ffd60a", "#ff9f0a", "#8d6e63", "#ff5a5a", "#bf5af2",
    "#ff6fd8", "#2dd4a7", "#5b8def", "#a8e10c", "#ff7a45",
    "#c9a7ff", "#9aa0a6", "#6b7280", "#ff9ec7", "#e9e36b",
    "#ff7a7a", "#4cd964", "#c2c24e", "#5fb0e8", "#b06ed0",
    "#32d5e0", "#ffbf8a",
]

# Per-class: population weight, 2D cluster spread, characteristic frequency band
# (Hz, log-sampled), and an SNR scale. Loosely informed by the real data
# (Blip/Scattered_Light huge; Extremely_Loud very loud; No_Glitch near threshold).
CLASS_CFG = {
    "1400Ripples":         dict(w=2,  sigma=0.40, freq=(1350, 1480), snr=0.9),
    "1080Lines":           dict(w=3,  sigma=0.40, freq=(1000, 1150), snr=0.9),
    "Air_Compressor":      dict(w=2,  sigma=0.45, freq=(20, 60),     snr=0.8),
    "Blip":                dict(w=22, sigma=0.70, freq=(30, 500),    snr=1.6),
    "Chirp":               dict(w=1,  sigma=0.45, freq=(20, 300),    snr=1.2),
    "Extremely_Loud":      dict(w=3,  sigma=0.80, freq=(10, 2048),   snr=15.0),
    "Helix":               dict(w=2,  sigma=0.45, freq=(50, 400),    snr=1.0),
    "Koi_Fish":            dict(w=10, sigma=0.70, freq=(30, 1000),   snr=2.2),
    "Light_Modulation":    dict(w=5,  sigma=0.55, freq=(50, 500),    snr=1.2),
    "Low_Frequency_Burst": dict(w=8,  sigma=0.60, freq=(10, 40),     snr=1.2),
    "Low_Frequency_Lines": dict(w=3,  sigma=0.45, freq=(10, 50),     snr=0.9),
    "No_Glitch":           dict(w=9,  sigma=2.40, freq=(10, 2048),   snr=0.5),
    "None_of_the_Above":   dict(w=6,  sigma=1.60, freq=(10, 2048),   snr=0.9),
    "Paired_Doves":        dict(w=1,  sigma=0.45, freq=(30, 400),    snr=1.0),
    "Power_Line":          dict(w=5,  sigma=0.50, freq=(55, 185),    snr=1.0),
    "Repeating_Blips":     dict(w=5,  sigma=0.60, freq=(30, 400),    snr=1.4),
    "Scattered_Light":     dict(w=20, sigma=0.95, freq=(10, 60),     snr=1.0),
    "Scratchy":            dict(w=5,  sigma=0.55, freq=(50, 500),    snr=1.1),
    "Tomte":               dict(w=4,  sigma=0.55, freq=(10, 60),     snr=1.0),
    "Violin_Mode":         dict(w=3,  sigma=0.40, freq=(450, 520),   snr=1.0),
    "Wandering_Line":      dict(w=3,  sigma=0.55, freq=(50, 1000),   snr=1.0),
    "Whistle":             dict(w=6,  sigma=0.60, freq=(100, 2048),  snr=1.2),
}

# Morphologically confusable pairs -> placed adjacently and used to bridge
# "confused" points between clusters.
NEIGHBORS = [
    ("Blip", "Koi_Fish"), ("Blip", "Repeating_Blips"), ("Koi_Fish", "Extremely_Loud"),
    ("Low_Frequency_Burst", "Tomte"), ("Scattered_Light", "Tomte"),
    ("1080Lines", "1400Ripples"), ("Power_Line", "Low_Frequency_Lines"),
    ("Whistle", "Light_Modulation"), ("None_of_the_Above", "No_Glitch"),
]

RUNS = ["O1", "O2", "O3a", "O3b"]
RUN_GPS = {
    "O1":  (1126400000, 1137250000),
    "O2":  (1164556817, 1187733618),
    "O3a": (1238112018, 1253977218),
    "O3b": (1256655618, 1269363618),
}
RUN_WEIGHT = {"O1": 1.0, "O2": 2.0, "O3a": 4.0, "O3b": 3.5}
IFOS = ["H1", "L1"]
GPS_BASE = 1126400000
DURATIONS = ["0.5", "1.0", "2.0", "4.0"]
ID_ALPHABET = np.array(list(
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"))
ID_LEN = 10


def layout_centers(rng, n, min_dist=3.0, span=10.5, tries=40000):
    """Poisson-disk-ish placement of n cluster centres in a square."""
    pts = []
    for _ in range(tries):
        if len(pts) == n:
            break
        c = rng.uniform(-span, span, size=2)
        if all(np.hypot(*(c - p)) >= min_dist for p in pts):
            pts.append(c)
    while len(pts) < n:                 # relax if rejection sampling fell short
        pts.append(rng.uniform(-span, span, size=2))
    return np.array(pts[:n])


def pull_neighbors_together(centers, idx, gap=1.8):
    """Move each confusable pair so they sit ~gap apart, straddling their midpoint."""
    for a, b in NEIGHBORS:
        ia, ib = idx[a], idx[b]
        mid = (centers[ia] + centers[ib]) / 2.0
        d = centers[ib] - centers[ia]
        norm = np.hypot(*d) or 1.0
        u = d / norm
        centers[ia] = mid - u * (gap / 2.0)
        centers[ib] = mid + u * (gap / 2.0)
    return centers


def shannon_entropy(P):
    """Row-wise Shannon entropy (natural log) of a probability matrix."""
    with np.errstate(divide="ignore", invalid="ignore"):
        logP = np.where(P > 0, np.log(P), 0.0)
    return -(P * logP).sum(axis=1)


def main():
    ap = argparse.ArgumentParser(description="Generate a synthetic Gravity Spy dataset.")
    ap.add_argument("--n", type=int, default=150_000, help="number of glitches")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--confused-frac", type=float, default=0.10,
                    help="fraction of main points with flat/bridged confidence")
    ap.add_argument("--mystery-frac", type=float, default=0.007,
                    help="fraction forming the hidden high-entropy cluster")
    ap.add_argument("--out", type=Path,
                    default=Path(__file__).resolve().parent.parent / "web" / "data")
    args = ap.parse_args()

    assert len(CLASSES) == len(PALETTE) == len(CLASS_CFG), "class/palette/cfg mismatch"
    rng = np.random.default_rng(args.seed)
    C = len(CLASSES)
    idx = {c: i for i, c in enumerate(CLASSES)}

    # --- cluster geometry ----------------------------------------------------
    centers = pull_neighbors_together(layout_centers(rng, C), idx)
    sigmas = np.array([CLASS_CFG[c]["sigma"] for c in CLASSES])
    weights = np.array([CLASS_CFG[c]["w"] for c in CLASSES], dtype=float)
    weights /= weights.sum()
    flo = np.array([CLASS_CFG[c]["freq"][0] for c in CLASSES], dtype=float)
    fhi = np.array([CLASS_CFG[c]["freq"][1] for c in CLASSES], dtype=float)
    snr_scale = np.array([CLASS_CFG[c]["snr"] for c in CLASSES], dtype=float)

    nbr_map = {i: [] for i in range(C)}
    for a, b in NEIGHBORS:
        nbr_map[idx[a]].append(idx[b])
        nbr_map[idx[b]].append(idx[a])

    n_mystery = int(args.n * args.mystery_frac)
    n_main = args.n - n_mystery

    # --- main population: intended class, confused mask, bridge neighbour -----
    intended = rng.choice(C, size=n_main, p=weights)
    confused = rng.random(n_main) < args.confused_frac
    nbr = intended.copy()
    for i in np.where(confused)[0]:
        opts = nbr_map[intended[i]]
        if opts:
            nbr[i] = opts[rng.integers(len(opts))]
        else:                                   # bridge to a random *other* class
            r = int(rng.integers(C - 1))
            nbr[i] = r + (1 if r >= intended[i] else 0)

    # Dirichlet confidence vectors via the gamma trick (per-row alpha).
    alpha = np.full((n_main, C), 0.12)
    rows = np.arange(n_main)
    alpha[rows, intended] += np.where(confused, 2.5, 14.0)
    cidx = np.where(confused)[0]
    alpha[cidx, nbr[cidx]] += 2.2
    g = rng.gamma(alpha)
    p = g / g.sum(axis=1, keepdims=True)

    # positions: confident -> around own centre; confused -> between the pair
    pos = centers[intended] + rng.normal(0, 1, (n_main, 2)) * sigmas[intended, None]
    t = rng.uniform(0.3, 0.7, size=cidx.size)[:, None]
    pos[cidx] = ((1 - t) * centers[intended[cidx]] + t * centers[nbr[cidx]]
                 + rng.normal(0, 0.35, (cidx.size, 2)))

    u = rng.random(n_main)
    freq = np.exp(np.log(flo[intended]) + u * (np.log(fhi[intended]) - np.log(flo[intended])))
    snr = 7.5 + rng.lognormal(0.6, 0.8, n_main) * 7.0 * snr_scale[intended]

    rw = np.array([RUN_WEIGHT[r] for r in RUNS]); rw /= rw.sum()
    run_idx = rng.choice(len(RUNS), size=n_main, p=rw)
    gps = np.empty(n_main)
    for ri, r in enumerate(RUNS):
        m = run_idx == ri
        lo, hi = RUN_GPS[r]
        gps[m] = rng.uniform(lo, hi, size=int(m.sum()))
    ifo = rng.choice(len(IFOS), size=n_main, p=[0.52, 0.48])

    # --- hidden "mystery" cluster in the emptiest corner ---------------------
    cand = np.array([[-9, -9], [9, -9], [-9, 9], [9, 9],
                     [0, -10], [0, 10], [-10, 0], [10, 0]], dtype=float)
    far = np.min(np.linalg.norm(cand[:, None, :] - centers[None, :, :], axis=2), axis=1)
    mcenter = cand[int(np.argmax(far))]
    mystery_classes = sorted(int(x) for x in rng.choice(C, size=2, replace=False))
    ma, mb = mystery_classes
    malpha = np.full((n_mystery, C), 0.12)
    malpha[:, ma] += 1.0
    malpha[:, mb] += 0.9
    mg = rng.gamma(malpha)
    mp = mg / mg.sum(axis=1, keepdims=True)
    mpos = mcenter + rng.normal(0, 0.5, (n_mystery, 2))
    mfreq = np.exp(rng.uniform(np.log(40), np.log(120), n_mystery))
    msnr = 7.5 + rng.lognormal(0.6, 0.7, n_mystery) * 7.0 * 1.1
    mrun_idx = rng.choice([2, 3], size=n_mystery, p=[0.3, 0.7])
    mgps = np.empty(n_mystery)
    for ri in (2, 3):
        m = mrun_idx == ri
        lo, hi = RUN_GPS[RUNS[ri]]
        mgps[m] = rng.uniform(lo, hi, size=int(m.sum()))
    mifo = rng.choice(len(IFOS), size=n_mystery, p=[0.5, 0.5])

    # --- combine + shuffle ---------------------------------------------------
    P = np.concatenate([p, mp])
    X = np.concatenate([pos, mpos])
    snr = np.concatenate([snr, msnr])
    freq = np.concatenate([freq, mfreq])
    run_idx = np.concatenate([run_idx, mrun_idx])
    gps = np.concatenate([gps, mgps])
    ifo = np.concatenate([ifo, mifo])

    N = args.n
    perm = rng.permutation(N)
    P, X, snr, freq, run_idx, gps, ifo = (a[perm] for a in (P, X, snr, freq, run_idx, gps, ifo))

    snr = np.clip(snr, 7.5, 2000.0)
    freq = np.clip(freq, 10.0, 2048.0)
    label = P.argmax(axis=1)
    confidence = P.max(axis=1)
    entropy = shannon_entropy(P)

    # random fixed-width gravityspy_ids
    ids_idx = rng.integers(0, ID_ALPHABET.size, size=(N, ID_LEN))
    ids = "".join(ID_ALPHABET[ids_idx].ravel().tolist())

    # --- write outputs -------------------------------------------------------
    out = args.out
    out.mkdir(parents=True, exist_ok=True)

    cols = [
        X[:, 0].astype("<f4"), X[:, 1].astype("<f4"),
        snr.astype("<f4"), freq.astype("<f4"),
        entropy.astype("<f4"), confidence.astype("<f4"),
        np.rint(gps - GPS_BASE).astype("<u4"),
        label.astype("<u1"), run_idx.astype("<u1"), ifo.astype("<u1"),
    ]
    glitches_bytes = b"".join(np.ascontiguousarray(a).tobytes() for a in cols)
    (out / "glitches.bin").write_bytes(glitches_bytes)

    conf_u8 = np.rint(P * 255).clip(0, 255).astype("<u1")
    conf_bytes = np.ascontiguousarray(conf_u8).tobytes()
    ids_bytes = ids.encode("ascii")
    (out / "conf.bin").write_bytes(conf_bytes)
    (out / "ids.txt").write_bytes(ids_bytes)
    stale_uuids = out / "uuids.bin"
    if stale_uuids.exists():
        stale_uuids.unlink()

    version = hashlib.sha1(glitches_bytes + conf_bytes + ids_bytes).hexdigest()[:12]

    meta = {
        "schema_version": 2,
        "version": version,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "synthetic",
        "total_glitches": int(N),
        "id_length": ID_LEN,
        "classes": CLASSES,
        "class_colors": PALETTE,
        "runs": RUNS,
        "ifos": IFOS,
        "bounds": {
            "xmin": round(float(X[:, 0].min()), 3), "xmax": round(float(X[:, 0].max()), 3),
            "ymin": round(float(X[:, 1].min()), 3), "ymax": round(float(X[:, 1].max()), 3),
        },
        # Floor the min / ceil the max so the default full-range filter encloses
        # EVERY point — rounding to nearest could clip the single extreme glitch.
        "snr": {"min": float(np.floor(snr.min() * 1000) / 1000), "max": float(np.ceil(snr.max() * 1000) / 1000)},
        "freq": {"min": float(np.floor(freq.min() * 1000) / 1000), "max": float(np.ceil(freq.max() * 1000) / 1000)},
        "gps": {"min": int(np.floor(gps.min())), "max": int(np.ceil(gps.max()))},
        "gps_base": GPS_BASE,
        "detail": {                    # synthetic: detail tier sits in web/data/ too
            "base_url": "", "conf_file": "conf.bin", "ids_file": "ids.txt",
            "uuids_file": "uuids.bin", "uuid_bytes": 16,
        },
        "images": {
            "available": False,        # synthetic data has no real spectrograms
            "durations": DURATIONS,    # url index -> duration: url1=0.5s ... url4=4.0s
        },
        "synthetic_info": {
            "note": "Synthetic data for development/demo. Not real LIGO glitches.",
            "confused_frac": args.confused_frac,
            "mystery_center": [round(float(mcenter[0]), 2), round(float(mcenter[1]), 2)],
            "mystery_classes": [CLASSES[ma], CLASSES[mb]],
            "mystery_count": int(n_mystery),
            "seed": args.seed,
        },
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=2))

    # --- report --------------------------------------------------------------
    def kb(path):
        return (out / path).stat().st_size / 1024.0

    print(f"Wrote synthetic dataset ({N:,} glitches) to {out}")
    print(f"  meta.json     {kb('meta.json'):8.1f} KB")
    print(f"  glitches.bin  {kb('glitches.bin'):8.1f} KB   (expect {N*31/1024:.1f})")
    print(f"  conf.bin      {kb('conf.bin'):8.1f} KB   (expect {N*C/1024:.1f})")
    print(f"  ids.txt       {kb('ids.txt'):8.1f} KB   (expect {N*ID_LEN/1024:.1f})")
    assert (out / "glitches.bin").stat().st_size == N * 31
    assert (out / "conf.bin").stat().st_size == N * C
    assert (out / "ids.txt").stat().st_size == N * ID_LEN
    print(f"  high-entropy points (>1.5 nats): {(entropy > 1.5).sum():,}")
    print(f"  mystery cluster: {n_mystery:,} pts near {meta['synthetic_info']['mystery_center']} "
          f"({CLASSES[ma]} / {CLASSES[mb]})")
    print("  byte-size assertions passed.")


if __name__ == "__main__":
    main()
