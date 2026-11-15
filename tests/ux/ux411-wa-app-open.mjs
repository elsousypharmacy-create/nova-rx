// UX411: /?app=whatsapp must land on the conversations list — a fresh visit and a repeat visit with the service worker.
// The house button must not open the NOVA home screen in this mode. Fake data only; every non-GET is aborted; no real WhatsApp send, no PIN.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux411-wa-app-open.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const origin = new URL(BASE).origin;
const NOW = Date.parse('2026-11-15T12:00:00+03:00');
const data = {
  wa_201000000001: { customer: 'منى (تجربة)', messages: [{ id: 'a1', dir: 'in', kind: 'in', text: 'عايزة بنادول', at: NOW - 3600e3, status: null }] },
  wa_201000000002: { customer: 'سعيد (تجربة)', messages: [{ id: 'b1', dir: 'in', kind: 'in', text: 'السلام عليكم', at: NOW - 7200e3, status: null }] }
};
const list = () => Object.entries(data).map(([id, c]) => ({ id, customer: c.customer, updatedAt: c.messages.at(-1).at, count: c.messages.length, last: c.messages.at(-1) }));
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('  ok', name); };

async function open(url, { sw = 'allow' } = {}) {
  const ctx = await browser.newContext({
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
const isList = async (page) => {
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('app-whatsapp')), true);
  assert.equal(await page.evaluate(() => location.search), '?app=whatsapp');
  assert.equal(await page.evaluate(() => location.hash), '#wa');
  assert.equal(await page.evaluate(() => document.body.dataset.activePage), 'inbox');
  assert.equal(await shown(page, '#novaInboxView'), true, 'conversations shown');
  assert.equal(await shown(page, '.pos-root'), false, 'POS hidden');
  assert.equal(await shown(page, '.nova-nav-row'), false, 'tab strip hidden');
  const txt = await page.locator('#novaInboxView').innerText();
  assert.ok(txt.includes('منى (تجربة)') && txt.includes('سعيد (تجربة)'), 'both conversations listed');
  assert.equal(await shown(page, '[data-wa-home]'), false, 'house button hidden in WhatsApp-only mode');
};

await t('fresh visit to /?app=whatsapp lands on the conversations list (iPhone 390×844)', async () => {
  const { ctx, page, errs, bad } = await open(BASE + '?app=whatsapp');
  await isList(page);
  assert.deepEqual(bad, []); assert.deepEqual(errs, []); await ctx.close();
});

await t('repeat visit with the service worker still lands on the conversations list', async () => {
  const { ctx, page, errs, bad } = await open(BASE + '?app=whatsapp', { sw: 'allow' });
  await isList(page);
  const sw1 = await page.evaluate(async () => {
    try {
      const r = await Promise.race([
        navigator.serviceWorker.ready.then(reg => reg.active && reg.active.scriptURL),
        new Promise(res => setTimeout(() => res(''), 8000))
      ]);
      return r || (navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL) || '';
    } catch (e) { return ''; }
  });
  assert.match(String(sw1), /sw\.js/, 'service worker registered');
  await page.goto(BASE + '?app=whatsapp', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await isList(page);
  const sw2 = await page.evaluate(() => (navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL) || '');
  assert.match(String(sw2), /sw\.js/, 'service worker controls the repeat visit');
  assert.deepEqual(bad, []); assert.deepEqual(errs, []); await ctx.close();
});

await t('tapping the house button does not open the NOVA home screen', async () => {
  const { ctx, page, errs } = await open(BASE + '?app=whatsapp');
  await isList(page);
  await page.evaluate(() => {
    const b = document.querySelector('[data-wa-home]');
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  await isList(page);
  assert.deepEqual(errs, []); await ctx.close();
});

await t('visiting / first (caches the shell) then /?app=whatsapp still opens conversations', async () => {
  const { ctx, page, errs } = await open(BASE);
  await page.waitForTimeout(500);
  await page.goto(BASE + '?app=whatsapp', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await isList(page);
  assert.deepEqual(errs, []); await ctx.close();
});

await browser.close(); console.log(`PASS ux411 wa app open (NOVA): ${n} cases`);
