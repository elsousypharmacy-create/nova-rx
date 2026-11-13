// UX26: receipt text and date formatting. Local static server, non-GET aborted.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const f = path.resolve(ROOT, '.' + p);
  if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end('nf'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'ar-EG' });
await ctx.route('**/*', r => { const m = r.request().method(); const u = r.request().url(); if ((m !== 'GET' && m !== 'HEAD') || !(u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:'))) return r.abort(); return r.continue(); });
const page = await ctx.newPage();
let fail = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fail++; };
const eq = (a, b, msg) => check(a === b, `${msg} (got ${JSON.stringify(a)})`);
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForSelector('#mainSearchInput');
// helper unit tests
const u = await page.evaluate(() => {
  const F = window.NovaFmt;
  return { p: [0, 1, 2, 3, 10, 11].map(F.pluralItems), d: F.formatDateTime(new Date(2026, 10, 3, 9, 4)), dd: F.formatDate(new Date(2026, 10, 3, 21, 4)), bad: F.formatDateTime('x'),
    pay: ['cash', 'card', 'credit', 'mixed'].map(F.payLabel) };
});
eq(u.p[1], 'صنف واحد', 'plural 1'); eq(u.p[2], 'صنفان', 'plural 2'); eq(u.p[3], '3 أصناف', 'plural 3'); eq(u.p[4], '10 أصناف', 'plural 10'); eq(u.p[5], '11 صنفًا', 'plural 11');
eq(u.d, '03/11/2026 09:04', 'formatDateTime'); eq(u.dd, '03/11/2026', 'formatDate'); eq(u.bad, '', 'invalid date empty');
eq(u.pay.join('|'), 'نقدي|بطاقة|آجل|مختلط', 'pay labels');
// receipt rendering
const receipt = (sale) => page.evaluate((s) => { window.novaReceipt.open(s, { copy: false }); return document.getElementById('receiptSlipContent').innerText; }, sale);
const mk = (n, extra) => ({ id: 'T' + n, number: 'S-' + n, at: new Date(2026, 10, 13, 21, 4).toISOString(), customer: 'عميل', lines: Array.from({ length: n }, (_, i) => ({ name: 'صنف' + i, qty: 1, price: 10, discount: 0 })), subtotal: 10 * n, discount: 0, vat: 0, total: 10 * n, received: 0, change: 0, ...extra });
const t1 = await receipt(mk(1, { payment: 'credit', tenders: [{ method: 'credit', amount: 12 }] }));
const t2 = await receipt(mk(2, { payment: 'cash' }));
const t3 = await receipt(mk(3, { payment: 'mixed', tenders: [{ method: 'cash', amount: 10 }, { method: 'credit', amount: 20 }], discount: 5 }));
check(!/credit/i.test(t1 + t2 + t3), 'no Latin credit/Credit in receipt');
check(!t1.includes('-0.00') && !t2.includes('-0.00'), 'no -0.00');
check(!t1.includes('الخصم') && t3.includes('الخصم'), 'discount row hidden at 0, shown when >0');
check(t1.includes('آجل'), 'credit label Arabic');
check(/\d{2}\/\d{2}\/\d{4}/.test(t1) && !/[٠-٩]/.test(t1), 'receipt date DD/MM/YYYY, Latin digits');
check(t1.includes('13/11/2026 21:04'), 'receipt date+time format');
check(t1.includes('صنف واحد') && t2.includes('صنفان') && t3.includes('3 أصناف'), 'subtotal plural 1/2/3');
// invoices table
await page.evaluate(() => { const m = (n) => ({ id: 'I' + n, number: 'S-' + n, at: new Date(2026, 10, 13, 21, 4).toISOString(), customer: 'عميل', lines: [{ name: 'x', qty: 1, price: 1, discount: 0 }], subtotal: 1, discount: 0, vat: 0, total: 1, payment: 'cash' }); localStorage.setItem('nova.sales', JSON.stringify([m(1)])); });
const hasList = await page.evaluate(() => !!(window.novaSales && window.novaSales.list));
if (hasList) {
  await page.evaluate(() => window.novaSales.list().length || 0);
  const src = await page.evaluate(() => document.documentElement.outerHTML.includes("window.NovaFmt.formatDateTime(x.at)"));
  check(src, 'invoices list uses NovaFmt.formatDateTime');
}
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
