import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const dir = new URL('../../backend/migrations/', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes('0002_catalog_inventory.sql'));
const sql = readFileSync(new URL('0002_catalog_inventory.sql', dir), 'utf8');
assert.ok(!/\b(DROP\s+(TABLE|COLUMN|INDEX|VIEW|TRIGGER)|TRUNCATE|DELETE\s+FROM)\b/i.test(sql), 'additive only');

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON');
db.exec(sql); db.exec(sql); // idempotent

const tables = ['products','product_barcodes','product_units','inventory_batches','inventory_movements','stock_counts','stock_transfers'];
for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  assert.ok(cols.includes('tenant_id') && cols.includes('branch_id'), t + ' needs tenant/branch');
  for (const c of db.prepare(`PRAGMA table_info(${t})`).all()) {
    if (/money|price|cost/.test(c.name)) assert.ok(c.name.endsWith('_minor') && c.type === 'INTEGER', c.name);
  }
}

const T = ['t1','b1'];
db.prepare('INSERT INTO products(id,tenant_id,branch_id,sku,name_ar,price_minor) VALUES(?,?,?,?,?,?)').run('p1',...T,'S1','دواء',1250);
assert.throws(() => db.prepare('INSERT INTO products(id,tenant_id,branch_id,sku,name_ar) VALUES(?,?,?,?,?)').run('p2',...T,'S1','x'), /UNIQUE/);
assert.throws(() => db.prepare('INSERT INTO products(id,tenant_id,branch_id,sku,name_ar,price_minor) VALUES(?,?,?,?,?,?)').run('p3',...T,'S3','x',-1), /CHECK/);
assert.throws(() => db.prepare('INSERT INTO products(id,sku,name_ar) VALUES(?,?,?)').run('p4','S4','x'), /NOT NULL/);
db.prepare('INSERT INTO product_barcodes(id,tenant_id,branch_id,product_id,barcode) VALUES(?,?,?,?,?)').run('bc1',...T,'p1','6221');
assert.throws(() => db.prepare('INSERT INTO product_barcodes(id,tenant_id,branch_id,product_id,barcode) VALUES(?,?,?,?,?)').run('bc2',...T,'p1','6221'), /UNIQUE/);
assert.throws(() => db.prepare('INSERT INTO product_units(id,tenant_id,branch_id,product_id,unit_name,factor) VALUES(?,?,?,?,?,?)').run('u1',...T,'p1','علبة',0), /CHECK/);
assert.throws(() => db.prepare('INSERT INTO inventory_batches(id,tenant_id,branch_id,product_id,batch_no,qty_on_hand) VALUES(?,?,?,?,?,?)').run('bt1',...T,'p1','B1',-5), /CHECK/);
db.prepare('INSERT INTO inventory_batches(id,tenant_id,branch_id,product_id,batch_no,qty_on_hand) VALUES(?,?,?,?,?,?)').run('bt1',...T,'p1','B1',10);

const mv = db.prepare('INSERT INTO inventory_movements(id,tenant_id,branch_id,product_id,batch_id,kind,qty_delta) VALUES(?,?,?,?,?,?,?)');
mv.run('m1',...T,'p1','bt1','receipt',10);
assert.throws(() => mv.run('m2',...T,'p1','bt1','receipt',0), /CHECK/);
assert.throws(() => mv.run('m3',...T,'p1','bt1','bogus',1), /CHECK/);
assert.throws(() => db.prepare("UPDATE inventory_movements SET qty_delta=99 WHERE id='m1'").run(), /append-only/);
assert.throws(() => db.prepare("DELETE FROM inventory_movements WHERE id='m1'").run(), /append-only/);
assert.equal(db.prepare('SELECT qty_delta FROM inventory_movements WHERE id=?').get('m1').qty_delta, 10);
mv.run('m4',...T,'p1','bt1','reversal',-10); // correction = new row

db.prepare('INSERT INTO stock_counts(id,tenant_id,branch_id,product_id,expected_qty,counted_qty) VALUES(?,?,?,?,?,?)').run('c1',...T,'p1',10,9);
assert.throws(() => db.prepare('INSERT INTO stock_counts(id,tenant_id,branch_id,product_id,expected_qty,counted_qty,status) VALUES(?,?,?,?,?,?,?)').run('c2',...T,'p1',1,1,'zzz'), /CHECK/);
const tr = db.prepare('INSERT INTO stock_transfers(id,tenant_id,branch_id,to_branch_id,product_id,qty) VALUES(?,?,?,?,?,?)');
tr.run('tr1','t1','b1','b2','p1',3);
assert.throws(() => tr.run('tr2','t1','b1','b1','p1',3), /CHECK/);
assert.throws(() => tr.run('tr3','t1','b1','b2','p1',0), /CHECK/);

// flag default OFF: worker does not mention catalog flag enabled by default
const idx = readFileSync(new URL('../../backend/src/index.js', import.meta.url), 'utf8');
assert.ok(!/catalog.*(=|:)\s*true/i.test(idx));
console.log('backend-migration-0002 OK');
