// UX-04 measurement: node tools/load/run-load.mjs [--items N] [--movements N] [--runs N] [--json]
// Cold = first call after building the index; warm = repeated calls. Reports p50/p95 (ms) and error rate.
import { generateFixture } from './load-fixture.mjs';
import { createUnifiedCatalog } from '../../worker/catalog/unified-catalog.js';
import { createSearchIndex } from '../../worker/catalog/catalog-search.js';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? Number(process.argv[i + 1]) : d; };
export const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)] : 0; };
export function measure(fn, runs) {
  const t = [], res = { errors: 0 };
  for (let i = 0; i < runs; i++) { const s = performance.now(); try { fn(i); } catch (e) { res.errors++; } t.push(performance.now() - s); }
  return { n: runs, p50: +pct(t, 50).toFixed(3), p95: +pct(t, 95).toFixed(3), errorRate: res.errors / runs };
}
export function run({ items, movements, runs }) {
  const out = {}, f = generateFixture({ items, movements });
  let s = performance.now(); const cat = createUnifiedCatalog(f.products); out.catalogBuildMs = +(performance.now() - s).toFixed(1);
  s = performance.now(); const idx = createSearchIndex(cat); const queries = ['بانادول 100', 'PANADOL 500', '6221000000123', 'aspirin', 'زيرتك'];
  out.search = { cold: measure(() => idx.search(queries[0]), 1) };
  out.indexBuildAndFirstMs = +(performance.now() - s).toFixed(1);
  out.search.warm = measure(i => idx.search(queries[i % queries.length]), runs);
  // movements: derive balances (full scan) and per-code lookup, as the ledger does
  const bal = () => { const o = {}; for (const m of f.movements) o[m.code] = (o[m.code] || 0) + m.delta; return o; };
  out.balances = { cold: measure(bal, 1), warm: measure(bal, 5) };
  out.onHandScan = measure(i => { let t = 0; const c = 'P' + i; for (const m of f.movements) if (m.code === c) t += m.delta; }, 20);
  return out;
}
if (import.meta.url === 'file://' + process.argv[1]) {
  const o = run({ items: arg('items', 100000), movements: arg('movements', 1000000), runs: arg('runs', 200) });
  console.log(JSON.stringify(o, null, 2));
}
