import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { createReports } = createRequire(import.meta.url)('../../bi-reports.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const rows = [];
for (let i = 1; i <= 120; i++) rows.push({ date: '2026-11-' + String((i % 28) + 1).padStart(2, '0'), name: i === 5 ? '=HYPERLINK("x")' : 'صنف ' + i, qty: i, branch: i % 2 ? 'أ' : 'ب' });
const def = { id: 'sales', title: 'تقرير المبيعات', columns: [{ key: 'date', label: 'التاريخ' }, { key: 'name', label: 'الصنف' }, { key: 'qty', label: 'الكمية', type: 'number' }], rows: () => rows };
const mk = (o = {}) => { const r = createReports({ can: () => true, schedule: fn => fn(), ...o }); r.define(def); return r; };

t('permission-aware: deny by default, list hides, export needs data.export', () => {
  const d = createReports(); d.define(def);
  assert.deepEqual(d.list(), []); assert.throws(() => d.page('sales'), { code: 'not-permitted' });
  const v = createReports({ can: a => a === 'reports.view' }); v.define(def);
  assert.equal(v.list().length, 1); assert.equal(v.page('sales').total, 120);
  assert.throws(() => v.snapshot('sales'), { code: 'not-permitted' });
});
t('filter and paging', () => {
  const r = mk();
  assert.equal(r.page('sales', { eq: { branch: 'أ' } }).total, 60);
  assert.equal(r.page('sales', { q: 'صنف 12' }).total, 2); // صنف 12 and صنف 120
  const p = r.page('sales', {}, { page: 99, size: 50 });
  assert.equal(p.page, 3); assert.equal(p.rows.length, 20); assert.equal(r.page('sales', {}, { size: 9999 }).rows.length, 120);
  assert.equal(r.page('sales', { from: '2026-11-05', to: '2026-11-05' }).rows.every(x => x.date === '2026-11-05'), true);
});
t('CSV: BOM, Arabic, CRLF, formula guard', () => {
  const c = mk().render(mk().snapshot('sales'), 'csv');
  assert.equal(c.charCodeAt(0), 0xfeff); assert.ok(c.includes('التاريخ,الصنف,الكمية\r\n')); assert.ok(c.includes('"\'=HYPERLINK(""x"")"'));
});
t('data limit blocks oversized export', () => {
  assert.throws(() => mk({ maxRows: 10 }).snapshot('sales'), { code: 'too-many-rows' });
  assert.equal(mk({ maxRows: 10 }).snapshot('sales', { eq: { branch: 'zz' } }).rows.length, 0);
});
t('XLSX is a valid zip (unzip -t) with RTL sheet and Arabic text', () => {
  const r = mk(), x = r.render(r.snapshot('sales'), 'xlsx');
  assert.equal(x[0], 0x50); const f = join(mkdtempSync(join(tmpdir(), 'bi-')), 'o.xlsx'); writeFileSync(f, x);
  try { const o = execFileSync('unzip', ['-p', f, 'xl/worksheets/sheet1.xml']).toString(); assert.ok(o.includes('rightToLeft="1"')); assert.ok(o.includes('تقرير') === false); assert.ok(o.includes('صنف 1')); assert.ok(o.includes('<v>120</v>')); }
  catch (e) { if (e.code === 'ENOENT') console.log('unzip missing, skipped content check'); else throw e; }
});
t('PDF path is RTL print html, escaped', () => {
  const r = mk(), h = r.render(r.snapshot('sales'), 'pdf');
  assert.ok(h.includes('dir="rtl"') && h.includes('تقرير المبيعات')); assert.ok(h.includes('&quot;x&quot;')); assert.throws(() => r.render(r.snapshot('sales'), 'doc'), { code: 'bad-format' });
});
t('background job needs another reviewer before release', () => {
  let later; const r = mk({ schedule: fn => { later = fn; } });
  const j = r.requestExport('sales', {}, 'csv', 'amal');
  assert.equal(j.status, 'queued'); assert.throws(() => r.release(j.id), { code: 'review-required' });
  assert.throws(() => r.review(j.id, 'sara', true), { code: 'not-reviewable' });
  later(); assert.equal(r.jobs()[0].status, 'pending-review');
  assert.throws(() => r.review(j.id, 'amal', true), { code: 'self-review' });
  assert.equal(r.review(j.id, 'sara', true).status, 'approved');
  assert.ok(r.release(j.id).startsWith('﻿')); assert.throws(() => r.release(j.id), { code: 'review-required' });
  const k = r.requestExport('sales', {}, 'pdf', 'amal'); later(); r.review(k.id, 'sara', false);
  assert.throws(() => r.release(k.id), { code: 'review-required' });
});
console.log(n + ' passed');
