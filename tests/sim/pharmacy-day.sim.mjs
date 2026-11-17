// Pharmacy-day simulation: N devices + ONE real backend (in-memory D1), seeded random day with offline periods, lost responses,
// random sales (cash/credit), partial returns, collections, receipts and shift closes. At the end every device syncs until quiet and
// the invariants are checked. Usage: node tests/sim/pharmacy-day.sim.mjs [seed] [steps] [devices]
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { createTenant } from '../../backend/src/onboarding.js';
import { createUser, login } from '../../backend/src/auth/auth.js';
import { stockOnHand } from '../../backend/src/sales/service.js';

const require = createRequire(import.meta.url);
const { createOutbox } = require('../../offline-outbox.js');
const { createLedger } = require('../../stock-ledger.js');
const { createBackendClient } = require('../../backend-client.js');
const { create: createPosWire, createScheduler } = require('../../pos-sync-wire.js');
const { createCreditLedger } = require('../../credit-ledger.js');
const { create: createCreditSync } = require('../../credit-sync-wire.js');
const { create: createReceiptSync } = require('../../receipt-sync-wire.js');
const { createStore } = require('../../purchase-orders.js');
const { create: createShiftSync, newClosingId } = require('../../shift-sync-wire.js');
const { create: createPoSync } = require('../../po-sync-wire.js');

const SEED = Number(process.argv[2] || 1), STEPS = Number(process.argv[3] || 300), NDEV = Number(process.argv[4] || 3);
let s = SEED >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)], int = (a, b) => a + Math.floor(rnd() * (b - a + 1));

const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
const mk = (sql, a = []) => ({ bind: (...x) => mk(sql, x), async first() { return db.prepare(sql).get(...a) ?? null; }, async all() { return { results: db.prepare(sql).all(...a) }; },
  async run() { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; }, get sql() { return sql; }, get a() { return a; } });
const D1 = { prepare: (q) => mk(q), async batch(list) { db.exec('BEGIN'); try { for (const x of list) db.prepare(x.sql).run(...x.a); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } } };
const kvm = new Map(); const KV = { async get(k) { return kvm.has(k) ? kvm.get(k) : null; }, async put(k, v) { kvm.set(k, v); }, async delete(k) { kvm.delete(k); } };
const env = { NOVA_AUTH: '1', NOVA_SYNC: '1', NOVA_SALES_WRITES: '1', DB: D1, KV, NOVA_API_PIN: 'pin-xyz-1', NOVA_TENANT_ID: 'ten-a' };
const T = await createTenant(D1, { tenantId: 'ten-a', name: 'x', branches: ['b'], owner: { username: 'owner-a', password: 'pw-owner-a-12345' } });
await createUser(KV, { username: 'owner-a', password: 'pw-owner-a-12345', role: 'owner' });
const tok = (await login(env, { username: 'owner-a', password: 'pw-owner-a-12345' })).ok.access_token;
const sc = { tenantId: 'ten-a', branchId: T.branchIds[0] };

const CODES = ['P1', 'P2', 'P3', 'P4'], CUST = ['c1', 'c2', 'c3'];
const stats = { sales: 0, returns: 0, collects: 0, receipts: 0, closes: 0, offlineTicks: 0, lostResponses: 0, droppedRequests: 0 };

function device(name, old) {
  const m = old ? old.map : new Map(); const storage = old ? old.storage : { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
  const outbox = createOutbox(storage, 'nova.outbox', { now: () => Date.now(), baseMs: 1, capMs: 2 });
  const ledger = createLedger(storage, 'nova.stock.ledger');
  const sales = old ? old.sales : []; const returned = old ? old.returned : {}; // saleId -> qty returned
  const d = { name, storage, map: m, outbox, ledger, sales, returned, online: old ? old.online : true, n: old ? old.n : 0 };
  d.fetch = async (u, i) => {
    if (!d.online) { stats.offlineTicks++; throw new Error('offline'); }
    if (rnd() < 0.05) { stats.droppedRequests++; throw new Error('dropped'); }
    const x = new URL(u); const res = await handle(new Request('https://x.test' + x.pathname + x.search, { method: i.method || 'GET', headers: i.headers, body: i.body }), env);
    if (rnd() < 0.05) { stats.lostResponses++; throw new Error('response lost'); } // server applied it, the device never heard
    return res;
  };
  d.client = createBackendClient({ storage, fetch: d.fetch, outbox, getToken: () => tok }); d.client.setUrl('https://api.test'); d.client.setEnabled(true);
  d.credit = createCreditLedger(storage, 'nova.credit');
  d.creditSync = createCreditSync({ storage, outbox, ledger: d.credit }); d.receiptSync = createReceiptSync({ outbox, storage, ledger }); d.shiftSync = createShiftSync({ storage, outbox });
  d.poSync = createPoSync({ storage, outbox });
  d.wire = createPosWire({ outbox, ledger, storage, hasSale: (id) => sales.some((x) => x.id === id), addSale: (r) => { sales.push(r); return true; } });
  d.sched = createScheduler({ client: d.client, wire: d.wire, storage, extras: () => [d.creditSync, d.receiptSync, d.shiftSync, d.poSync], getSale: (id) => sales.find((x) => x.id === id) });
  d.store = createStore(storage, ledger);
  return d;
}
const devs = Array.from({ length: NDEV }, (_, i) => device('D' + (i + 1)));
const own = (d) => d.sales.filter((x) => x.source !== 'SYNC');
const remaining = (d, sale) => sale.lines[0].qty - (d.returned[sale.id] || 0);

async function receive(d) {
  const code = pick(CODES), qty = int(5, 40);
  const po = d.store.create({ supplier: 'S' + int(1, 2), lines: [{ code, name: code, qty, cost: 4 }] });
  d.store.send(po.id, { confirmed: true }); d.store.accept(po.id, { confirmed: true });
  const grn = { ref: 'G' + (++d.n), lines: [{ code, lot: 'L' + int(1, 3), expiry: '2030-01-01', qty, cost: 4 }] };
  const r = d.store.receive(po.id, grn, { confirmed: true }); d.receiptSync.afterReceive(r.po, grn); stats.receipts++;
}
// opening stock: device D1 receives every product first (the real pharmacy imports an opening balance)
for (const c of CODES) { const d = devs[0]; const po = d.store.create({ supplier: 'S0', lines: [{ code: c, name: c, qty: 100, cost: 4 }] }); d.store.send(po.id, { confirmed: true }); d.store.accept(po.id, { confirmed: true }); const grn = { ref: 'OPEN-' + c, lines: [{ code: c, lot: 'L0', expiry: '2030-01-01', qty: 100, cost: 4 }] }; const r = d.store.receive(po.id, grn, { confirmed: true }); d.receiptSync.afterReceive(r.po, grn); }
for (let i = 0; i < 3; i++) for (const d of devs) await d.sched.tick();

let sid = 0;
for (let step = 0; step < STEPS; step++) {
  const d = pick(devs), a = rnd();
  if (rnd() < 0.08) d.online = !d.online;
  if (rnd() < 0.03) { const i = devs.indexOf(d); devs[i] = device(d.name, d); stats.reloads = (stats.reloads || 0) + 1; continue; } // page reload: every module rebuilt from localStorage
  if (rnd() < 0.05) { await Promise.all([d.sched.tick(), pick(devs).sched.tick()]); stats.parallelTicks = (stats.parallelTicks || 0) + 1; continue; } // two devices sync at the same instant
  try {
    if (a < 0.40) { // sale
      const code = pick(CODES), qty = int(1, 3), price = int(5, 20), credit = rnd() < 0.3, id = 's' + (++sid) + d.name;
      const sale = { id, number: id, at: new Date().toISOString(), total: qty * price, payment: credit ? 'credit' : 'cash', customerId: credit ? pick(CUST) : undefined,
        lines: [{ name: code, barcode: code, unit: 'box', unitFactor: 1, price, qty, discount: 0 }] };
      d.sales.push(sale); d.wire.afterSale(sale); stats.sales++;
      if (credit) d.credit.charge({ id, customerId: sale.customerId, amount: sale.total, override: true });
    } else if (a < 0.55) { // partial return of one of this device's own sales
      const cand = own(d).filter((x) => remaining(d, x) > 0); if (cand.length) { const sale = pick(cand), q = int(1, remaining(d, sale)), rid = 'r' + (++sid) + d.name;
        d.wire.afterReturn(sale, { id: rid, saleId: sale.id, lines: [{ idx: 0, qty: q }] }); d.returned[sale.id] = (d.returned[sale.id] || 0) + q; stats.returns++; }
    } else if (a < 0.65) { // collection
      const c = pick(CUST), bal = d.credit.balance(c); if (bal > 0) { d.credit.collect({ id: 'k' + (++sid) + d.name, customerId: c, amount: Math.min(bal, int(1, 20)) }); stats.collects++; }
    } else if (a < 0.72) await receive(d);
    else if (a < 0.76) { const at = Date.now(); const list = JSON.parse(d.storage.getItem('nova-rx-shift-closings-v1') || '[]'); list.push({ id: newClosingId(at), at, period: 'day', periodLabel: 'اليوم', float: 100, expected: 100, counted: 100, diff: 0, cashier: d.name, note: '' }); d.storage.setItem('nova-rx-shift-closings-v1', JSON.stringify(list)); stats.closes++; }
    else await d.sched.tick();
  } catch (e) { console.log('STEP ERROR', step, d.name, String(e && e.message || e)); process.exitCode = 1; }
}

// settle: everybody online, sync until nothing changes
for (const d of devs) d.online = true;
const origRnd = rnd; // no more random failures while settling
d0: for (let round = 0; round < 40; round++) { for (const d of devs) { await d.sched.tick(); } const pend = devs.reduce((n, d) => n + d.outbox.all().filter((e) => e.status !== 'synced').length, 0); if (!pend && round > 4) break d0; await new Promise((r) => setTimeout(r, 5)); }

const problems = [];
const chk = (ok, msg) => { if (!ok) problems.push(msg); };
for (const d of devs) {
  const bad = d.outbox.all().filter((e) => e.status !== 'synced');
  chk(bad.length === 0, `${d.name}: ${bad.length} outbox entries not synced: ` + JSON.stringify(bad.slice(0, 3).map((e) => [e.key, e.status, e.lastError, (e.conflicts || []).length])));
}
for (const c of CODES) {
  const srv = await stockOnHand(env, sc, c); chk(srv >= 0, `server stock negative for ${c}: ${srv}`);
  for (const d of devs) chk(d.ledger.onHand(c) === srv, `${d.name} stock ${c} = ${d.ledger.onHand(c)} but server = ${srv}`);
}
const ids = (d) => d.sales.map((x) => x.id).sort().join(',');
for (const d of devs) chk(ids(d) === ids(devs[0]), `${d.name} sales list differs from ${devs[0].name}: ${d.sales.length} vs ${devs[0].sales.length}`);
for (const c of CUST) for (const d of devs) chk(d.credit.balance(c) === devs[0].credit.balance(c), `${d.name} credit ${c} = ${d.credit.balance(c)} vs ${devs[0].credit.balance(c)}`);
const closeIds = (d) => JSON.parse(d.storage.getItem('nova-rx-shift-closings-v1') || '[]').map((x) => x.id).sort().join(',');
for (const d of devs) chk(closeIds(d) === closeIds(devs[0]), `${d.name} shift closings differ`);
const srvSales = db.prepare('SELECT COUNT(*) c FROM sales').get().c; chk(srvSales === devs[0].sales.length, `server sales ${srvSales} vs devices ${devs[0].sales.length}`);
const srvRet = db.prepare('SELECT COUNT(*) c FROM sale_returns').get().c; chk(srvRet === stats.returns, `server returns ${srvRet} vs made ${stats.returns}`);
const srvSess = db.prepare('SELECT COUNT(*) c FROM cashier_sessions').get().c; chk(srvSess === stats.closes, `server shift sessions ${srvSess} vs made ${stats.closes}`);

if (problems.some((p) => /stock/.test(p)) && process.env.SIM_DIAG) {
  for (const c of CODES) {
    const srv = {}; for (const r of db.prepare('SELECT kind, SUM(qty_delta) q, COUNT(*) n FROM inventory_movements WHERE product_id=? GROUP BY kind').all(c)) srv[r.kind] = r.q + '/' + r.n;
    console.log('DIAG server', c, JSON.stringify(srv));
    for (const d of devs) { const g = {}; for (const m of d.ledger.movements().filter((x) => x.code === c)) { g[m.kind] = g[m.kind] || [0, 0]; g[m.kind][0] += m.delta; g[m.kind][1]++; } console.log('DIAG', d.name, c, JSON.stringify(g)); }
  }
  const dup = db.prepare("SELECT ref_id, COUNT(*) n FROM inventory_movements WHERE kind='receipt' AND ref_type='stock_receipt' GROUP BY ref_id HAVING n>1").all(); console.log('DIAG dup receipt refs', JSON.stringify(dup));
  const keys = {}; for (const d of devs) for (const e of d.outbox.all()) if (/^rcv:/.test(e.key)) (keys[e.key] = keys[e.key] || []).push(d.name); console.log('DIAG receipt keys on >1 device', JSON.stringify(Object.entries(keys).filter(([, v]) => v.length > 1)));
}
console.log(`seed=${SEED} steps=${STEPS} devices=${NDEV}`, JSON.stringify(stats));
if (problems.length) { console.log('PROBLEMS (' + problems.length + '):'); problems.slice(0, 15).forEach((p) => console.log(' - ' + p)); process.exitCode = 1; } else console.log('SIM OK');
