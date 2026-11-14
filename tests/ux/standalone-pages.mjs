// UX47: standalone pages (WhatsApp inbox, supplier-compare) + customers empty state.
// Local static server, fake API responses, all non-GET requests aborted. Usage: node tests/ux/standalone-pages.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
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
const json = o => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });

const audit = () => {
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const ctrls = [...document.querySelectorAll('button,a[href],input:not([type=hidden]),textarea,select')].filter(e => vis(e) && !e.disabled);
  const small = ctrls.filter(e => e.getBoundingClientRect().height < 43.5).map(e => (e.id || e.className || e.tagName) + ':' + Math.round(e.getBoundingClientRect().height));
  let minFont = 99; const tiny = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) {
    if (!n.textContent.trim() || !n.parentElement || !vis(n.parentElement) || n.parentElement.closest('script,style')) continue;
    const fs_ = parseFloat(getComputedStyle(n.parentElement).fontSize);
    if (fs_ < minFont) minFont = fs_;
    if (fs_ < 12) tiny.push(n.parentElement.className + ':' + fs_);
  }
  const emoji = /[◉➤\u{1F300}-\u{1FAFF}☀-➿]/u.test(document.body.innerText);
  return { small, minFont, tiny, emoji };
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failed++; };
for (const [name, size, mobile] of [['mobile', { width: 390, height: 844 }, true], ['desktop', { width: 1366, height: 768 }, false]]) {
  const ctx = await browser.newContext({ viewport: size, locale: 'ar-EG', isMobile: mobile, hasTouch: mobile });
  await ctx.route('**/*', r => {
    const m = r.request().method(); const u = r.request().url();
    if (u.startsWith(BASE + '/api/whatsapp/chats/wa_1')) return r.fulfill(json({ ok: true, name: 'أحمد', hold: false, msgs: [{ role: 'user', text: 'مرحبا', t: '10:00' }] }));
    if (u.startsWith(BASE + '/api/whatsapp/chats')) return r.fulfill(json({ ok: true, chats: [{ id: 'wa_1', name: 'أحمد', phone: '1', lastText: 'مرحبا', last: '10:00' }] }));
    if ((m !== 'GET' && m !== 'HEAD') || !(u.startsWith(BASE) || u.startsWith('data:'))) return r.abort();
    return r.continue();
  });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); } catch {} });

  await page.goto(BASE + '/integrations/whatsapp/inbox.html', { waitUntil: 'load' });
  await page.waitForSelector('.chat');
  let a = await page.evaluate(audit);
  check(a.small.length === 0, `${name} inbox list buttons >=44px ${a.small}`);
  check(a.minFont >= 12, `${name} inbox min font ${a.minFont} ${a.tiny}`);
  check(a.emoji === false, `${name} inbox no emoji glyph`);
  check(await page.locator('a[href="/"]:has-text("رجوع للتطبيق")').isVisible(), `${name} inbox back-to-app link`);
  await page.click('.chat'); await page.waitForSelector('#active:not(.hidden)'); await page.waitForTimeout(200);
  a = await page.evaluate(audit);
  check(a.small.length === 0, `${name} inbox chat view buttons >=44px ${a.small}`);
  check(a.minFont >= 12, `${name} inbox chat min font ${a.minFont} ${a.tiny}`);
  check(a.emoji === false, `${name} inbox chat no emoji glyph`);

  await page.goto(BASE + '/supplier-compare.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  a = await page.evaluate(audit);
  const sb = await page.evaluate(() => [...document.querySelectorAll('button')].map(b => b.getBoundingClientRect().height));
  check(sb.length > 0 && sb.every(h => h >= 43.5), `supplier-compare ${name} buttons >=44px ${sb}`);

  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForSelector('#mainSearchInput'); await page.waitForTimeout(500);
  await page.click('.nova-tab[data-page="customers"]'); await page.waitForTimeout(300);
  const rows = await page.locator('#novaRows tr').count();
  const card = page.locator('#novaCustEmpty');
  if (rows < 8) {
    check(await card.isVisible() && await card.locator('button:has-text("إضافة عميل")').isVisible(), `${name} customers (${rows} rows) empty-state card with add action`);
    const h = await card.locator('button').evaluate(e => e.getBoundingClientRect().height);
    check(h >= 43.5, `${name} customers add button >=44px (${h})`);
  } else check(await card.count() === 0, `${name} customers ${rows} rows no empty card`);
  await ctx.close();
}
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
