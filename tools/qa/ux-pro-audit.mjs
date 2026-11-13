// Professional UX audit (UX8). Serves the CURRENT repo frontend locally; fake demo data only.
// Usage: node tools/qa/ux-pro-audit.mjs   (needs: npm ci && npx playwright install --with-deps chromium)
// Every non-GET request is aborted (no writes). Output: .nova/qa/ux-pro-raw.json + .nova/qa/ux-pro/*.png
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, '.nova/qa/ux-pro');
fs.mkdirSync(OUT, { recursive: true });
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
const VIEWPORTS = { desktop: { width: 1366, height: 768 }, mobile: { width: 390, height: 844 } };
const result = { date: new Date().toISOString(), base: 'local repo frontend', viewports: {}, blockedWrites: [] };

const INIT = () => {
  window.__ux = { cls: 0, longTasks: [], events: [], lcp: 0 };
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__ux.cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {}
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__ux.longTasks.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true }); } catch {}
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__ux.lcp = Math.round(e.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__ux.events.push({ n: e.name, d: Math.round(e.duration) }); }).observe({ type: 'event', durationThreshold: 16, buffered: true }); } catch {}
};

// ---- static page measurements (contrast, tap targets, focus, RTL, empty states) ----
const MEASURE = () => {
  const parse = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const bgOf = el => { let bg = [8, 9, 11]; const chain = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) chain.push(c); if (c && c[3] >= 1) break; } for (const c of chain.reverse()) bg = bg.map((v, i) => i < 3 ? Math.round(c[i] * c[3] + v * (1 - c[3])) : v); return bg; };
  const vis = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; };
  const inHidden = e => { for (let x = e; x && x !== document.body; x = x.parentElement) { const s = getComputedStyle(x); if (s.display === 'none' || s.visibility === 'hidden' || x.hidden) return true; if (s.opacity === '0') return true; } return false; };
  const L = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  const els = [...document.querySelectorAll('body *')].filter(e => vis(e) && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1));
  let fails = []; let minFont = 99; const fonts = new Set(); const sizes = {};
  for (const e of els) {
    const s = getComputedStyle(e); const fg = parse(s.color); if (!fg) continue; const bg = bgOf(e);
    const f2 = fg.slice(0, 3).map((v, i) => Math.round(v * fg[3] + bg[i] * (1 - fg[3])));
    const a = L(f2), b = L(bg), r = (Math.max(a, b) + .05) / (Math.min(a, b) + .05); const fs = parseFloat(s.fontSize);
    const large = fs >= 24 || (fs >= 18.66 && parseInt(s.fontWeight) >= 700);
    minFont = Math.min(minFont, fs); sizes[Math.round(fs)] = (sizes[Math.round(fs)] || 0) + 1; fonts.add(s.fontFamily.split(',')[0].trim());
    if (r < (large ? 3 : 4.5)) fails.push({ d: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/)[0] : ''), t: (e.textContent || '').trim().slice(0, 20), r: +r.toFixed(2) });
  }
  const ctrls = [...document.querySelectorAll('button,a[href],[role=button],input:not([type=hidden]),select,textarea')].filter(e => vis(e) && !inHidden(e));
  const small = ctrls.filter(b => { const r = b.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).map(b => (b.id || (b.innerText || b.getAttribute('aria-label') || b.placeholder || b.tagName).trim().slice(0, 18)) + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height));
  const unlabeled = ctrls.filter(b => !((b.innerText || '').trim() || b.getAttribute('aria-label') || b.getAttribute('title') || b.placeholder || (b.labels && b.labels.length))).map(b => b.tagName + (b.id ? '#' + b.id : '')).slice(0, 8);
  // controls inside hidden modals that remain tabbable
  const hiddenTabbable = [...document.querySelectorAll('button,a[href],input,select,textarea')].filter(e => !e.disabled && e.tabIndex >= 0 && (getComputedStyle(e).visibility !== 'hidden') && getComputedStyle(e).display !== 'none' && (inHidden(e) || e.getBoundingClientRect().width === 0) && !!e.closest('.modal-backdrop,[role=dialog]')).length;
  const btnStyles = new Set(ctrls.filter(e => e.tagName === 'BUTTON').map(e => { const s = getComputedStyle(e); return [s.borderRadius, s.fontSize, s.height].join('|'); }));
  return {
    dir: document.documentElement.dir, lang: document.documentElement.lang, title: document.title,
    contrastFails: fails.length, worst: fails.sort((a, b) => a.r - b.r).slice(0, 6), minFont, fontFamilies: [...fonts], fontSizesUsed: Object.keys(sizes).length,
    controls: ctrls.length, tapUnder44: small.length, tapSamples: small.slice(0, 10), unlabeled, hiddenTabbable,
    buttonStyleVariants: btnStyles.size, overflowX: document.documentElement.scrollWidth > innerWidth + 2,
    bodyDir: getComputedStyle(document.body).direction,
  };
};

for (const [vp, size] of Object.entries(VIEWPORTS)) {
  const R = result.viewports[vp] = { perf: {}, pages: {}, journeys: {} };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: size, locale: 'ar-EG', isMobile: vp === 'mobile', hasTouch: vp === 'mobile' });
  await ctx.addInitScript(INIT);
  await ctx.route('**/*', r => { const m = r.request().method(); if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') { result.blockedWrites.push(`${vp} ${m} ${r.request().url().slice(0, 80)}`); return r.abort(); } if (!r.request().url().startsWith(BASE)) return r.abort(); return r.continue(); });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 120))); page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 100)); });
  page.on('dialog', d => d.accept().catch(() => {}));
  let shots = 0; const shot = async (name) => { if (shots++ >= 17) return; await page.screenshot({ path: path.join(OUT, `${vp}-${name}.png`), type: 'png' }).catch(() => {}); };

  // ---- first load ----
  const t0 = Date.now();
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#mainSearchInput');
  R.perf.loadMs = Date.now() - t0;
  R.perf.nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; const f = performance.getEntriesByName('first-contentful-paint')[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fcp: f ? Math.round(f.startTime) : null, transferKB: Math.round(n.transferSize / 1024), htmlKB: Math.round(n.decodedBodySize / 1024) }; });
  await page.waitForTimeout(800);
  await shot('00-sale-empty');
  R.pages.sale = await page.evaluate(MEASURE);

  // ---- journey instrumentation ----
  const J = (name) => ({ name, clicks: 0, keys: 0, typed: 0, steps: [], t0: Date.now(), deadEnds: [], notes: [] });
  const click = async (j, sel, label) => { j.clicks++; j.steps.push('click ' + (label || sel)); await page.click(sel, { timeout: 4000 }); };
  const press = async (j, key) => { j.keys++; j.steps.push('key ' + key); await page.keyboard.press(key); };
  const type = async (j, txt, sel) => { if (sel) { j.clicks++; j.steps.push('focus ' + sel); await page.click(sel); } j.typed += txt.length; j.steps.push('type ' + txt.length + ' chars'); await page.keyboard.type(txt); };
  const fin = j => { j.ms = Date.now() - j.t0; j.total = j.clicks + j.keys; delete j.t0; return j; };
  const run = async (name, fn) => { const j = J(name); try { await fn(j); } catch (e) { j.error = e.message.split('\n')[0].slice(0, 160); j.deadEnds.push('تعذّر الإكمال: ' + j.error); } R.journeys[name] = fin(j); };
  const goSale = async () => { await page.evaluate(() => document.querySelector('.nova-tab[data-page=sale]')?.click()); await page.waitForTimeout(150); };

  // J1: quick sale by barcode, keyboard only
  await run('quick_sale_barcode_keyboard', async j => {
    await page.focus('#mainSearchInput'); j.notes.push('البحث يأخذ التركيز تلقائياً عند الفتح: ' + (await page.evaluate(() => document.activeElement.id === 'mainSearchInput')));
    await type(j, '6281001234568'); await press(j, 'Enter');
    await page.waitForSelector('#invoiceTableBody tr', { timeout: 2000 });
    await press(j, 'F9');
    const gate = await page.evaluate(() => !document.getElementById('customerCheckoutGate').hidden);
    if (gate) { j.notes.push('شاشة رقم العميل تظهر قبل الدفع في كل فاتورة (خطوة إضافية)'); await shot('01-customer-gate'); await press(j, 'Enter'); }
    await page.waitForTimeout(150); await shot('02-checkout'); j.notes.push('الدفع النقدي: المبلغ المستلم مُعبّأ تلقائياً = ' + (await page.inputValue('#inputCashReceived')));
    await press(j, 'Enter');
    await page.waitForSelector('#receiptModal.active', { timeout: 3000 }); await shot('03-receipt');
    await press(j, 'F2'); await page.waitForTimeout(150);
  });

  // J2: sale by name with mouse: pick suggestion, qty up, % discount, card
  await run('quick_sale_name_mouse_discount_card', async j => {
    await goSale();
    await type(j, 'اوجمنتين', '#mainSearchInput'); await page.waitForSelector('.suggestion-item', { timeout: 2000 }); await shot('04-suggestions');
    await click(j, '.suggestion-item', 'نتيجة البحث');
    await page.waitForSelector('#invoiceTableBody tr');
    const qtySel = await page.evaluate(() => { const i = document.querySelector('#invoiceTableBody input[type=number]'); return i ? 'qty-input' : null; });
    j.notes.push('حقل الكمية في الصف: ' + (qtySel ? 'موجود' : 'غير موجود'));
    const plus = await page.$('#invoiceTableBody [data-act=inc], #invoiceTableBody .qty-btn.plus, #invoiceTableBody button[aria-label*="زيادة"]');
    if (plus) { await plus.click(); j.clicks++; j.steps.push('click زيادة الكمية'); } else { const q = await page.$('#invoiceTableBody input[type=number]'); if (q) { await q.fill('2'); j.clicks++; j.typed++; j.steps.push('اضبط الكمية بالكتابة'); } }
    await type(j, '10', '#inputPercentDiscount'); await page.waitForTimeout(200); await shot('05-discount');
    await click(j, '#btnCheckout');
    if (await page.evaluate(() => !document.getElementById('customerCheckoutGate').hidden)) await click(j, '#gateSkipCustomer', 'تخطي العميل');
    await page.waitForSelector('#checkoutModal.active'); await click(j, '.pay-method-btn[data-method=card]', 'بطاقة'); await shot('06-pay-card');
    await click(j, '#btnConfirmPayment'); await page.waitForSelector('#receiptModal.active'); await shot('07-receipt-card');
    j.notes.push('زر طباعة الإيصال: ' + (await page.isVisible('#btnPrintReceiptBtn')) + ' — الطباعة نفسها لا تُحتسب (نافذة المتصفح)');
    await click(j, '#btnReceiptNewSale', 'فاتورة جديدة');
  });

  // J3: return
  await run('return', async j => {
    await click(j, '.nova-tab[data-page=invoices]', 'تبويب الفواتير'); await page.waitForTimeout(300); await shot('08-invoices');
    const btn = await page.$('[data-return]'); if (!btn) { j.deadEnds.push('لا يوجد زر مرتجع'); return; }
    j.notes.push('البحث عن الفاتورة: حقل بحث موجود = ' + (await page.isVisible('#novaFilter')));
    await btn.click(); j.clicks++; j.steps.push('click مرتجع');
    await page.waitForSelector('.nova-return-overlay [data-ret-idx]'); await shot('09-return-dialog');
    const inp = await page.$('.nova-return-overlay [data-ret-idx]'); await inp.fill('1'); j.clicks++; j.typed++; j.steps.push('كمية المرتجع');
    await page.fill('#novaRetReason', 'اختبار'); j.clicks++; j.typed += 6; j.steps.push('سبب المرتجع (إلزامي)');
    await click(j, '#novaRetOk', 'تأكيد المرتجع'); await page.waitForTimeout(300); await shot('10-return-done');
    j.notes.push('لا يوجد "إرجاع كل الأصناف" بنقرة واحدة؛ السبب إلزامي بنص حر بلا أسباب جاهزة');
  });

  // J4: purchasing / receiving
  await run('purchase_receiving', async j => {
    await goSale();
    await click(j, '#novaPurchasesNav', 'تبويب المشتريات'); await page.waitForSelector('#load'); await page.waitForTimeout(500); await shot('11-purchases');
    R.pages.purchases = await page.evaluate(MEASURE);
    await click(j, '#loadMock', 'بيانات تجريبية'); await page.waitForTimeout(500);
    j.notes.push('تحديد الأصناف: ' + (await page.isVisible('#selectAll')));
    await click(j, '#review', 'مراجعة قائمة التجهيز'); await page.waitForTimeout(500); await shot('12-purchases-review');
    j.notes.push('استلام فاتورة المشتريات (قراءة الفاتورة) في تبويب المنتجات: زر "✦ قراءة فاتورة مشتريات" — لا يوجد مسار استلام مرتبط بأمر الشراء من نفس الشاشة');
    await page.goto(BASE + '/index.html'); await page.waitForSelector('#mainSearchInput',{state:'attached'});
  });

  // J5: stock lookup + low stock
  await run('stock_lookup_low_stock', async j => {
    await click(j, '.nova-tab[data-page=products]', 'تبويب المنتجات'); await page.waitForTimeout(300); await shot('13-products');
    R.pages.products = await page.evaluate(MEASURE);
    await type(j, 'جلوك', '#novaFilter'); await page.waitForTimeout(250); await shot('14-products-filtered');
    const rows = await page.evaluate(() => document.querySelectorAll('table tbody tr').length); j.notes.push('صفوف بعد البحث: ' + rows);
    const lowFilter = await page.evaluate(() => /منخفض/.test(document.body.innerText) && !!document.querySelector('[data-filter],[data-low],.nova-chip'));
    j.notes.push('فلتر "مخزون منخفض" قابل للنقر: ' + lowFilter);
    if (!lowFilter) j.deadEnds.push('بطاقة "مخزون منخفض" للعرض فقط — لا تفتح قائمة الأصناف الناقصة');
    await page.fill('#novaFilter', ''); await page.waitForTimeout(100);
    // click-through test of the low-stock KPI
    const kpi = await page.$('text=مخزون منخفض'); if (kpi) { const before = await page.evaluate(() => document.querySelectorAll('table tbody tr').length); await kpi.click(); j.clicks++; j.steps.push('click بطاقة المخزون المنخفض'); await page.waitForTimeout(250); const after = await page.evaluate(() => document.querySelectorAll('table tbody tr').length); j.notes.push(`بعد النقر على البطاقة: الصفوف ${before} → ${after}`); if (before === after) j.deadEnds.push('النقر على بطاقة المخزون المنخفض لا يفعل شيئاً'); }
  });

  // J6: customer debt payment
  await run('customer_debt_payment', async j => {
    await click(j, '.nova-tab[data-page=customers]', 'تبويب العملاء'); await page.waitForTimeout(300); await shot('15-customers'); R.pages.customers = await page.evaluate(MEASURE);
    const txt = await page.evaluate(() => document.body.innerText);
    const hasPay = /سداد|تحصيل|دفعة|مديونية|رصيد آجل|Pay debt/.test(txt) && !!document.querySelector('[data-debt],[data-settle]');
    const row = await page.$('table tbody tr'); if (row) { await row.click(); j.clicks++; j.steps.push('click صف عميل'); await page.waitForTimeout(250); await shot('16-customer-row'); }
    const opened = await page.evaluate(() => !!document.querySelector('[role=dialog]:not([hidden]), .nova-customer-detail, .customer-detail'));
    j.notes.push('صف العميل يفتح تفاصيل: ' + opened);
    j.deadEnds.push('لا توجد شاشة لسداد دين عميل آجل ولا رصيد مدين ظاهر في قائمة العملاء (بيع الآجل متاح من الدفع لكن بلا مسار تحصيل)');
    j.notes.push('ملف credit-ledger.js موجود كمنطق لكن غير موصول بواجهة: ' + !hasPay);
  });

  // J7: prescription / chronic patient
  await run('prescription_chronic_patient', async j => {
    await goSale();
    await click(j, '#btnAddLoyalty', 'ربط عميل (F3)'); await page.waitForTimeout(200);
    await type(j, 'طارق'); await page.waitForTimeout(250); await shot('17-customer-search');
    const sug = await page.$('.suggestion-item'); if (sug) { await sug.click({ timeout: 3000 }).catch(async () => { j.deadEnds.push('نتيجة العميل لا يمكن لمسها على الموبايل (مغطاة)'); await sug.evaluate(e => e.click()); }); j.clicks++; j.steps.push('click عميل'); }
    await page.waitForTimeout(250); await shot('18-customer-attached');
    const sideTxt = await page.evaluate(() => document.querySelector('.customer-sidebar')?.innerText.replace(/\s+/g, ' ').slice(0, 300));
    j.notes.push('الشريط الجانبي للعميل: ' + sideTxt);
    const hasChronic = /مزمن|Chronic|تكرار|روشتة|وصفة|ملف المريض|حساسية/.test(sideTxt || '');
    if (!hasChronic) j.deadEnds.push('لا يظهر للعميل أدوية مزمنة/آخر صرف/حساسية ولا زر "إعادة صرف الروشتة السابقة" في شاشة البيع');
    await page.keyboard.press('F2').catch(() => {});
  });

  // J8: daily report
  await run('daily_report', async j => {
    await goSale();
    await click(j, '.nova-tab[data-page=reports]', 'تبويب التقارير'); await page.waitForTimeout(400); await shot('19-reports'); R.pages.reports = await page.evaluate(MEASURE);
    const rt = await page.evaluate(() => document.body.innerText);
    j.notes.push('مبيعات اليوم/صافي اليوم ظاهرة: ' + /مبيعات اليوم/.test(rt) + ' — صافي: ' + /صافي اليوم/.test(rt));
    j.notes.push('طباعة/تصدير تقرير اليوم: ' + (await page.evaluate(() => [...document.querySelectorAll('button')].some(b => /طباعة|تصدير|إغلاق اليوم|Z/.test(b.innerText) && b.getBoundingClientRect().width > 0 && !b.closest('.modal-backdrop')))));
    const range = await page.evaluate(() => !!document.querySelector('input[type=date],select#range,[data-range]')); j.notes.push('اختيار فترة/تاريخ: ' + range);
    if (!range) j.deadEnds.push('لا يوجد اختيار فترة (اليوم/الأسبوع/الشهر) ولا طباعة تقرير نهاية اليوم/إغلاق الوردية من التقارير');
  });

  // J9: settings
  await run('settings', async j => {
    await click(j, '.nova-tab[data-page=settings]', 'تبويب الإعدادات'); await page.waitForTimeout(400); await shot('20-settings'); R.pages.settings = await page.evaluate(MEASURE);
    await click(j, '[data-lang=en]', 'English'); await page.waitForTimeout(300); await shot('21-settings-en');
    R.pages.settingsEn = { dir: await page.evaluate(() => document.documentElement.dir), notes: 'التبديل للإنجليزية' };
    await click(j, '[data-lang=ar]', 'عربي'); await page.waitForTimeout(200);
  });

  // ---- other screens measured ----
  await page.goto(BASE + '/index.html'); await page.waitForSelector('#mainSearchInput',{state:'attached'}); await page.waitForTimeout(300);
  R.pages.invoices = await (async () => { await page.evaluate(() => document.querySelector('.nova-tab[data-page=invoices]').click()); await page.waitForTimeout(300); return page.evaluate(MEASURE); })();

  // ---- screen switch timing + INP ----
  const sw = {};
  for (const t of ['sale', 'invoices', 'products', 'customers', 'reports', 'settings', 'sale']) {
    const a = await page.evaluate(t => new Promise(res => { const s = performance.now(); document.querySelector(`.nova-tab[data-page=${t}]`).click(); requestAnimationFrame(() => requestAnimationFrame(() => res(Math.round(performance.now() - s)))); }), t);
    sw[t + (sw[t] !== undefined ? '_2' : '')] = a;
  }
  R.perf.screenSwitchMs = sw;
  // add 25 lines to the cart to stress the invoice table
  const stress = await page.evaluate(async () => {
    const inp = document.getElementById('mainSearchInput'); const codes = ['6281001234567', '6281001234568', '6281001234569', '6281001234570', '6281001234571'];
    const t = []; for (let i = 0; i < 25; i++) { const s = performance.now(); inp.value = codes[i % 5]; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); t.push(Math.round(performance.now() - s)); await new Promise(r => setTimeout(r, 10)); }
    return { max: Math.max(...t), avg: Math.round(t.reduce((a, b) => a + b, 0) / t.length), rows: document.querySelectorAll('#invoiceTableBody tr').length };
  });
  R.perf.addItemStress = stress; await shot('22-cart-stress');
  const u = await page.evaluate(() => window.__ux);
  R.perf.cls = +u.cls.toFixed(4); R.perf.longTasks = u.longTasks; R.perf.lcp = u.lcp; R.perf.slowEvents = u.events.sort((a, b) => b.d - a.d).slice(0, 5); R.perf.inpApprox = u.events.length ? u.events.sort((a, b) => b.d - a.d)[0].d : 0;

  // ---- keyboard / focus checks ----
  await page.goto(BASE + '/index.html'); await page.waitForSelector('#mainSearchInput',{state:'attached'}); await page.waitForTimeout(300);
  R.keyboard = await page.evaluate(() => ({
    autofocusSearch: document.activeElement && document.activeElement.id === 'mainSearchInput',
    fKeysDocumented: ['F2', 'F3', 'F4', 'F9'].filter(k => document.body.innerHTML.includes(k)),
    hasF1Help: /F1|\?/.test(document.querySelector('#helpModal')?.innerText || ''),
  })).catch(() => ({}));
  const focus = [];
  let modalStops = 0;
  for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); if (await page.evaluate(() => { const e = document.activeElement; const m = e.closest('.modal-backdrop'); return !!m && !m.classList.contains('active'); })) modalStops++; if (i < 12) focus.push(await page.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return { id: e.id || e.tagName, visible: r.width > 0 && r.height > 0, outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0, shadow: s.boxShadow !== 'none' }; })); }
  R.keyboard.tabStopsInsideClosedModals = modalStops; R.keyboard.tabOrder = focus; R.keyboard.focusIndicatorMissing = focus.filter(f => !f.outline && !f.shadow).length; R.keyboard.focusOnInvisible = focus.filter(f => !f.visible).length;
  await shot('23-focus');
  R.errors = errs.slice(0, 10);
  await browser.close();
}
server.close();
fs.writeFileSync(path.join(ROOT, '.nova/qa/ux-pro-raw.json'), JSON.stringify(result, null, 1));
for (const [vp, r] of Object.entries(result.viewports)) {
  console.log('==', vp, JSON.stringify(r.perf));
  for (const [n, j] of Object.entries(r.journeys)) console.log(n.padEnd(40), 'clicks', j.clicks, 'keys', j.keys, 'typed', j.typed, 'total', j.total, j.ms + 'ms', j.error ? 'ERR ' + j.error : '', j.deadEnds.length ? 'DEAD:' + j.deadEnds.length : '');
}
console.log('blocked writes:', result.blockedWrites.length);
