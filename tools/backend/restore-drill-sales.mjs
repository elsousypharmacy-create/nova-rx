#!/usr/bin/env node
// S1-10: restore drill for the server data that matters in Stage 1. Seeds a tenant/branch, a staff user (PBKDF2 hash),
// a product with stock and one completed sale applied through the real sync push (same path as a device), then exports
// every row as SQL INSERTs (like `wrangler d1 export`), imports them into a NEW empty database (never the original) and
// checks that the sale, its lines, payments, stock on hand and the staff login are identical.
// In-memory node:sqlite only: no network, no Cloudflare, nothing live. Run: node tools/backend/restore-drill-sales.mjs
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { applyMigrations, loadMigrationsFromDir } from '../../backend/src/db/migrate.js';
import { handle } from '../../backend/src/index.js';
import { stockOnHand, recordStockMovement } from '../../backend/src/sales/service.js';

const MIG_DIR = fileURLToPath(new URL('../../backend/migrations', import.meta.url));

async function newDb(migs) {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON'); await applyMigrations(db, migs);
  const mk = (sql, a = []) => ({ bind: (...x) => mk(sql, x), async first() { return db.prepare(sql).get(...a) ?? null; },
    async all() { return { results: db.prepare(sql).all(...a) }; },
    async run() { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; }, get sql() { return sql; }, get a() { return a; } });
  const D1 = { prepare: (s) => mk(s), async batch(list) { db.exec('BEGIN'); try { for (const s of list) db.prepare(s.sql).run(...s.a); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } } };
  return { db, D1 };
}
const mkKV = () => { const m = new Map(); return { async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } }; };
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' || typeof v === 'bigint' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");

// Export like wrangler: one INSERT per row, user tables only (schema comes from migrations on the new database).
export function exportSql(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations','_cf_KV','_migrations') ORDER BY name").all().map((r) => r.name);
  const out = [];
  for (const t of tables) for (const row of db.prepare(`SELECT * FROM "${t}"`).all()) { const k = Object.keys(row); out.push(`INSERT INTO "${t}" (${k.map((c) => '"' + c + '"').join(',')}) VALUES (${k.map((c) => q(row[c])).join(',')});`); }
  return out;
}
// Import into an EMPTY database with the same migrations; FK checks off during load (parents/children in any order), then verified.
export function importSql(db, lines) {
  db.exec('PRAGMA foreign_keys=OFF'); db.exec('BEGIN');
  try { for (const l of lines) { try { db.exec(l); } catch (e) { if (!/UNIQUE constraint failed/.test(String(e))) throw e; } } db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  db.exec('PRAGMA foreign_keys=ON');
  const bad = db.prepare('PRAGMA foreign_key_check').all(); if (bad.length) throw new Error('foreign key check failed after import: ' + bad.length);
}

export async function runDrill() {
  const migs = await loadMigrationsFromDir(MIG_DIR);
  const checks = []; const ck = (name, ok) => { checks.push({ name, ok: !!ok }); return ok; };
  const PIN = 'drill-pin-1234567';
  const A = await newDb(migs);
  const env = { NOVA_AUTH: '1', NOVA_SYNC: '1', NOVA_SALES_WRITES: '1', DB: A.D1, KV: mkKV(), NOVA_API_PIN: PIN, NOVA_TENANT_ID: 'drill' };
  const call = async (e, method, path, body, tok) => { const h = { 'Content-Type': 'application/json' }; if (tok) h.Authorization = 'Bearer ' + tok; const r = await handle(new Request('https://x.test' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), e); return [r.status, await r.json()]; };
  // 1. seed: owner (PIN bootstrap -> tenant + branch), a cashier, a product with stock, one sale through sync push
  let [s, j] = await call(env, 'POST', '/api/v1/auth/login', { username: 'owner', password: PIN }); const owner = j.access_token;
  [s] = await call(env, 'POST', '/api/v1/staff', { username: 'cashier1', password: 'cashier-pass-123', role: 'cashier' }, owner); ck('seed staff user', s === 200);
  const branch = A.db.prepare("SELECT id FROM branches WHERE tenant_id='drill'").get().id, scope = { tenantId: 'drill', branchId: branch };
  A.db.prepare("INSERT INTO products(id,tenant_id,branch_id,sku,name_ar) VALUES('p-drill','drill',?,'SKU-D','دواء تجربة')").run(branch);
  ck('seed stock', (await recordStockMovement(env, scope, { kind: 'receipt', productId: 'p-drill', qtyDelta: 20 }, 'r1')).ok);
  [s, j] = await call(env, 'POST', '/api/v1/sync/push', { ops: [{ key: 'inv-drill-1', payload: { id: 'inv-drill-1', number: 'D-1', lines: [{ code: 'p-drill', qty: 3, price: 12.5 }] } }] }, owner);
  const res = j.results && j.results[0]; ck('seed sale via sync push', s === 200 && res && res.status === 'applied' && res.saleId);
  const before = {
    sale: A.db.prepare('SELECT id,total_minor,status FROM sales WHERE id=?').get(res.saleId),
    lines: A.db.prepare('SELECT product_id,qty,unit_price_minor FROM sale_items WHERE sale_id=? ORDER BY product_id').all(res.saleId),
    pays: A.db.prepare('SELECT method,amount_minor FROM payments WHERE sale_id=?').all(res.saleId),
    stock: await stockOnHand(env, scope, 'p-drill'),
    hash: A.db.prepare("SELECT password_hash h FROM users WHERE username='cashier1'").get().h,
    feed: A.db.prepare("SELECT COUNT(*) c FROM change_feed WHERE entity='sale'").get().c,
  };
  ck('stock after sale = 17', before.stock === 17);
  // 2. export -> 3. import into a NEW empty database
  const dump = exportSql(A.db);
  ck('export has no plaintext password', !dump.some((l) => l.includes('cashier-pass-123') || l.includes(PIN)));
  const B = await newDb(migs); importSql(B.db, dump);
  const env2 = { ...env, DB: B.D1, KV: mkKV() }; // fresh KV: sessions are not part of the backup, logins must still work
  // 4. identical sale / lines / payments / stock / staff hash, and the staff can log in on the restored database
  ck('sale restored', JSON.stringify(B.db.prepare('SELECT id,total_minor,status FROM sales WHERE id=?').get(res.saleId)) === JSON.stringify(before.sale));
  ck('sale lines restored', JSON.stringify(B.db.prepare('SELECT product_id,qty,unit_price_minor FROM sale_items WHERE sale_id=? ORDER BY product_id').all(res.saleId)) === JSON.stringify(before.lines));
  ck('payments restored', JSON.stringify(B.db.prepare('SELECT method,amount_minor FROM payments WHERE sale_id=?').all(res.saleId)) === JSON.stringify(before.pays));
  ck('stock on hand restored (17)', (await stockOnHand(env2, scope, 'p-drill')) === before.stock);
  ck('staff hash identical, never plaintext', B.db.prepare("SELECT password_hash h FROM users WHERE username='cashier1'").get().h === before.hash && before.hash.startsWith('pbkdf2$'));
  ck('change feed restored', B.db.prepare("SELECT COUNT(*) c FROM change_feed WHERE entity='sale'").get().c === before.feed);
  [s] = await call(env2, 'POST', '/api/v1/auth/login', { username: 'cashier1', password: 'cashier-pass-123' }); ck('staff login works on the restored database', s === 200);
  [s] = await call(env2, 'POST', '/api/v1/auth/login', { username: 'owner', password: PIN }); ck('owner login works on the restored database', s === 200);
  // replaying the same op on the restored database is still idempotent (sync_ops restored)
  const t2 = (await call(env2, 'POST', '/api/v1/auth/login', { username: 'owner', password: PIN }))[1].access_token;
  [s, j] = await call(env2, 'POST', '/api/v1/sync/push', { ops: [{ key: 'inv-drill-1', payload: { id: 'inv-drill-1', number: 'D-1', lines: [{ code: 'p-drill', qty: 3, price: 12.5 }] } }] }, t2);
  ck('replay after restore does not double-sell', j.results[0].duplicate === true && (await stockOnHand(env2, scope, 'p-drill')) === 17);
  ck('original database untouched by the drill', A.db.prepare('SELECT COUNT(*) c FROM sales').get().c === 1);
  return { ok: checks.every((c) => c.ok), checks };
}

import { resolve } from 'node:path';
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const r = await runDrill();
  for (const c of r.checks) console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name);
  console.log(r.ok ? 'RESTORE DRILL PASS' : 'RESTORE DRILL FAILED'); process.exit(r.ok ? 0 : 1);
}
