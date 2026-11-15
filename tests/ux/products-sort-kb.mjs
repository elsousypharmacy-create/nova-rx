// UX305: products table sortable headers (aria-sort), sticky header, focusable rows, Enter activates. Local server, non-GET aborted.
// Usage: node tests/ux/products-sort-kb.mjs
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
async function open(w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-EG' });
  await ctx.route('**/*', r => { const q = r.request(); return q.method() === 'GET' && (q.url().startsWith(BASE) || q.url().startsWith('data:')) ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.nova-tab');
  await page.waitForTimeout(600);
  return page;
}
try {
  for (const [w, h] of [[1366, 768], [390, 844]]) {
    const p = await open(w, h);
    await p.locator('[data-page="products"]').click();
    await p.waitForSelector('#novaRows tr');
    await p.waitForSelector('#novaRows[data-rows-complete]', { timeout: 5000 }).catch(() => {});
    const rows = p.locator('#novaRows tr');
    assert.equal(await rows.first().getAttribute('tabindex'), '0', 'rows tabindex 0 @' + w);
    // Tab reaches a row; focus ring visible
    await p.locator('#novaFilter').focus();
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) { await p.keyboard.press('Tab'); reached = await p.evaluate(() => document.activeElement && document.activeElement.tagName === 'TR'); }
    assert.ok(reached, 'Tab reaches a row @' + w);
    const ol = await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    assert.notEqual(ol, 'none', 'focus ring @' + w);
    // Enter activates the row (click handler)
    const pr = p.evaluate(() => new Promise(r => { document.activeElement.addEventListener('click', () => r(true), { once: true }); setTimeout(() => r(false), 1500); }));
    await p.keyboard.press('Enter');
    assert.equal(await pr, true, 'Enter clicks row @' + w);
    if (w === 1366) {
      assert.equal(await p.locator('th[aria-sort]').count(), 3, '3 sortable th');
      const names = () => p.locator('#novaRows tr td:nth-child(3)').evaluateAll(a => a.map(e => parseFloat(e.textContent.replace(/[^\d.]/g, ''))));
      const th = p.locator('th[aria-sort]', { hasText: 'السعر' });
      await th.locator('button').click();
      assert.equal(await p.locator('th[aria-sort]', { hasText: 'السعر' }).getAttribute('aria-sort'), 'ascending');
      let a = await names(); assert.deepEqual(a, [...a].sort((x, y) => x - y), 'price asc');
      await p.locator('th[aria-sort] button', { hasText: 'السعر' }).click();
      assert.equal(await p.locator('th[aria-sort]', { hasText: 'السعر' }).getAttribute('aria-sort'), 'descending');
      a = await names(); assert.deepEqual(a, [...a].sort((x, y) => y - x), 'price desc');
      assert.equal(await p.locator('th[aria-sort="none"]').count(), 2, 'others none');
      const pos = await p.locator('.nova-data-table thead th').first().evaluate(e => getComputedStyle(e).position);
      assert.equal(pos, 'sticky');
      assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.nova-tbl-scroll')).overflowY), 'auto');
      assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.nova-data-table')).direction), 'rtl');
    }
    await p.context().close();
  }
  console.log('PASS products-sort-kb');
} finally { await browser.close(); server.close(); }
