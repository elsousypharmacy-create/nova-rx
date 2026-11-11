// INV-01 stock core: append-only movement ledger + atomic sale / return / goods receipt, scoped per tenant and branch.
// Pure domain logic over a tiny SYNC store interface that node:sqlite's DatabaseSync (and any SQLite-compatible sync
// wrapper) provides: db.exec(sql), db.prepare(sql).run/get/all(...params). It makes NO storage choice: the production
// store (D1, Postgres...) is an owner decision (FND-02). Not wired to the Worker or the UI. Money = integer cents,
// quantity = whole BASE units (the smallest stocked thing; conversions live in worker/catalog/unit-conversion.js).

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS batch(id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, product_id TEXT NOT NULL, lot TEXT NOT NULL, expiry TEXT NOT NULL, UNIQUE(tenant_id, product_id, lot));
CREATE TABLE IF NOT EXISTS stock_balance(tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, batch_id INTEGER NOT NULL REFERENCES batch(id), on_hand INTEGER NOT NULL CHECK(on_hand >= 0), PRIMARY KEY(tenant_id, branch_id, batch_id));
CREATE TABLE IF NOT EXISTS stock_movement(id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, batch_id INTEGER NOT NULL REFERENCES batch(id), qty_delta INTEGER NOT NULL CHECK(qty_delta <> 0), kind TEXT NOT NULL CHECK(kind IN ('receive','sale','return')), ref_type TEXT NOT NULL, ref_id TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS stock_movement_no_update BEFORE UPDATE ON stock_movement BEGIN SELECT RAISE(ABORT,'stock_movement is append-only'); END;
CREATE TRIGGER IF NOT EXISTS stock_movement_no_delete BEFORE DELETE ON stock_movement BEGIN SELECT RAISE(ABORT,'stock_movement is append-only'); END;
CREATE TABLE IF NOT EXISTS stock_policy(tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, product_id TEXT NOT NULL, min_base INTEGER NOT NULL CHECK(min_base >= 0), max_base INTEGER NOT NULL CHECK(max_base >= min_base), PRIMARY KEY(tenant_id, branch_id, product_id));
CREATE TABLE IF NOT EXISTS invoice(id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, number TEXT NOT NULL, total_cents INTEGER NOT NULL CHECK(total_cents >= 0), UNIQUE(tenant_id, number));
CREATE TABLE IF NOT EXISTS invoice_line(id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL REFERENCES invoice(id), product_id TEXT NOT NULL, batch_id INTEGER NOT NULL REFERENCES batch(id), qty INTEGER NOT NULL CHECK(qty > 0), line_total_cents INTEGER NOT NULL CHECK(line_total_cents >= 0));
CREATE TABLE IF NOT EXISTS payment(id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL REFERENCES invoice(id), method TEXT NOT NULL CHECK(method IN ('cash','card','credit')), amount_cents INTEGER NOT NULL CHECK(amount_cents > 0));
CREATE TABLE IF NOT EXISTS return_line(id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_line_id INTEGER NOT NULL REFERENCES invoice_line(id), qty INTEGER NOT NULL CHECK(qty > 0), refund_cents INTEGER NOT NULL CHECK(refund_cents >= 0), return_key TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS return_not_above_sold BEFORE INSERT ON return_line BEGIN
  SELECT RAISE(ABORT,'return exceeds sold') WHERE (SELECT COALESCE(SUM(qty),0) FROM return_line WHERE invoice_line_id = NEW.invoice_line_id) + NEW.qty > (SELECT qty FROM invoice_line WHERE id = NEW.invoice_line_id);
END;
CREATE TABLE IF NOT EXISTS purchase_order(tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, po_ref TEXT NOT NULL, PRIMARY KEY(tenant_id, po_ref));
CREATE TABLE IF NOT EXISTS po_line(tenant_id TEXT NOT NULL, po_ref TEXT NOT NULL, product_id TEXT NOT NULL, ordered_base INTEGER NOT NULL CHECK(ordered_base > 0), PRIMARY KEY(tenant_id, po_ref, product_id));
CREATE TABLE IF NOT EXISTS receipt_line(id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, po_ref TEXT NOT NULL, receipt_key TEXT NOT NULL, product_id TEXT NOT NULL, batch_id INTEGER NOT NULL REFERENCES batch(id), qty INTEGER NOT NULL CHECK(qty > 0), cost_cents INTEGER NOT NULL CHECK(cost_cents >= 0));
CREATE TABLE IF NOT EXISTS journal_entry(id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, ref_type TEXT NOT NULL, ref_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS journal_line(id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL REFERENCES journal_entry(id), account TEXT NOT NULL, debit_cents INTEGER NOT NULL DEFAULT 0 CHECK(debit_cents >= 0), credit_cents INTEGER NOT NULL DEFAULT 0 CHECK(credit_cents >= 0), CHECK(debit_cents = 0 OR credit_cents = 0));
CREATE TABLE IF NOT EXISTS idempotency_key(tenant_id TEXT NOT NULL, key TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL, PRIMARY KEY(tenant_id, key));
`;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const REF = /^[A-Za-z0-9_./-]{1,128}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// calendar-exact: '2026-02-31' must not silently roll over to March
const validDate = d => typeof d === 'string' && DATE.test(d) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
const METHODS = new Set(['cash', 'card', 'credit']);
const MAX_QTY = 1e9, MAX_CENTS = 1e12;

export class CoreError extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail; } }
const bad = (code, detail) => { throw new CoreError(code, detail); };
const posInt = (v, max) => Number.isSafeInteger(v) && v > 0 && v <= max;
const nonNegInt = (v, max) => Number.isSafeInteger(v) && v >= 0 && v <= max;

function scopeOf(scope) {
  if (!scope || typeof scope !== 'object' || !ID.test(String(scope.tenantId ?? '')) || !ID.test(String(scope.branchId ?? ''))) bad('scope-invalid');
  return { t: scope.tenantId, b: scope.branchId };
}

// canonical, order-independent request fingerprint (strict: arrays keep order, object keys sorted)
function fingerprint(value) {
  const walk = v => {
    if (v === null || typeof v === 'boolean' || typeof v === 'number' || typeof v === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(walk).join(',') + ']';
    if (typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + walk(v[k])).join(',') + '}';
    return bad('request-invalid');
  };
  return walk(value);
}
async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function createStockCore(db, { now = () => new Date() } = {}) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') throw new Error('store-invalid');
  const q = (sql, ...p) => db.prepare(sql).all(...p);
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  const today = () => now().toISOString().slice(0, 10);

  function install() { db.exec('PRAGMA foreign_keys = ON;'); db.exec(SCHEMA); }

  // one writer transaction; an idempotency record makes a retried request return the stored result (never a second effect)
  function atomic(s, ns, rawKey, fp, work) {
    if (typeof rawKey !== 'string' || !REF.test(rawKey)) bad('idempotency-key-invalid');
    const key = `${ns}:${rawKey}`;
    db.exec('BEGIN IMMEDIATE');
    try {
      const seen = one('SELECT request_hash, response_json FROM idempotency_key WHERE tenant_id=? AND key=?', s.t, key);
      if (seen) { if (seen.request_hash !== fp) bad('idempotency-conflict'); db.exec('COMMIT'); return { ...JSON.parse(seen.response_json), replay: true }; }
      const result = work();
      run('INSERT INTO idempotency_key(tenant_id, key, request_hash, response_json) VALUES(?,?,?,?)', s.t, key, fp, JSON.stringify(result));
      db.exec('COMMIT');
      return result;
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
  }
  const prepare = async (key, payload) => ({ key, fp: await sha256(fingerprint(payload)) });

  const journal = (s, refType, refId, debits, credits) => {
    const id = Number(run('INSERT INTO journal_entry(tenant_id, ref_type, ref_id) VALUES(?,?,?)', s.t, refType, refId).lastInsertRowid);
    for (const [account, cents] of debits) if (cents > 0) run('INSERT INTO journal_line(entry_id, account, debit_cents) VALUES(?,?,?)', id, account, cents);
    for (const [account, cents] of credits) if (cents > 0) run('INSERT INTO journal_line(entry_id, account, credit_cents) VALUES(?,?,?)', id, account, cents);
  };
  const move = (s, batchId, delta, kind, refType, refId) => {
    run('INSERT INTO stock_movement(tenant_id, branch_id, batch_id, qty_delta, kind, ref_type, ref_id) VALUES(?,?,?,?,?,?,?)', s.t, s.b, batchId, delta, kind, refType, refId);
    if (delta > 0) run('INSERT INTO stock_balance(tenant_id, branch_id, batch_id, on_hand) VALUES(?,?,?,?) ON CONFLICT(tenant_id, branch_id, batch_id) DO UPDATE SET on_hand = on_hand + excluded.on_hand', s.t, s.b, batchId, delta);
    else if (Number(run('UPDATE stock_balance SET on_hand = on_hand + ? WHERE tenant_id=? AND branch_id=? AND batch_id=?', delta, s.t, s.b, batchId).changes) !== 1) bad('insufficient-stock', { batchId }); // an outgoing move needs an existing balance (the CHECK refuses a negative one)
  };

  // ---- stock policy (min/max per product and branch) -------------------------------------------------------------
  function setPolicy(scope, productId, minBase, maxBase) {
    const s = scopeOf(scope);
    if (!ID.test(String(productId)) || !nonNegInt(minBase, MAX_QTY) || !nonNegInt(maxBase, MAX_QTY) || maxBase < minBase) bad('policy-invalid');
    run('INSERT INTO stock_policy(tenant_id, branch_id, product_id, min_base, max_base) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id, branch_id, product_id) DO UPDATE SET min_base=excluded.min_base, max_base=excluded.max_base', s.t, s.b, productId, minBase, maxBase);
  }

  // ---- reads (always scoped) -------------------------------------------------------------------------------------
  // available = sellable now (not expired); onHand includes expired lots so a count of the shelf still reconciles.
  function stockOf(scope, productId) {
    const s = scopeOf(scope);
    const r = one('SELECT COALESCE(SUM(sb.on_hand),0) AS on_hand, COALESCE(SUM(CASE WHEN b.expiry >= ? THEN sb.on_hand ELSE 0 END),0) AS available FROM stock_balance sb JOIN batch b ON b.id = sb.batch_id WHERE sb.tenant_id=? AND sb.branch_id=? AND b.product_id=?', today(), s.t, s.b, String(productId));
    return { productId: String(productId), onHand: r.on_hand, available: r.available };
  }
  // products whose sellable stock is below the minimum; need = max - available (what a purchase should bring back)
  function shortages(scope) {
    const s = scopeOf(scope);
    return q('SELECT p.product_id AS productId, p.min_base AS minBase, p.max_base AS maxBase, COALESCE((SELECT SUM(sb.on_hand) FROM stock_balance sb JOIN batch b ON b.id = sb.batch_id WHERE sb.tenant_id=p.tenant_id AND sb.branch_id=p.branch_id AND b.product_id=p.product_id AND b.expiry >= ?),0) AS available FROM stock_policy p WHERE p.tenant_id=? AND p.branch_id=? ORDER BY p.product_id', today(), s.t, s.b)
      .filter(r => r.available < r.minBase).map(r => ({ productId: r.productId, available: r.available, minBase: r.minBase, maxBase: r.maxBase, needBase: r.maxBase - r.available }));
  }
  function getInvoice(scope, number) {
    const s = scopeOf(scope);
    const inv = one('SELECT id, number, total_cents AS totalCents FROM invoice WHERE tenant_id=? AND branch_id=? AND number=?', s.t, s.b, String(number));
    if (!inv) return null; // another tenant's or branch's invoice looks exactly like a missing one
    const lines = q('SELECT il.id, il.product_id AS productId, il.batch_id AS batchId, il.qty, il.line_total_cents AS lineTotalCents, COALESCE((SELECT SUM(qty) FROM return_line WHERE invoice_line_id = il.id),0) AS returned FROM invoice_line il WHERE il.invoice_id=? ORDER BY il.id', inv.id);
    return { ...inv, lines };
  }

  // ---- write: goods receipt, optionally against a purchase order ---------------------------------------------------
  function registerPurchaseOrder(scope, { poRef, lines }) {
    const s = scopeOf(scope);
    if (!REF.test(String(poRef ?? '')) || !Array.isArray(lines) || lines.length === 0) bad('po-invalid');
    db.exec('BEGIN IMMEDIATE');
    try {
      run('INSERT INTO purchase_order(tenant_id, branch_id, po_ref) VALUES(?,?,?)', s.t, s.b, poRef);
      for (const l of lines) { if (!ID.test(String(l.productId)) || !posInt(l.orderedBase, MAX_QTY)) bad('po-line-invalid'); run('INSERT INTO po_line(tenant_id, po_ref, product_id, ordered_base) VALUES(?,?,?,?)', s.t, poRef, l.productId, l.orderedBase); }
      db.exec('COMMIT');
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
  }
  function poStatus(scope, poRef) {
    const s = scopeOf(scope);
    const po = one('SELECT po_ref FROM purchase_order WHERE tenant_id=? AND branch_id=? AND po_ref=?', s.t, s.b, String(poRef));
    if (!po) return null;
    const lines = q('SELECT pl.product_id AS productId, pl.ordered_base AS orderedBase, COALESCE((SELECT SUM(qty) FROM receipt_line r WHERE r.tenant_id=pl.tenant_id AND r.po_ref=pl.po_ref AND r.product_id=pl.product_id),0) AS receivedBase FROM po_line pl WHERE pl.tenant_id=? AND pl.po_ref=? ORDER BY pl.product_id', s.t, String(poRef));
    return { poRef: String(poRef), complete: lines.every(l => l.receivedBase >= l.orderedBase), lines: lines.map(l => ({ ...l, outstandingBase: Math.max(0, l.orderedBase - l.receivedBase) })) };
  }
  async function receiveGoods(scope, { key, poRef = null, lines }) {
    const s = scopeOf(scope);
    if (!Array.isArray(lines) || lines.length === 0 || lines.length > 500) bad('receipt-invalid');
    const norm = lines.map(l => {
      if (!ID.test(String(l.productId)) || !REF.test(String(l.lot ?? '')) || !validDate(l.expiry) || !posInt(l.qtyBase, MAX_QTY) || !nonNegInt(l.costCents ?? 0, MAX_CENTS)) bad('receipt-line-invalid', l);
      return { productId: String(l.productId), lot: String(l.lot), expiry: l.expiry, qtyBase: l.qtyBase, costCents: l.costCents ?? 0 };
    });
    if (poRef !== null && !REF.test(String(poRef))) bad('po-invalid');
    const { fp } = await prepare(key, { poRef, norm });
    return atomic(s, 'receipt', key, fp, () => {
      if (poRef !== null) {
        if (!one('SELECT 1 AS x FROM purchase_order WHERE tenant_id=? AND branch_id=? AND po_ref=?', s.t, s.b, poRef)) bad('po-not-found');
        const incoming = new Map(); for (const l of norm) incoming.set(l.productId, (incoming.get(l.productId) ?? 0) + l.qtyBase);
        for (const [pid, qty] of incoming) {
          const pl = one('SELECT ordered_base AS o, COALESCE((SELECT SUM(qty) FROM receipt_line r WHERE r.tenant_id=? AND r.po_ref=? AND r.product_id=?),0) AS got FROM po_line WHERE tenant_id=? AND po_ref=? AND product_id=?', s.t, poRef, pid, s.t, poRef, pid);
          if (!pl) bad('product-not-on-po', pid);
          if (pl.got + qty > pl.o) bad('over-receipt', { productId: pid, ordered: pl.o, alreadyReceived: pl.got, incoming: qty });
        }
      }
      let costTotal = 0;
      for (const l of norm) {
        run('INSERT OR IGNORE INTO batch(tenant_id, product_id, lot, expiry) VALUES(?,?,?,?)', s.t, l.productId, l.lot, l.expiry);
        const b = one('SELECT id, expiry FROM batch WHERE tenant_id=? AND product_id=? AND lot=?', s.t, l.productId, l.lot);
        if (b.expiry !== l.expiry) bad('lot-expiry-conflict', l.lot); // the same lot cannot change its expiry date
        move(s, b.id, l.qtyBase, 'receive', 'receipt', key);
        run('INSERT INTO receipt_line(tenant_id, branch_id, po_ref, receipt_key, product_id, batch_id, qty, cost_cents) VALUES(?,?,?,?,?,?,?,?)', s.t, s.b, poRef ?? '-', key, l.productId, b.id, l.qtyBase, l.costCents);
        costTotal += l.costCents;
      }
      if (costTotal > 0) journal(s, 'receipt', key, [['inventory', costTotal]], [['payables', costTotal]]);
      return { receiptKey: key, poRef, lines: norm.length, receivedBase: norm.reduce((n, l) => n + l.qtyBase, 0), costCents: costTotal };
    });
  }

  // ---- write: sale. lines = [{productId, qtyBase, lineTotalCents}] already converted and priced by the POS layer ------
  async function sell(scope, { key, number, lines, payments }, hooks = {}) {
    const s = scopeOf(scope);
    if (!REF.test(String(number ?? '')) || !Array.isArray(lines) || lines.length === 0 || lines.length > 200 || !Array.isArray(payments) || payments.length === 0) bad('sale-invalid');
    const ls = lines.map(l => { if (!ID.test(String(l.productId)) || !posInt(l.qtyBase, MAX_QTY) || !nonNegInt(l.lineTotalCents, MAX_CENTS)) bad('line-invalid', l); return { productId: String(l.productId), qtyBase: l.qtyBase, lineTotalCents: l.lineTotalCents }; });
    const ps = payments.map(p => { if (!METHODS.has(p.method) || !posInt(p.amountCents, MAX_CENTS)) bad('payment-invalid', p); return { method: p.method, amountCents: p.amountCents }; });
    const total = ls.reduce((n, l) => n + l.lineTotalCents, 0), paid = ps.reduce((n, p) => n + p.amountCents, 0);
    if (total > MAX_CENTS) bad('sale-invalid');
    if (paid !== total) bad('payment-mismatch', { total, paid });
    const { fp } = await prepare(key, { number, ls, ps });
    return atomic(s, 'sale', key, fp, () => {
      const inv = Number(run('INSERT INTO invoice(tenant_id, branch_id, number, total_cents) VALUES(?,?,?,?)', s.t, s.b, String(number), total).lastInsertRowid);
      for (const l of ls) {
        const batches = q('SELECT sb.batch_id AS id, sb.on_hand AS onHand FROM stock_balance sb JOIN batch b ON b.id = sb.batch_id WHERE sb.tenant_id=? AND sb.branch_id=? AND b.product_id=? AND sb.on_hand > 0 AND b.expiry >= ? ORDER BY b.expiry ASC, b.id ASC', s.t, s.b, l.productId, today());
        let need = l.qtyBase; const parts = [];
        for (const b of batches) { if (need === 0) break; const take = Math.min(need, b.onHand); parts.push({ id: b.id, take }); need -= take; }
        if (need > 0) bad('insufficient-stock', { productId: l.productId, missing: need });
        // split the line's cents across the batches it touched, exactly (largest remainder, ties to the earlier batch)
        let given = 0; const cents = parts.map(p => { const c = Math.floor(l.lineTotalCents * p.take / l.qtyBase); given += c; return c; });
        for (let r = l.lineTotalCents - given, i = 0; r > 0; r--, i = (i + 1) % parts.length) cents[i] += 1;
        parts.forEach((p, i) => {
          run('INSERT INTO invoice_line(invoice_id, product_id, batch_id, qty, line_total_cents) VALUES(?,?,?,?,?)', inv, l.productId, p.id, p.take, cents[i]);
          move(s, p.id, -p.take, 'sale', 'invoice', String(number));
        });
      }
      if (hooks.failAt === 'after-stock') bad('injected-failure');
      for (const p of ps) run('INSERT INTO payment(invoice_id, method, amount_cents) VALUES(?,?,?)', inv, p.method, p.amountCents);
      journal(s, 'invoice', String(number), ps.map(p => [p.method === 'credit' ? 'receivable' : p.method, p.amountCents]), [['sales', total]]);
      if (hooks.failAt === 'after-journal') bad('injected-failure');
      return { invoiceId: inv, number: String(number), totalCents: total };
    });
  }

  // ---- write: return. items = [{productId, qtyBase}] taken back from ONE invoice; stock is restored to the same batches ---
  async function returnItems(scope, { key, invoiceNumber, items }) {
    const s = scopeOf(scope);
    if (!REF.test(String(invoiceNumber ?? '')) || !Array.isArray(items) || items.length === 0) bad('return-invalid');
    const its = items.map(i => { if (!ID.test(String(i.productId)) || !posInt(i.qtyBase, MAX_QTY)) bad('return-line-invalid', i); return { productId: String(i.productId), qtyBase: i.qtyBase }; });
    const { fp } = await prepare(key, { invoiceNumber, its });
    return atomic(s, 'return', key, fp, () => {
      const inv = getInvoice({ tenantId: s.t, branchId: s.b }, invoiceNumber);
      if (!inv) bad('invoice-not-found');
      let refund = 0;
      for (const it of its) {
        let rest = it.qtyBase;
        const lines = inv.lines.filter(l => l.productId === it.productId).reverse(); // newest batch line first
        for (const l of lines) {
          if (rest === 0) break;
          const room = l.qty - (one('SELECT COALESCE(SUM(qty),0) AS r FROM return_line WHERE invoice_line_id=?', l.id).r);
          const take = Math.min(rest, room); if (take <= 0) continue;
          const before = one('SELECT COALESCE(SUM(qty),0) AS r, COALESCE(SUM(refund_cents),0) AS c FROM return_line WHERE invoice_line_id=?', l.id);
          const cumulative = Math.round(l.lineTotalCents * (before.r + take) / l.qty); // exact at full return: qty/qty * total
          const cents = cumulative - before.c;
          run('INSERT INTO return_line(invoice_line_id, qty, refund_cents, return_key) VALUES(?,?,?,?)', l.id, take, cents, key);
          move(s, l.batchId, take, 'return', 'invoice', String(invoiceNumber));
          refund += cents; rest -= take;
        }
        if (rest > 0) bad('return-exceeds-sold', { productId: it.productId, excess: rest });
      }
      if (refund > 0) journal(s, 'return', String(invoiceNumber), [['sales', refund]], [['cash', refund]]);
      return { invoiceNumber: String(invoiceNumber), refundCents: refund };
    });
  }

  // ---- reconciliation: every invariant, for one tenant (daily close / after any incident) -------------------------------
  function reconcile(scope) {
    const s = scopeOf(scope); const v = [];
    for (const r of q('SELECT i.id, i.number, i.total_cents AS t, COALESCE((SELECT SUM(amount_cents) FROM payment WHERE invoice_id=i.id),0) AS paid, COALESCE((SELECT SUM(line_total_cents) FROM invoice_line WHERE invoice_id=i.id),0) AS lines FROM invoice i WHERE i.tenant_id=?', s.t)) {
      if (r.paid !== r.t) v.push(`invoice ${r.number}: payments ${r.paid} != total ${r.t}`);
      if (r.lines !== r.t) v.push(`invoice ${r.number}: lines ${r.lines} != total ${r.t}`);
    }
    for (const r of q('SELECT jl.entry_id AS e, SUM(jl.debit_cents) AS d, SUM(jl.credit_cents) AS c FROM journal_line jl JOIN journal_entry je ON je.id = jl.entry_id WHERE je.tenant_id=? GROUP BY jl.entry_id', s.t)) if (r.d !== r.c) v.push(`journal ${r.e}: debit ${r.d} != credit ${r.c}`);
    for (const r of q('SELECT sb.batch_id AS b, sb.branch_id AS br, sb.on_hand AS oh, COALESCE((SELECT SUM(qty_delta) FROM stock_movement m WHERE m.tenant_id=sb.tenant_id AND m.branch_id=sb.branch_id AND m.batch_id=sb.batch_id),0) AS mv FROM stock_balance sb WHERE sb.tenant_id=?', s.t)) if (r.oh !== r.mv) v.push(`batch ${r.b}/${r.br}: on_hand ${r.oh} != movements ${r.mv}`);
    for (const r of q('SELECT il.id, il.qty, COALESCE(SUM(rl.qty),0) AS ret, COALESCE(SUM(rl.refund_cents),0) AS rc, il.line_total_cents AS lt FROM invoice_line il JOIN invoice i ON i.id = il.invoice_id LEFT JOIN return_line rl ON rl.invoice_line_id = il.id WHERE i.tenant_id=? GROUP BY il.id', s.t)) {
      if (r.ret > r.qty) v.push(`line ${r.id}: returned ${r.ret} > sold ${r.qty}`);
      if (r.rc > r.lt) v.push(`line ${r.id}: refunded ${r.rc} > sold ${r.lt}`);
      if (r.ret === r.qty && r.rc !== r.lt) v.push(`line ${r.id}: fully returned but refund ${r.rc} != ${r.lt}`);
    }
    for (const r of q('SELECT pl.po_ref AS po, pl.product_id AS p, pl.ordered_base AS o, COALESCE((SELECT SUM(qty) FROM receipt_line r WHERE r.tenant_id=pl.tenant_id AND r.po_ref=pl.po_ref AND r.product_id=pl.product_id),0) AS got FROM po_line pl WHERE pl.tenant_id=?', s.t)) if (r.got > r.o) v.push(`po ${r.po}/${r.p}: received ${r.got} > ordered ${r.o}`);
    return v;
  }

  return Object.freeze({ install, setPolicy, stockOf, shortages, getInvoice, registerPurchaseOrder, poStatus, receiveGoods, sell, returnItems, reconcile });
}
