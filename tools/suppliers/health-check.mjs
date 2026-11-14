// UX201 read-only supplier health check against the live Worker (GET status + one search probe).
// Never calls cart/order/PO routes. Prints/writes states only; never secrets.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
const S = createRequire(import.meta.url)('../../supplier-status.js');
const base = (process.env.NOVA_WORKER_URL || 'https://nova-rx-preview.elsousypharmacy.workers.dev').replace(/\/+$/, '');
const pin = process.env.NOVA_API_PIN || '';
const out = process.argv[2] || 'out/suppliers-status.json';
const KNOWN = [{ id: 'aumet', name: 'Aumet', secrets: ['AUMET_USERNAME', 'AUMET_PASSWORD'] }, { id: 'pharmaoverseas', name: 'PharmaOverseas', secrets: ['PHARMAOVERSEAS_USERNAME', 'PHARMAOVERSEAS_PASSWORD'] }];
const checkedAt = new Date().toISOString();
async function call(path, init = {}) {
  try { const r = await fetch(base + path, { ...init, headers: { 'X-Nova-Pin': pin, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(70000) }); let b = null; try { b = await r.json(); } catch {} return { status: r.status, body: b }; }
  catch { return { status: 0, body: null }; }
}
let items;
if (!pin) items = KNOWN.map(k => ({ id: k.id, name: k.name, state: 'unknown', detail: 'NOVA_API_PIN missing; nothing checked' }));
else {
  const st = await call('/api/suppliers/status');
  if (st.status !== 200) items = KNOWN.map(k => ({ id: k.id, name: k.name, state: S.fromHttp(st.status), detail: 'status HTTP ' + st.status }));
  else {
    const list = st.body.suppliers || [];
    const probe = await call('/api/suppliers/search', { method: 'POST', body: JSON.stringify({ query: 'Panadol', requestedQty: 1, supplierIds: list.map(s => s.id), aumetSellerIds: [] }) });
    const pm = Object.fromEntries(((probe.body && probe.body.suppliers) || []).map(s => [s.id, s]));
    items = list.map(s => ({ id: s.id, name: s.name, state: S.classify(s, probe.status === 200 ? pm[s.id] : { state: 'error', message: 'HTTP ' + probe.status }), detail: s.state + (pm[s.id] ? '/' + pm[s.id].state : '') }));
  }
}
const res = S.build(items, checkedAt);
mkdirSync(out.replace(/[^/]*$/, '') || '.', { recursive: true });
writeFileSync(out, JSON.stringify(res, null, 2));
for (const s of res.suppliers) console.log(`${s.id}: ${s.state} (${s.detail})`);
console.log(JSON.stringify(S.summarize(res.suppliers)));
