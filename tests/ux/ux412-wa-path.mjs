// UX412: /whatsapp (and /whatsapp?app=whatsapp) must land on the conversations list.
// The raw HTML (no JS) already has the NOVA WhatsApp name, icon and manifest, so iOS
// Add to Home Screen does not pick up the POS start_url. Fake data only; every non-GET
// is aborted; no real WhatsApp send, no PIN.
// Run: node tests/ux/ux412-wa-path.mjs
// Optional: NOVA_URL=https://nova-rx-preview.elsousypharmacy.workers.dev/ node tests/ux/ux412-wa-path.mjs
import { chromium, devices } from '@playwright/test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchWhatsAppHtml, isWhatsAppPath } from '../../tools/whatsapp-spa.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/+$/, '');
const NOW = Date.parse('2026-11-16T00:30:00+03:00');
const data = {
  wa_201000000001: { customer: 'منى (تجربة)', messages: [{ id: 'a1', dir: 'in', kind: 'in', text: 'عايزة بنادول', at: NOW - 3600e3, status: null }] },
  wa_201000000002: { customer: 'سعيد (تجربة)', messages: [{ id: 'b1', dir: 'in', kind: 'in', text: 'السلام عليكم', at: NOW - 7200e3, status: null }] }
};
const list = () => Object.entries(data).map(([id, c]) => ({ id, customer: c.customer, updatedAt: c.messages.at(-1).at, count: c.messages.length, last: c.messages.at(-1) }));
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json'
};

function startLocal() {
  const index = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const waHtml = patchWhatsAppHtml(index);
  return new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => {
      try {
        const u = new URL(req.url, 'http://127.0.0.1');
        const send = (status, type, body) => {
          res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
          res.end(body);
        };
        if (isWhatsAppPath(u.pathname) || u.pathname === '/whatsapp/index.html') {
          send(200, 'text/html; charset=utf-8', waHtml);
          return;
        }
        let rel = u.pathname === '/' ? '/index.html' : u.pathname;
        const file = path.resolve(ROOT, '.' + rel);
        if (!file.startsWith(ROOT + path.sep) && file !== ROOT) { send(403, 'text/plain', 'Forbidden'); return; }
        if (!existsSync(file)) { send(404, 'text/plain', 'Not found'); return; }
        const ext = path.extname(file);
        send(200, TYPES[ext] || 'application/octet-stream', readFileSync(file));
      } catch (e) {
        res.writeHead(500).end(String(e && e.message));
      }
    });
    s.listen(0, '127.0.0.1', () => resolve({ server: s, origin: `http://127.0.0.1:${s.address().port}` }));
    s.on('error', reject);
  });
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('  ok', name); };

let local = null;
const given = process.env.NOVA_URL;
const origin = given ? new URL(given).origin : (local = await startLocal()).origin;

async function open(url, { sw = 'block', standalone = false } = {}) {
  const iphone = devices['iPhone 13'] || devices['iPhone 12'];
  const ctx = await browser.newContext({
    ...iphone,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    userAgent: UA,
    locale: 'ar-EG',
    timezoneId: 'Asia/Riyadh',
    serviceWorkers: sw,
    hasTouch: true,
    isMobile: true
  });
  const bad = [];
  await ctx.route('**/*', r => {
    const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin };
    if (u.startsWith(origin) && (q.method() === 'GET' || q.method() === 'HEAD')) return r.continue();
    if (u.includes('/api/v1/inbox/history/') && q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'content-type,authorization,x-nova-pin' } });
    if (u.includes('/api/v1/inbox/history/') && q.method() === 'GET') {
      const id = new URL(u).searchParams.get('id');
      const body = u.includes('/push/key') ? { ok: true, enabled: false } : u.includes('/conversations') ? { ok: true, conversations: list() } : { ok: true, conversation: data[id] ? { id, customer: data[id].customer, updatedAt: NOW, messages: data[id].messages } : null };
      return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    }
    if (q.method() !== 'GET' && q.method() !== 'HEAD') { bad.push(q.method() + ' ' + u); return r.abort(); }
    return r.abort();
  });
  if (standalone) {
    await ctx.addInitScript(() => {
      try { Object.defineProperty(window.navigator, 'standalone', { configurable: true, get: () => true }); } catch {}
      const orig = window.matchMedia.bind(window);
      window.matchMedia = (q) => {
        if (String(q).includes('display-mode: standalone')) {
          return { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent() { return false; } };
        }
        return orig(q);
      };
    });
  }
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('nova.flags.inboxSend', '0'); } catch {} });
  await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(1500);
  return { ctx, page, errs, bad };
}

const shown = (page, sel) => page.evaluate(s => {
  const e = document.querySelector(s);
  if (!e) return false;
  const r = e.getBoundingClientRect();
  const cs = getComputedStyle(e);
  return !e.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
}, sel);

const isList = async (page, { path = '/whatsapp' } = {}) => {
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('app-whatsapp')), true);
  const loc = await page.evaluate(() => ({ path: location.pathname, search: location.search, hash: location.hash }));
  const p = String(loc.path).replace(/\/+$/, '') || '/';
  assert.equal(p, path, 'pathname ' + loc.path);
  assert.equal(loc.search, '?app=whatsapp');
  assert.equal(loc.hash, '#wa');
  assert.equal(await page.evaluate(() => document.body.dataset.activePage), 'inbox');
  assert.equal(await shown(page, '#novaInboxView'), true, 'conversations shown');
  assert.equal(await shown(page, '.pos-root'), false, 'POS hidden');
  assert.equal(await shown(page, '.nova-nav-row'), false, 'tab strip hidden');
  const txt = await page.locator('#novaInboxView').innerText();
  assert.ok(txt.includes('منى (تجربة)') && txt.includes('سعيد (تجربة)'), 'both conversations listed');
};

await t('manifest start_url is /whatsapp?app=whatsapp, scope /whatsapp, name NOVA WhatsApp', async () => {
  const res = await fetch(origin + '/manifest-whatsapp.webmanifest');
  assert.equal(res.ok, true, 'manifest ' + res.status);
  const m = await res.json();
  assert.equal(m.start_url, '/whatsapp?app=whatsapp');
  assert.equal(m.scope, '/whatsapp');
  assert.equal(m.id, '/whatsapp');
  assert.equal(m.name, 'NOVA WhatsApp');
  assert.equal(m.short_name, 'NOVA WhatsApp');
  assert.equal(m.display, 'standalone');
});

await t('raw /whatsapp HTML already has NOVA WhatsApp head (no JS)', async () => {
  const res = await fetch(origin + '/whatsapp');
  assert.equal(res.ok, true, '/whatsapp status ' + res.status);
  const src = await res.text();
  const head = src.slice(0, src.indexOf('</head>'));
  assert.match(head, /<title>NOVA WhatsApp<\/title>/);
  assert.match(head, /apple-mobile-web-app-title" content="NOVA WhatsApp"/);
  assert.match(head, /manifest-whatsapp\.webmanifest/);
  assert.match(head, /nova-whatsapp-180\.png/);
  assert.match(head, /class="app-whatsapp"/);
  assert.doesNotMatch(head, /<title>NOVA Rx \|/);
  assert.doesNotMatch(head, /apple-mobile-web-app-title" content="NOVA Rx"/);
});

await t('raw / still has the NOVA Rx head', async () => {
  const res = await fetch(origin + '/');
  const src = await res.text();
  const head = src.slice(0, src.indexOf('</head>'));
  assert.match(head, /<title>NOVA Rx \|/);
  assert.match(head, /apple-mobile-web-app-title" content="NOVA Rx"/);
  assert.match(head, /<link rel="manifest" href="\/manifest\.webmanifest\?v=3">/);
  assert.doesNotMatch(head, /<link rel="manifest" href="\/manifest-whatsapp/);
});

await t('/whatsapp lands on the conversations list (iPhone 390×844)', async () => {
  const { ctx, page, errs, bad } = await open(origin + '/whatsapp');
  await isList(page);
  assert.equal(await page.title(), 'NOVA WhatsApp');
  assert.equal(await page.locator('meta[name=apple-mobile-web-app-title]').getAttribute('content'), 'NOVA WhatsApp');
  assert.match(await page.locator('link[rel=manifest]').getAttribute('href'), /manifest-whatsapp\.webmanifest/);
  assert.deepEqual(bad, []); assert.deepEqual(errs, []); await ctx.close();
});

await t('/whatsapp?app=whatsapp lands on the conversations list', async () => {
  const { ctx, page, errs, bad } = await open(origin + '/whatsapp?app=whatsapp');
  await isList(page);
  assert.deepEqual(bad, []); assert.deepEqual(errs, []); await ctx.close();
});

await t('standalone display-mode on /whatsapp opens the inbox', async () => {
  const { ctx, page, errs, bad } = await open(origin + '/whatsapp', { standalone: true });
  await isList(page);
  const flag = await page.evaluate(() => sessionStorage.getItem('nova.wa.standalone'));
  assert.equal(flag, '1');
  assert.deepEqual(bad, []); assert.deepEqual(errs, []); await ctx.close();
});

await t('/?app=whatsapp still opens the conversations list', async () => {
  const { ctx, page, errs, bad } = await open(origin + '/?app=whatsapp');
  await isList(page, { path: '/' });
  assert.deepEqual(bad, []); assert.deepEqual(errs, []); await ctx.close();
});

await t('repeat visit with the service worker on /whatsapp still opens conversations', async () => {
  const { ctx, page, errs, bad } = await open(origin + '/whatsapp', { sw: 'allow' });
  await isList(page);
  await page.goto(origin + '/whatsapp', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await isList(page);
  assert.deepEqual(bad, []); assert.deepEqual(errs, []); await ctx.close();
});

await browser.close();
if (local) await new Promise(r => local.server.close(r));
console.log(`PASS ux412 wa path (NOVA): ${n} cases`);
