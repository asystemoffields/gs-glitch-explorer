#!/usr/bin/env python3
"""Pull the pipeline outputs out of the Modal volume to ./_data_real.

The `modal volume get` CLI no-ops on this Windows setup (reports success, writes
nothing), so we read the files via the SDK instead.
"""
from pathlib import Path

import modal

DEST = Path(__file__).resolve().parent / "_data_real"
FILES = ["meta.json", "glitches.bin", "conf.bin", "ids.txt", "uuids.bin"]


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    vol = modal.Volume.from_name("gs-glitch-data")
    for f in FILES:
        out = DEST / f
        n = 0
        with open(out, "wb") as fh:
            for chunk in vol.read_file(f"out/{f}"):
                fh.write(chunk)
                n += len(chunk)
        print(f"{f}: {n/1e6:.2f} MB -> {out}")


if __name__ == "__main__":
    main()
