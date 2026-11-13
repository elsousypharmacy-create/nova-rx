import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const dir = new URL('../../backend/migrations/', import.meta.url);
const sql = ['0002_catalog_inventory.sql', '0003_sales_finance.sql'].map(f => readFileSync(new URL(f, dir), 'utf8'));
assert.ok(!/\b(DROP\s+(TABLE|COLUMN|INDEX|VIEW|TRIGGER)|TRUNCATE|DELETE\s+FROM)\b/i.test(sql[1]), 'additive only');
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
db.exec(sql[0]); db.exec(sql[1]); db.exec(sql[1]); // idempotent

const T = ['t1', 'b1'];
const run = (q, ...a) => db.prepare(q).run(...a);
for (const t of ['customers','sales','sale_items','payments','sale_returns','sale_return_items','suppliers','purchase_orders','purchase_order_items','receipts','cashier_sessions','journal_entries','journal_lines','audit_logs','idempotency_keys']) {
  const cols = db.prepare(`PRAGMA table_info(${t})`).all();
  assert.ok(cols.some(c => c.name === 'tenant_id'), t + ' needs tenant_id');
  for (const c of cols) if (/money|price|cost|amount|total|refund|debit|credit|float|counted/.test(c.name) && !/^(credit_limit_minor)$/.test(c.name) || c.name === 'credit_limit_minor') assert.ok(c.name.endsWith('_minor') && c.type === 'INTEGER', c.name);
}

run('INSERT INTO products(id,tenant_id,branch_id,sku,name_ar) VALUES(?,?,?,?,?)', 'p1', ...T, 'S1', 'دواء');
run('INSERT INTO sales(id,tenant_id,branch_id,total_minor) VALUES(?,?,?,?)', 's1', ...T, 5000);
run('INSERT INTO sale_items(id,tenant_id,branch_id,sale_id,product_id,qty,unit_price_minor) VALUES(?,?,?,?,?,?,?)', 'si1', ...T, 's1', 'p1', 5, 1000);
run('INSERT INTO payments(id,tenant_id,branch_id,sale_id,method,amount_minor) VALUES(?,?,?,?,?,?)', 'pay1', ...T, 's1', 'cash', 5000);
assert.throws(() => run('INSERT INTO payments(id,tenant_id,branch_id,sale_id,method,amount_minor) VALUES(?,?,?,?,?,?)', 'pay2', ...T, 's1', 'bogus', 1), /CHECK/);
assert.throws(() => run('INSERT INTO sale_items(id,tenant_id,branch_id,sale_id,product_id,qty,unit_price_minor) VALUES(?,?,?,?,?,?,?)', 'si2', ...T, 's1', 'p1', 0, 1), /CHECK/);

// returns cannot exceed sold qty (DB trigger)
run('INSERT INTO sale_returns(id,tenant_id,branch_id,sale_id) VALUES(?,?,?,?)', 'r1', ...T, 's1');
const ri = (id, q) => run('INSERT INTO sale_return_items(id,tenant_id,branch_id,return_id,sale_item_id,qty) VALUES(?,?,?,?,?,?)', id, ...T, 'r1', 'si1', q);
ri('ri1', 3);
assert.throws(() => ri('ri2', 3), /RETURN_EXCEEDS_SOLD/); // cumulative 6 > 5
assert.throws(() => ri('ri3', 6), /RETURN_EXCEEDS_SOLD/);
ri('ri4', 2); // exactly the rest
assert.throws(() => ri('ri5', 1), /RETURN_EXCEEDS_SOLD/);

// audit_logs append-only
run('INSERT INTO audit_logs(id,tenant_id,action,request_id) VALUES(?,?,?,?)', 'a1', 't1', 'sale.create', 'req1');
assert.throws(() => run("UPDATE audit_logs SET action='x' WHERE id='a1'"), /append-only/);
assert.throws(() => run("DELETE FROM audit_logs WHERE id='a1'"), /append-only/);
assert.equal(db.prepare('SELECT action FROM audit_logs WHERE id=?').get('a1').action, 'sale.create');

// idempotency unique per tenant
run('INSERT INTO idempotency_keys(id,tenant_id,idem_key) VALUES(?,?,?)', 'i1', 't1', 'k');
assert.throws(() => run('INSERT INTO idempotency_keys(id,tenant_id,idem_key) VALUES(?,?,?)', 'i2', 't1', 'k'), /UNIQUE/);
run('INSERT INTO idempotency_keys(id,tenant_id,idem_key) VALUES(?,?,?)', 'i3', 't2', 'k');

// journal line must be exactly one side
run('INSERT INTO journal_entries(id,tenant_id,branch_id) VALUES(?,?,?)', 'j1', ...T);
const jl = (id, d, c) => run('INSERT INTO journal_lines(id,tenant_id,branch_id,entry_id,account_code,debit_minor,credit_minor) VALUES(?,?,?,?,?,?,?)', id, ...T, 'j1', '1000', d, c);
jl('l1', 100, 0); jl('l2', 0, 100);
assert.throws(() => jl('l3', 1, 1), /CHECK/);
assert.throws(() => jl('l4', 0, 0), /CHECK/);

// flag default OFF
const idx = readFileSync(new URL('../../backend/src/index.js', import.meta.url), 'utf8');
assert.ok(!/(sales|finance).*(=|:)\s*true/i.test(idx));
const wt = readFileSync(new URL('../../backend/wrangler.toml', import.meta.url), 'utf8');
assert.ok(!/BACKEND_ENABLED\s*=\s*"?(1|true|on)/i.test(wt));
console.log('backend-migration-0003 OK');
