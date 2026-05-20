// Stats sidebar: totals, visible class mix, and detector split.
import { el } from './util.js';

export function buildStats(root, data, state) {
  const { meta, C, N } = data;
  root.innerHTML = '';

  const total = el('b', {}, [N.toLocaleString()]);
  const shown = el('b');
  const shownPct = el('span', { class: 'hint' });
  const dist = el('div', { class: 'distbar' });
  const segs = [];
  for (let j = 0; j < C; j++) {
    const s = el('span', { style: { background: data.classColor(j) } });
    segs.push(s);
    dist.appendChild(s);
  }
  const ifoLine = el('b');

  root.append(
    el('h3', { style: { margin: '0 0 8px' } }, ['Stats']),
    el('div', { class: 'stat-line' }, ['Total glitches', total]),
    el('div', { class: 'stat-line' }, [el('span', {}, ['Shown ', shownPct]), shown]),
    dist,
    el('div', { class: 'hint', style: { margin: '2px 0 8px' } }, ['Class mix (visible) — hover for counts']),
    el('div', { class: 'stat-line' }, ['Detector', ifoLine]),
  );

  function refresh() {
    const v = state.visibleCount;
    shown.textContent = v.toLocaleString();
    shownPct.textContent = N ? `(${(v / N * 100).toFixed(1)}%)` : '';
    for (let j = 0; j < C; j++) {
      segs[j].style.width = (v ? state.classCounts[j] / v * 100 : 0) + '%';
      segs[j].title = `${meta.classes[j]}: ${state.classCounts[j].toLocaleString()}`;
    }
    ifoLine.textContent = meta.ifos.map((nm, k) => `${nm} ${state.ifoCounts[k].toLocaleString()}`).join('   ·   ');
  }
  state.on((evt) => { if (evt === 'filters' || evt === 'reset') refresh(); });
  refresh();
}
