/** Aggregate Transformers.js per-file progress into a monotonic 0–100 bar. */
const LARGE_FILE = 10 * 1024 * 1024;

export function downloadPct(fileBytes, uiPct) {
  const big = [];
  for (const f of fileBytes.values()) {
    if (f && f.total >= LARGE_FILE) big.push(f);
  }
  if (!big.length) return uiPct;
  let loaded = 0;
  let total = 0;
  for (const f of big) {
    loaded += f.loaded || 0;
    total += f.total || 0;
  }
  if (!total) return uiPct;
  let pct = Math.round((100 * loaded) / total);
  if (big.length < 2) pct = Math.min(49, Math.round(pct * 0.5));
  pct = Math.max(0, Math.min(100, pct));
  if (pct < uiPct) return uiPct;
  return pct;
}
