// Second professional UX audit (UX21, re-measures UX8 journeys on ux-pro1 frontend). Serves the CURRENT repo frontend locally; fake demo data only.
// Usage: node tools/qa/ux-pro-audit.mjs   (needs: npm ci && npx playwright install --with-deps chromium)
// Every non-GET request is aborted (no writes). Output: .nova/qa/ux-pro2-raw.json + .nova/qa/ux-pro/*.png
const { chromium } = await import(process.env.PW_MODULE || 'playwright');
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, '.nova/qa/ux-pro2');
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
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  const ctx = await browser.newContext({ viewport: size, locale: 'ar-EG', isMobile: vp === 'mobile', hasTouch: vp === 'mobile' });
  await ctx.addInitScript(INIT);
  await ctx.route('**/*', r => { const m = r.request().method(); if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') { result.blockedWrites.push(`${vp} ${m} ${r.request().url().slice(0, 80)}`); return r.abort(); } if (!r.request().url().startsWith(BASE)) return r.abort(); return r.continue(); });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 120))); page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 100)); });
  page.on('dialog', d => d.accept().catch(() => {}));
  let shots = 0; const shot = async (name) => { if (shots++ >= 20) return; await page.screenshot({ path: path.join(OUT, `${vp}-${name}.png`), type: 'png' }).catch(() => {}); };

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

  // ===== UX21 journeys (re-measured on the ux-pro1 frontend; keystroke-first where UX17 allows) =====
  const state = async () => page.evaluate(() => [...document.querySelectorAll('.modal-backdrop.active,.nova-return-overlay,.nova-pay-overlay,[class*=overlay]')].filter(e => e.offsetWidth).map(e => e.id || e.className.split(' ')[0]).join(','));
  const toastTxt = async () => page.evaluate(() => [...document.querySelectorAll('.toast')].map(e => e.innerText.trim()).join(' / '));
  const tab = async (j, pg, label) => { j.clicks++; j.steps.push('click تبويب ' + (label || pg)); await page.evaluate(x => document.querySelector('.nova-tab[data-page="' + x + '"]').click(), pg); await page.waitForTimeout(300); };

  // J1: quick sale by barcode, keyboard only (target 3 keys)
  await run('quick_sale_barcode_keyboard', async j => {
    await page.focus('#mainSearchInput'); j.notes.push('البحث يأخذ التركيز تلقائياً: ' + (await page.evaluate(() => document.activeElement.id === 'mainSearchInput')));
    await type(j, '6281001234568'); await press(j, 'Enter'); await page.waitForSelector('#invoiceTableBody tr', { timeout: 2000 });
    await press(j, 'Enter'); await page.waitForSelector('#checkoutModal.active'); 
    j.notes.push('الدفع النقدي: المبلغ المستلم مُعبّأ = ' + (await page.inputValue('#inputCashReceived')) + '، التركيز على: ' + (await page.evaluate(() => document.activeElement.id)));
    await press(j, 'Enter'); await page.waitForSelector('#receiptModal.active', { timeout: 3000 }); await page.waitForTimeout(200); await shot('02-receipt');
    j.notes.push('حالة الطابعة المعروضة في الإيصال: ' + (await page.evaluate(() => [...document.querySelectorAll('#receiptModal [id*=rinter],#receiptModal [class*=printer]')].filter(e => e.offsetWidth).map(e => e.innerText.trim().slice(0, 30)).join(' + '))));
    await press(j, 'Enter'); await page.waitForTimeout(200);
    j.notes.push('بعد Enter: الإيصال مغلق وفاتورة جديدة = ' + (await page.evaluate(() => !document.getElementById('receiptModal').classList.contains('active') && document.querySelectorAll('#invoiceTableBody tr[data-id],#invoiceTableBody tr').length <= 1)) + '، التركيز: ' + (await page.evaluate(() => document.activeElement.id)));
  });

  // J2: sale by name: *2 quantity, F6 discount, F10 card (keyboard) — UX17
  await run('quick_sale_name_keyboard_discount_card', async j => {
    await goSale();
    await type(j, '*2 اوجمنتين', '#mainSearchInput'); j.clicks = 0; j.steps.pop(); j.steps.pop(); await page.waitForSelector('.suggestion-item', { timeout: 2000 }); 
    await press(j, 'Enter'); await page.waitForSelector('#invoiceTableBody tr');
    const q = await page.evaluate(() => document.querySelector('#invoiceTableBody input')?.value); j.notes.push('كمية السطر بعد *2: ' + q);
    await press(j, 'F6'); await page.keyboard.type('10'); j.typed += 2; await page.waitForTimeout(150); 
    await page.focus('#mainSearchInput'); await press(j, 'Enter'); await page.waitForSelector('#checkoutModal.active');
    await press(j, 'F10'); await page.waitForTimeout(150); 
    j.notes.push('زر التأكيد بعد F10 عليه التركيز: ' + (await page.evaluate(() => document.activeElement.id)));
    await press(j, 'Enter'); await page.waitForSelector('#receiptModal.active'); await press(j, 'Enter'); await page.waitForTimeout(200);
  });

  // J2b: same sale mouse-only (for comparison with UX8: 8 clicks)
  await run('quick_sale_name_mouse_discount_card', async j => {
    await goSale();
    await type(j, 'اوجمنتين', '#mainSearchInput'); await page.waitForSelector('.suggestion-item'); await click(j, '.suggestion-item', 'نتيجة البحث'); await page.waitForSelector('#invoiceTableBody tr');
    const plus = await page.$('#invoiceTableBody button:has-text("+")'); if (plus) { await plus.click(); j.clicks++; j.steps.push('click +'); }
    await type(j, '10', '#inputPercentDiscount'); await click(j, '#btnCheckout');
    if (await page.evaluate(() => !!document.getElementById('customerCheckoutGate') && !document.getElementById('customerCheckoutGate').hidden)) await click(j, '#gateSkipCustomer');
    await page.waitForSelector('#checkoutModal.active'); await click(j, '.pay-method-btn[data-method=card]', 'بطاقة'); await click(j, '#btnConfirmPayment'); await page.waitForSelector('#receiptModal.active'); await click(j, '#btnReceiptNewSale', 'فاتورة جديدة');
  });

  // J3: credit sale to a registered customer (creates debt), then debt collection
  await run('credit_sale_then_debt_collection', async j => {
    await goSale();
    await type(j, '6281001234568', '#mainSearchInput'); j.clicks--; j.steps.pop(); await press(j, 'Enter'); await page.waitForTimeout(200);
    await press(j, 'F3'); await page.keyboard.type('طارق'); j.typed += 4; await page.waitForSelector('.suggestion-item'); await press(j, 'Enter'); await page.waitForTimeout(300);
    j.notes.push('لوحة العميل: ' + (await page.evaluate(() => (document.querySelector('.customer-sidebar')?.innerText || '').replace(/\s+/g, ' ').slice(0, 160)))); await shot('06-customer-panel');
    await press(j, 'F9'); await page.waitForSelector('#checkoutModal.active'); await press(j, 'F11'); await press(j, 'Enter'); await page.waitForSelector('#receiptModal.active'); await page.waitForTimeout(200);
    j.notes.push('طريقة الدفع في الإيصال: ' + (await page.evaluate(() => (document.getElementById('receiptModal').innerText.match(/طريقة الدفع:[^\n]*\n?[^\n]*/) || [''])[0].replace(/\n/g, ' '))));
    await press(j, 'Enter'); await page.waitForTimeout(200);
    await tab(j, 'customers'); await shot('07-customers-debt'); await click(j, 'text=سداد', 'زر سداد'); await page.waitForSelector('#novaPayAmt'); await shot('08-debt-dialog');
    j.notes.push('المبلغ مُعبّأ: ' + (await page.inputValue('#novaPayAmt')) + '، التركيز: ' + (await page.evaluate(() => document.activeElement.id)));
    const cb = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /تأكيد السداد/.test(x.innerText)); const s = getComputedStyle(b); return { bg: s.backgroundColor, color: s.color, disabled: b.disabled }; }); j.notes.push('زر تأكيد السداد: ' + JSON.stringify(cb));
    await click(j, 'text=تأكيد السداد', 'تأكيد السداد'); await page.waitForTimeout(300);
    j.notes.push('بعد السداد: ' + (await toastTxt()) + ' — المديونية: ' + (await page.evaluate(() => (document.querySelector('table tbody tr')?.innerText || '').replace(/\s+/g, ' ').slice(-30))));
  });

  // J4: return (UX14: return-all + chips)
  await run('return', async j => {
    await tab(j, 'invoices'); await shot('09-invoices');
    await click(j, '[data-return]', 'مرتجع'); await page.waitForSelector('.nova-return-overlay'); await shot('10-return-dialog');
    j.notes.push('نص الدفع في الحوار: ' + (await page.evaluate(() => document.querySelector('.nova-return-overlay').innerText.match(/بنفس طريقة الدفع الأصلية[^.]*/)?.[0])));
    await click(j, '#novaRetAll', 'إرجاع كل الأصناف'); await click(j, '.nova-return-overlay button:has-text("رجوع العميل")', 'سبب جاهز');
    await click(j, '#novaRetOk', 'تأكيد'); await page.waitForTimeout(300); 
    j.notes.push('الفاتورة بعد المرتجع: ' + (await page.evaluate(() => (document.querySelector('table tbody tr')?.innerText || '').replace(/\s+/g, ' ').slice(0, 120)))); j.notes.push('Toast: ' + (await toastTxt()));
  });

  // J5: purchasing / receiving (UX19)
  await run('purchase_receiving', async j => {
    await goSale(); await click(j, '#novaPurchasesNav', 'تبويب المشتريات'); await page.waitForSelector('#load'); await page.waitForTimeout(500); await shot('12-purchases');
    R.pages.purchases = await page.evaluate(MEASURE);
    j.notes.push('زر «استلام فاتورة»: ' + (await page.evaluate(() => { const a = document.getElementById('receiveInvoice'); return a ? a.getAttribute('href') + ' (' + Math.round(a.getBoundingClientRect().width) + 'x' + Math.round(a.getBoundingClientRect().height) + ')' : 'غير موجود'; })));
    await click(j, '#receiveInvoice', 'استلام فاتورة'); await page.waitForTimeout(700); await shot('13-receive-landing');
    j.notes.push('بعد النقر: ' + page.url().replace(BASE, '') + ' — نافذة الاستلام ظاهرة: ' + (await page.evaluate(() => [...document.querySelectorAll('.modal-backdrop.active,[role=dialog]')].some(e => e.offsetWidth))));
    await page.goto(BASE + '/index.html'); await page.waitForSelector('#mainSearchInput', { state: 'attached' });
  });

  // J6: stock lookup + low stock (UX12)
  await run('stock_lookup_low_stock', async j => {
    await tab(j, 'products'); await shot('14-products'); R.pages.products = await page.evaluate(MEASURE);
    j.notes.push('تصنيفات إنجليزية متبقية: ' + (await page.evaluate(() => [...document.querySelectorAll('table tbody td:last-child')].map(e => e.innerText.trim()).filter(t => /^[A-Za-z]+$/.test(t)).join(','))));
    j.notes.push('عمود العبوة «—»: ' + (await page.evaluate(() => [...document.querySelectorAll('table tbody tr')].filter(r => r.cells[3] && r.cells[3].innerText.trim() === '—').length)));
    const before = await page.evaluate(() => [...document.querySelectorAll('table tbody tr')].filter(r => r.offsetParent).length);
    await click(j, '#novaLowKpi', 'بطاقة مخزون منخفض'); await page.waitForTimeout(250); const after = await page.evaluate(() => [...document.querySelectorAll('table tbody tr')].filter(r => r.offsetParent).length);
    j.notes.push(`بطاقة النواقص: الصفوف ${before} → ${after}`); await shot('15-low-filtered');
    j.notes.push('شارات حمراء: ' + (await page.evaluate(() => document.querySelectorAll('[class*=low],[class*=stock-badge],.nova-stock-low').length)));
    await click(j, '#novaLowKpi', 'إلغاء الفلتر'); await type(j, 'جلوك', '#novaFilter'); await page.waitForTimeout(250);
    j.notes.push('بحث «جلوك» → صفوف: ' + (await page.evaluate(() => [...document.querySelectorAll('table tbody tr')].filter(r => r.offsetParent).length)));
  });

  // J7: chronic patient re-dispense (UX15)
  await run('prescription_chronic_patient', async j => {
    await goSale(); await page.focus('#mainSearchInput');
    await press(j, 'F3'); await page.keyboard.type('طارق'); j.typed += 4; await page.waitForSelector('.suggestion-item'); await press(j, 'Enter'); await page.waitForTimeout(300); await shot('16-chronic-panel');
    const rd = await page.$('text=إعادة صرف آخر فاتورة'); if (!rd) { j.deadEnds.push('لا يوجد زر إعادة صرف'); return; }
    await rd.click(); j.clicks++; j.steps.push('click إعادة صرف آخر فاتورة'); await page.waitForTimeout(300); await shot('17-redispense');
    j.notes.push('الأصناف في الفاتورة بعد إعادة الصرف: ' + (await page.evaluate(() => document.querySelectorAll('#invoiceTableBody tr').length)));
    j.notes.push('هل يتحقق من المخزون/الصلاحية قبل الإضافة: يعتمد على مسار البيع الأصلي — غير ظاهر للمستخدم');
    await press(j, 'F2').catch(() => {});
  });

  // J8: daily report (UX13)
  await run('daily_report', async j => {
    await tab(j, 'reports'); await shot('18-reports'); R.pages.reports = await page.evaluate(MEASURE);
    j.notes.push('أزرار الفترة: ' + (await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => /اليوم|7 أيام|الشهر/.test(b.innerText) && b.offsetWidth).map(b => b.innerText.trim()).join(' | '))));
    await click(j, 'button:has-text("الشهر")', 'الشهر'); await page.waitForTimeout(200);
    j.notes.push('طريقة الدفع (نقدي/بطاقة/آجل) في التقرير: ' + (await page.evaluate(() => /نقدي|بطاقة|آجل/.test(document.body.innerText.split('بيانات العرض التجريبية')[0].split('التقارير')[1] || ''))));
    j.notes.push('بيانات تجريبية تظهر بجانب الحقيقية في نفس الشاشة: ' + (await page.evaluate(() => /بيانات العرض التجريبية/.test(document.body.innerText))));
    j.notes.push('زر طباعة نهاية اليوم: ' + (await page.isVisible('#novaPrintDay')));
  });

  // J9: settings
  await run('settings', async j => {
    await tab(j, 'settings'); await shot('19-settings'); R.pages.settings = await page.evaluate(MEASURE);
    j.notes.push('نصوص تقنية ظاهرة (صلاحيات sale.create…): ' + (await page.evaluate(() => /sale\.create/.test(document.body.innerText))));
    await click(j, '[data-lang=en]', 'English'); await page.waitForTimeout(300); 
    R.pages.settingsEn = { dir: await page.evaluate(() => document.documentElement.dir), englishLeftoverArabic: await page.evaluate(() => (document.body.innerText.match(/[؀-ۿ]+/g) || []).length) };
    await click(j, '[data-lang=ar]', 'عربي'); await page.waitForTimeout(200);
  });

  // J10: details — stale toast, held-invoices English, logo, VAT label, offline
  await run('details_probe', async j => {
    await goSale(); await page.waitForTimeout(300);
    j.notes.push('صورة مكسورة: ' + (await page.evaluate(() => [...document.images].filter(i => i.complete && i.naturalWidth === 0 && i.offsetWidth).map(i => i.src.slice(-40) + '|' + i.alt).join(','))));
    j.notes.push('نصوص إنجليزية ظاهرة في شاشة البيع: ' + (await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.offsetWidth && e.children.length === 0 && /^[A-Za-z][A-Za-z :.,\/()-]{5,}$/.test(e.innerText || '') ).map(e => e.innerText.trim()).filter((v, i, a) => a.indexOf(v) === i).slice(0, 12).join(' | '))));
    j.notes.push('نسبة الضريبة المعروضة: ' + (await page.evaluate(() => (document.body.innerText.match(/ضريبة القيمة المضافة \([^)]*\)/) || [''])[0])));
    await click(j, '#btnHeldInvoices', 'معلقة'); await page.waitForTimeout(250); await shot('23-held-panel'); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    await page.focus('#mainSearchInput'); for (const c of ['6281001234568', '6281001234567', '6281001234569']) { await page.keyboard.type(c); await page.keyboard.press('Enter'); await page.waitForTimeout(150); }
    await shot('24-cart-3-lines'); await page.keyboard.press('F9'); await page.waitForSelector('#checkoutModal.active'); await page.waitForTimeout(150); await shot('25-checkout-4-methods'); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    await page.keyboard.press('F1'); await page.waitForTimeout(200); await shot('21-help');
    j.notes.push('F1 يفتح المساعدة: ' + (await page.evaluate(() => document.getElementById('helpModal').classList.contains('active')))); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    await type(j, '6281001234568', '#mainSearchInput'); await press(j, 'Enter'); await page.waitForTimeout(150);
    const t0 = Date.now(); let toastGone = null; for (let i = 0; i < 40; i++) { if (!(await toastTxt())) { toastGone = Date.now() - t0; break; } await page.waitForTimeout(250); } j.notes.push('مدة بقاء التوست (مللي ث): ' + toastGone);
    await page.keyboard.press('Enter'); await page.waitForSelector('#checkoutModal.active'); await page.waitForTimeout(200);
    j.notes.push('توست فوق نافذة الدفع: ' + (await toastTxt()) + ' / مغطي لزر التأكيد: ' + (await page.evaluate(() => { const t = document.querySelector('.toast'); const b = document.getElementById('btnConfirmPayment'); if (!t || !b) return false; const a = t.getBoundingClientRect(), c = b.getBoundingClientRect(); return !(a.right < c.left || a.left > c.right || a.bottom < c.top || a.top > c.bottom); })));
    const cr = await page.evaluate(() => { const bs = [...document.querySelectorAll('.pay-method-btn')].filter(b => b.offsetWidth).map(b => Math.round(b.getBoundingClientRect().top)); return { rows: new Set(bs).size, n: bs.length }; }); j.notes.push('أزرار طرق الدفع: ' + cr.n + ' في ' + cr.rows + ' صفوف');
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    await ctx.setOffline(true); await page.waitForTimeout(400); await shot('22-offline');
    j.notes.push('عند قطع الإنترنت: مؤشر الاتصال = ' + (await page.evaluate(() => (document.querySelector('#netStatus,.net-status,[class*=offline],[id*=online]')?.innerText || 'لا مؤشر').slice(0, 30))));
    await ctx.setOffline(false);
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
fs.writeFileSync(path.join(ROOT, '.nova/qa/ux-pro2-raw.json'), JSON.stringify(result, null, 1));
for (const [vp, r] of Object.entries(result.viewports)) {
  console.log('==', vp, JSON.stringify(r.perf));
  for (const [n, j] of Object.entries(r.journeys)) console.log(n.padEnd(40), 'clicks', j.clicks, 'keys', j.keys, 'typed', j.typed, 'total', j.total, j.ms + 'ms', j.error ? 'ERR ' + j.error : '', j.deadEnds.length ? 'DEAD:' + j.deadEnds.length : '');
}
console.log('blocked writes:', result.blockedWrites.length);
