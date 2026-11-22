// UX310: close buttons and F1 chip have >=44x44 hit area. Usage: node tests/ux/touch-targets-close.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const f = path.resolve(ROOT, '.' + p);
  if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end('nf'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const snapshot = fs.readFileSync(path.join(ROOT, 'data/emergency-stock.json'), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const [w, h, mobile] of [[1366, 768, false], [390, 844, true]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-EG', hasTouch: mobile, isMobile: mobile });
    await ctx.route('**/*', r => { const q = r.request(); return q.url().startsWith(BASE) || q.url().startsWith('data:') ? r.continue() : r.abort(); });
    const page = await ctx.newPage();
    await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
    await page.route('**/*', r => r.request().method() !== 'GET' ? r.abort() : r.fallback());
    await (await page.addInitScript({ content: "try{var P=function(){localStorage.setItem('nova-rx-receipt-preview','1')},C=Storage.prototype.clear;Storage.prototype.clear=function(){C.call(this);if(this===localStorage)P()};P()}catch(e){}" }), page).addInitScript(() => { try { localStorage.clear(); localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('#btnCloseHelp', { state: 'attached' });
    const ids = ['btnCloseReceipt', 'btnCloseHelp', 'btnCloseCheckout'];
    // measure with modals forced visible (display of the overlay only; button geometry is its own)
    const res = await page.evaluate(ids => {
      const out = {};
      for (const id of ids) {
        const el = document.getElementById(id);
        const ov = el.closest('.modal-overlay, .modal-backdrop, [class*="modal"]');
        const prev = ov && ov.getAttribute('style');
        if (ov) ov.classList.add('active');
        const r = el.getBoundingClientRect();
        out[id] = { w: r.width, h: r.height, label: el.getAttribute('aria-label') };
        if (ov) { ov.classList.remove('active'); }
      }
      const chip = document.getElementById('novaHelpChip');
      const r = chip.getBoundingClientRect();
      out.novaHelpChip = { w: r.width, h: r.height, shown: getComputedStyle(chip).display !== 'none' };
      return out;
    }, ids);
    console.log(w + 'x' + h, JSON.stringify(res));
    for (const id of ids) {
      assert.ok(res[id].w >= 44 && res[id].h >= 44, `${id} ${res[id].w}x${res[id].h} < 44 @${w}`);
      assert.ok(res[id].label, `${id} aria-label`);
    }
    if (res.novaHelpChip.shown) assert.ok(res.novaHelpChip.h >= 44 && res.novaHelpChip.w >= 44, `chip ${res.novaHelpChip.w}x${res.novaHelpChip.h}`);
    await ctx.close();
  }
  console.log('PASS touch-targets-close');
} finally { await browser.close(); server.close(); }
