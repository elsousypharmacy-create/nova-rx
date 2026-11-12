import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const E = createRequire(import.meta.url)('../../emergency-core.js');
const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; };
const csv = fs.readFileSync(new URL('../fixtures/emergency/snapshot-sample.csv', import.meta.url), 'utf8');

// snapshot parsing
const p = E.parseSnapshot(csv, { exportedAt: '2026-11-09T08:00:00Z' });
assert.ok(p.ok); assert.equal(p.items.length, 4);
assert.equal(p.items[2].price, null, 'zero price is not a price');
assert.equal(E.parseSnapshot('').ok, false);
assert.equal(E.parseSnapshot('code,namear\n1,2').ok, false);
assert.equal(E.parseSnapshot('{bad').ok, false);
assert.ok(E.parseSnapshot(JSON.stringify({ exportedAt: '2026-01-01T00:00:00Z', items: [{ code: '5', namear: 'س', price: '1,200.5' }] })).items[0].price === 1200.5);

// freshness (never claims real-time)
const now = Date.parse('2026-11-09T09:00:00Z');
assert.equal(E.freshness('2026-11-09T08:00:00Z', now).level, 'ok');
assert.equal(E.freshness('2026-11-09T01:00:00Z', now).level, 'stale');
assert.equal(E.freshness('2026-11-07T01:00:00Z', now).level, 'old');
assert.equal(E.freshness(null, now).level, 'unknown');

// search: name (Arabic normalisation), barcode/code, no-price item still found
assert.equal(E.searchItems(p.items, 'بانادول').length, 1);
assert.equal(E.searchItems(p.items, 'اوجمنتين')[0].code, '10000002');
assert.equal(E.searchItems(p.items, '6281000000001')[0].code, '10000004');
assert.equal(E.searchItems(p.items, '10000001')[0].code, '10000001');
assert.equal(E.searchItems(p.items, 'ا').length, 0);

// basket + totals + discount authorisation
const b = E.emptyBasket();
E.addLine(b, p.items[0], 2); E.addLine(b, p.items[0], 1); E.addLine(b, p.items[1], 1);
assert.equal(b.lines.length, 2); assert.equal(b.lines[0].qty, 3);
assert.throws(() => E.addLine(b, p.items[2], 1), /no-price/);
assert.deepEqual(E.totals(b), { subtotal: 102, discount: 0, total: 102 });
E.setQty(b, '10000001', 0); assert.equal(b.lines[0].qty, 1);
b.discount = 5; assert.equal(E.discountProblem(b), 'الخصم يحتاج اسم من اعتمده');
b.discountBy = 'أحمد'; assert.equal(E.discountProblem(b), null);
assert.equal(E.totals(b).total, 72);
b.discount = 9999; assert.equal(E.totals(b).total, 0, 'discount capped at subtotal');
b.discount = 5;

// invoice: needs staff, immutable snapshot, unique id/ref
assert.throws(() => E.createInvoice({ basket: b, staff: '', deviceId: 'D' }), /staff-required/);
assert.throws(() => E.createInvoice({ basket: E.emptyBasket(), staff: 'x', deviceId: 'D' }), /empty-basket/);
const inv = E.createInvoice({ deviceId: 'DEV-TEST0001', basket: b, staff: 'منى', now: now });
const inv2 = E.createInvoice({ deviceId: 'DEV-TEST0001', basket: b, staff: 'منى', now: now });
assert.notEqual(inv.id, inv2.id); assert.match(inv.id, /^[0-9a-f-]{36}$/); assert.match(inv.ref, /^EMG-261109-[0-9A-F]{5}$/);
assert.ok(inv.label.includes('لم تُرحّل للنظام'));
// OFF-02: device id, unit, emergency warning, no central-collection claim
assert.throws(() => E.createInvoice({ basket: b, staff: 'علي' }), /device-required/);
const st = mem(), dev = E.getDeviceId(st); assert.match(dev, /^DEV-[0-9A-F]{8}$/); assert.equal(E.getDeviceId(st), dev, 'device id is stable');
const oi = E.createInvoice({ basket: b, staff: 'علي', deviceId: dev, now: 1 });
assert.equal(oi.deviceId, dev); assert.equal(oi.centralCollection, false); assert.equal(oi.emergencyMode, true);
assert.ok(oi.warning.includes('وضع الطوارئ') && oi.warning.includes('لم يتم تحصيلها مركزيًا'));
assert.equal(oi.lines[0].unit, 'علبة'); assert.match(oi.id, /^[0-9a-f-]{36}$/);
b.lines[0].unitPrice = 999;                                   // later price edits must not touch the invoice
assert.equal(inv.lines[0].unitPrice, 12.5); assert.ok(Object.isFrozen(inv.lines));
assert.equal(inv.total, 72);

// queue: dedupe, review needs a name, synced is terminal + idempotent, export skips synced
const q = E.createQueue(mem());
assert.equal(q.add(inv), true); assert.equal(q.add(inv), false); assert.equal(q.list().length, 1);
assert.throws(() => q.mark(inv.id, 'synced', ''), /reviewer-required/);
assert.equal(q.mark(inv.id, 'needs-review', 'سعيد', 'سعر اتغير').changed, true);
const first = q.mark(inv.id, 'synced', 'سعيد'); assert.equal(first.changed, true);
const second = q.mark(inv.id, 'synced', 'سعيد'); assert.equal(second.duplicate, true); assert.equal(second.changed, false);
assert.equal(q.get(inv.id).audit.filter(a => a.action === 'synced').length, 1, 'one synced audit entry only');
assert.equal(q.counts().synced, 1); assert.equal(JSON.parse(q.exportForImport()).invoices.length, 0);
q.add(inv2); const ex = JSON.parse(q.exportForImport()); assert.equal(ex.invoices[0].externalId, inv2.id);
assert.equal(JSON.stringify(ex).includes('password'), false);

// conflicts
const cur = JSON.parse(JSON.stringify(p.items)); cur[0].price = 15; cur[1].stock = 0;
const cf = E.detectConflicts(E.createInvoice({ deviceId: 'DEV-TEST0001', basket: (() => { const x = E.emptyBasket(); E.addLine(x, p.items[0], 1); E.addLine(x, p.items[1], 2); return x; })(), staff: 's' }), cur);
assert.deepEqual(cf.map(c => c.type).sort(), ['price-changed', 'stock-low']);
assert.equal(E.detectConflicts(inv, []).every(c => c.type === 'missing'), true);

// draft autosave / recovery, broken storage
const s = mem(); assert.equal(E.saveDraft(s, { basket: b }), true); assert.equal(E.loadDraft(s).basket.lines.length, 2);
s.setItem('novaEmergencyDraft', '{oops'); assert.equal(E.loadDraft(s), null);
assert.equal(E.saveDraft({ setItem() { throw new Error('quota'); } }, { basket: b }), false);

// pagination for 1 / 6 / 20 items
for (const [n, pages] of [[1, 1], [6, 1], [9, 1], [10, 2], [20, 3]]) {
  const lines = Array.from({ length: n }, (_, i) => i);
  const pg = E.paginate(lines, 9, 10); assert.equal(pg.length, pages, `n=${n}`); assert.equal(pg.flat().length, n);
}

// PDF container is structurally valid
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const pdf = E.buildPdf([{ jpeg: jpg, w: 10, h: 14 }, { jpeg: jpg, w: 10, h: 14 }]);
const txt = Buffer.from(pdf).toString('latin1');
assert.ok(txt.startsWith('%PDF-1.4') && txt.trimEnd().endsWith('%%EOF')); assert.match(txt, /\/Count 2/);
const sx = +txt.match(/startxref\n(\d+)/)[1]; assert.ok(txt.slice(sx).startsWith('xref'));
for (const m of txt.matchAll(/(\d{10}) 00000 n /g)) assert.match(txt.slice(+m[1], +m[1] + 12), /^\d+ 0 obj/);

// static: no network, no secrets in the new files
for (const f of ['emergency-core.js', 'emergency-sales.html']) {
  const src = fs.readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
  const fetches = src.match(/\bfetch\(/g) || [];
  assert.equal(/XMLHttpRequest|WebSocket|sendBeacon/.test(src) || fetches.length > (f.endsWith('.html') ? 1 : 0), false, f + ' network use limited to one same-origin fetch');
  if (f.endsWith('.html')) assert.ok(src.includes("fetch('/emergency/stock.json'"), 'only the same-origin price list is fetched');
  assert.equal(/password|api[_-]?key|token|secret/i.test(src), false, f + ' must not mention credentials');
}
console.log('emergency-core checks passed');
