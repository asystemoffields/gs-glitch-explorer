// Builds the left filter sidebar and wires every control to `state`.
import { el, debounce } from './util.js';
import { makeDualSlider, makeSeg } from './widgets.js';

export function buildFilters(root, data, state) {
  const { meta, C } = data;
  root.innerHTML = '';

  const section = (title, children, headExtra) =>
    el('div', { class: 'section' }, [el('h3', {}, [title, headExtra]), ...children]);
  const hint = (t) => el('div', { class: 'hint', style: { marginTop: '6px' } }, [t]);
  const link = (text, fn) => el('span', { class: 'linkish', onclick: fn }, [text]);
  const sliderInput = (mutate) => debounce((v) => state.update((f) => mutate(f, v)), 40);

  // ---------- Classes ----------
  const countSpans = [];
  const classRows = [];
  const list = el('div', { class: 'classlist' });
  for (let j = 0; j < C; j++) {
    const cnt = el('span', { class: 'cnt' });
    const cb = el('input', { type: 'checkbox' });
    cb.checked = true;
    const row = el('div', { class: 'class-row' }, [
      cb,
      el('span', { class: 'swatch', style: { background: data.classColor(j) } }),
      el('span', { class: 'name', title: meta.classes[j] }, [meta.classes[j]]),
      cnt,
    ]);
    cb.addEventListener('change', () => {
      row.classList.toggle('off', !cb.checked);
      state.update((f) => { f.classOn[j] = cb.checked ? 1 : 0; });
    });
    countSpans.push(cnt);
    classRows.push({ cb, row });
    list.appendChild(row);
  }
  const setAll = (v) => {
    classRows.forEach(({ cb, row }) => { cb.checked = !!v; row.classList.toggle('off', !v); });
    state.update((f) => f.classOn.fill(v));
  };
  root.appendChild(section('Classes', [list],
    el('span', { class: 'count' }, [link('all', () => setAll(1)), ' · ', link('none', () => setAll(0))])));

  // ---------- Detector ----------
  const ifoSeg = makeSeg(['Both', 'H1', 'L1'], 0,
    (_i, lbl) => state.update((f) => { f.ifo = lbl === 'Both' ? 'both' : lbl; }));
  root.appendChild(section('Detector', [ifoSeg.el]));

  // ---------- Observing run ----------
  const runCbs = [];
  const runWrap = el('div', { class: 'row', style: { flexWrap: 'wrap', gap: '10px' } });
  meta.runs.forEach((r, ri) => {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = true;
    cb.addEventListener('change', () => state.update((f) => { f.runOn[ri] = cb.checked ? 1 : 0; }));
    runCbs.push(cb);
    runWrap.appendChild(el('label', { class: 'row', style: { margin: 0 } }, [cb, ' ' + r]));
  });
  root.appendChild(section('Observing run', [runWrap]));

  // ---------- Duplicates ----------
  const dupCount = meta.duplicate_count || 0;
  let dupCb = null;
  if (dupCount > 0) {
    dupCb = el('input', { type: 'checkbox' });
    dupCb.checked = false;
    dupCb.addEventListener('change', () =>
      state.update((f) => { f.showDups = dupCb.checked; }));
    const dupLabel = el('label', { class: 'row', style: { margin: 0 } },
      [dupCb, ` Show duplicates (${dupCount.toLocaleString()})`]);
    root.appendChild(section('Duplicates', [dupLabel,
      hint('The source data contains duplicate gravityspy_id entries. By default only the highest-confidence instance is shown.')]));
  }

  // ---------- SNR ----------
  const snr = makeDualSlider({
    min: meta.snr.min, max: meta.snr.max, value: [meta.snr.min, meta.snr.max], log: true,
    format: (v) => (v >= 100 ? v.toFixed(0) : v.toFixed(1)),
    onInput: sliderInput((f, v) => f.snr = v),
  });
  root.appendChild(section('SNR · log', [snr.el]));

  // ---------- Peak frequency ----------
  const freq = makeDualSlider({
    min: meta.freq.min, max: meta.freq.max, value: [meta.freq.min, meta.freq.max], log: true,
    format: (v) => (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0)),
    onInput: sliderInput((f, v) => f.freq = v),
  });
  root.appendChild(section('Peak frequency · Hz · log', [freq.el]));

  // ---------- ML confidence ----------
  const conf = makeDualSlider({
    min: 0, max: 1, value: [0, 1],
    format: (v) => (v * 100).toFixed(0) + '%',
    onInput: sliderInput((f, v) => f.conf = v),
  });
  root.appendChild(section('ML confidence · assigned class', [conf.el,
    hint('Drag the upper handle down to isolate low-confidence — possibly new-class — glitches.')]));

  // ---------- Entropy ----------
  const ent = makeDualSlider({
    min: 0, max: state.maxEntropy, value: [0, state.maxEntropy], accent: true,
    format: (v) => v.toFixed(2),
    onInput: sliderInput((f, v) => f.entropy = v),
  });
  root.appendChild(section('Confusion · entropy · nats', [ent.el]));

  // ---------- live sync ----------
  function refreshCounts() {
    for (let j = 0; j < C; j++) countSpans[j].textContent = state.classCounts[j].toLocaleString();
  }
  function syncFromState() {
    const f = state.filters;
    classRows.forEach(({ cb, row }, j) => { cb.checked = !!f.classOn[j]; row.classList.toggle('off', !cb.checked); });
    ifoSeg.set(f.ifo === 'both' ? 0 : (f.ifo === 'H1' ? 1 : 2));
    runCbs.forEach((cb, ri) => { cb.checked = !!f.runOn[ri]; });
    if (dupCb) dupCb.checked = !!f.showDups;
    snr.set(f.snr); freq.set(f.freq); conf.set(f.conf); ent.set(f.entropy);
  }
  state.on((evt) => {
    if (evt === 'filters' || evt === 'reset') refreshCounts();
    if (evt === 'reset') syncFromState();
  });
  refreshCounts();
}
