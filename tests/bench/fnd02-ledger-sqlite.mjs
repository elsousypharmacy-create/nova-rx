// FND-02 LOCAL harness: ADR section 4 mini-schema + invariants on SQLite (node:sqlite, in memory / temp file).
// Proves SQLite SEMANTICS and the invariant design only. It measures NOTHING about Cloudflare D1 (latency, batch limits,
// limits per request), Postgres/Hyperdrive, cost, restore or cross-region p95, and it recommends no storage product.
// No network, no accounts, no live data, no secrets. Temp files live in the OS temp dir and are removed.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const SCHEMA = `
CREATE TABLE batch(id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, product_id TEXT NOT NULL, lot TEXT NOT NULL, expiry TEXT NOT NULL, UNIQUE(tenant_id, product_id, lot));
CREATE TABLE stock_balance(tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, batch_id INTEGER NOT NULL REFERENCES batch(id), on_hand INTEGER NOT NULL CHECK(on_hand >= 0), PRIMARY KEY(tenant_id, branch_id, batch_id));
CREATE TABLE stock_movement(id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, batch_id INTEGER NOT NULL REFERENCES batch(id), qty_delta INTEGER NOT NULL CHECK(qty_delta <> 0), kind TEXT NOT NULL CHECK(kind IN ('receive','sale','return')), ref_type TEXT, ref_id TEXT);
CREATE TRIGGER stock_movement_no_update BEFORE UPDATE ON stock_movement BEGIN SELECT RAISE(ABORT,'stock_movement is append-only'); END;
CREATE TRIGGER stock_movement_no_delete BEFORE DELETE ON stock_movement BEGIN SELECT RAISE(ABORT,'stock_movement is append-only'); END;
CREATE TABLE invoice(id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, number TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('final','void')), total_cents INTEGER NOT NULL CHECK(total_cents >= 0), version INTEGER NOT NULL DEFAULT 1, UNIQUE(tenant_id, number));
CREATE TABLE invoice_line(id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL REFERENCES invoice(id), batch_id INTEGER NOT NULL REFERENCES batch(id), qty INTEGER NOT NULL CHECK(qty > 0), unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0), line_total_cents INTEGER NOT NULL CHECK(line_total_cents = qty * unit_price_cents));
CREATE TABLE payment(id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL REFERENCES invoice(id), method TEXT NOT NULL CHECK(method IN ('cash','card','credit')), amount_cents INTEGER NOT NULL CHECK(amount_cents > 0));
CREATE TABLE return_line(id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_line_id INTEGER NOT NULL REFERENCES invoice_line(id), qty INTEGER NOT NULL CHECK(qty > 0));
CREATE TRIGGER return_not_above_sold BEFORE INSERT ON return_line BEGIN
  SELECT RAISE(ABORT,'return exceeds sold') WHERE (SELECT COALESCE(SUM(qty),0) FROM return_line WHERE invoice_line_id = NEW.invoice_line_id) + NEW.qty > (SELECT qty FROM invoice_line WHERE id = NEW.invoice_line_id);
END;
CREATE TABLE journal_entry(id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, ref_type TEXT NOT NULL, ref_id TEXT NOT NULL);
CREATE TABLE journal_line(id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL REFERENCES journal_entry(id), account TEXT NOT NULL, debit_cents INTEGER NOT NULL DEFAULT 0 CHECK(debit_cents >= 0), credit_cents INTEGER NOT NULL DEFAULT 0 CHECK(credit_cents >= 0), CHECK(debit_cents = 0 OR credit_cents = 0));
CREATE TABLE idempotency_key(tenant_id TEXT NOT NULL, key TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL, PRIMARY KEY(tenant_id, key));
`;

export function openDb(path = ':memory:', schema = SCHEMA) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = ' + (path === ':memory:' ? 'MEMORY' : 'WAL') + '; PRAGMA busy_timeout = 5000;');
  if (schema) db.exec(schema);
  return db;
}

const hashOf = o => createHash('sha256').update(JSON.stringify(o)).digest('hex');
const tx = (db, fn) => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; } };

export function receive(db, { tenant, branch, product, lot, expiry, qty }) {
  return tx(db, () => {
    db.prepare('INSERT OR IGNORE INTO batch(tenant_id, product_id, lot, expiry) VALUES(?,?,?,?)').run(tenant, product, lot, expiry);
    const b = db.prepare('SELECT id FROM batch WHERE tenant_id=? AND product_id=? AND lot=?').get(tenant, product, lot);
    db.prepare('INSERT INTO stock_balance(tenant_id, branch_id, batch_id, on_hand) VALUES(?,?,?,?) ON CONFLICT(tenant_id, branch_id, batch_id) DO UPDATE SET on_hand = on_hand + excluded.on_hand').run(tenant, branch, b.id, qty);
    db.prepare("INSERT INTO stock_movement(tenant_id, branch_id, batch_id, qty_delta, kind, ref_type, ref_id) VALUES(?,?,?,?,'receive','receipt',?)").run(tenant, branch, b.id, qty, lot);
    return b.id;
  });
}

// Sell: one transaction = idempotency check + FEFO allocation + invoice + lines + payments + movements + balances + journal.
// req = { tenant, branch, key, number, lines:[{product, qty, unitPriceCents}], payments:[{method, amountCents}] }
// opts.failAt (test hook): 'after-movements' | 'after-journal' throws inside the transaction to prove rollback.
export function sell(db, req, opts = {}) {
  const { tenant, branch, key, number } = req;
  const rh = hashOf({ number, lines: req.lines, payments: req.payments, branch });
  return tx(db, () => {
    const seen = db.prepare('SELECT request_hash, response_json FROM idempotency_key WHERE tenant_id=? AND key=?').get(tenant, key);
    if (seen) { if (seen.request_hash !== rh) throw new Error('idempotency-conflict'); return { ...JSON.parse(seen.response_json), replay: true }; }
    let total = 0; const alloc = [];
    for (const l of req.lines) {
      if (!Number.isInteger(l.qty) || l.qty <= 0 || !Number.isInteger(l.unitPriceCents) || l.unitPriceCents < 0) throw new Error('line-invalid');
      let need = l.qty;
      const batches = db.prepare(`SELECT s.batch_id, s.on_hand FROM stock_balance s JOIN batch b ON b.id = s.batch_id WHERE s.tenant_id=? AND s.branch_id=? AND b.product_id=? AND s.on_hand > 0 AND b.expiry >= date('now') ORDER BY b.expiry ASC, b.id ASC`).all(tenant, branch, l.product);
      for (const b of batches) { if (need === 0) break; const take = Math.min(need, b.on_hand); alloc.push({ batch: b.batch_id, qty: take, price: l.unitPriceCents }); need -= take; }
      if (need > 0) throw new Error('insufficient-stock');
      total += l.qty * l.unitPriceCents;
    }
    const paid = req.payments.reduce((s, p) => s + p.amountCents, 0);
    if (paid !== total) throw new Error('payment-mismatch');
    const inv = db.prepare("INSERT INTO invoice(tenant_id, branch_id, number, status, total_cents) VALUES(?,?,?,'final',?)").run(tenant, branch, number, total);
    const invoiceId = Number(inv.lastInsertRowid);
    for (const a of alloc) {
      db.prepare('INSERT INTO invoice_line(invoice_id, batch_id, qty, unit_price_cents, line_total_cents) VALUES(?,?,?,?,?)').run(invoiceId, a.batch, a.qty, a.price, a.qty * a.price);
      db.prepare("INSERT INTO stock_movement(tenant_id, branch_id, batch_id, qty_delta, kind, ref_type, ref_id) VALUES(?,?,?,?,'sale','invoice',?)").run(tenant, branch, a.batch, -a.qty, number);
      db.prepare('UPDATE stock_balance SET on_hand = on_hand - ? WHERE tenant_id=? AND branch_id=? AND batch_id=?').run(a.qty, tenant, branch, a.batch);
    }
    if (opts.failAt === 'after-movements') throw new Error('injected-failure');
    for (const p of req.payments) db.prepare('INSERT INTO payment(invoice_id, method, amount_cents) VALUES(?,?,?)').run(invoiceId, p.method, p.amountCents);
    const je = Number(db.prepare("INSERT INTO journal_entry(tenant_id, ref_type, ref_id) VALUES(?,'invoice',?)").run(tenant, number).lastInsertRowid);
    for (const p of req.payments) db.prepare('INSERT INTO journal_line(entry_id, account, debit_cents) VALUES(?,?,?)').run(je, p.method === 'credit' ? 'receivable' : p.method, p.amountCents);
    db.prepare("INSERT INTO journal_line(entry_id, account, credit_cents) VALUES(?,'sales',?)").run(je, total);
    if (opts.failAt === 'after-journal') throw new Error('injected-failure');
    const res = { invoiceId, number, totalCents: total };
    db.prepare('INSERT INTO idempotency_key(tenant_id, key, request_hash, response_json) VALUES(?,?,?,?)').run(tenant, key, rh, JSON.stringify(res));
    return res;
  });
}

export function returnLine(db, { tenant, branch, number, invoiceLineId, qty }) {
  return tx(db, () => {
    const l = db.prepare('SELECT il.batch_id, il.unit_price_cents FROM invoice_line il WHERE il.id=?').get(invoiceLineId);
    if (!l) throw new Error('line-not-found');
    db.prepare('INSERT INTO return_line(invoice_line_id, qty) VALUES(?,?)').run(invoiceLineId, qty); // trigger refuses > sold
    db.prepare("INSERT INTO stock_movement(tenant_id, branch_id, batch_id, qty_delta, kind, ref_type, ref_id) VALUES(?,?,?,?,'return','invoice',?)").run(tenant, branch, l.batch_id, qty, number);
    db.prepare('UPDATE stock_balance SET on_hand = on_hand + ? WHERE tenant_id=? AND branch_id=? AND batch_id=?').run(qty, tenant, branch, l.batch_id);
    const je = Number(db.prepare("INSERT INTO journal_entry(tenant_id, ref_type, ref_id) VALUES(?,'return',?)").run(tenant, number).lastInsertRowid);
    db.prepare("INSERT INTO journal_line(entry_id, account, debit_cents) VALUES(?,'sales',?)").run(je, qty * l.unit_price_cents);
    db.prepare("INSERT INTO journal_line(entry_id, account, credit_cents) VALUES(?,'cash',?)").run(je, qty * l.unit_price_cents);
    return { ok: true };
  });
}

// The ADR section 4 invariants. Returns a list of violations (empty = all hold).
export function checkInvariants(db) {
  const v = [];
  const q = sql => db.prepare(sql).all();
  for (const r of q('SELECT i.id, i.total_cents, COALESCE((SELECT SUM(amount_cents) FROM payment WHERE invoice_id=i.id),0) AS paid, COALESCE((SELECT SUM(line_total_cents) FROM invoice_line WHERE invoice_id=i.id),0) AS lines FROM invoice i WHERE i.status = \'final\'')) {
    if (r.paid !== r.total_cents) v.push(`invoice ${r.id}: payments ${r.paid} != total ${r.total_cents}`);
    if (r.lines !== r.total_cents) v.push(`invoice ${r.id}: lines ${r.lines} != total ${r.total_cents}`);
  }
  for (const r of q('SELECT entry_id, SUM(debit_cents) d, SUM(credit_cents) c FROM journal_line GROUP BY entry_id')) if (r.d !== r.c) v.push(`journal ${r.entry_id}: debit ${r.d} != credit ${r.c}`);
  for (const r of q('SELECT s.batch_id, s.branch_id, s.on_hand, COALESCE((SELECT SUM(qty_delta) FROM stock_movement m WHERE m.batch_id=s.batch_id AND m.branch_id=s.branch_id),0) AS mv FROM stock_balance s')) if (r.on_hand !== r.mv) v.push(`batch ${r.batch_id}/${r.branch_id}: on_hand ${r.on_hand} != movements ${r.mv}`);
  for (const r of q('SELECT il.id, il.qty, COALESCE(SUM(rl.qty),0) AS ret FROM invoice_line il LEFT JOIN return_line rl ON rl.invoice_line_id = il.id GROUP BY il.id HAVING ret > il.qty')) v.push(`line ${r.id}: returned ${r.ret} > sold ${r.qty}`);
  for (const r of q('SELECT COUNT(*) AS n FROM (SELECT tenant_id, key FROM idempotency_key GROUP BY tenant_id, key HAVING COUNT(*) > 1)')) if (r.n) v.push('duplicate idempotency keys');
  return v;
}

export const counts = db => Object.fromEntries(['invoice', 'invoice_line', 'payment', 'stock_movement', 'journal_entry', 'journal_line', 'idempotency_key'].map(t => [t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));

// ---- worker thread: one writer with its own connection to the shared file database ----
if (!isMainThread && workerData?.role === 'writer') {
  const db = openDb(workerData.path, null);
  let ok = 0, rejected = 0, busyRetries = 0;
  for (let i = 0; i < workerData.n; i++) {
    for (let attempt = 0; ; attempt++) {
      try {
        sell(db, { tenant: 't1', branch: 'b1', key: `w${workerData.id}-${i}`, number: `W${workerData.id}-${i}`, lines: [{ product: 'P1', qty: 1, unitPriceCents: 1000 }], payments: [{ method: 'cash', amountCents: 1000 }] });
        ok++; break;
      } catch (e) {
        if (/insufficient-stock/.test(e.message)) { rejected++; break; }
        if (/locked|busy/i.test(e.message) && attempt < 50) { busyRetries++; continue; }
        throw e;
      }
    }
  }
  parentPort.postMessage({ id: workerData.id, ok, rejected, busyRetries });
}

// ---- main: assertions + measurements ----
async function main() {
  const out = { note: 'SQLite semantics only; no D1/Postgres/network/cost/restore measurement', cases: 0 };
  const t = async (name, fn) => { await fn(); out.cases++; console.log('  ok', name); };
  const today = new Date(); const iso = d => new Date(today.getTime() + d * 864e5).toISOString().slice(0, 10);
  const seed = db => { receive(db, { tenant: 't1', branch: 'b1', product: 'P1', lot: 'L-late', expiry: iso(400), qty: 500 }); receive(db, { tenant: 't1', branch: 'b1', product: 'P1', lot: 'L-early', expiry: iso(60), qty: 300 }); };
  const mkReq = (n, qty = 2, key = `k${n}`) => ({ tenant: 't1', branch: 'b1', key, number: `INV-${n}`, lines: [{ product: 'P1', qty, unitPriceCents: 1250 }], payments: [{ method: 'cash', amountCents: qty * 1250 }] });

  console.log('Running FND-02 local SQLite harness...');
  await t('FEFO: the earliest-expiry batch is consumed first, then the next', async () => {
    const db = openDb(); seed(db);
    sell(db, mkReq(1, 299)); assert.equal(db.prepare("SELECT on_hand FROM stock_balance s JOIN batch b ON b.id=s.batch_id WHERE b.lot='L-early'").get().on_hand, 1);
    sell(db, mkReq(2, 3));
    const early = db.prepare("SELECT on_hand FROM stock_balance s JOIN batch b ON b.id=s.batch_id WHERE b.lot='L-early'").get().on_hand;
    const late = db.prepare("SELECT on_hand FROM stock_balance s JOIN batch b ON b.id=s.batch_id WHERE b.lot='L-late'").get().on_hand;
    assert.deepEqual([early, late], [0, 498]);
    assert.deepEqual(checkInvariants(db), []);
  });

  await t('expired stock is never sold', async () => {
    const db = openDb(); receive(db, { tenant: 't1', branch: 'b1', product: 'P1', lot: 'L-old', expiry: iso(-5), qty: 10 });
    assert.throws(() => sell(db, mkReq(1, 1)), /insufficient-stock/);
    assert.deepEqual(counts(db).invoice, 0);
  });

  await t('oversell is refused and leaves nothing behind', async () => {
    const db = openDb(); receive(db, { tenant: 't1', branch: 'b1', product: 'P1', lot: 'L1', expiry: iso(100), qty: 5 });
    const before = counts(db);
    assert.throws(() => sell(db, mkReq(1, 6)), /insufficient-stock/);
    assert.deepEqual(counts(db), before);
    assert.throws(() => db.prepare('UPDATE stock_balance SET on_hand = -1').run(), /CHECK/);
  });

  await t('payments must equal the document total; bad lines are refused', async () => {
    const db = openDb(); seed(db);
    const r = mkReq(1, 2); r.payments = [{ method: 'cash', amountCents: 100 }];
    assert.throws(() => sell(db, r), /payment-mismatch/);
    assert.throws(() => sell(db, { ...mkReq(2), lines: [{ product: 'P1', qty: 1.5, unitPriceCents: 10 }] }), /line-invalid/);
    assert.throws(() => sell(db, { ...mkReq(3), lines: [{ product: 'P1', qty: 1, unitPriceCents: 10.5 }] }), /line-invalid/);
    assert.equal(counts(db).invoice, 0);
  });

  await t('idempotency: same key and same payload returns the same invoice once; different payload is refused', async () => {
    const db = openDb(); seed(db);
    const a = sell(db, mkReq(1, 2, 'KEY'));
    for (let i = 0; i < 5; i++) { const again = sell(db, mkReq(1, 2, 'KEY')); assert.equal(again.invoiceId, a.invoiceId); assert.equal(again.replay, true); }
    assert.equal(counts(db).invoice, 1);
    assert.equal(db.prepare('SELECT SUM(qty_delta) s FROM stock_movement WHERE kind=\'sale\'').get().s, -2);
    assert.throws(() => sell(db, mkReq(1, 3, 'KEY')), /idempotency-conflict/);
    assert.equal(counts(db).invoice, 1);
    assert.throws(() => sell(db, { ...mkReq(9, 1, 'K9'), number: 'INV-1' }), /UNIQUE/); // duplicate invoice number
  });

  await t('failure injection: a crash mid-transaction rolls back every table, and the retry succeeds', async () => {
    for (const failAt of ['after-movements', 'after-journal']) {
      const db = openDb(); seed(db);
      const before = counts(db), bal = db.prepare('SELECT SUM(on_hand) s FROM stock_balance').get().s;
      assert.throws(() => sell(db, mkReq(1, 4, 'RETRY'), { failAt }), /injected-failure/);
      assert.deepEqual(counts(db), before); assert.equal(db.prepare('SELECT SUM(on_hand) s FROM stock_balance').get().s, bal);
      const ok = sell(db, mkReq(1, 4, 'RETRY'));
      assert.equal(ok.totalCents, 5000); assert.deepEqual(checkInvariants(db), []);
    }
  });

  await t('stock_movement is append-only (UPDATE and DELETE are refused)', async () => {
    const db = openDb(); seed(db); sell(db, mkReq(1));
    assert.throws(() => db.prepare('UPDATE stock_movement SET qty_delta = 999').run(), /append-only/);
    assert.throws(() => db.prepare('DELETE FROM stock_movement').run(), /append-only/);
  });

  await t('returns: partial return restores stock and posts a balanced entry; return above sold is refused', async () => {
    const db = openDb(); seed(db); sell(db, mkReq(1, 5));
    const line = db.prepare('SELECT id FROM invoice_line LIMIT 1').get().id;
    const before = db.prepare('SELECT SUM(on_hand) s FROM stock_balance').get().s;
    returnLine(db, { tenant: 't1', branch: 'b1', number: 'INV-1', invoiceLineId: line, qty: 2 });
    assert.equal(db.prepare('SELECT SUM(on_hand) s FROM stock_balance').get().s, before + 2);
    assert.throws(() => returnLine(db, { tenant: 't1', branch: 'b1', number: 'INV-1', invoiceLineId: line, qty: 4 }), /return exceeds sold/);
    returnLine(db, { tenant: 't1', branch: 'b1', number: 'INV-1', invoiceLineId: line, qty: 3 });
    assert.throws(() => returnLine(db, { tenant: 't1', branch: 'b1', number: 'INV-1', invoiceLineId: line, qty: 1 }), /return exceeds sold/);
    assert.deepEqual(checkInvariants(db), []);
  });

  await t('the invariant checker really detects corruption (tampered payment, balance and journal)', async () => {
    for (const [sql, re] of [
      ['UPDATE payment SET amount_cents = amount_cents + 1', /payments/],
      ['UPDATE stock_balance SET on_hand = on_hand + 1', /movements/],
      ['UPDATE journal_line SET debit_cents = debit_cents + 1 WHERE id = (SELECT MIN(id) FROM journal_line)', /debit/],
    ]) { const db = openDb(); seed(db); sell(db, mkReq(1)); db.exec(sql); const v = checkInvariants(db); assert.ok(v.some(x => re.test(x)), sql + ' -> ' + v.join(';')); }
  });

  await t('the schema itself refuses bad rows (not only the application code)', async () => {
    const db = openDb(); seed(db); sell(db, mkReq(1));
    const bad = (sql, re, ...args) => assert.throws(() => db.prepare(sql).run(...args), re, sql);
    bad('INSERT INTO invoice_line(invoice_id, batch_id, qty, unit_price_cents, line_total_cents) VALUES(1,1,2,100,999)', /CHECK/);
    bad('INSERT INTO invoice_line(invoice_id, batch_id, qty, unit_price_cents, line_total_cents) VALUES(1,1,0,100,0)', /CHECK/);
    bad("INSERT INTO payment(invoice_id, method, amount_cents) VALUES(1,'cash',0)", /CHECK/);
    bad("INSERT INTO payment(invoice_id, method, amount_cents) VALUES(1,'bitcoin',5)", /CHECK/);
    bad("INSERT INTO payment(invoice_id, method, amount_cents) VALUES(999,'cash',5)", /FOREIGN KEY/);
    bad('INSERT INTO journal_line(entry_id, account, debit_cents, credit_cents) VALUES(1,\'x\',5,5)', /CHECK/);
    bad('INSERT INTO journal_line(entry_id, account, debit_cents) VALUES(1,\'x\',-5)', /CHECK/);
    bad("INSERT INTO invoice(tenant_id, branch_id, number, status, total_cents) VALUES('t1','b1','Z','draft',0)", /CHECK/);
    bad("INSERT INTO invoice(tenant_id, branch_id, number, status, total_cents) VALUES('t1','b1','Y','final',-1)", /CHECK/);
    bad("INSERT INTO stock_movement(tenant_id, branch_id, batch_id, qty_delta, kind) VALUES('t1','b1',1,0,'sale')", /CHECK/);
    bad('INSERT INTO return_line(invoice_line_id, qty) VALUES(1, 999)', /return exceeds sold/);
    assert.deepEqual(checkInvariants(db), []);
  });

  await t('measure: 1000 sequential invoices (in-memory SQLite, single connection)', async () => {
    const db = openDb(); receive(db, { tenant: 't1', branch: 'b1', product: 'P1', lot: 'L1', expiry: iso(300), qty: 5000 });
    const ms = [];
    for (let i = 1; i <= 1000; i++) { const t0 = performance.now(); sell(db, mkReq(i, 2)); ms.push(performance.now() - t0); }
    ms.sort((a, b) => a - b); const p = f => Math.round(ms[Math.floor(ms.length * f)] * 1000) / 1000;
    out.sequential1000 = { p50ms: p(0.5), p95ms: p(0.95), p99ms: p(0.99), totalMs: Math.round(ms.reduce((s, x) => s + x, 0)) };
    assert.equal(counts(db).invoice, 1000); assert.deepEqual(checkInvariants(db), []);
    assert.equal(db.prepare('SELECT on_hand FROM stock_balance').get().on_hand, 5000 - 2000);
  });

  await t('concurrent writers: 5 connections x 40 sells on 150 units of stock never oversell', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nova-fnd02-')); const path = join(dir, 'bench.db');
    try {
      const db = openDb(path); receive(db, { tenant: 't1', branch: 'b1', product: 'P1', lot: 'L1', expiry: iso(300), qty: 150 });
      const t0 = performance.now();
      const results = await Promise.all(Array.from({ length: 5 }, (_, id) => new Promise((res, rej) => { const w = new Worker(fileURLToPath(import.meta.url), { workerData: { role: 'writer', path, id, n: 40 } }); w.once('message', res); w.once('error', rej); })));
      const wall = Math.round(performance.now() - t0);
      const sold = results.reduce((s, r) => s + r.ok, 0), rejected = results.reduce((s, r) => s + r.rejected, 0), retries = results.reduce((s, r) => s + r.busyRetries, 0);
      assert.equal(sold, 150); assert.equal(rejected, 50); assert.equal(sold + rejected, 200);
      assert.equal(db.prepare('SELECT on_hand FROM stock_balance').get().on_hand, 0);
      assert.deepEqual(checkInvariants(db), []);
      out.concurrent = { writers: 5, attempts: 200, sold, rejectedForStock: rejected, busyRetries: retries, wallMs: wall };
      db.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  console.log(JSON.stringify(out));
  console.log(`PASS fnd02 local sqlite harness: ${out.cases} cases (SQLite semantics only; NOT a D1 or Postgres measurement)`);
}
if (isMainThread && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
