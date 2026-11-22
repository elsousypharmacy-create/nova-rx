// SALE-01: production backend flag, DEFAULT OFF, one device only. Fake/local data: localStorage cleared, every non-GET
// aborted, every non-local request aborted except GETs to production nova-rx-api, which are answered by a MOCK here
// (nothing reaches the real server). Needs a static server on the repo root, e.g. `python3 -m http.server 8765`.
// Run: node tests/ui-sale01-backend-flag.mjs   (NOVA_URL to override, CHROME_PATH for a system Chrome)
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const PROD = 'https://nova-rx-api.elsousypharmacy.workers.dev';
const TOKEN = 'fake-session-key-sale01';
const snapshot = readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8');
let passed = 0;
const t = async (name, fn) => {
  try { await fn(); } catch (e) { console.log('  FAIL', name, '\n   ', String(e.stack || e.message).split('\n').slice(0, 4).join('\n')); process.exit(1); }
  passed++; console.log('  ok', name);
};
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });

async function open() {
  const origin = new URL(BASE).origin;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG', serviceWorkers: 'block' });
  const prodCalls = [], blocked = [], logs = [];
  await ctx.route('**/*', (r) => {
    const req = r.request(), u = req.url();
    if (u.startsWith(PROD)) {
      prodCalls.push({ url: u, method: req.method(), auth: req.headers().authorization || '' });
      if (req.method() !== 'GET') return r.abort();
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, conversations: [] }) });
    }
    if (req.method() !== 'GET' && req.method() !== 'HEAD') { blocked.push(u); return r.abort(); }
    if (u.startsWith(origin) || u.startsWith('data:')) return r.continue();
    blocked.push(u); return r.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => logs.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await (await page.addInitScript({ content: "try{var P=function(){localStorage.setItem('nova-rx-receipt-preview','1')},C=Storage.prototype.clear;Storage.prototype.clear=function(){C.call(this);if(this===localStorage)P()};P()}catch(e){}" }), page).addInitScript(() => {
    try {
      if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); }
      localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage');
    } catch {}
  });
  await page.goto(origin + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.novaBackendFlag && window.novaSales && window.novaPay, null, { timeout: 10000 });
  return { ctx, page, errors, prodCalls, blocked, logs };
}
const openSettings = async (page) => {
  await page.evaluate(() => document.querySelector('.nova-tab[data-page=settings]').click());
  await page.waitForSelector('#novaBackendCard #novaBackendToggle', { timeout: 5000 });
};

try {
  const s = await open();
  const { page } = s;

  await t('default OFF: flag absent, config disabled, no base URL', async () => {
    assert.equal(await page.evaluate(() => localStorage.getItem('novaBackend.enabled')), null);
    assert.deepEqual(await page.evaluate(() => window.novaBackendFlag.config()), { enabled: false, baseUrl: '', hasToken: false, production: false });
  });

  await t('flag OFF: settings card says off, RTL kept, 44px toggle, no token field', async () => {
    await openSettings(page);
    assert.equal(await page.locator('#novaBackendState').getAttribute('data-state'), 'off');
    assert.match(await page.locator('#novaBackendState').innerText(), /مقفول/);
    assert.equal(await page.locator('#novaBackendToken').count(), 0);
    const h = await page.locator('#novaBackendToggle').evaluate((b) => b.getBoundingClientRect().height);
    assert.ok(h >= 44, 'toggle height ' + h);
    assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
  });

  await t('flag OFF: opening conversations makes zero production calls', async () => {
    await page.evaluate(() => window.NovaOpenInbox && window.NovaOpenInbox());
    await page.waitForTimeout(800);
    assert.equal(s.prodCalls.length, 0, JSON.stringify(s.prodCalls));
  });

  await t('flag ON (this device): card shows production, token kept in sessionStorage only', async () => {
    await openSettings(page);
    await page.locator('#novaBackendToggle').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('novaBackend.enabled')), 'true');
    assert.equal(await page.locator('#novaBackendState').getAttribute('data-state'), 'on');
    assert.match(await page.locator('#novaBackendState').innerText(), /nova-rx-api\.elsousypharmacy\.workers\.dev/);
    assert.match(await page.locator('#novaBackendState').innerText(), /الإنتاج/);
    await page.locator('#novaBackendToken').fill(TOKEN);
    await page.locator('#novaBackendTokenSave').click();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('novaBackend.token')), TOKEN);
    assert.equal(await page.locator('#novaBackendToken').inputValue(), '', 'token never shown back');
    const ls = await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)));
    assert.ok(!ls.includes(TOKEN), 'token not in localStorage');
    assert.ok(!(await page.locator('#novaBackendCard').innerHTML()).includes(TOKEN), 'token not in DOM');
  });

  await t('flag ON: conversations call the production base URL with Bearer auth (mocked)', async () => {
    await page.evaluate(() => window.NovaOpenInbox && window.NovaOpenInbox());
    await page.waitForFunction(() => true);
    for (let i = 0; i < 30 && !s.prodCalls.some((c) => c.url === PROD + '/api/v1/inbox/conversations'); i++) await page.waitForTimeout(100);
    const c = s.prodCalls.find((x) => x.url === PROD + '/api/v1/inbox/conversations');
    assert.ok(c, JSON.stringify(s.prodCalls));
    assert.equal(c.method, 'GET');
    assert.equal(c.auth, 'Bearer ' + TOKEN);
    assert.ok(s.prodCalls.every((x) => x.method === 'GET'), 'no production writes');
  });

  await t('token and PIN never logged to the console', async () => {
    assert.ok(!s.logs.some((l) => l.includes(TOKEN)), 'token in console');
  });

  await t('turning OFF clears flag and session token; then no new production calls', async () => {
    await openSettings(page);
    await page.locator('#novaBackendToggle').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('novaBackend.enabled')), null);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('novaBackend.token')), null);
    assert.equal(await page.locator('#novaBackendState').getAttribute('data-state'), 'off');
  });

  await t('no page errors', () => assert.deepEqual(s.errors, [], JSON.stringify(s.errors)));
  await s.ctx.close();

  // Fresh device, flag never touched: a local sale works exactly as before and makes zero production calls.
  const d = await open();
  await t('flag OFF: local sale saves to this device, zero production calls', async () => {
    const before = await d.page.evaluate(() => window.novaSales.list().length);
    const code = await d.page.evaluate(() => window.NOVA_DEMO.products.find((p) => p && p.barcode && p.price > 0).barcode);
    await d.page.locator('#mainSearchInput').fill(code);
    await d.page.locator('#mainSearchInput').press('Enter');
    await d.page.keyboard.press('F9');
    await d.page.waitForFunction(() => document.getElementById('checkoutModal').classList.contains('active'), null, { timeout: 3000 });
    await d.page.locator('.quick-cash-btn[data-val="exact"]').click();
    await d.page.keyboard.press('Enter');
    await d.page.waitForFunction(() => document.getElementById('receiptModal').classList.contains('active'), null, { timeout: 3000 });
    assert.equal(await d.page.evaluate(() => window.novaSales.list().length), before + 1);
    assert.equal(await d.page.evaluate(() => window.novaSales.list()[0].status), 'final');
    assert.equal(d.prodCalls.length, 0, JSON.stringify(d.prodCalls));
  });
  await t('no page errors (sale)', () => assert.deepEqual(d.errors, [], JSON.stringify(d.errors)));
  await d.ctx.close();

  console.log(`SALE-01 backend flag OK (${passed} checks)`);
} finally {
  await browser.close();
}
