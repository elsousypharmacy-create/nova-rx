// UX40: one SVG icon set. No emoji/glyph text in buttons/headings; svg icon widths in {16,20}; icons centered with label.
// Usage: node tests/ux/icon-consistency.mjs   (env: PW_MODULE=<path to playwright-core/index.mjs>, CHROME_PATH)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PW_MODULE || '@playwright/test');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  if (p === '/purchases') p = '/purchases.html';
  const f = path.resolve(ROOT, '.' + p);
  if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end('{}'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const snapshot = fs.readFileSync(path.join(ROOT, 'data/emergency-stock.json'), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const BAD = /[\u{1F300}-\u{1FAFF}☀-➿⭐✦✕✓◉⚙]/u;

const audit = () => {
  const vis = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const out = { glyph: [], size: [], center: [] };
  const scope = document.querySelectorAll('button, a.btn, [role=button], summary, h1, h2, h3, h4, .btn, .nova-tab');
  for (const el of scope) {
    if (!vis(el)) continue;
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      const par = n.parentElement;
      if (par && par.closest('script,style,svg') ) continue;
      if (/[\u{1F300}-\u{1FAFF}☀-➿⭐✦✕✓◉⚙]/u.test(n.textContent) && vis(par)) out.glyph.push((el.id || el.className || el.tagName) + ': ' + n.textContent.trim().slice(0, 30));
    }
    for (const s of el.querySelectorAll('svg')) {
      if (!vis(s) || s.closest('[data-icon-exempt]')) continue;
      const r = s.getBoundingClientRect();
      const id = (el.id || el.className || el.tagName).toString().slice(0, 40);
      if (![16, 20].includes(Math.round(r.width))) out.size.push(id + ' w=' + r.width);
      const label = (el.textContent || '').trim();
      if (label) {
        const rng = document.createRange(); rng.selectNodeContents(el);
        const texts = [];
        const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n; (n = tw.nextNode());) if (n.textContent.trim() && !n.parentElement.closest('svg')) { const q = document.createRange(); q.selectNodeContents(n); const b = q.getBoundingClientRect(); if (b.height) texts.push(b); }
        if (texts.length) {
          const t = texts[0]; const d = Math.abs((r.top + r.height / 2) - (t.top + t.height / 2));
          if (d > 2 && Math.abs(r.top - t.top) < 40) out.center.push(id + ' delta=' + d.toFixed(1));
        }
      }
    }
  }
  return out;
};

try {
  let total = 0;
  for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG' });
    await ctx.route('**/*', r => { const q = r.request(); return q.url().startsWith(BASE) || q.url().startsWith('data:') ? r.continue() : r.abort(); });
    const page = await ctx.newPage();
    await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
    await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });
    for (const pg of ['sale', 'products', 'reports', 'settings']) {
      await page.evaluate(p => { const t = document.querySelector('.nova-tab[data-page="' + p + '"]'); t && t.click(); }, pg);
      await page.waitForTimeout(400);
      const r = await page.evaluate(audit);
      const tag = `${vp.width}x${vp.height} ${pg}`;
      assert.deepEqual(r.glyph, [], tag + ' glyph text');
      assert.deepEqual(r.size, [], tag + ' svg size');
      assert.deepEqual(r.center, [], tag + ' centering');
      total++;
    }
    await page.goto(BASE + 'purchases.html', { waitUntil: 'load' });
    await page.waitForTimeout(500);
    const r = await page.evaluate(audit);
    const tag = `${vp.width}x${vp.height} purchases`;
    assert.deepEqual(r.glyph, [], tag + ' glyph text');
    assert.deepEqual(r.size, [], tag + ' svg size');
    assert.deepEqual(r.center, [], tag + ' centering');
    total++;
    await ctx.close();
  }
  console.log('icon-consistency passed: views=' + total);
} finally { await browser.close(); server.close(); }
