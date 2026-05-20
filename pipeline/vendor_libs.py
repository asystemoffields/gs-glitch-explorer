#!/usr/bin/env python3
"""
Vendor the browser libraries into web/vendor/ so the app has NO build step and
NO runtime CDN dependency (works offline / air-gapped; "runs forever" regardless
of CDN uptime). Re-run to update.

- regl + regl-scatterplot ship UMD `dist/*.min.js` -> downloaded as-is.
- pub-sub-es@3 is ESM-only (no UMD/global build), but regl-scatterplot's UMD
  reads a global `createPubSub`. So we fetch its ESM source and wrap it in a
  classic-script IIFE that assigns `window.createPubSub` (the only change is
  replacing the two ESM `export` lines). Load order: regl, pub-sub-es, scatterplot.

Writes web/vendor/{regl.min.js, pub-sub-es.js, regl-scatterplot.min.js, VENDOR.md}.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import requests

VENDOR = Path(__file__).resolve().parent.parent / "web" / "vendor"
UMD_PKGS = [("regl", "2"), ("regl-scatterplot", "1")]
PUBSUB_SPEC = "3"


def get(url: str) -> bytes:
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return r.content


def resolve_version(pkg: str, spec: str) -> str:
    url = f"https://data.jsdelivr.com/v1/packages/npm/{pkg}/resolved?specifier={spec}"
    return json.loads(get(url))["version"]


def find_dist_min(pkg: str, ver: str) -> str:
    flat = json.loads(get(f"https://data.jsdelivr.com/v1/packages/npm/{pkg}@{ver}?structure=flat"))
    files = [f["name"] for f in flat["files"]]
    cands = [f for f in files if re.search(r"/dist/.*\.min\.js$", f)]
    if not cands:
        cands = [f for f in files if f.endswith(".min.js")]
    cands.sort(key=lambda f: ("esm" in f or "module" in f or "worker" in f, len(f)))
    if not cands:
        raise RuntimeError(f"no .min.js found for {pkg}@{ver}")
    return cands[0]


def vendor_umd(pkg: str, spec: str, manifest: list) -> None:
    ver = resolve_version(pkg, spec)
    path = find_dist_min(pkg, ver)
    url = f"https://cdn.jsdelivr.net/npm/{pkg}@{ver}{path}"
    content = get(url)
    (VENDOR / f"{pkg}.min.js").write_bytes(content)
    print(f"{pkg}@{ver}  ({len(content)/1024:.1f} KB)  <- {url}")
    for token in (b"createScatterplot", b"createREGL"):
        if token in content[:6000] or token in content[-6000:]:
            print(f"    global sniff: {token.decode()}")
    manifest.append((f"{pkg}.min.js", pkg, ver, path, len(content)))


def vendor_pubsub(spec: str, manifest: list) -> None:
    ver = resolve_version("pub-sub-es", spec)
    src = get(f"https://cdn.jsdelivr.net/npm/pub-sub-es@{ver}/dist/index.js").decode("utf-8")
    # The ONLY ESM-specific syntax in this file is the two trailing `export` lines.
    body = "\n".join(ln for ln in src.splitlines() if not ln.strip().startswith("export "))
    header = (
        f"/* pub-sub-es@{ver} vendored as a classic script exposing window.createPubSub.\n"
        f" * Source: https://cdn.jsdelivr.net/npm/pub-sub-es@{ver}/dist/index.js (MIT, Fritz Lekschas).\n"
        f" * Only change: the two ESM `export` lines are replaced with a browser-global\n"
        f" * assignment so regl-scatterplot's UMD build can read `createPubSub`.\n"
        f" * Regenerate via pipeline/vendor_libs.py. */\n"
    )
    wrapped = (
        header
        + "(function (root) {\n"
        + body
        + "\n  root.createPubSub = createPubSub;\n  root.globalPubSub = globalPubSub;\n"
        + "})(typeof globalThis !== 'undefined' ? globalThis : window);\n"
    )
    (VENDOR / "pub-sub-es.js").write_text(wrapped, encoding="utf-8")
    print(f"pub-sub-es@{ver}  ({len(wrapped)/1024:.1f} KB)  -> pub-sub-es.js (ESM wrapped to global createPubSub)")
    manifest.append(("pub-sub-es.js", "pub-sub-es", ver, "/dist/index.js (wrapped to global)", len(wrapped)))


def main():
    VENDOR.mkdir(parents=True, exist_ok=True)
    manifest = []
    for pkg, spec in UMD_PKGS:
        vendor_umd(pkg, spec, manifest)
    vendor_pubsub(PUBSUB_SPEC, manifest)

    (VENDOR / "VENDOR.md").write_text(
        "# Vendored browser libraries\n\n"
        "Downloaded by `pipeline/vendor_libs.py` from jsDelivr (npm). Re-run to update.\n\n"
        "**Load order in index.html: regl → pub-sub-es → regl-scatterplot.**\n\n"
        + "".join(f"- `{n}` — **{p}@{v}** (`{src}`, {sz/1024:.1f} KB)\n" for (n, p, v, src, sz) in manifest),
        encoding="utf-8",
    )
    print("Wrote", VENDOR / "VENDOR.md")


if __name__ == "__main__":
    main()
