// Live check of the supplier API on the real Worker (runs on GitHub with the PIN secret).
// Prints only statuses, counts and public product lines. Never prints the PIN or any session.
const base = (process.env.NOVA_WORKER_URL || 'https://nova-rx-preview.elsousypharmacy.workers.dev').replace(/\/+$/, '');
const pin = process.env.NOVA_API_PIN || '';
if (!pin) { console.log('NOVA_API_PIN is not set; nothing checked'); process.exit(0); }
const headers = { 'X-Nova-Pin': pin, 'Content-Type': 'application/json' };

async function call(path, init = {}) {
  const t0 = Date.now();
  const res = await fetch(base + path, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, ms: Date.now() - t0, body };
}

const status = await call('/api/suppliers/status');
console.log(`status: HTTP ${status.status}`, JSON.stringify((status.body && status.body.suppliers || []).map((s) => ({ id: s.id, state: s.state }))));

for (const query of ['أوجمنتين 1 جم (Augmentin 1g)', 'بانادول إكسترا (Panadol Extra 24 Tab)']) {
  const r = await call('/api/suppliers/search', { method: 'POST', body: JSON.stringify({ query, requestedQty: 1 }) });
  const res0 = r.body && r.body.results && r.body.results[0];
  console.log(`search "${query}": HTTP ${r.status} in ${r.ms} ms, offers: ${res0 ? res0.offers.length : 0}, suppliers: ${JSON.stringify((r.body && r.body.suppliers || []).map((s) => `${s.id}:${s.state}`))}`);
  if (res0 && res0.offers[0]) {
    for (const o of res0.offers.slice(0, 3)) {
      console.log(`   ${o.offer.productName} | ${o.packPrice} | stock ${o.offer.stockStatus} | score ${o.score}${o.eligible ? '' : ' | ' + o.reasons.join(',')}`);
    }
  }
}
