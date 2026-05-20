// Thin wrapper around regl-scatterplot (UMD global `createScatterplot`).
// - x/y are normalised to NDC [-1,1] (the library does NOT auto-fit).
// - class -> colour via the categorical `valueA` channel.
// - emphasis category (0..3) -> opacity via the categorical `valueB` channel,
//   so we get exact discrete alpha levels with no interpolation surprises.

export function createScatter({ canvas, data, hooks = {} }) {
  // regl-scatterplot's UMD assigns the *namespace* to window.createScatterplot;
  // the factory is its `.default` export. Resolve robustly.
  const _ns = (typeof createScatterplot !== 'undefined') ? createScatterplot : undefined;
  const makeScatterplot = typeof _ns === 'function' ? _ns : (_ns && (_ns.default || _ns.createScatterplot));
  if (typeof makeScatterplot !== 'function') {
    throw new Error('regl-scatterplot factory not found — global shape: ' +
      (_ns ? '{' + Object.keys(_ns).join(',') + '}' : 'undefined') + ' (check vendor/ <script> tags)');
  }
  const { N, col, meta } = data;

  // normalise positions to [-1, 1]
  const b = meta.bounds;
  const maxAbs = Math.max(Math.abs(b.xmin), Math.abs(b.xmax), Math.abs(b.ymin), Math.abs(b.ymax)) || 1;
  const inv = 1 / maxAbs;
  const xN = new Float32Array(N);
  const yN = new Float32Array(N);
  for (let i = 0; i < N; i++) { xN[i] = col.x[i] * inv; yN[i] = col.y[i] * inv; }

  // Frame the actual (normalised) data extent, not the whole [-1,1] box — real
  // UMAP output is off-centre, so [-1,1] would leave large empty margins.
  const _m = 0.04;
  const dataArea = {
    x: b.xmin * inv - (b.xmax - b.xmin) * inv * _m,
    y: b.ymin * inv - (b.ymax - b.ymin) * inv * _m,
    width: (b.xmax - b.xmin) * inv * (1 + 2 * _m),
    height: (b.ymax - b.ymin) * inv * (1 + 2 * _m),
  };

  const valueA = col.labelIdx;             // Uint8 0..C-1  -> categorical colour
  let valueB = new Uint8Array(N).fill(2);  // emphasis 0..3 -> categorical opacity

  const sp = makeScatterplot({
    canvas,
    width: 'auto',
    height: 'auto',
    pointSize: 3,
    pointSizeSelected: 5,
    backgroundColor: '#0a0d13',
    pointColor: data.classColors.slice(),          // one CSS hex per class
    colorBy: 'valueA',
    opacityBy: 'valueB',
    opacity: [0.03, 0.12, 0.80, 1.0],              // indexed by emphasis category
    pointColorActive: '#ffffff',
    pointOutlineWidth: 2,
    lassoColor: [1, 0.82, 0.4, 0.9],
    lassoLineWidth: 2,
    deselectOnDblClick: true,
    deselectOnEscape: true,
  });

  let drawing = false;
  let needsDraw = false;
  let pendingExtra = {};
  function draw(extra = {}) {
    pendingExtra = { ...pendingExtra, ...extra };
    needsDraw = true;
    if (drawing) return;
    drawing = true;
    Promise.resolve().then(async () => {
      while (needsDraw) {
        needsDraw = false;
        const opts = pendingExtra;
        pendingExtra = {};
        await sp.draw({ x: xN, y: yN, valueA, valueB },
          { zDataType: 'categorical', wDataType: 'categorical', preventFilterReset: true, ...opts });
      }
      drawing = false;
    }).catch((e) => {
      drawing = false;
      setTimeout(() => { throw e; });
    });
  }
  draw();
  sp.zoomToArea(dataArea);

  // Distinguish a single click (-> detail) from a lasso (-> gallery). The lasso
  // publishes `select` *before* `lassoEnd`, but always after `lassoStart`, so we
  // latch "a lasso gesture is in progress" on lassoStart and read it in select.
  let lassoing = false;
  sp.subscribe('pointOver', (i) => hooks.onHover && hooks.onHover(i));
  sp.subscribe('pointOut', () => hooks.onPointOut && hooks.onPointOut());
  sp.subscribe('lassoStart', () => { lassoing = true; });
  sp.subscribe('lassoEnd', () => { lassoing = false; });
  sp.subscribe('select', ({ points }) => {
    if (!points || points.length === 0) return;
    if (lassoing || points.length > 1) hooks.onLasso && hooks.onLasso(points);
    else hooks.onClick && hooks.onClick(points[0]);
  });
  sp.subscribe('deselect', () => hooks.onDeselect && hooks.onDeselect());

  return {
    raw: sp,
    setEmphasis(arr) { valueB = arr; draw(); },
    setTheme(bg, palette) { sp.set({ backgroundColor: bg, pointColor: palette }); draw(); },
    setPointSize(px) { sp.set({ pointSize: px }); },
    setLassoMode(on) { sp.set({ mouseMode: on ? 'lasso' : 'panZoom' }); },
    select(idx) { sp.select(Array.isArray(idx) ? idx : [idx], { preventEvent: true }); },
    deselect() { sp.deselect({ preventEvent: true }); },
    zoomAll() { sp.zoomToArea(dataArea, { transition: true }); },
    zoomToPoints(idx) { if (idx && idx.length) sp.zoomToPoints(idx, { transition: true, padding: 0.3 }); },
    screenPos(i) { return sp.getScreenPosition(i); },
    refresh() { sp.refresh(); },
    destroy() { sp.destroy(); },
  };
}
