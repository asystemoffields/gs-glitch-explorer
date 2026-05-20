// Loads the two-tier data (see ../DATA_FORMAT.md).
//   Overview tier (eager, from web/data/):  meta.json + glitches.bin.
//   Detail tier  (lazy, from meta.detail.base_url, or web/data/ if empty):
//                conf.bin, ids.txt, uuids.bin.
// The detail tier is fetched only on first detail/gallery/kNN interaction, so it
// never blocks the initial scatter render — and it can live on a CDN (a GitHub
// Release) so the dataset can grow without bloating the Pages repo.

const DATA_DIR = 'data';

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status}`);
  return res.arrayBuffer();
}
async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status}`);
  return res.text();
}

const HEX = [];
for (let i = 0; i < 256; i++) HEX.push(i.toString(16).padStart(2, '0'));

export async function loadData() {
  const meta = await (await fetch(`${DATA_DIR}/meta.json`)).json();
  const N = meta.total_glitches;
  const C = meta.classes.length;
  const idLen = meta.id_length;

  // ---- overview tier ----
  const buf = await fetchBuffer(`${DATA_DIR}/glitches.bin`);
  let o = 0;
  const f32 = (n) => { const a = new Float32Array(buf, o, n); o += n * 4; return a; };
  const u32 = (n) => { const a = new Uint32Array(buf, o, n); o += n * 4; return a; };
  const u8 = (n) => { const a = new Uint8Array(buf, o, n); o += n; return a; };
  const col = {
    x: f32(N), y: f32(N), snr: f32(N), peakFreq: f32(N),
    entropy: f32(N), confidence: f32(N), gpsOff: u32(N),
    labelIdx: u8(N), runIdx: u8(N), ifoIdx: u8(N),
  };
  if (o !== buf.byteLength) throw new Error(`glitches.bin size mismatch: decoded ${o} of ${buf.byteLength} bytes (expected N=${N})`);

  // ---- detail tier (lazy) ----
  const detail = Object.assign(
    { base_url: '', conf_file: 'conf.bin', ids_file: 'ids.txt', uuids_file: 'uuids.bin', uuid_bytes: 16 },
    meta.detail || {});
  const detailBase = detail.base_url ? detail.base_url.replace(/\/+$/, '') : DATA_DIR;
  const images = meta.images || { available: false };

  let conf = null, idsText = null, uuids = null;
  let pConf, pIds, pUuids;
  // Each ensure* caches its promise but CLEARS the cache on failure, so a flaky
  // CDN can be retried (not stuck on a permanently-rejected cached promise), and
  // validates the decoded length against N so a truncated download fails loudly.
  function ensureConf() {
    if (!pConf) pConf = fetchBuffer(`${detailBase}/${detail.conf_file}`)
      .then((b) => { const a = new Uint8Array(b); if (a.length !== N * C) throw new Error(`conf.bin: ${a.length} != ${N * C}`); conf = a; })
      .catch((e) => { pConf = null; throw e; });
    return pConf;
  }
  function ensureIds() {
    if (!pIds) pIds = fetchText(`${detailBase}/${detail.ids_file}`)
      .then((t) => { if (t.length < N * idLen) throw new Error(`ids.txt: ${t.length} < ${N * idLen}`); idsText = t; })
      .catch((e) => { pIds = null; throw e; });
    return pIds;
  }
  function ensureUuids() {
    if (!images.available) return Promise.resolve(null);
    if (!pUuids) pUuids = fetchBuffer(`${detailBase}/${detail.uuids_file}`)
      .then((b) => { const a = new Uint8Array(b); if (a.length !== N * 4 * 16) throw new Error(`uuids.bin: ${a.length} != ${N * 4 * 16}`); uuids = a; })
      .catch((e) => { pUuids = null; throw e; });
    return pUuids;
  }

  const id = (i) => (idsText ? idsText.slice(i * idLen, (i + 1) * idLen).trim() : '');
  function confVec(i) {
    if (!conf) return null;
    const out = new Float32Array(C);
    for (let j = 0; j < C; j++) out[j] = conf[i * C + j] / 255;
    return out;
  }
  function imageUrl(i, d) {
    if (!images.available || !uuids) return null;
    const base = (i * 4 + d) * 16;
    let allZero = true, hex = '';
    for (let k = 0; k < 16; k++) { const b = uuids[base + k]; if (b) allZero = false; hex += HEX[b]; }
    if (allZero) return null;
    const u = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    return images.prefix + u + images.suffix;
  }

  return {
    meta, N, C, col, images,
    classes: meta.classes, classColors: meta.class_colors,
    id,
    gps: (i) => meta.gps_base + col.gpsOff[i],
    className: (i) => meta.classes[col.labelIdx[i]],
    runName: (i) => meta.runs[col.runIdx[i]],
    ifoName: (i) => meta.ifos[col.ifoIdx[i]],
    classColor: (j) => meta.class_colors[j],
    imagesAvailable: () => !!images.available,
    ensureConf, ensureIds, ensureUuids, confVec, rawConf: () => conf, imageUrl,
  };
}
