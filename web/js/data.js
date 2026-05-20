// Loads the two-tier data (see ../DATA_FORMAT.md).
//   Overview tier (eager, from web/data/):  meta.json + glitches.bin.
//   Detail tier  (lazy, from meta.detail.base_url, or web/data/ if empty):
//                conf.bin, ids.txt, uuids.bin.
// The detail tier is fetched only on first detail/gallery/kNN interaction, so it
// never blocks the initial scatter render — and it can live on a CORS-enabled
// object store so the dataset can grow without bloating the Pages repo.

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
async function fetchRange(url, start, end) {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (!res.ok) throw new Error(`failed to load ${url} bytes ${start}-${end}: ${res.status}`);
  return { status: res.status, buffer: await res.arrayBuffer() };
}

const HEX = [];
for (let i = 0; i < 256; i++) HEX.push(i.toString(16).padStart(2, '0'));

export async function loadData() {
  const meta = await (await fetch(`${DATA_DIR}/meta.json?t=${Date.now()}`)).json();
  const N = meta.total_glitches;
  const C = meta.classes.length;
  const idLen = meta.id_length;
  // Cache-busting: meta.json is always fetched fresh (above); the big data files
  // are cached but keyed by meta.version (a content hash), so a new pipeline run
  // makes browsers refetch instead of serving stale bytes.
  const vq = meta.version ? `?v=${encodeURIComponent(meta.version)}` : '';

  // ---- overview tier ----
  const buf = await fetchBuffer(`${DATA_DIR}/glitches.bin${vq}`);
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
  const durations = Array.isArray(images.durations) && images.durations.length
    ? images.durations : ['0.5', '1.0', '2.0', '4.0'];
  const durationCount = durations.length;
  const uuidBytes = detail.uuid_bytes || 16;
  const uuidRecordBytes = durationCount * uuidBytes;
  const uuidTotalBytes = N * uuidRecordBytes;
  const uuidUrl = `${detailBase}/${detail.uuids_file}${vq}`;

  let conf = null, idsText = null, uuids = null;
  let pConf, pIds, pUuids;
  const uuidRecords = new Map();
  const pUuidRecords = new Map();
  // Each ensure* caches its promise but CLEARS the cache on failure, so a flaky
  // CDN can be retried (not stuck on a permanently-rejected cached promise), and
  // validates the decoded length against N so a truncated download fails loudly.
  function ensureConf() {
    if (!pConf) pConf = fetchBuffer(`${detailBase}/${detail.conf_file}${vq}`)
      .then((b) => { const a = new Uint8Array(b); if (a.length !== N * C) throw new Error(`conf.bin: ${a.length} != ${N * C}`); conf = a; })
      .catch((e) => { pConf = null; throw e; });
    return pConf;
  }
  function ensureIds() {
    if (!pIds) pIds = fetchText(`${detailBase}/${detail.ids_file}${vq}`)
      .then((t) => { if (t.length < N * idLen) throw new Error(`ids.txt: ${t.length} < ${N * idLen}`); idsText = t; })
      .catch((e) => { pIds = null; throw e; });
    return pIds;
  }
  function ensureUuids() {
    if (!images.available) return Promise.resolve(null);
    if (!pUuids) pUuids = fetchBuffer(uuidUrl)
      .then((b) => { const a = new Uint8Array(b); if (a.length !== uuidTotalBytes) throw new Error(`uuids.bin: ${a.length} != ${uuidTotalBytes}`); uuids = a; })
      .catch((e) => { pUuids = null; throw e; });
    return pUuids;
  }
  function storeUuidRecord(i, a) {
    if (a.length !== uuidRecordBytes) throw new Error(`uuid record ${i}: ${a.length} != ${uuidRecordBytes}`);
    uuidRecords.set(i, a);
  }
  function ensureUuidRecord(i) {
    if (!images.available || i < 0 || i >= N) return Promise.resolve(null);
    if (uuids || uuidRecords.has(i)) return Promise.resolve(null);
    if (!pUuidRecords.has(i)) {
      const start = i * uuidRecordBytes;
      const end = start + uuidRecordBytes - 1;
      pUuidRecords.set(i, fetchRange(uuidUrl, start, end)
        .then(({ status, buffer }) => {
          const a = new Uint8Array(buffer);
          if (status === 206) {
            storeUuidRecord(i, a);
          } else if (a.length === uuidTotalBytes) {
            uuids = a;
          } else {
            storeUuidRecord(i, a);
          }
        })
        .catch((e) => { pUuidRecords.delete(i); throw e; }));
    }
    return pUuidRecords.get(i);
  }
  function ensureUuidRecords(indices) {
    if (!images.available || uuids) return Promise.resolve(null);
    const list = (Array.isArray(indices) || ArrayBuffer.isView(indices)) ? Array.from(indices) : [indices];
    const wanted = [...new Set(list.filter((i) => Number.isInteger(i) && i >= 0 && i < N))];
    return Promise.all(wanted.map(ensureUuidRecord)).then(() => null);
  }
  function uuidRecord(i) {
    if (uuids) return uuids.subarray(i * uuidRecordBytes, (i + 1) * uuidRecordBytes);
    return uuidRecords.get(i) || null;
  }

  const id = (i) => (idsText ? idsText.slice(i * idLen, (i + 1) * idLen).trim() : '');
  function confVec(i) {
    if (!conf) return null;
    const out = new Float32Array(C);
    for (let j = 0; j < C; j++) out[j] = conf[i * C + j] / 255;
    return out;
  }
  function imageUrl(i, d) {
    if (!images.available || d < 0 || d >= durationCount || uuidBytes !== 16) return null;
    const rec = uuidRecord(i);
    if (!rec) return null;
    const base = d * uuidBytes;
    let allZero = true, hex = '';
    for (let k = 0; k < uuidBytes; k++) { const b = rec[base + k]; if (b) allZero = false; hex += HEX[b]; }
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
    ensureConf, ensureIds, ensureUuids, ensureUuidRecord, ensureUuidRecords,
    confVec, rawConf: () => conf, imageUrl,
  };
}
