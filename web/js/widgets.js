// Reusable UI widgets (no dependencies beyond util.el).
import { el } from './util.js';

/**
 * Dual-handle range slider over a linear or log scale.
 * makeDualSlider({ min, max, value:[lo,hi], log, accent, format, onInput }) ->
 *   { el, set([lo,hi]), get() }
 * onInput receives [lo, hi] in real (un-mapped) units.
 */
export function makeDualSlider({ min, max, value, log = false, steps = 1000, accent = false,
                                 format = (v) => String(Math.round(v)), onInput }) {
  const safeMin = Math.max(min, 1e-9);   // guard the log scale if a future min <= 0
  const lnmin = log ? Math.log(safeMin) : 0;
  const lnmax = log ? Math.log(Math.max(max, safeMin)) : 0;
  const toVal = (pos) => {
    const t = pos / steps;
    return log ? Math.exp(lnmin + t * (lnmax - lnmin)) : min + t * (max - min);
  };
  const toPos = (v) => {
    const t = log ? (Math.log(v) - lnmin) / (lnmax - lnmin) : (v - min) / (max - min);
    return Math.round(Math.max(0, Math.min(1, t)) * steps);
  };

  const lo = el('input', { type: 'range', min: 0, max: steps, value: toPos(value[0]) });
  const hi = el('input', { type: 'range', min: 0, max: steps, value: toPos(value[1]) });
  const track = el('div', { class: 'track' });
  const fill = el('div', { class: 'fill' });
  const slider = el('div', { class: 'slider' + (accent ? ' accent' : '') }, [track, fill, lo, hi]);
  const readLo = el('span');
  const readHi = el('span');
  const wrap = el('div', {}, [slider, el('div', { class: 'range-readout' }, [readLo, readHi])]);

  let cur = [value[0], value[1]];
  function paint() {
    const a = Math.min(+lo.value, +hi.value), b = Math.max(+lo.value, +hi.value);
    fill.style.left = (a / steps * 100) + '%';
    fill.style.width = ((b - a) / steps * 100) + '%';
    readLo.textContent = format(cur[0]);
    readHi.textContent = format(cur[1]);
  }
  function handle() {
    const a = Math.min(+lo.value, +hi.value), b = Math.max(+lo.value, +hi.value);
    cur = [toVal(a), toVal(b)];
    paint();
    if (onInput) onInput(cur);
  }
  lo.addEventListener('input', handle);
  hi.addEventListener('input', handle);
  paint();

  return {
    el: wrap,
    set(v) { lo.value = toPos(v[0]); hi.value = toPos(v[1]); cur = [v[0], v[1]]; paint(); },
    get: () => cur,
  };
}

/** Segmented button group. makeSeg(['Both','H1','L1'], 0, (i,label)=>{}) -> {el, set(i)} */
export function makeSeg(labels, activeIdx, onPick) {
  let btns;
  const set = (i) => btns.forEach((b, k) => b.classList.toggle('on', k === i));
  btns = labels.map((lbl, i) =>
    el('button', { onclick: () => { set(i); onPick(i, lbl); } }, [lbl]));
  set(activeIdx);
  return { el: el('div', { class: 'seg' }, btns), set };
}
