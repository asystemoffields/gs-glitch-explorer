#!/usr/bin/env python3
"""
publish_data.py — move generated data into the two-tier hosting layout.

  * overview (meta.json, glitches.bin) -> web/data/  (committed to the repo)
  * detail   (conf.bin, ids.txt, uuids.bin) -> same-origin web/data/ or a
    CORS-enabled object store
  * patches web/data/meta.json `detail.base_url` when detail lives off-repo

Prereqs:
  python pipeline/process_data.py --out web/data   # or pass --src <generated-data-dir>
  gh auth status                                   # push access to the repo

Usage:
  # Local testing: drop ALL tiers into web/data/ with base_url="" (no Release/CORS):
  python pipeline/publish_data.py --src <generated-data-dir> --local-only

  # Deploy: overview -> repo, detail -> CORS object store you upload separately:
  python pipeline/publish_data.py --src web/data --base-url https://<bucket-host>/gs/
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


def run(*args):
    print("+", " ".join(args))
    subprocess.run(list(args), check=True)


def copy_if_different(src: Path, dst: Path) -> None:
    if src.resolve() == dst.resolve():
        return
    shutil.copy2(src, dst)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=WEB_DATA)
    ap.add_argument("--release-tag", "--tag", default=None,
                    help="upload detail files to a GitHub Release; kept for archival workflows")
    ap.add_argument("--repo", default=REPO)
    ap.add_argument("--local-only", action="store_true",
                    help="copy all tiers into web/data/ with base_url='' (no Release upload)")
    ap.add_argument("--base-url", default=None,
                    help="set meta.detail.base_url to this CORS-enabled URL (e.g. an R2 "
                         "bucket); you upload the detail files there yourself")
    a = ap.parse_args()

    if not (a.src / "meta.json").exists():
        sys.exit(f"missing meta.json in {a.src} — run process_data.py or pass --src")
    meta = json.loads((a.src / "meta.json").read_text())
    meta.setdefault("detail", {})
    # uuids.bin only exists when the dataset has real spectrograms
    detail = ["conf.bin", "ids.txt"] + (["uuids.bin"] if meta.get("images", {}).get("available") else [])
    missing = [f for f in OVERVIEW + detail if not (a.src / f).exists()]
    if missing:
        sys.exit(f"missing {missing} in {a.src} — run process_data.py or pass --src")

    WEB_DATA.mkdir(parents=True, exist_ok=True)

    if a.local_only:
        for f in OVERVIEW + detail:
            copy_if_different(a.src / f, WEB_DATA / f)
        meta["detail"]["base_url"] = ""
        (WEB_DATA / "meta.json").write_text(json.dumps(meta, indent=2))
        sizes = {f: (WEB_DATA / f).stat().st_size for f in OVERVIEW + detail}
        print("LOCAL: all tiers in web/data/, base_url=''.")
        print({k: f"{v/1e6:.1f} MB" for k, v in sizes.items()})
        return

    if a.base_url:
        # Off-repo detail tier: overview to the repo, base_url -> a CORS object
        # store (you upload the detail files there). See README "Hosting".
        copy_if_different(a.src / "glitches.bin", WEB_DATA / "glitches.bin")
        meta["detail"]["base_url"] = a.base_url.rstrip("/") + "/"
        (WEB_DATA / "meta.json").write_text(json.dumps(meta, indent=2))
        print(f"Overview -> web/data/; meta.detail.base_url = {meta['detail']['base_url']}")
        print("Now upload these to that base URL (public-read + CORS allowing GET):")
        for f in detail:
            print("   ", a.src / f)
        print("Then commit web/data/{meta.json,glitches.bin} and push.")
        return

    if not a.release_tag:
        sys.exit("choose --local-only or --base-url. Release hosting requires --release-tag.")

    # overview -> repo
    copy_if_different(a.src / "glitches.bin", WEB_DATA / "glitches.bin")

    # detail -> GitHub Release. This is useful for archival distribution; the
    # app's lazy fetch path needs same-origin hosting or a CORS-enabled store.
    base = f"https://github.com/{a.repo}/releases/download/{a.release_tag}/"
    detail_paths = [str(a.src / f) for f in detail]
    exists = subprocess.run(["gh", "release", "view", a.release_tag, "--repo", a.repo],
                            capture_output=True).returncode == 0
    if exists:
        run("gh", "release", "upload", a.release_tag, "--repo", a.repo, "--clobber", *detail_paths)
    else:
        run("gh", "release", "create", a.release_tag, "--repo", a.repo,
            "--title", f"Data {a.release_tag}",
            "--notes", "Gravity Spy detail tier: confidence matrix, ids, spectrogram UUIDs.",
            *detail_paths)

    meta["detail"]["base_url"] = base
    (WEB_DATA / "meta.json").write_text(json.dumps(meta, indent=2))
    print(f"\nDetail uploaded to release '{a.release_tag}'.  meta.detail.base_url = {base}")
    print("For the live app, prefer same-origin hosting or a CORS-enabled object store.")


if __name__ == "__main__":
    main()
