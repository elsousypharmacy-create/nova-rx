// #41 stock count (الجرد): blind partial count while selling, idempotent close, shortage via novaItemCard.adjust, surplus via addLot.
// Local fake data only. Uses its own static server (or NOVA_URL when given).
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const full = path.resolve(ROOT, rel);
      if (!full.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(full, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

const own = process.env.NOVA_URL ? null : await startServer();
const BASE = process.env.NOVA_URL || own.url;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
const errors = [];

try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('__nsc_cleared')) { localStorage.clear(); sessionStorage.setItem('__nsc_cleared', '1'); }
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.novaLazy && window.novaStock && window.NOVA_DEMO && window.novaSales));
  // lazy: not loaded at startup on the sale page
  assert.equal(await page.evaluate(() => typeof window.novaStockCount), 'undefined', 'stock count must stay lazy at startup');
  await page.evaluate(() => window.novaLazy.load());
  await page.waitForFunction(() => !!(window.novaStockCount && window.novaItemCard));

  // products page shows the card
  await page.evaluate(() => { const t = document.querySelector('.nova-tab[data-page="products"]'); if (t) t.click(); });
  await page.evaluate(id => window.novaPageViews.openTool(id), 'novaStockCount'); await page.waitForTimeout(400); // Q21-2c: the card is a tool in «الأدوات»
  await page.waitForSelector('#novaStockCount', { timeout: 10000 });

  const setup = await page.evaluate(() => {
    const S = window.novaStock, all = window.NOVA_DEMO.products || [];
    const clean = all.filter((p) => !S.hasLots(S.keyOf(p)));
    const A = clean[0], B = clean[1], C = clean[2];
    const keyA = S.keyOf(A), keyB = S.keyOf(B), keyC = S.keyOf(C);
    S.addLot({ key: keyA, lot: 'A1', expiry: '2029-12-31', qty: 5, cost: 10 }, 'SEED-A1');
    S.addLot({ key: keyB, lot: 'B1', expiry: '2029-12-31', qty: 3, cost: 4 }, 'SEED-B1');
    S.addLot({ key: keyC, lot: 'C1', expiry: '2029-12-31', qty: 6, cost: 2 }, 'SEED-C1');
    const sess = window.novaStockCount.start();
    window.novaStockCount.addProduct(keyA);
    window.novaStockCount.addProduct(keyB);
    window.novaStockCount.addProduct(keyC);
    return { sessionId: sess.id, keyA, keyB, keyC };
  });

  const sell = (key, lot, qty, id) => page.evaluate(({ key, lot, qty, id }) => window.novaSales.add({ id, at: new Date().toISOString(), total: qty, payment: 'cash',
    lines: [{ key, barcode: key, name: 'x', qty, price: 1, lots: [{ lot, expiry: '2029-12-31', qty }] }] }), { key, lot, qty, id });

  // a sale BETWEEN adding C and counting it: the shelf already lost 1 box, so counting 5 is NOT a shortage
  await sell(setup.keyC, 'C1', 1, 'T-SALE-C-BEFORE');

  // blind UI: open the counting overlay from the card
  await page.click('#novaStockCount button.btn-primary');
  await page.waitForSelector('#novaStockCountOverlay .nsc-lot-row');
  const blind = await page.evaluate(() => {
    const ov = document.getElementById('novaStockCountOverlay');
    const rows = Array.from(ov.querySelectorAll('.nsc-lot-row'));
    const a1 = rows.find((r) => r.textContent.includes('A1'));
    const attrs = Array.from(ov.querySelectorAll('*')).some((n) => Array.from(n.attributes).some((a) => /expect/i.test(a.name) || (a.name === 'value' && n.tagName === 'INPUT' && a.value !== '')));
    const inputs = Array.from(ov.querySelectorAll('input.nsc-count')).map((i) => i.value);
    const bad = Array.from(ov.querySelectorAll('button')).filter((b) => b.getBoundingClientRect().height < 44 && b.offsetParent).length;
    const bg = getComputedStyle(ov).backgroundColor;
    const b1 = rows.find((r) => r.textContent.includes('B1'));
    return { a1: a1 ? a1.textContent : '', b1: b1 ? b1.textContent : 'missing', attrs, inputs, bad, bg,
      overflow: document.documentElement.scrollWidth > window.innerWidth || ov.scrollWidth > ov.clientWidth };
  });
  assert.ok(blind.a1, 'A1 row rendered');
  assert.equal(/5/.test(blind.a1), false, 'expected 5 must not show next to A1: ' + blind.a1);
  assert.equal(/3/.test(blind.b1), false, 'expected 3 must not show next to B1: ' + blind.b1);
  assert.equal(blind.attrs, false, 'no expected value in attributes / prefilled inputs');
  assert.deepEqual(blind.inputs, ['', '', ''], 'count inputs start empty');
  assert.equal(blind.bad, 0, 'buttons at least 44px');
  assert.equal(blind.bg, 'rgb(20, 24, 29)', 'dark theme overlay');
  assert.equal(blind.overflow, false, 'no horizontal overflow at 390px');

  // count through the real UI for C1 (Arabic-Indic digits from a phone keyboard)
  await page.locator('#novaStockCountOverlay .nsc-lot-row', { hasText: 'C1' }).locator('input').fill('٥');
  await page.locator('#novaStockCountOverlay .nsc-lot-row', { hasText: 'C1' }).locator('input').dispatchEvent('change');
  assert.match(await page.textContent('#novaStockCountOverlay .nsc-progress'), /1/, 'progress updated');

  // finishing with uncounted lots is refused
  const early = await page.evaluate((s) => { try { window.novaStockCount.lock(s.sessionId); return 'locked'; } catch (e) { return e.code; } }, setup);
  assert.equal(early, 'errUncounted');

  const diffs = await page.evaluate((s) => {
    const N = window.novaStockCount;
    N.setCount(s.sessionId, s.keyA, 'A1', '2029-12-31', 4);
    N.setCount(s.sessionId, s.keyB, 'B1', '2029-12-31', 5);
    N.addUnknownLot(s.sessionId, s.keyA, 'A9', '01/30', 1);
    let bad = null; try { N.setCount(s.sessionId, s.keyA, 'A1', '2029-12-31', -1); } catch (e) { bad = e.code; }
    return { rows: N.differences(s.sessionId), bad };
  }, setup);
  assert.equal(diffs.bad, 'errBadCount', 'negative count refused');
  const by = Object.fromEntries(diffs.rows.map((d) => [d.lot, d]));
  assert.equal(diffs.rows.length, 4);
  assert.equal(by.A1.delta, -1, 'A1 shortage 1');
  assert.equal(by.B1.delta, 2, 'B1 surplus 2');
  assert.equal(by.A9.delta, 1, 'A9 unknown lot +1');
  assert.equal(by.A9.expiry, '2030-01-31', 'MM/YY expiry -> last day of month');
  assert.equal(by.C1.delta, 0, 'sale between scan and count is not a shortage');

  // a sale AFTER the count, before closing: it must be kept (A1 ends at 4 - 1 = 3)
  await sell(setup.keyA, 'A1', 1, 'T-SALE-A-AFTER');

  // close is fail-closed on permission (false result and throw)
  const perm = await page.evaluate(async (s) => {
    const real = window.novaPerms;
    const out = [];
    for (const fake of [{ require: () => false }, { require: () => { throw new Error('x'); } }]) {
      window.novaPerms = fake;
      try { await window.novaStockCount.close(s.sessionId, 'فقد / سرقة'); out.push('closed'); } catch (e) { out.push(e.code); }
    }
    window.novaPerms = real;
    return { out, closed: !!window.novaStockCount.sessions().find((x) => x.id === s.sessionId).closedAt };
  }, setup);
  assert.deepEqual(perm.out, ['errNoPerm', 'errNoPerm']);
  assert.equal(perm.closed, false);

  // missing reason refused; «تانية» needs a typed note
  const noReason = await page.evaluate(async (s) => {
    const r = [];
    try { await window.novaStockCount.close(s.sessionId, { A1: { reason: 'فقد / سرقة' }, B1: { reason: 'تانية' }, A9: { reason: 'خطأ استلام سابق' } }); r.push('closed'); } catch (e) { r.push(e.code); }
    return r;
  }, setup);
  assert.deepEqual(noReason, ['errReason']);

  // review via the UI: Finish locks the counts, expected numbers appear only now
  await page.evaluate(() => document.getElementById('novaStockCountOverlay').remove());
  await page.click('#novaStockCount button.btn-primary');
  await page.waitForSelector('#novaStockCountOverlay .nsc-footer');
  await page.locator('#novaStockCountOverlay .nsc-footer button.btn-primary').click();
  await page.waitForSelector('#novaStockCountOverlay table.nsc-table');
  const locked = await page.evaluate((s) => { try { window.novaStockCount.setCount(s.sessionId, s.keyA, 'A1', '2029-12-31', 5); return 'edited'; } catch (e) { return e.code; } }, setup);
  assert.equal(locked, 'errLocked', 'counts cannot change after the review is opened');

  const stock = await page.evaluate(async (s) => {
    const reasons = { A1: { reason: 'فقد / سرقة', note: 'نقص رف' }, B1: { reason: 'خطأ استلام سابق' }, A9: { reason: 'تانية', note: 'تشغيلة جديدة' } };
    const snap = () => {
      const g = (k, lot) => (window.novaStock.lots(k).find((l) => l.lot === lot) || {}).onHand;
      return { A1: g(s.keyA, 'A1'), A9: g(s.keyA, 'A9'), B1: g(s.keyB, 'B1'), C1: g(s.keyC, 'C1') };
    };
    const [r1, r2] = await Promise.all([window.novaStockCount.close(s.sessionId, reasons), window.novaStockCount.close(s.sessionId, reasons)]);
    const first = snap();
    const r3 = await window.novaStockCount.close(s.sessionId, reasons);
    // crash replay: re-open the session record (closedAt removed, plan kept) and close again -> nothing applied twice
    const all = JSON.parse(localStorage.getItem('nova-rx-stock-count-v1'));
    const me = all.find((x) => x.id === s.sessionId); const keep = me.closedAt; me.closedAt = null;
    localStorage.setItem('nova-rx-stock-count-v1', JSON.stringify(all));
    await window.novaStockCount.close(s.sessionId, null);
    const second = snap();
    const sess = window.novaStockCount.sessions().find((x) => x.id === s.sessionId);
    return { first, second, same: r1 === r2, again: !!r3.alreadyClosed, summary: sess.summary, closed: !!sess.closedAt, keep: !!keep,
      card: !!document.getElementById('novaStockCount'), reasons: sess.lines.map((l) => l.reason || '') };
  }, setup);
  assert.deepEqual(stock.first, { A1: 3, A9: 1, B1: 5, C1: 5 }, 'counted quantities applied, sales during the count kept');
  assert.deepEqual(stock.second, stock.first, 'retry / crash replay does not double-apply');
  assert.equal(stock.same, true, 'concurrent close calls share one run');
  assert.equal(stock.again, true, 'second close reports alreadyClosed');
  assert.equal(stock.closed, true);
  assert.deepEqual(stock.summary, { shortageCost: 10, surplusCost: 18, netCost: 8 }, 'cost summary (A1 -1x10, B1 +2x4, A9 +1x10)');
  assert.equal(stock.card, true);

  // shortage went through the item card adjustment (ledger + adjustment record)
  const ledger = await page.evaluate((s) => {
    const raw = Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('\n');
    return { out: raw.includes(s.sessionId + '-out'), ref: raw.includes('COUNT-' + s.sessionId + '/') };
  }, setup);
  assert.equal(ledger.out, true, 'shortage adjustment id recorded');
  assert.equal(ledger.ref, true, 'surplus receipt refs recorded');

  // read-only report (from «تقارير الجرد» on the card) shows the summary
  await page.evaluate(() => { const o = document.getElementById('novaStockCountOverlay'); if (o) o.remove(); });
  await page.click('#novaStockCount .nsc-report-item');
  await page.waitForSelector('#novaStockCountOverlay .nsc-summary');
  assert.match(await page.textContent('#novaStockCountOverlay .nsc-summary'), /فرق التكلفة: 8/);
  const ovf = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(ovf, false, 'no horizontal overflow on the review at 390px');

  // ---- #41b: shortage bigger than the stock now is capped, not stuck forever ----
  let dialogs = 0; page.on('dialog', (d) => { dialogs++; d.dismiss(); });
  const cap = await page.evaluate(() => {
    const S = window.novaStock, N = window.novaStockCount;
    const D = (window.NOVA_DEMO.products || []).filter((p) => !S.hasLots(S.keyOf(p)))[0];
    const key = S.keyOf(D);
    S.addLot({ key, lot: 'D1', expiry: '2029-12-31', qty: 5, cost: 3 }, 'SEED-D1');
    const sess = N.start(); N.addProduct(key); N.setCount(sess.id, key, 'D1', '2029-12-31', 0); N.lock(sess.id);
    return { id: sess.id, key };
  });
  await sell(cap.key, 'D1', 3, 'T-SALE-D-DURING-REVIEW'); // stock is 2 now, the count says 5 are missing
  await page.evaluate(() => { const o = document.getElementById('novaStockCountOverlay'); if (o) o.remove(); });
  await page.click('#novaStockCount button.btn-primary');
  await page.waitForSelector('#novaStockCountOverlay table.nsc-table');
  assert.match(await page.textContent('#novaStockCountOverlay .nsc-capped'), /اتخصم المتاح بس \(2\/5\)/, 'review row shows the capped shortage');
  const capClose = await page.evaluate(async (c) => {
    const r = await window.novaStockCount.close(c.id, 'فقد / سرقة');
    const lot = window.novaStock.lots(c.key).find((l) => l.lot === 'D1');
    const sess = window.novaStockCount.sessions().find((x) => x.id === c.id);
    return { closed: !!sess.closedAt, summary: sess.summary, onHand: lot ? lot.onHand : 0, capped: sess.plan.capped, ok: !!r.session };
  }, cap);
  assert.equal(capClose.closed, true, 'a shortage above the stock still closes');
  assert.equal(capClose.onHand, 0, 'only the available 2 boxes were deducted (never negative)');
  assert.deepEqual(capClose.summary, { shortageCost: 6, surplusCost: 0, netCost: -6 }, 'cost uses the capped quantity');
  assert.deepEqual(capClose.capped, { 0: { wanted: 5, applied: 2 } });

  // ---- #41b: cancel count ----
  const can = await page.evaluate(() => {
    const S = window.novaStock, N = window.novaStockCount;
    const E = (window.NOVA_DEMO.products || []).filter((p) => !S.hasLots(S.keyOf(p)))[0];
    const key = S.keyOf(E);
    S.addLot({ key, lot: 'E1', expiry: '2029-12-31', qty: 4, cost: 2 }, 'SEED-E1');
    const sess = N.start(); N.addProduct(key); N.setCount(sess.id, key, 'E1', '2029-12-31', 1); N.lock(sess.id);
    return { id: sess.id, key };
  });
  const refuse = await page.evaluate((c) => {
    const real = window.novaPerms, out = [];
    for (const fake of [{ require: () => false }, { require: () => { throw new Error('x'); } }]) {
      window.novaPerms = fake;
      try { window.novaStockCount.cancel(c.id, 'سبب'); out.push('cancelled'); } catch (e) { out.push(e.code); }
    }
    window.novaPerms = real;
    try { window.novaStockCount.cancel(c.id, '   '); out.push('cancelled'); } catch (e) { out.push(e.code); }
    // a partly applied frozen plan can never be cancelled silently
    const all = JSON.parse(localStorage.getItem('nova-rx-stock-count-v1')); const me = all.find((x) => x.id === c.id);
    const variants = [{ outApplied: true, ins: [] }, { outStarted: true, ins: [] }, { ins: [{ done: true }] }, { ins: [{ started: true }] }];
    for (const v of variants) {
      me.plan = Object.assign({ out: [], note: '', reasons: {} }, v); localStorage.setItem('nova-rx-stock-count-v1', JSON.stringify(all));
      try { window.novaStockCount.cancel(c.id, 'سبب'); out.push('cancelled'); } catch (e) { out.push(e.code); }
    }
    me.plan = null; localStorage.setItem('nova-rx-stock-count-v1', JSON.stringify(all));
    return out;
  }, can);
  assert.deepEqual(refuse, ['errNoPermCancel', 'errNoPermCancel', 'errCancelReason', 'errPartial', 'errPartial', 'errPartial', 'errPartial'], 'cancel is fail-closed, needs a reason, refuses a partly applied plan');
  assert.equal(await page.evaluate((c) => !!window.novaStockCount.sessions().find((x) => x.id === c.id).cancelledAt, can), false, 'refused attempts changed nothing');

  // through the real UI: dialog with a required reason, no window.confirm
  await page.evaluate(() => { const o = document.getElementById('novaStockCountOverlay'); if (o) o.remove(); });
  await page.evaluate(() => window.novaStockCount.sessions()); // keep session
  await page.waitForSelector('#novaStockCount .nsc-cancel-btn');
  await page.click('#novaStockCount .nsc-cancel-btn');
  await page.waitForSelector('#novaStockCountCancelDlg textarea');
  await page.click('#novaStockCountCancelDlg .nsc-dlg-ok');
  assert.match(await page.textContent('#novaStockCountCancelDlg .nsc-dlg-msg'), /اكتب سبب/, 'empty reason refused in the dialog');
  await page.fill('#novaStockCountCancelDlg textarea', 'بدأته بالغلط');
  await page.click('#novaStockCountCancelDlg .nsc-dlg-ok');
  await page.waitForFunction(() => !document.getElementById('novaStockCountCancelDlg'));
  const after = await page.evaluate((c) => {
    const s = window.novaStockCount.sessions().find((x) => x.id === c.id);
    const lot = window.novaStock.lots(c.key).find((l) => l.lot === 'E1');
    return { at: !!s.cancelledAt, reason: s.cancelReason, by: typeof s.cancelledBy, closed: !!s.closedAt, onHand: lot.onHand };
  }, can);
  assert.deepEqual(after, { at: true, reason: 'بدأته بالغلط', by: 'string', closed: false, onHand: 4 }, 'cancelled with no stock move');
  const reports = await page.evaluate(() => Array.from(document.querySelectorAll('#novaStockCount .nsc-report-item')).map((b) => b.textContent));
  assert.ok(reports.some((t) => t.includes('ملغي') && t.includes('بدأته بالغلط')), 'cancelled count listed as «ملغي» in the reports');
  assert.equal(await page.evaluate(() => /ابدأ جرد جديد/.test(document.getElementById('novaStockCount').textContent)), true, 'a new count can start after cancelling');
  assert.equal(await page.evaluate((c) => { try { window.novaStockCount.setCount(c.id, c.key, 'E1', '2029-12-31', 2); return 'edited'; } catch (e) { return e.code; } }, can), 'errNoSession');
  assert.equal(dialogs, 0, 'no window.confirm / alert used');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('PASS stock-count');
} finally {
  await browser.close();
  if (own) own.server.close();
}
