// Central app state + the filter/mask engine. Library-independent.
//
// recompute() is one O(N) pass over all glitches that produces:
//   - visible[i]      : 1 if the point passes all active filters
//   - emphasis[i]     : display category fed to the scatter (0 filtered .. 3 bright)
//   - classCounts[j]  : visible count per class (drives the class list + stats)
//   - ifoCounts[k]    : visible count per detector
// It runs on every filter change (debounced for slider drags). At ~677k points
// this is well under a frame, so filtering feels instant.

// Emphasis categories -> mapped to actual alpha by scatter.js (categorical valueB).
const EMPH_FILTERED = 0;   // failed a filter: faint context
const EMPH_DIMMED = 1;     // visible but not "uncertain" while Discovery highlight is on
const EMPH_VISIBLE = 2;    // normal visible
const EMPH_BRIGHT = 3;     // visible AND high-entropy while Discovery highlight is on

export function createState(data) {
  const { N, C, col, meta } = data;
  const nRuns = meta.runs.length;
  const maxEntropy = Math.log(C);

  const listeners = new Set();
  const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const emit = (evt) => listeners.forEach((l) => l(evt, state));

  const defaults = () => ({
    classOn: new Uint8Array(C).fill(1),
    ifo: 'both',                          // 'both' | 'H1' | 'L1'
    runOn: new Uint8Array(nRuns).fill(1),
    snr: [meta.snr.min, meta.snr.max],
    freq: [meta.freq.min, meta.freq.max],
    conf: [0, 1],
    entropy: [0, maxEntropy],
    time: null,                           // null = all; else [gpsMin, gpsMax]
  });

  const f = defaults();
  const d = { showUncertain: false, uncertainThreshold: 1.5, sizeBySnr: false };

  let selected = -1;
  let pinned = -1;

  const emphasis = new Uint8Array(N);
  const visible = new Uint8Array(N);
  const classCounts = new Int32Array(C);
  const ifoCounts = new Int32Array(meta.ifos.length);
  let visibleCount = 0;

  const ifoIndex = { H1: meta.ifos.indexOf('H1'), L1: meta.ifos.indexOf('L1') };

  function recompute() {
    const { snr, peakFreq, confidence, entropy, labelIdx, runIdx, ifoIdx, gpsOff } = col;
    const snrLo = f.snr[0], snrHi = f.snr[1];
    const fLo = f.freq[0], fHi = f.freq[1];
    const cLo = f.conf[0], cHi = f.conf[1];
    const eLo = f.entropy[0], eHi = f.entropy[1];
    const ifoF = f.ifo === 'both' ? -1 : ifoIndex[f.ifo];
    const hasTime = !!f.time;
    const tLo = hasTime ? f.time[0] - meta.gps_base : 0;
    const tHi = hasTime ? f.time[1] - meta.gps_base : 0;
    const showUnc = d.showUncertain, uth = d.uncertainThreshold;

    classCounts.fill(0);
    ifoCounts.fill(0);
    let vis = 0;
    for (let i = 0; i < N; i++) {
      const li = labelIdx[i];
      let ok = f.classOn[li] === 1 &&
        f.runOn[runIdx[i]] === 1 &&
        (ifoF < 0 || ifoIdx[i] === ifoF) &&
        snr[i] >= snrLo && snr[i] <= snrHi &&
        peakFreq[i] >= fLo && peakFreq[i] <= fHi &&
        confidence[i] >= cLo && confidence[i] <= cHi &&
        entropy[i] >= eLo && entropy[i] <= eHi;
      if (ok && hasTime) { const t = gpsOff[i]; ok = t >= tLo && t <= tHi; }

      if (ok) {
        visible[i] = 1; vis++; classCounts[li]++; ifoCounts[ifoIdx[i]]++;
        emphasis[i] = showUnc ? (entropy[i] >= uth ? EMPH_BRIGHT : EMPH_DIMMED) : EMPH_VISIBLE;
      } else {
        visible[i] = 0;
        emphasis[i] = EMPH_FILTERED;
      }
    }
    visibleCount = vis;
  }

  const state = {
    data, filters: f, discovery: d, emphasis, visible, classCounts, ifoCounts, maxEntropy,
    get visibleCount() { return visibleCount; },
    get selected() { return selected; },
    get pinned() { return pinned; },
    on,
    recompute,
    /** Mutate filters/discovery inside fn, then recompute + notify. */
    update(fn) { fn(f, d); recompute(); emit('filters'); },
    setSelected(i) { selected = i; emit('select'); },
    setPinned(i) { pinned = i; emit('pin'); },
    reset() { Object.assign(f, defaults()); d.showUncertain = false; recompute(); emit('filters'); emit('reset'); },
  };

  recompute();
  return state;
}
