// Live check of the supplier API on the real Worker (runs on GitHub with the PIN secret).
// READ ONLY: it only calls status, sellers and search. It never calls a cart or order route.
// Prints only statuses, counts and public product lines. Never prints the PIN or any session.
// Contract checked since #112: a search with no warehouse selection returns NO Aumet offer, and a
// scoped search returns Aumet offers only from the selected warehouses.
const base = (process.env.NOVA_WORKER_URL || 'https://nova-rx-preview.elsousypharmacy.workers.dev').replace(/\/+$/, '');
const pin = process.env.NOVA_API_PIN || '';
if (!pin) { console.log('NOVA_API_PIN is not set; nothing checked'); process.exit(0); }
const headers = { 'X-Nova-Pin': pin, 'Content-Type': 'application/json' };

async function call(path, init = {}) {
  const t0 = Date.now();
  let res, body = null;
  try { res = await fetch(base + path, { ...init, headers: { ...headers, ...(init.headers || {}) }, signal: AbortSignal.timeout(70000) }); }
  catch (e) { return { status: 0, ms: Date.now() - t0, body: null, error: e.name }; }
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, ms: Date.now() - t0, body };
}
const counts = s => (s.rows === undefined ? '' : `(rows=${s.rows},readable=${s.readable},drifted=${s.drifted},selected=${s.selected},shown=${s.shown},noSeller=${s.noSeller}${s.sellerSample && s.sellerSample.length ? ',sample=' + JSON.stringify(s.sellerSample) : ''})`);
const states = r => JSON.stringify((r.body && r.body.suppliers || []).map(s => `${s.id}:${s.state}${counts(s)}${s.message ? ' ' + s.message : ''}`));
const allOffers = r => ((r.body && r.body.results) || []).flatMap(x => x.offers || []);
let failed = false;
const fail = msg => { console.log('FAIL: ' + msg); failed = true; };

const status = await call('/api/suppliers/status');
console.log(`status: HTTP ${status.status}`, JSON.stringify((status.body && status.body.suppliers || []).map(s => ({ id: s.id, state: s.state }))));

const sellers = await call('/api/suppliers/sellers');
const sellerRows = (sellers.body && sellers.body.sellers) || [];
const unlocked = sellerRows.filter(s => !s.locked).map(s => String(s.id));
console.log('LIST id:name -> ' + JSON.stringify(sellerRows.slice(0, 20).map(s => `${s.id}:${s.name}${s.locked ? ':locked' : ''}`)));
console.log(`sellers: HTTP ${sellers.status}, unlocked Aumet warehouses: ${unlocked.length}${unlocked.length ? '' : ' (none readable: the Aumet session is missing or expired)'}`);
const scope = unlocked.slice(0, 5);

for (const query of ['أوجمنتين 1 جم (Augmentin 1g)', 'بانادول إكسترا (Panadol Extra 24 Tab)']) {
  // A) no selection: must never return an Aumet offer (fail closed).
  const open = await call('/api/suppliers/search', { method: 'POST', body: JSON.stringify({ query, requestedQty: 1 }) });
  const openAumet = allOffers(open).filter(o => o.offer && o.offer.supplierId === 'aumet').length;
  console.log(`unscoped "${query}": HTTP ${open.status}, Aumet offers ${openAumet} (must be 0), suppliers: ${states(open)}`);
  if (open.status === 200 && openAumet > 0) fail('an unscoped search returned Aumet offers');
  // B) scoped to the first warehouses: offers must come only from them.
  if (!scope.length) { console.log(`scoped "${query}": skipped, no warehouses readable`); continue; }
  const scoped = await call('/api/suppliers/search', { method: 'POST', body: JSON.stringify({ query, requestedQty: 1, supplierIds: ['aumet', 'pharmaoverseas'], aumetSellerIds: scope }) });
  const offers = allOffers(scoped);
  const aumet = offers.filter(o => o.offer && o.offer.supplierId === 'aumet');
  const outside = aumet.filter(o => !scope.includes(String(o.offer.sellerId))).length;
  console.log(`scoped "${query}" (${scope.length} warehouses): HTTP ${scoped.status} in ${scoped.ms} ms, offers ${offers.length} (Aumet ${aumet.length}, PharmaOverseas ${offers.length - aumet.length}), outside selection ${outside} (must be 0), suppliers: ${states(scoped)}`);
  if (outside > 0) fail('a scoped search returned an Aumet offer from an unselected warehouse');
  for (const o of offers.slice(0, 3)) console.log(`   ${o.offer.supplierId} | ${o.offer.productName} | ${o.packPrice} | stock ${o.offer.stockStatus}`);
}
if (failed) process.exitCode = 1;
