// Small DOM + formatting helpers. No dependencies.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** el('div', {class:'x', onclick:fn, dataset:{i:3}}, [childNode, 'text']) */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function debounce(fn, ms = 120) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

// GPS seconds -> approximate UTC. GPS epoch 1980-01-06; Unix offset 315964800;
// minus 18 leap seconds (valid 2017-01-01+; O1 (2015-16) is ~1s off — fine for display).
const GPS_TO_UNIX = 315964800 - 18;
export function gpsToUTC(gps) {
  return new Date((gps + GPS_TO_UNIX) * 1000).toISOString().replace('.000Z', 'Z');
}

export function fmtFreq(hz) {
  return hz >= 1000 ? (hz / 1000).toFixed(2) + ' kHz' : hz.toFixed(1) + ' Hz';
}
export function fmtNum(x, d = 1) { return Number(x).toFixed(d); }
export function fmtInt(x) { return Math.round(x).toLocaleString(); }
