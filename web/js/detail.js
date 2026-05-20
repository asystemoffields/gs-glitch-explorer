// The right-hand detail panel for a selected glitch:
// spectrograms (real or placeholder), metadata, the 22-class confidence
// breakdown, and Pin / Find-similar actions (delegated to main via hooks).
import { el, gpsToUTC, fmtFreq, fmtNum } from './util.js';

export function buildDetail(refs, data, state, hooks = {}) {
  const { panel, idEl, body, closeEl } = refs;
  const { col } = data;
  closeEl.addEventListener('click', () => state.setSelected(-1));

  const swatch = (j, extra = {}) =>
    el('span', { class: 'swatch', style: { background: data.classColor(j), display: 'inline-block', verticalAlign: 'middle', ...extra } });

  function placeholderCell(durLabel, note) {
    return el('div', { class: 'speccell' }, [el('div', { class: 'cap' }, [durLabel + ' s']), el('div', { class: 'ph' }, [note])]);
  }
  function imgCell(durLabel, url) {
    const ph = el('div', { class: 'ph' }, ['image unavailable']);
    const img = el('img', { src: url, loading: 'lazy', alt: durLabel + 's spectrogram' });
    const cell = el('div', { class: 'speccell' }, [el('div', { class: 'cap' }, [durLabel + ' s']), img]);
    img.addEventListener('error', () => { if (img.parentNode === cell) cell.replaceChild(ph, img); });
    return cell;
  }
  async function spectroGrid(i, small = false) {
    const durs = (data.meta.images && data.meta.images.durations) || ['0.5', '1.0', '2.0', '4.0'];
    const grid = el('div', { class: 'specgrid' });
    let ok = data.imagesAvailable();
    if (ok) { try { await data.ensureUuids(); } catch (e) { ok = false; } }
    if (ok) {
      durs.forEach((dl, d) => {
        const url = data.imageUrl(i, d);
        grid.appendChild(url ? imgCell(dl, url) : placeholderCell(dl, 'no image'));
      });
    } else {
      const note = data.imagesAvailable() ? 'spectrogram unavailable' : 'synthetic — no spectrogram';
      durs.forEach((dl) => grid.appendChild(placeholderCell(dl, note)));
    }
    return grid;
  }

  function metaTable(i) {
    const rows = [
      ['Class', el('span', {}, [swatch(col.labelIdx[i], { marginRight: '6px' }), data.className(i)])],
      ['ML confidence', (col.confidence[i] * 100).toFixed(1) + '%'],
      ['Entropy', fmtNum(col.entropy[i], 3) + ' nats'],
      ['SNR', fmtNum(col.snr[i], 1)],
      ['Peak frequency', fmtFreq(col.peakFreq[i])],
      ['Detector', data.ifoName(i)],
      ['Observing run', data.runName(i)],
      ['GPS', String(data.gps(i))],
      ['UTC', gpsToUTC(data.gps(i))],
    ];
    return el('table', { class: 'meta-table' },
      rows.map(([k, v]) => el('tr', {}, [el('td', {}, [k]), el('td', {}, [v])])));
  }

  function confBars(i) {
    const wrap = el('div', { class: 'confbars' }, [el('div', { class: 'hint' }, ['Loading confidence vector…'])]);
    data.ensureConf().then(() => {
      if (state.selected !== i) return;
      const vec = data.confVec(i);
      const order = [...vec.keys()].sort((a, b) => vec[b] - vec[a]);
      const top = order[0];
      wrap.innerHTML = '';
      order.forEach((j) => {
        const v = vec[j];
        wrap.appendChild(el('div', { class: 'confbar' + (j === top ? ' top' : '') }, [
          el('span', { class: 'lbl', title: data.classes[j] }, [data.classes[j]]),
          el('div', { class: 'barwrap' }, [el('div', { class: 'bar', style: { width: (v * 100).toFixed(1) + '%', background: data.classColor(j) } })]),
          el('span', { class: 'val' }, [(v * 100).toFixed(v >= 0.1 ? 0 : 1)]),
        ]));
      });
    }).catch(() => {
      wrap.innerHTML = '';
      wrap.appendChild(el('div', { class: 'hint' }, ['Could not load confidence data.']));
    });
    return wrap;
  }

  async function pinnedCompare(i) {
    const p = state.pinned;
    if (p < 0 || p === i) return null;
    const grid = await spectroGrid(p, true);
    return el('div', { style: { marginBottom: '12px' } }, [
      el('div', { class: 'hint', style: { marginBottom: '6px' } }, [
        '📌 Pinned for comparison: ', el('span', { style: { color: 'var(--accent-2)' } }, [data.id(p)]),
        ' — ', swatch(col.labelIdx[p], { marginRight: '4px' }), data.className(p),
      ]),
      grid,
    ]);
  }

  async function render(i) {
    try { await data.ensureIds(); } catch (e) { /* id falls back to '' below */ }
    if (state.selected !== i) return;
    idEl.textContent = data.id(i) || '(id unavailable)';
    body.innerHTML = '';
    const pinBlock = await pinnedCompare(i);
    const grid = await spectroGrid(i);
    if (state.selected !== i) return; // selection changed while awaiting
    const isPinned = state.pinned === i;
    body.append(
      ...(pinBlock ? [pinBlock, el('div', { class: 'hint', style: { marginBottom: '4px' } }, ['Selected:'])] : []),
      grid,
      el('div', { class: 'detail-actions' }, [
        el('button', { class: 'btn sm accent', onclick: () => hooks.onFindSimilar && hooks.onFindSimilar(i) }, ['✦ Find similar']),
        el('button', { class: 'btn sm' + (isPinned ? ' active' : ''), onclick: () => { state.setPinned(isPinned ? -1 : i); render(i); } },
          [isPinned ? '📌 Unpin' : '📌 Pin']),
      ]),
      metaTable(i),
      el('h3', { style: { margin: '14px 0 6px', color: 'var(--muted)' } }, ['ML confidence breakdown']),
      confBars(i),
    );
  }

  state.on((evt) => {
    if (evt !== 'select') return;
    const i = state.selected;
    if (i >= 0) { panel.classList.add('open'); render(i); }
    else { panel.classList.remove('open'); }
  });
}
