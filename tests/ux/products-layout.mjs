// UX43: products toolbar single row (desktop) and card rows (mobile). Usage: node tests/ux/products-layout.mjs
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
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'ar-EG' });
  await ctx.route('**/*', r => { const q = r.request(); return q.url().startsWith(BASE) || q.url().startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.locator('.nova-tab[data-page="products"]').first().click();
  await page.waitForSelector('#novaRows tr');

  // Desktop: one row, equal heights.
  const boxes = await page.evaluate(() => ['novaFilter', 'novaInventoryPurchase', 'novaInventoryLabels'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return { top: r.top, h: r.height, bottom: r.bottom }; }));
  for (const b of boxes) {
    assert.ok(Math.abs(b.top - boxes[0].top) <= 1, `same top ${JSON.stringify(boxes)}`);
    assert.ok(Math.abs(b.h - boxes[0].h) <= 1, `equal height ${JSON.stringify(boxes)}`);
  }

  // Mobile.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  const m = await page.evaluate(() => {
    const t = document.querySelector('.nova-data-table');
    const cells = [...t.querySelectorAll('tbody tr:first-child td')];
    const tr = t.querySelector('tbody tr').getBoundingClientRect();
    return {
      sw: t.scrollWidth, cw: t.clientWidth, doc: document.documentElement.scrollWidth, iw: innerWidth,
      display: getComputedStyle(t).display,
      labels: cells.map(c => c.getAttribute('data-label')),
      inside: cells.every(c => { const r = c.getBoundingClientRect(); return r.left >= tr.left - 1 && r.right <= tr.right + 1 && r.width > 0; }),
    };
  });
  assert.ok(m.sw <= m.cw + 2, `table scrollWidth ${m.sw} <= clientWidth ${m.cw}+2`);
  assert.ok(m.doc <= m.iw, `no page horizontal scroll ${m.doc} <= ${m.iw}`);
  assert.ok(m.labels.length >= 3 && m.labels.every(Boolean), `all columns labelled ${m.labels}`);
  assert.ok(m.inside, 'cells within card');
  assert.deepEqual(errors, []);
  console.log('products-layout passed');
} finally { await browser.close(); server.close(); }
