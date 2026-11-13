import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { salesWritesEnabled, createSale, returnSale, voidSale, recordStockMovement, stockOnHand } from '../../backend/src/sales/service.js';

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
await applyMigrations(db, await loadMigrationsFromDir(fileURLToPath(new URL('../../backend/migrations', import.meta.url))));
// D1 emulation: batch() = BEGIN ... COMMIT, ROLLBACK on any failure (all-or-nothing).
const mk = (sql, a = []) => ({ sql, a, bind: (...x) => mk(sql, x),
  async first() { return db.prepare(sql).get(...a) ?? null; }, async all() { return { results: db.prepare(sql).all(...a) }; }, async run() { return db.prepare(sql).run(...a); } });
const D1 = { prepare: (s) => mk(s), async batch(list) {
  db.exec('BEGIN');
  try { for (const s of list) db.prepare(s.sql).run(...s.a); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
} };
const env = { NOVA_SALES_WRITES: '1', DB: D1 };
const sc = { tenantId: 't1', branchId: 'b1' };
const count = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;

// flag default OFF
assert.equal(salesWritesEnabled({ DB: D1 }), false);
const off = await createSale({ DB: D1 }, sc, { items: [] }, 'r0');
assert.equal(off.ok, false); assert.equal(off.code, 'SALES_DISABLED'); assert.equal(off.requestId, 'r0'); assert.match(off.message_ar, /[؀-ۿ]/);
assert.equal(count('sales'), 0);

db.prepare("INSERT INTO products(id,tenant_id,branch_id,sku,name_ar) VALUES('p1','t1','b1','S1','دواء'),('p2','t1','b1','S2','آخر')").run();
assert.equal((await recordStockMovement(env, sc, { kind: 'receipt', productId: 'p1', qtyDelta: 10 }, 'r1')).ok, true);
assert.equal((await recordStockMovement(env, sc, { kind: 'receipt', productId: 'p1', qtyDelta: -1 }, 'r1')).code, 'BAD_REQUEST');
assert.equal(await stockOnHand(env, sc, 'p1'), 10);

// sale: stock from ledger, payments sum, journal balanced
const sale = await createSale(env, sc, { items: [{ productId: 'p1', qty: 4, unitPriceMinor: 1000 }], payments: [{ method: 'cash', amountMinor: 3500 }], discountMinor: 500 }, 'r2');
assert.equal(sale.ok, true); assert.equal(sale.totalMinor, 3500);
assert.equal(await stockOnHand(env, sc, 'p1'), 6);
const bal = db.prepare('SELECT SUM(debit_minor) d, SUM(credit_minor) c FROM journal_lines').get();
assert.equal(bal.d, bal.c); assert.equal(bal.d, 3500);

// all-or-nothing: second item has no stock -> nothing written
const before = [count('sales'), count('sale_items'), count('payments'), count('inventory_movements'), count('journal_entries')];
const bad = await createSale(env, sc, { items: [{ productId: 'p1', qty: 2, unitPriceMinor: 100 }, { productId: 'p2', qty: 1, unitPriceMinor: 100 }], payments: [{ method: 'cash', amountMinor: 300 }] }, 'r3');
assert.equal(bad.code, 'INSUFFICIENT_STOCK'); assert.equal(bad.requestId, 'r3'); assert.match(bad.message_ar, /[؀-ۿ]/);
assert.deepEqual([count('sales'), count('sale_items'), count('payments'), count('inventory_movements'), count('journal_entries')], before);
assert.equal(await stockOnHand(env, sc, 'p1'), 6);
// payment mismatch / bad input
assert.equal((await createSale(env, sc, { items: [{ productId: 'p1', qty: 1, unitPriceMinor: 100 }], payments: [{ method: 'cash', amountMinor: 99 }] }, 'r4')).code, 'PAYMENT_MISMATCH');
assert.equal((await createSale(env, sc, { items: [{ productId: 'p1', qty: 1.5, unitPriceMinor: 100 }], payments: [] }, 'r4')).code, 'BAD_REQUEST');
assert.equal((await createSale(env, { tenantId: '' }, { items: [] }, 'r4')).code, 'BAD_REQUEST');

// returns <= sold (cumulative), rolled back whole when exceeding
const siId = db.prepare('SELECT id FROM sale_items').get().id;
const ret1 = await returnSale(env, sc, { saleId: sale.saleId, items: [{ saleItemId: siId, qty: 3 }] }, 'r5');
assert.equal(ret1.ok, true); assert.equal(ret1.refundMinor, 2625); // 3*1000*3500/4000
assert.equal(await stockOnHand(env, sc, 'p1'), 9);
const rcount = [count('sale_returns'), count('sale_return_items'), count('inventory_movements'), count('journal_entries')];
const over = await returnSale(env, sc, { saleId: sale.saleId, items: [{ saleItemId: siId, qty: 2 }] }, 'r6');
assert.equal(over.code, 'RETURN_EXCEEDS_SOLD');
assert.deepEqual([count('sale_returns'), count('sale_return_items'), count('inventory_movements'), count('journal_entries')], rcount);
assert.equal((await returnSale(env, sc, { saleId: sale.saleId, items: [{ saleItemId: siId, qty: 1 }] }, 'r7')).ok, true);
assert.equal(await stockOnHand(env, sc, 'p1'), 10);
// other tenant cannot see the sale
assert.equal((await returnSale(env, { tenantId: 't2', branchId: 'b1' }, { saleId: sale.saleId, items: [{ saleItemId: siId, qty: 1 }] }, 'r8')).code, 'NOT_FOUND');
// sale with returns cannot be voided
assert.equal((await voidSale(env, sc, { saleId: sale.saleId }, 'r9')).code, 'VOID_HAS_RETURNS');

// void: reversed not deleted; double void refused
const s2 = await createSale(env, sc, { items: [{ productId: 'p1', qty: 5, unitPriceMinor: 200 }], payments: [{ method: 'card', amountMinor: 1000 }] }, 'r10');
assert.equal(await stockOnHand(env, sc, 'p1'), 5);
const nSales = count('sales');
assert.equal((await voidSale(env, sc, { saleId: s2.saleId, reason: 'خطأ' }, 'r11')).ok, true);
assert.equal(await stockOnHand(env, sc, 'p1'), 10);
assert.equal(count('sales'), nSales); // not deleted
assert.equal(db.prepare('SELECT status FROM sales WHERE id=?').get(s2.saleId).status, 'void');
assert.equal(db.prepare("SELECT COUNT(*) c FROM inventory_movements WHERE kind='reversal' AND reverses_id IS NOT NULL").get().c, 1);
const bal2 = db.prepare('SELECT SUM(debit_minor) d, SUM(credit_minor) c FROM journal_lines').get(); assert.equal(bal2.d, bal2.c);
assert.equal((await voidSale(env, sc, { saleId: s2.saleId }, 'r12')).code, 'SALE_NOT_COMPLETED');

// DB-level immutability (defence in depth, bypassing the service)
for (const q of ['DELETE FROM sales', 'DELETE FROM payments', 'DELETE FROM sale_items', 'DELETE FROM journal_lines', "UPDATE payments SET amount_minor=1", "UPDATE sales SET total_minor=1", "UPDATE sales SET status='completed' WHERE status='void'"])
  assert.throws(() => db.exec(q), /FINANCIAL_RECORD_IMMUTABLE/, q);
assert.throws(() => db.exec("DELETE FROM inventory_movements"), /append-only/);
assert.throws(() => db.exec("INSERT INTO inventory_movements(id,tenant_id,branch_id,product_id,kind,qty_delta,reverses_id) SELECT 'dup',tenant_id,branch_id,product_id,'reversal',-1,reverses_id FROM inventory_movements WHERE reverses_id IS NOT NULL"), /UNIQUE|INSUFFICIENT/);
// negative adjustment cannot drive stock below zero
assert.equal((await recordStockMovement(env, sc, { kind: 'adjustment', productId: 'p1', qtyDelta: -11 }, 'r13')).code, 'INSUFFICIENT_STOCK');
assert.equal((await recordStockMovement(env, sc, { kind: 'adjustment', productId: 'p1', qtyDelta: -10 }, 'r13')).ok, true);
assert.equal(await stockOnHand(env, sc, 'p1'), 0);
console.log('backend-sales-writes OK');
