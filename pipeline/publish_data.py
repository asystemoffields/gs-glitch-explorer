#!/usr/bin/env python3
"""
publish_data.py — deploy the Modal pipeline output into the two-tier layout.

  * overview (meta.json, glitches.bin) -> web/data/  (committed to the repo)
  * detail   (conf.bin, ids.txt, uuids.bin) -> a GitHub Release (CDN)
  * patches web/data/meta.json `detail.base_url` to the Release download URL

Prereqs:
  modal volume get gs-glitch-data out ./pipeline/_modal_out --force   # fetch outputs
  gh auth status                                                       # push access to the repo
  (a Release needs a tag target, so the repo must have >=1 pushed commit)

Usage:
  # Local testing: drop ALL tiers into web/data/ with base_url="" (no Release/CORS):
  python pipeline/publish_data.py --local-only

  # Deploy: overview -> repo, detail -> Release, patch base_url:
  python pipeline/publish_data.py --tag data-v1
"""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

REPO = "asystemoffields/gs-glitch-explorer"
ROOT = Path(__file__).resolve().parent.parent
WEB_DATA = ROOT / "web" / "data"
OVERVIEW = ["meta.json", "glitches.bin"]
DETAIL = ["conf.bin", "ids.txt", "uuids.bin"]


def run(*args):
    print("+", " ".join(args))
    subprocess.run(list(args), check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=ROOT / "pipeline" / "_modal_out")
    ap.add_argument("--tag", default="data-v1")
    ap.add_argument("--repo", default=REPO)
    ap.add_argument("--local-only", action="store_true",
                    help="copy all tiers into web/data/ with base_url='' (no Release upload)")
    a = ap.parse_args()

    if not (a.src / "meta.json").exists():
        sys.exit(f"missing meta.json in {a.src} — run pipeline/fetch_volume.py first")
    meta = json.loads((a.src / "meta.json").read_text())
    meta.setdefault("detail", {})
    # uuids.bin only exists when the dataset has real spectrograms
    detail = ["conf.bin", "ids.txt"] + (["uuids.bin"] if meta.get("images", {}).get("available") else [])
    missing = [f for f in OVERVIEW + detail if not (a.src / f).exists()]
    if missing:
        sys.exit(f"missing {missing} in {a.src} — run pipeline/fetch_volume.py first")

    WEB_DATA.mkdir(parents=True, exist_ok=True)

    if a.local_only:
        for f in OVERVIEW + detail:
            shutil.copy2(a.src / f, WEB_DATA / f)
        meta["detail"]["base_url"] = ""
        (WEB_DATA / "meta.json").write_text(json.dumps(meta, indent=2))
        sizes = {f: (WEB_DATA / f).stat().st_size for f in OVERVIEW + DETAIL}
        print("LOCAL: all tiers in web/data/, base_url=''.")
        print({k: f"{v/1e6:.1f} MB" for k, v in sizes.items()})
        return

    # overview -> repo
    shutil.copy2(a.src / "glitches.bin", WEB_DATA / "glitches.bin")

    # detail -> GitHub Release
    base = f"https://github.com/{a.repo}/releases/download/{a.tag}/"
    detail_paths = [str(a.src / f) for f in detail]
    exists = subprocess.run(["gh", "release", "view", a.tag, "--repo", a.repo],
                            capture_output=True).returncode == 0
    if exists:
        run("gh", "release", "upload", a.tag, "--repo", a.repo, "--clobber", *detail_paths)
    else:
        run("gh", "release", "create", a.tag, "--repo", a.repo,
            "--title", f"Data {a.tag}",
            "--notes", "Gravity Spy detail tier: confidence matrix, ids, spectrogram UUIDs.",
            *detail_paths)

    meta["detail"]["base_url"] = base
    (WEB_DATA / "meta.json").write_text(json.dumps(meta, indent=2))
    print(f"\nDetail uploaded to release '{a.tag}'.  meta.detail.base_url = {base}")
    print("Now commit web/data/{meta.json,glitches.bin} and push; then verify the app fetches detail (CORS).")


if __name__ == "__main__":
    main()
