// Colour helpers for the categorical class palette (hex strings from meta.json).

export function hexToRgb255(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function hexToRgb01(hex) {
  return hexToRgb255(hex).map((v) => v / 255);
}

export function hexToCss(hex, alpha = 1) {
  const [r, g, b] = hexToRgb255(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Relative luminance (0..1) — useful to pick black/white text over a swatch. */
export function luminance(hex) {
  const [r, g, b] = hexToRgb01(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Darken a colour if it's too light to read on a light background. */
export function darkenForLight(hex) {
  const [r, g, b] = hexToRgb255(hex);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum <= 0.5) return hex;
  const k = (0.5 / lum) * 0.92;
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return '#' + [c(r), c(g), c(b)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Map a categorical palette to legible-on-light variants (dark mode: unchanged). */
export function paletteForLight(colors) { return colors.map(darkenForLight); }
