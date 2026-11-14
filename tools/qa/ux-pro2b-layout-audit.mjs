// UX37 layout/spacing/icon audit. Local repo frontend, fake data, every non-GET aborted.
// Usage: PW_MODULE=<playwright-core/index.mjs> CHROME_BIN=/usr/bin/chromium node tools/qa/ux-pro2b-layout-audit.mjs
const { chromium } = await import(process.env.PW_MODULE || 'playwright-core');
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, '.nova/qa/ux-pro2b'); fs.mkdirSync(OUT, { recursive: true });
const T = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((q, s) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p === '/') p = '/index.html'; if (p === '/purchases') p = '/purchases.html'; const f = path.resolve(ROOT, '.' + p); if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404).end('nf'); return; } s.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(s); });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}`;
const VP = { desktop: { width: 1366, height: 768 }, mobile: { width: 390, height: 844 } };
const result = { date: new Date().toISOString(), blockedWrites: [], screens: {} };
const M = () => {
  const vis = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const root = document.documentElement, vh = innerHeight, vw = innerWidth;
  const cands = [...document.querySelectorAll('.modal-backdrop.active .modal,.modal-backdrop.active>div,.nova-return-overlay>div,.nova-pay-overlay>div,.nova-page-view:not([hidden]),.pos-root,main')].filter(vis);
  const spacing = new Set(); const gaps = new Set(); const radii = new Set();
  document.querySelectorAll('body *').forEach(e => { if (!vis(e)) return; const s = getComputedStyle(e); if (s.display.includes('flex') || s.display.includes('grid')) { const g = parseFloat(s.columnGap) || 0; if (g) gaps.add(Math.round(g)); } const r = parseFloat(s.borderRadius); if (r) radii.add(Math.round(r)); });
  // overflow / clipped text
  const clipped = [...document.querySelectorAll('body *')].filter(e => vis(e) && e.scrollWidth > e.clientWidth + 2 && ['hidden', 'clip'].includes(getComputedStyle(e).overflowX) && e.children.length === 0).slice(0, 6).map(e => (e.id || e.className || e.tagName).toString().slice(0, 30) + ':' + (e.innerText || '').slice(0, 14));
  // off-screen controls
  const off = [...document.querySelectorAll('button,a[href],input,select')].filter(e => { if (!vis(e)) return false; const r = e.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1; }).slice(0, 6).map(e => (e.id || e.innerText || e.tagName).trim().slice(0, 16));
  // icons
  const icons = [...document.querySelectorAll('svg,i[class*=icon],.icon,.nova-ico,[class*=icon]')].filter(vis).map(e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return { t: e.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height), sw: e.getAttribute('stroke-width') || s.strokeWidth, fill: e.getAttribute('fill') || '' }; });
  const svgCount = document.querySelectorAll('svg').length;
  const emoji = [...document.querySelectorAll('button,a,label,span,h1,h2,h3,td,th')].filter(e => vis(e) && e.children.length === 0 && /[\u{1F300}-\u{1FAFF}☀-➿⭐⚙✔✖➕]/u.test(e.textContent)).map(e => e.textContent.trim().slice(0, 14));
  const iconSizes = {}; icons.forEach(i => { const k = i.w + 'x' + i.h; iconSizes[k] = (iconSizes[k] || 0) + 1; });
  const btns = [...document.querySelectorAll('button,a.btn,.btn')].filter(vis); const bh = {}; btns.forEach(b => { const h = Math.round(b.getBoundingClientRect().height); bh[h] = (bh[h] || 0) + 1; });
  const heights = Object.entries(bh).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => k + 'px×' + v);
  // wasted space: empty gutter of main content
  const main = cands[0]; let usedPct = null, emptyBottom = null; if (main) { const r = main.getBoundingClientRect(); const kids = [...main.querySelectorAll('*')].filter(vis); const maxB = Math.max(...kids.map(k => k.getBoundingClientRect().bottom), r.top); emptyBottom = Math.round(Math.max(0, r.bottom - maxB)); const maxR = Math.max(...kids.map(k => k.getBoundingClientRect().right), 0), minL = Math.min(...kids.map(k => k.getBoundingClientRect().left), vw); usedPct = Math.round(100 * (maxR - minL) / Math.max(1, r.width)); }
  const fontSizes = new Set([...document.querySelectorAll('body *')].filter(e => vis(e) && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).map(e => Math.round(parseFloat(getComputedStyle(e).fontSize))));
  return { scrollX: root.scrollWidth > vw + 2, scrollY: root.scrollHeight > vh + 2, docH: root.scrollHeight, vh, clipped, offscreen: off, svgCount, iconSizes, emoji: [...new Set(emoji)].slice(0, 8), btnHeights: heights, gaps: [...gaps].sort((a, b) => a - b), radii: [...radii].sort((a, b) => a - b), usedWidthPct: usedPct, emptyBottomPx: emptyBottom, fontSizeCount: fontSizes.size, dir: root.dir };
};
for (const [vp, size] of Object.entries(VP)) {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
  const ctx = await browser.newContext({ viewport: size, locale: 'ar-EG', isMobile: vp === 'mobile', hasTouch: vp === 'mobile' });
  await ctx.route('**/*', r => { const m = r.request().method(); if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') { result.blockedWrites.push(m + ' ' + r.request().url().slice(0, 60)); return r.abort(); } if (!r.request().url().startsWith(BASE)) return r.abort(); return r.continue(); });
  const page = await ctx.newPage(); page.on('dialog', d => d.accept().catch(() => {}));
  let shots = 0; const rec = async (key, shotName) => { await page.waitForTimeout(250); const m = await page.evaluate(M); (result.screens[key] ||= {})[vp] = m; if (shotName && shots++ < 15) await page.screenshot({ path: path.join(OUT, `${vp}-${shotName}.png`) }).catch(() => {}); };
  const tab = async p => { await page.evaluate(x => document.querySelector('.nova-tab[data-page="' + x + '"]').click(), p); await page.waitForTimeout(300); };
  const closeAll = async () => { await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelectorAll('.nova-return-overlay,.nova-pay-overlay').forEach(e => e.remove())); await page.waitForTimeout(150); };
  const step = async (name, fn) => { try { await fn(); } catch (e) { (result.screens[name] ||= {})[vp] = { error: e.message.split('\n')[0].slice(0, 100) }; } };
  await page.goto(BASE + '/index.html'); await page.waitForSelector('#mainSearchInput'); await page.waitForTimeout(700);
  await step('sale_empty', async () => rec('sale_empty', '01-sale-empty'));
  await step('sale_filled', async () => { await page.focus('#mainSearchInput'); await page.keyboard.type('6281001234568'); await page.keyboard.press('Enter'); await page.waitForSelector('#invoiceTableBody tr'); await page.keyboard.type('x'); await page.fill('#mainSearchInput', 'اوجمنتين'); await page.waitForSelector('.suggestion-item', { timeout: 2000 }); await rec('sale_suggestions', '02-sale-suggestions'); await page.keyboard.press('Enter'); await page.waitForTimeout(200); await rec('sale_filled', '03-sale-cart'); });
  await step('checkout', async () => { await page.fill('#mainSearchInput', ''); await page.evaluate(() => document.getElementById('btnCheckout').click()); await page.waitForTimeout(300); if (await page.evaluate(() => { const g = document.getElementById('gateSkipCustomer'); return g && g.offsetWidth; })) { await rec('customer_gate', '04-customer-gate'); await page.click('#gateSkipCustomer'); } await page.waitForSelector('#checkoutModal.active'); await rec('checkout_modal', '05-checkout'); await page.click('#btnConfirmPayment'); await page.waitForSelector('#receiptModal.active'); await rec('receipt_modal', '06-receipt'); await page.click('#btnReceiptNewSale'); await page.waitForTimeout(250); });
  for (const [p, n] of [['invoices', '07-invoices'], ['products', '08-products'], ['customers', '09-customers'], ['reports', '10-reports'], ['settings', '11-settings']]) await step(p, async () => { await closeAll(); await tab(p); await rec(p, n); });
  await step('return_dialog', async () => { await tab('invoices'); await page.click('[data-return]', { timeout: 3000 }); await page.waitForSelector('.nova-return-overlay'); await rec('return_dialog', '12-return'); await closeAll(); });
  await step('debt_dialog', async () => { await tab('customers'); await page.click('text=سداد', { timeout: 3000 }); await page.waitForSelector('#novaPayAmt'); await rec('debt_dialog', '13-debt'); await closeAll(); });
  await step('purchases', async () => { await page.goto(BASE + '/purchases.html'); await page.waitForSelector('#load', { timeout: 4000 }); await page.waitForTimeout(500); await rec('purchases', '14-purchases'); });
  await step('whatsapp_inbox', async () => { await page.goto(BASE + '/integrations/whatsapp/inbox.html'); await page.waitForTimeout(700); await rec('whatsapp_inbox', '15-whatsapp'); });
  await step('sticker_studio', async () => { await page.goto(BASE + '/sticker-studio.html'); await page.waitForTimeout(700); await rec('sticker_studio', null); });
  await step('emergency', async () => { await page.goto(BASE + '/emergency-sales.html'); await page.waitForTimeout(700); await rec('emergency', null); });
  await step('supplier_compare', async () => { await page.goto(BASE + '/supplier-compare.html'); await page.waitForTimeout(700); await rec('supplier_compare', null); });
  await browser.close();
}
fs.writeFileSync(path.join(ROOT, '.nova/qa/ux-pro2b-raw.json'), JSON.stringify(result, null, 1));
console.log('blocked writes:', result.blockedWrites.length); server.close();
