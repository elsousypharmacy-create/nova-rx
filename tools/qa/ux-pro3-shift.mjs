// UX38 — full pharmacist-shift simulation (30 sales, 3 returns, receiving, shortage, debt, chronic refill, close of day).
// Local only: serves the CURRENT repo frontend, fake demo data, every non-GET request and every non-local request is aborted.
// Usage: PW_MODULE=<playwright-core/index.mjs> CHROME_BIN=/usr/bin/chromium node tools/qa/ux-pro3-shift.mjs
// Output: .nova/qa/ux-pro3-raw.json and .nova/qa/ux-pro3/*.png (max 30)
const { chromium } = await import(process.env.PW_MODULE || 'playwright');
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, '.nova/qa/ux-pro3');
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT, f));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  if (p === '/purchases') p = '/purchases.html';
  const f = path.resolve(ROOT, '.' + p);
  if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end('nf'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const result = { date: new Date().toISOString(), blockedWrites: [], desktop: {}, mobile: {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(vp, size) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  const ctx = await browser.newContext({ viewport: size, locale: 'ar-EG', isMobile: vp === 'mobile', hasTouch: vp === 'mobile' });
  await ctx.route('**/*', r => {
    const m = r.request().method();
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') { result.blockedWrites.push(`${vp} ${m} ${r.request().url().slice(0, 80)}`); return r.abort(); }
    if (!r.request().url().startsWith(BASE)) return r.abort();
    return r.continue();
  });
  await ctx.addInitScript(() => { window.fmt = s => (s || '').replace(/\s+/g, ' ').trim(); });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message.slice(0, 120)));
  page.on('dialog', d => { errs.push('dialog: ' + d.message().slice(0, 60)); d.accept().catch(() => {}); });
  return { browser, ctx, page, errs };
}

const fmt = s => (s || '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- desktop shift
{
  const { browser, ctx, page, errs } = await open('desktop', { width: 1366, height: 768 });
  const R = result.desktop; R.steps = {}; R.sales = []; R.notes = {}; R.search = {}; R.keyboard = {};
  let shots = 0; const shot = async n => { if (shots++ >= 22) return; await page.screenshot({ path: path.join(OUT, `d-${n}.png`) }).catch(() => {}); };
  const cnt = () => ({ clicks: 0, keys: 0, typed: 0 });
  let C = cnt();
  const key = async k => { C.keys++; await page.keyboard.press(k); };
  const type = async t => { C.typed += t.length; await page.keyboard.type(t); };
  const click = async (sel, o) => { C.clicks++; await page.click(sel, { timeout: 3000, ...o }); };
  const tab = async pg => { await page.evaluate(x => document.querySelector('.nova-tab[data-page="' + x + '"]').click(), pg); await sleep(250); };
  const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map(e => e.innerText.trim()).join(' / '));
  const step = async (name, fn) => {
    C = cnt(); const t0 = Date.now(); const rec = { notes: [] };
    try { await fn(rec); } catch (e) { rec.error = e.message.split('\n')[0].slice(0, 150); }
    Object.assign(rec, C, { total: C.clicks + C.keys, ms: Date.now() - t0 }); R.steps[name] = rec; return rec;
  };

  // ---- first run (empty storage): what does a new cashier see?
  await page.goto(BASE + '/index.html'); await page.waitForSelector('#mainSearchInput'); await sleep(900);
  await shot('00-first-run');
  R.notes.firstRun = await page.evaluate(() => ({
    title: document.title, hasWelcome: !!document.querySelector('[class*=welcome],[class*=onboard],[class*=tour]'),
    hasShiftUI: /وردية|Shift/i.test(document.body.innerText), focusId: document.activeElement.id,
    emptyHint: fmt(document.querySelector('#invoiceTableBody')?.innerText || '') || fmt(document.querySelector('.empty-state,.invoice-empty')?.innerText || ''),
    visibleShortcutHints: /F9|F2|F3/.test(document.getElementById('invoiceTable')?.parentElement?.innerText || '') , searchPlaceholder: document.getElementById('mainSearchInput').placeholder,
    modeTag: document.getElementById('searchModeTag')?.innerText, bodyHasF1Hint: /F1/.test(document.body.innerText),
  })).catch(() => ({}));
  function fmt(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

  // ---- keyboard-only audit from cold start
  R.keyboard.tabOrder = [];
  await page.evaluate(() => document.activeElement.blur());
  for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); R.keyboard.tabOrder.push(await page.evaluate(() => { const e = document.activeElement; return (e.id ? '#' + e.id : e.tagName + '.' + String(e.className).split(' ')[0]) + ' «' + fmt((e.innerText || e.getAttribute('aria-label') || e.placeholder || '').slice(0, 18)) + '»'; })); }
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('F1'); await sleep(250); await shot('01-help-F1');
  R.keyboard.helpOpen = await page.evaluate(() => document.getElementById('helpModal').classList.contains('active'));
  await page.keyboard.press('Escape'); await sleep(150);
  await page.focus('#mainSearchInput');

  // ---- shift open: is there anything?
  R.notes.shiftOpen = await page.evaluate(() => ({ anyShiftText: /وردية|فتح الدرج|رصيد افتتاحي|opening float/i.test(document.body.innerText), settingsHasShift: false }));

  // ---- search quality (Arabic normalisation, typos, partial words, mixed, generic names)
  const queries = ['اوجمنتين', 'أوجمنتين', 'اوجمنتن', 'بانادول', 'بنادول', 'بانادول اكسترا', 'panadol', 'panadl', 'بانادول extra', 'جلوك', 'جلوكوفاج 500', 'كونكور', 'كونكر', 'concor', 'اموكسيسيلين', 'amoxi', 'ديكلوفيناك', 'diclo', 'مسكن صداع', 'فيتامين د', 'فيتامين د3', 'vit d', 'اوميبرازول', 'اوميبرازل', 'نيكسيوم', 'نكسيوم', 'سيتريزين', 'سترزين', 'فولتارين', 'فولتارين جل', 'اوتريفين', 'بخاخ انف', 'ليبيتور', 'كولسترول', 'باراسيتامول', 'ستامول', 'سولبادين', 'فوار'];
  R.search.results = {};
  for (const q of queries) {
    await page.fill('#mainSearchInput', ''); await page.fill('#mainSearchInput', q); await sleep(220);
    R.search.results[q] = await page.evaluate(() => [...document.querySelectorAll('.suggestion-item')].map(e => fmt(e.innerText).slice(0, 34)));
  }
  await page.fill('#mainSearchInput', 'اموكسي'); await sleep(250); await shot('02-search-no-result-arabic-generic');
  R.search.noResultText = await page.evaluate(() => fmt((document.querySelector('.suggestions,#searchSuggestions,[class*=suggest]') || {}).innerText || ''));
  await page.fill('#mainSearchInput', '');

  // ---- helpers for sales
  const pay = async (rec, method) => {
    // after items are in the cart
    await key('Enter'); await page.waitForSelector('#checkoutModal.active', { timeout: 2500 });
    if (method === 'card') await key('F10'); else if (method === 'credit') await key('F11');
    await key('Enter'); await page.waitForSelector('#receiptModal.active', { timeout: 3000 }); await sleep(80);
  };
  const finish = async () => { await key('Enter'); await sleep(120); };
  const gateSkip = async () => { // customer gate (UX) when needed
    const g = await page.$('#gateSkipCustomer'); if (g && await g.isVisible()) { C.clicks++; await g.click(); }
  };
  const sale = async (label, kind, fn) => {
    const rec = await step('sale-' + label, async r => { await page.focus('#mainSearchInput'); await fn(r); });
    rec.kind = kind; rec.label = label; R.sales.push({ label, kind, clicks: rec.clicks, keys: rec.keys, typed: rec.typed, ms: rec.ms, error: rec.error, notes: rec.notes });
    return rec;
  };
  const BARS = ['6281001234567', '6281001234568', '6281001234569', '6281001234570', '6281001234571', '6281001234572', '6281001234573', '6281001234574', '6281001234575', '6281001234576'];

  // 1-10 barcode sales (rush hour: no customer, cash)
  for (let i = 0; i < 10; i++) {
    await sale('barcode-' + (i + 1), 'barcode', async r => {
      await type(BARS[i]); await key('Enter'); await page.waitForSelector('#invoiceTableBody tr', { timeout: 2000 });
      await pay(r, 'cash'); if (i === 0) await shot('03-receipt-after-first-sale'); await finish();
    });
  }
  // 11-18 name search with typos / Arabic-English mix
  const nameQs = ['بنادول', 'اوجمنتن', 'panadol', 'جلوك', 'كونكر', 'فولتارين جل', 'omepr', 'سترزين'];
  for (let i = 0; i < nameQs.length; i++) {
    await sale('name-' + (i + 1), 'name', async r => {
      await type(nameQs[i]); await sleep(200);
      const n = await page.evaluate(() => document.querySelectorAll('.suggestion-item').length);
      if (!n) { r.notes.push('لا نتائج لـ ' + nameQs[i]); await page.fill('#mainSearchInput', ''); throw new Error('no result: ' + nameQs[i]); }
      await key('Enter'); await page.waitForSelector('#invoiceTableBody tr', { timeout: 2000 });
      await pay(r, 'cash'); await finish();
    });
  }
  // 19-21 partial strips (unit select)
  for (let i = 0; i < 3; i++) {
    await sale('strip-' + (i + 1), 'partial-strip', async r => {
      await type(['panadol', 'سيتريزين', 'جلوكوفاج'][i]); await sleep(200); await key('Enter'); await page.waitForSelector('#invoiceTableBody tr');
      const opts = await page.evaluate(() => [...document.querySelectorAll('#invoiceTableBody .unit-select option')].map(o => o.innerText));
      r.notes.push('وحدات: ' + opts.join('/'));
      await page.selectOption('#invoiceTableBody .unit-select', { index: 1 }); C.clicks += 2; await sleep(120);
      r.notes.push('بعد اختيار شريط: ' + fmt(await page.evaluate(() => document.querySelector('#invoiceTableBody tr')?.innerText || '')).slice(0, 90));
      r.notes.push('التركيز بعد تغيير الوحدة: ' + await page.evaluate(() => document.activeElement.tagName + '#' + document.activeElement.id));
      if (i === 0) await shot('04-partial-strip-line');
      await page.focus('#mainSearchInput'); C.clicks++; // need to return to search manually
      await pay(r, 'cash'); await finish();
    });
  }
  // 22-24 discount
  for (let i = 0; i < 3; i++) {
    await sale('discount-' + (i + 1), 'discount', async r => {
      await type(BARS[i + 2]); await key('Enter'); await page.waitForSelector('#invoiceTableBody tr');
      await key('F6'); const focusAfterF6 = await page.evaluate(() => document.activeElement.id); r.notes.push('F6 يركّز على: ' + focusAfterF6);
      await type(['10', '5', '15'][i]); await sleep(120);
      if (i === 0) await shot('05-discount-applied');
      await page.focus('#mainSearchInput'); C.clicks++;
      await pay(r, 'cash'); await finish();
    });
  }
  // 25-26 split payment
  for (let i = 0; i < 2; i++) {
    await sale('split-' + (i + 1), 'split', async r => {
      await type(BARS[i + 4]); await key('Enter'); await page.waitForSelector('#invoiceTableBody tr');
      await key('Enter'); await page.waitForSelector('#checkoutModal.active');
      await click('.pay-method-btn[data-method=split]'); await sleep(150);
      if (i === 0) await shot('06-split-payment');
      r.notes.push('التركيز بعد «مختلط»: ' + await page.evaluate(() => document.activeElement.id || document.activeElement.tagName));
      r.notes.push('قيمة النقد/البطاقة الافتراضية: ' + await page.evaluate(() => [document.getElementById('inputCashReceived').value, document.getElementById('inputCardAmount').value].join('|')));
      await page.fill('#inputCardAmount', '40'); C.clicks++; C.typed += 2; await sleep(100);
      r.notes.push('النقد المطلوب بعد 40 بطاقة: ' + await page.inputValue('#inputCashReceived'));
      await key('Enter'); await page.waitForSelector('#receiptModal.active', { timeout: 3000 }).catch(() => r.notes.push('Enter لم يُكمل: ' + (""))); r.notes.push('Toast: ' + await toasts());
      await finish();
    });
  }
  // 27-30 credit customer
  for (let i = 0; i < 4; i++) {
    await sale('credit-' + (i + 1), 'credit', async r => {
      await type(BARS[i]); await key('Enter'); await page.waitForSelector('#invoiceTableBody tr');
      await key('F3'); await type(['طارق', 'سارة', 'فهد', 'نورة'][i]); await sleep(250);
      if (i === 0) await shot('07-customer-search-F3');
      await key('Enter'); await sleep(250);
      await key('F9'); await page.waitForSelector('#checkoutModal.active'); await key('F11');
      if (i === 0) await shot('08-credit-checkout');
      await key('Enter'); await page.waitForSelector('#receiptModal.active', { timeout: 3000 }).catch(async () => r.notes.push('لم يكتمل الآجل؛ Toast: ' + await toasts()));
      if (i === 0) r.notes.push('إيصال الآجل: ' + fmt(await page.evaluate(() => (document.getElementById('receiptModal').innerText.match(/آجل[^\n]*/g) || []).join(' | '))));
      await finish();
    });
  }
  R.notes.salesDone = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('nova-rx-sales-v1') || '[]').length; } catch { return -1; } });

  // ---- shortage handling: sell more than stock / out of stock item
  await step('shortage-oversell', async r => {
    await page.focus('#mainSearchInput'); await type('*500 كونكور'); await sleep(250); await key('Enter'); await sleep(300);
    r.notes.push('Toast بعد *500: ' + await toasts());
    r.notes.push('كمية السطر: ' + await page.evaluate(() => document.querySelector('#invoiceTableBody input')?.value));
    await shot('09-oversell-warning');
    await key('Enter'); await sleep(250);
    r.notes.push('نافذة الدفع مفتوحة رغم الكمية الزائدة: ' + await page.evaluate(() => document.getElementById('checkoutModal').classList.contains('active')));
    r.notes.push('Toast: ' + await toasts());
    await key('Escape'); await sleep(150);
    r.notes.push('زر «سجّل نقص / اطلب» متاح في الواجهة: ' + await page.evaluate(() => /ناقص|نقص|طلب الصنف|اطلب/.test(document.querySelector('.suggestion-item,#invoiceTableBody')?.innerText || '')));
    await page.focus('#mainSearchInput');
  });
  await step('undo-delete-line', async r => {
    await page.evaluate(() => document.querySelector('#invoiceTableBody .btn-icon-del')?.click()); await sleep(200);
    r.notes.push('بعد حذف السطر: Toast=' + await toasts() + ' | زر تراجع: ' + await page.evaluate(() => /تراجع|Undo/.test(document.body.innerText)));
    await page.evaluate(() => document.getElementById('btnNewSale')?.click());
  });
  await step('undo-clear-invoice', async r => {
    await page.focus('#mainSearchInput'); await type('6281001234567'); await key('Enter'); await sleep(200);
    await key('F4'); await sleep(250);
    r.notes.push('بعد F4: سطور السلة=' + await page.evaluate(() => document.querySelectorAll('#invoiceTableBody tr').length) + ' | تأكيد؟ ' + errs.filter(e => e.startsWith('dialog')).slice(-1) + ' | تراجع: ' + await page.evaluate(() => /تراجع|Undo/.test(document.body.innerText)));
  });

  // ---- hold & resume (customer interruption)
  await step('hold-resume', async r => {
    await page.focus('#mainSearchInput'); await type('6281001234568'); await key('Enter'); await sleep(200);
    await click('#holdCurrentInvoice'); await sleep(250); r.notes.push('Toast التعليق: ' + await toasts());
    r.notes.push('اختصار مرئي للتعليق: ' + await page.evaluate(() => document.getElementById('holdCurrentInvoice').title));
    await click('#btnHeldInvoices'); await sleep(300); await shot('10-held-panel');
    r.notes.push('لوحة المعلقة: ' + fmt(await page.evaluate(() => document.querySelector('[class*=held-panel],#heldPanel,.held-list')?.innerText || '')).slice(0, 140));
    await page.keyboard.press('Escape');
  });

  // ---- returns x3 via invoices
  await tab('invoices'); await sleep(300); await shot('11-invoices');
  for (let i = 0; i < 3; i++) {
    await step('return-' + (i + 1), async r => {
      if (i) await tab('invoices');
      const n = await page.evaluate(() => document.querySelectorAll('[data-return]').length); r.notes.push('أزرار مرتجع: ' + n);
      await click(`[data-return] >> nth=${i}`); await page.waitForSelector('.nova-return-overlay', { timeout: 2000 });
      if (i === 0) await shot('12-return-dialog');
      await click('#novaRetAll'); await click('.nova-return-overlay button:has-text("رجوع العميل")'); await click('#novaRetOk'); await sleep(300);
      r.notes.push('Toast: ' + await toasts());
      r.notes.push('محاولة مرتجع ثانٍ لنفس الفاتورة مُنعت؟ ' + await page.evaluate(i => { const b = document.querySelectorAll('[data-return]')[i]; return b ? 'الزر ما زال ظاهراً' : 'اختفى'; }, i));
    });
  }

  // ---- receiving with batch/expiry: what UI exists?
  await step('receiving-1', async r => {
    await tab('products'); await sleep(300);
    r.notes.push('أزرار الصفحة: ' + await page.evaluate(() => [...document.querySelectorAll('#novaInventoryPurchase,#novaInventoryLabels,[id*=Receive],[id*=receive],[id*=lot]')].map(e => fmt(e.innerText)).join(' | ')));
    await click('#novaInventoryPurchase'); await sleep(500); await shot('13-receiving-ai-only');
    r.notes.push('حقول يدوية للتشغيلة/الصلاحية: ' + await page.evaluate(() => [...document.querySelectorAll('#novaAiPanel input,#novaAiPanel select')].map(e => e.type + (e.placeholder ? ':' + e.placeholder : '')).join(',')));
    await page.click('#novaAiClose').catch(() => {});
  });
  await step('receiving-2-purchases-page', async r => {
    await page.goto(BASE + '/purchases'); await sleep(900); await shot('14-purchases');
    r.notes.push('نموذج استلام يدوي (رقم تشغيلة/صلاحية): ' + await page.evaluate(() => /تشغيلة|batch|lot|صلاحية|expiry/i.test(document.body.innerText)));
    await page.goto(BASE + '/index.html'); await page.waitForSelector('#mainSearchInput');
  });
  // seed 2 receipts via the app's own stock API only to continue the scenario (no UI exists)
  R.notes.seedLots = await page.evaluate(() => { try { const a = window.novaStock.addLot({ key: window.novaStock.keyOf({ id: 'PRD001' }), lot: 'B2611', expiry: '2027-03-31', qty: 20, cost: 30 }); return JSON.stringify(a).slice(0, 80); } catch (e) { return 'ERR ' + e.message; } });

  // ---- chronic refill
  await step('chronic-refill', async r => {
    await tab('sale'); await page.focus('#mainSearchInput'); await key('F3'); await type('طارق'); await sleep(250); await key('Enter'); await sleep(300); await shot('15-customer-panel-chronic');
    r.notes.push('لوحة العميل: ' + fmt(await page.evaluate(() => document.querySelector('.customer-sidebar')?.innerText || '')).slice(0, 200));
    const b = await page.$('#btnRefillLast'); if (b) { await click('#btnRefillLast'); await sleep(300); r.notes.push('أصناف بعد الإعادة: ' + await page.evaluate(() => document.querySelectorAll('#invoiceTableBody tr').length) + ' | Toast: ' + await toasts()); }
    else r.notes.push('زر إعادة الصرف غير ظاهر');
    r.notes.push('تذكير موعد الصرف القادم/الأيام المتبقية: ' + await page.evaluate(() => /ينتهي|متبقي|موعد|remind/i.test(document.querySelector('.customer-sidebar')?.innerText || '')));
    await page.evaluate(() => document.getElementById('btnNewSale')?.click());
  });

  // ---- debt collection
  await step('debt-collection', async r => {
    await tab('customers'); await sleep(300); await shot('16-customers-debt');
    r.notes.push('صفوف العملاء: ' + await page.evaluate(() => document.querySelectorAll('table tbody tr').length));
    const pays = await page.$$('text=سداد'); r.notes.push('أزرار سداد: ' + pays.length);
    if (pays.length) { await click('text=سداد >> nth=0'); await page.waitForSelector('#novaPayAmt', { timeout: 2000 }); await shot('17-debt-dialog'); r.notes.push('المبلغ المعبّأ: ' + await page.inputValue('#novaPayAmt')); await click('text=تأكيد السداد'); await sleep(300); r.notes.push('Toast: ' + await toasts()); }
    r.notes.push('كشف حساب العميل/طباعة: ' + await page.evaluate(() => /كشف حساب|statement/i.test(document.body.innerText)));
  });

  // ---- end of day
  await step('end-of-day', async r => {
    await tab('reports'); await sleep(500); await shot('18-reports-day');
    r.notes.push('نص التقرير: ' + fmt(await page.evaluate(() => document.querySelector('#novaPayBreakdown')?.innerText || '')).slice(0, 200));
    r.notes.push('جرد نقدية/فرق الدرج/إغلاق وردية: ' + await page.evaluate(() => /جرد|فرق الدرج|إغلاق الوردية|قفل|Z-?report|cash count/i.test(document.body.innerText)));
    r.notes.push('طباعة نهاية اليوم: ' + await page.evaluate(() => /طباعة تقرير نهاية اليوم/.test(document.body.innerText)));
    r.notes.push('تصدير/نسخة احتياطية ظاهرة بالتقارير: ' + await page.evaluate(() => /نسخ|تصدير|Export|Backup/i.test(document.body.innerText)));
    r.notes.push('بيانات العرض التجريبي مختلطة مع الحقيقية: ' + await page.evaluate(() => /تجريب/.test(document.body.innerText)));
  });

  // ---- cold-start keyboard sale and rush hour: timing of 10 consecutive barcode sales
  const bar = R.sales.filter(s => s.kind === 'barcode');
  R.notes.rush = { barcodeSalesMs: bar.map(s => s.ms), avgMs: Math.round(bar.reduce((a, s) => a + s.ms, 0) / Math.max(1, bar.length)) };
  R.consoleErrors = errs.slice(0, 15);
  await browser.close();
}

// ---------------------------------------------------------------- mobile pass (spot checks only)
{
  const { browser, page, errs } = await open('mobile', { width: 390, height: 844 });
  const R = result.mobile; R.notes = {};
  let shots = 0; const shot = async n => { if (shots++ >= 8) return; await page.screenshot({ path: path.join(OUT, `m-${n}.png`) }).catch(() => {}); };
  await page.goto(BASE + '/index.html'); await page.waitForSelector('#mainSearchInput'); await sleep(800);
  await shot('00-first-run');
  await page.fill('#mainSearchInput', 'بنادول'); await sleep(300); await shot('01-search');
  await page.keyboard.press('Enter'); await sleep(300);
  await page.fill('#mainSearchInput', '6281001234567'); await page.keyboard.press('Enter'); await sleep(300);
  await shot('02-cart');
  R.notes.cart = await page.evaluate(() => ({ lines: document.querySelectorAll('#invoiceTableBody tr').length, checkoutVisible: !!document.getElementById('btnCheckout') && document.getElementById('btnCheckout').getBoundingClientRect().bottom <= innerHeight, h: Math.round(document.getElementById('btnCheckout').getBoundingClientRect().height) }));
  await page.click('#btnCheckout'); await sleep(400); await shot('03-checkout');
  R.notes.checkout = await page.evaluate(() => ({ overflowX: document.documentElement.scrollWidth > innerWidth + 2, confirmVisible: (() => { const b = document.getElementById('btnConfirmPayment'); const r = b.getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; })() }));
  await page.click('.pay-method-btn[data-method=split]').catch(() => {}); await sleep(250); await shot('04-split');
  R.notes.splitConfirmVisible = await page.evaluate(() => { const b = document.getElementById('btnConfirmPayment'); const r = b.getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; });
  await page.keyboard.press('Escape'); await sleep(200);
  await page.evaluate(() => document.querySelector('.nova-tab[data-page=reports]').click()); await sleep(400); await shot('05-reports');
  R.notes.reports = await page.evaluate(() => ({ overflowX: document.documentElement.scrollWidth > innerWidth + 2 }));
  R.consoleErrors = errs.slice(0, 10);
  await browser.close();
}

server.close();
fs.writeFileSync(path.join(ROOT, '.nova/qa/ux-pro3-raw.json'), JSON.stringify(result, null, 1));
console.log('done; writes blocked:', result.blockedWrites.length, 'screenshots:', fs.readdirSync(OUT).length);
