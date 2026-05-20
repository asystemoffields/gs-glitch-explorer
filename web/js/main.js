// Orchestrator: load data, wire state <-> scatter <-> panels, and implement the
// discovery, gallery, find-similar, and temporal features.
import { loadData } from './data.js';
import { createState } from './state.js';
import { createScatter } from './scatter.js';
import { buildFilters } from './filters.js';
import { buildStats } from './stats.js';
import { buildDetail } from './detail.js';
import { makeDualSlider } from './widgets.js';
import { $, el, debounce, fmtNum, fmtFreq, gpsToUTC } from './util.js';
import { paletteForLight } from './colors.js';

const GALLERY_MAX = 120;

const floatStyle = (top, side) => ({
  position: 'absolute', top, [side]: '12px', zIndex: 18, width: '236px',
  background: 'var(--panel)', border: '1px solid var(--border-2)',
  borderRadius: '8px', padding: '10px 12px',
});

async function main() {
  const loading = $('#loading');
  let data;
  try {
    data = await loadData();
  } catch (e) {
    loading.innerHTML = '';
    loading.append(el('div', { style: { color: 'var(--danger)', maxWidth: '440px', textAlign: 'center' } }, [
      'Failed to load data: ' + e.message,
      el('div', { class: 'hint', style: { marginTop: '8px' } },
        ['Serve the web/ folder over HTTP (e.g. `python -m http.server`); opening index.html via file:// will not work.']),
    ]));
    return;
  }

  try {
    runApp(data);
    loading.style.display = 'none';
  } catch (e) {
    loading.style.display = 'flex';
    loading.innerHTML = '';
    loading.append(el('div', { style: { color: 'var(--danger)', maxWidth: '440px', textAlign: 'center' } },
      ['App error: ' + e.message, el('pre', { class: 'hint', style: { whiteSpace: 'pre-wrap', marginTop: '8px' } }, [String(e.stack || '')])]));
    throw e;
  }
}

function runApp(data) {
  const state = createState(data);

  // source badge
  const badge = $('#src-badge');
  const synthetic = data.meta.source === 'synthetic' || !!data.meta.synthetic_info;
  badge.textContent = synthetic ? '◇ synthetic demo data' : 'Gravity Spy · Zenodo 5649212';
  badge.classList.toggle('synthetic', synthetic);

  // ---------- scatter + tooltip ----------
  const canvas = $('#scatter-canvas');
  const tooltip = $('#tooltip');
  let lastMouse = { x: 0, y: 0 };
  let hoverIdx = -1;
  canvas.addEventListener('mousemove', (e) => { lastMouse = { x: e.clientX, y: e.clientY }; if (hoverIdx >= 0) positionTooltip(); });
  canvas.addEventListener('mouseleave', hideTooltip);

  const scatter = createScatter({
    canvas, data,
    hooks: {
      onHover: (i) => showTooltip(i),
      onPointOut: hideTooltip,
      onClick: (i) => state.setSelected(i),
      onLasso: (pts) => openGallery(pts, `${pts.length.toLocaleString()} points lassoed`),
      onDeselect: () => state.setSelected(-1),
    },
  });

  function showTooltip(i) {
    hoverIdx = i;
    const c = data.col;
    tooltip.innerHTML = '';
    tooltip.append(
      el('div', { class: 'tt-class' }, [
        el('span', { class: 'swatch', style: { background: data.classColor(c.labelIdx[i]), display: 'inline-block', marginRight: '5px' } }),
        data.className(i),
      ]),
      el('div', { class: 'tt-row' }, [`conf ${(c.confidence[i] * 100).toFixed(0)}%  ·  SNR ${fmtNum(c.snr[i], 1)}  ·  ${fmtFreq(c.peakFreq[i])}`]),
      el('div', { class: 'tt-row' }, [`${data.ifoName(i)}  ·  ${data.runName(i)}  ·  entropy ${fmtNum(c.entropy[i], 2)}`]),
    );
    tooltip.style.display = 'block';
    positionTooltip();
  }
  function positionTooltip() {
    const pad = 14, r = tooltip.getBoundingClientRect();
    let x = lastMouse.x + pad, y = lastMouse.y + pad;
    if (x + r.width > window.innerWidth) x = lastMouse.x - r.width - pad;
    if (y + r.height > window.innerHeight) y = lastMouse.y - r.height - pad;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  }
  function hideTooltip() { hoverIdx = -1; tooltip.style.display = 'none'; }

  // ---------- panels ----------
  buildFilters($('#filters'), data, state);
  buildStats($('#stats'), data, state);
  buildDetail({ panel: $('#detail'), idEl: $('#detail-id'), body: $('#detail-body'), closeEl: $('#detail-close') },
    data, state, { onFindSimilar: findSimilar, onPin: (i) => state.setPinned(i) });

  // ---------- state -> scatter ----------
  const pushEmphasis = debounce(() => scatter.setEmphasis(state.emphasis), 50);
  state.on((evt) => {
    if (evt === 'filters' || evt === 'reset') pushEmphasis();
    if (evt === 'select') { const i = state.selected; if (i >= 0) scatter.select(i); else scatter.deselect(); }
  });
  scatter.setEmphasis(state.emphasis);

  // ---------- gallery ----------
  const gallery = $('#gallery'), gGrid = $('#gallery-grid'), gTitle = $('#gallery-title'), gSub = $('#gallery-sub');
  $('#gallery-close').addEventListener('click', () => gallery.classList.remove('open'));

  async function openGallery(indices, title) {
    gTitle.textContent = 'Selection';
    gSub.textContent = title;
    gGrid.innerHTML = '';
    gallery.classList.add('open');
    const show = indices.slice(0, GALLERY_MAX);
    try { await data.ensureIds(); } catch (e) {}
    if (data.imagesAvailable()) { try { await data.ensureUuidRecords(show); } catch (e) {} }
    for (const i of show) gGrid.appendChild(thumb(i));
    if (indices.length > GALLERY_MAX) gSub.textContent = `${title} — showing ${GALLERY_MAX} of ${indices.length.toLocaleString()}`;
  }
  function thumb(i) {
    const c = data.col;
    let media;
    const url = data.imagesAvailable() ? data.imageUrl(i, 1) : null; // 1.0s view
    if (url) {
      media = el('img', { src: url, loading: 'lazy' });
      media.addEventListener('error', () => { if (media.parentNode) media.parentNode.replaceChild(el('div', { class: 'ph' }, ['no image']), media); });
    } else {
      media = el('div', { class: 'ph', style: { color: data.classColor(c.labelIdx[i]) } }, [`${(c.confidence[i] * 100).toFixed(0)}%`]);
    }
    return el('div', { class: 'gthumb', title: `${data.id(i)} — entropy ${fmtNum(c.entropy[i], 2)}`, onclick: () => state.setSelected(i) }, [
      media,
      el('div', { class: 'cap' }, [
        el('span', { class: 'swatch', style: { background: data.classColor(c.labelIdx[i]) } }),
        el('span', { style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, [data.className(i)]),
      ]),
    ]);
  }

  // ---------- find similar (kNN in confidence space, cosine) ----------
  async function findSimilar(i, K = 60) {
    gSub.textContent = 'computing neighbours…';
    try { await data.ensureConf(); await data.ensureIds(); }
    catch (e) { gSub.textContent = 'could not load data for similarity search'; return; }
    if (state.selected !== i) return;                 // selection changed while loading
    const conf = data.rawConf(), C = data.C, N = data.N;
    const q = new Float32Array(C); let qn = 0;
    for (let j = 0; j < C; j++) { q[j] = conf[i * C + j]; qn += q[j] * q[j]; }
    qn = Math.sqrt(qn) || 1;
    // single-pass top-K (no 677k allocation / full sort); skips the query itself
    const topI = new Int32Array(K).fill(-1);
    const topS = new Float32Array(K).fill(-Infinity);
    let worst = -Infinity, worstAt = 0;
    for (let p = 0; p < N; p++) {
      if (p === i) continue;
      let dot = 0, pn = 0; const b = p * C;
      for (let j = 0; j < C; j++) { const v = conf[b + j]; dot += q[j] * v; pn += v * v; }
      const s = dot / ((Math.sqrt(pn) || 1) * qn);
      if (s > worst) {
        topI[worstAt] = p; topS[worstAt] = s;
        worst = topS[0]; worstAt = 0;
        for (let k = 1; k < K; k++) if (topS[k] < worst) { worst = topS[k]; worstAt = k; }
      }
    }
    const pairs = [];
    for (let k = 0; k < K; k++) if (topI[k] >= 0) pairs.push([topI[k], topS[k]]);
    pairs.sort((a, b) => b[1] - a[1]);
    const idx = pairs.map((p) => p[0]);
    scatter.select(idx);
    scatter.zoomToPoints(idx);
    openGallery(idx, `${idx.length} nearest to ${data.id(i)} in confidence space`);
  }

  // ---------- discovery panel ----------
  let uncCb, lassoCb, thr, thrVal;
  const disc = buildDiscoveryPanel();
  $('#btn-discovery').addEventListener('click', () => {
    const open = disc.style.display === 'none';
    disc.style.display = open ? 'block' : 'none';
    $('#btn-discovery').classList.toggle('active', open);
  });
  function buildDiscoveryPanel() {
    const defaultThreshold = Math.min(1.5, state.maxEntropy);
    uncCb = el('input', { type: 'checkbox' });
    uncCb.addEventListener('change', () => state.update((f, d) => { d.showUncertain = uncCb.checked; }));
    thr = el('input', { type: 'range', min: 0, max: Math.round(state.maxEntropy * 100), value: Math.round(defaultThreshold * 100), style: { width: '100%' } });
    thrVal = el('span', { class: 'hint' }, [defaultThreshold.toFixed(2)]);
    thr.addEventListener('input', () => { const v = +thr.value / 100; thrVal.textContent = v.toFixed(2); state.update((f, d) => { d.uncertainThreshold = v; }); });
    lassoCb = el('input', { type: 'checkbox' });
    lassoCb.addEventListener('change', () => scatter.setLassoMode(lassoCb.checked));
    const panel = el('div', { style: floatStyle('12px', 'left') }, [
      el('h3', {}, ['✦ Discovery']),
      el('label', { class: 'row', style: { cursor: 'pointer' } }, [uncCb, ' Highlight uncertain']),
      el('div', { class: 'row', style: { justifyContent: 'space-between', margin: '4px 0 0' } }, [el('span', { class: 'hint' }, ['entropy ≥']), thrVal]),
      thr,
      el('label', { class: 'row', style: { cursor: 'pointer', marginTop: '8px' } }, [lassoCb, ' Lasso-select (drag)']),
      el('div', { class: 'hint', style: { marginTop: '8px' } }, ['Shift-drag also lassos. Lasso a clump of highlighted points to gallery their spectrograms.']),
    ]);
    panel.style.display = 'none';
    $('#main').appendChild(panel);
    return panel;
  }

  // ---------- temporal ----------
  setupTemporal();
  function setupTemporal() {
    const wrap = $('#temporal'), histo = $('#temporal-histo'), label = $('#temporal-label'), playBtn = $('#temporal-play');
    const gmin = data.meta.gps.min, gmax = data.meta.gps.max, span = (gmax - gmin) || 1;

    const BINS = 90, counts = new Int32Array(BINS);
    for (let i = 0; i < data.N; i++) { let b = ((data.gps(i) - gmin) / span * BINS) | 0; if (b < 0) b = 0; if (b >= BINS) b = BINS - 1; counts[b]++; }
    let cmax = 1; for (let b = 0; b < BINS; b++) cmax = Math.max(cmax, counts[b]);
    histo.innerHTML = '';
    for (let b = 0; b < BINS; b++) histo.appendChild(el('i', { style: { height: Math.max(1, counts[b] / cmax * 34) + 'px' } }));

    const setLabel = (lo, hi) => { label.textContent = `${gpsToUTC(lo).slice(0, 10)} → ${gpsToUTC(hi).slice(0, 10)}`; };
    const slider = makeDualSlider({
      min: gmin, max: gmax, value: [gmin, gmax], format: (v) => gpsToUTC(v).slice(0, 7),
      onInput: debounce((v) => { state.update((f) => { f.time = [v[0], v[1]]; }); setLabel(v[0], v[1]); }, 40),
    });
    $('#temporal-slider').replaceWith(slider.el);

    let playing = null;
    playBtn.addEventListener('click', () => {
      if (playing) { clearInterval(playing); playing = null; playBtn.textContent = '▶ Play'; return; }
      playBtn.textContent = '⏸ Pause';
      const winLen = span * 0.12; let cur = gmin;
      playing = setInterval(() => {
        cur += span / 120; if (cur > gmax) cur = gmin;
        const lo = cur, hi = Math.min(gmax, cur + winLen);
        slider.set([lo, hi]); setLabel(lo, hi); state.update((f) => { f.time = [lo, hi]; });
      }, 150);
    });

    $('#btn-temporal').addEventListener('click', () => {
      const open = !wrap.classList.contains('open');
      wrap.classList.toggle('open', open);
      $('#btn-temporal').classList.toggle('active', open);
      if (playing) { clearInterval(playing); playing = null; playBtn.textContent = '▶ Play'; }
      slider.set([gmin, gmax]);
      label.textContent = 'All time';
      state.update((f) => { f.time = null; });
    });
  }

  // ---------- theme: auto (system) / light / dark ----------
  const THEMES = ['auto', 'light', 'dark'];
  const themeBtn = $('#btn-theme');
  let themePref = localStorage.getItem('gs-theme') || 'auto';
  const isLight = () => {
    const t = document.documentElement.dataset.theme;
    if (t === 'light') return true;
    if (t === 'dark') return false;
    return window.matchMedia('(prefers-color-scheme: light)').matches;
  };
  function applyTheme() {
    if (themePref === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = themePref;
    if (themeBtn) themeBtn.textContent = themePref === 'auto' ? '◐ Auto' : (themePref === 'light' ? '☀ Light' : '☾ Dark');
    const bg = getComputedStyle(document.body).getPropertyValue('--scatter-bg').trim() || '#0a0d13';
    scatter.setTheme(bg, isLight() ? paletteForLight(data.classColors) : data.classColors.slice());
  }
  if (themeBtn) themeBtn.addEventListener('click', () => {
    themePref = THEMES[(THEMES.indexOf(themePref) + 1) % THEMES.length];
    localStorage.setItem('gs-theme', themePref);
    applyTheme();
  });
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (themePref === 'auto') applyTheme(); });
  applyTheme();

  // ---------- header buttons ----------
  $('#btn-reset').addEventListener('click', () => {
    if (uncCb) uncCb.checked = false;
    if (lassoCb) lassoCb.checked = false;
    if (thr && thrVal) {
      const defaultThreshold = Math.min(1.5, state.maxEntropy);
      thr.value = Math.round(defaultThreshold * 100);
      thrVal.textContent = defaultThreshold.toFixed(2);
    }
    scatter.setLassoMode(false);
    gallery.classList.remove('open');
    state.reset();
    scatter.zoomAll();
  });
  $('#btn-help').addEventListener('click', toggleHelp);
  function toggleHelp() {
    const existing = document.getElementById('help-pop');
    if (existing) { existing.remove(); return; }
    const pop = el('div', { id: 'help-pop', style: { ...floatStyle('12px', 'right'), width: '300px', zIndex: 60 } }, [
      el('h3', {}, ['How to use']),
      el('div', {
        class: 'hint', html:
          '• <b>Drag</b> to pan, <b>scroll</b> to zoom.<br>' +
          '• <b>Click</b> a point for spectrograms + the 22-class confidence breakdown.<br>' +
          '• <b>Shift-drag</b> (or Discovery → Lasso) selects a region → spectrogram gallery.<br>' +
          '• Pull the <b>ML-confidence</b> max down, or raise <b>entropy</b>, then ✦ <b>Discovery → Highlight uncertain</b> to surface candidate new classes.<br>' +
          '• <b>Find similar</b> ranks every glitch by confidence-vector similarity.' +
          '<br><br><span style="color:var(--muted-2)">Data: Gravity Spy / LIGO Scientific Collaboration · CC-BY-4.0 · cite Glanzer et al. 2023 (doi:10.1088/1361-6382/acb633) · spectrograms © Zooniverse.</span>',
      }),
      el('button', { class: 'btn sm', style: { marginTop: '8px' }, onclick: () => pop.remove() }, ['Got it']),
    ]);
    $('#main').appendChild(pop);
  }
}

main();
