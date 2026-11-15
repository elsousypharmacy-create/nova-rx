// WA-APP: /?app=whatsapp = the conversations screen on its own (no POS, no tab strip); the normal app and /#wa are unchanged.
// Fake data only: the history API is answered by page.route, every non-GET is aborted, no real WhatsApp send, no PIN.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/wa-app-mode.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const origin = new URL(BASE).origin;
const NOW = Date.parse('2026-11-15T12:00:00+03:00');
const data = { wa_201000000001: { customer: 'منى (تجربة)', messages: [{ id: 'a1', dir: 'in', kind: 'in', text: 'عايزة بنادول', at: NOW - 3600e3, status: null }] }, wa_201000000002: { customer: 'سعيد (تجربة)', messages: [{ id: 'b1', dir: 'in', kind: 'in', text: 'السلام عليكم', at: NOW - 7200e3, status: null }] } };
const list = () => Object.entries(data).map(([id, c]) => ({ id, customer: c.customer, updatedAt: c.messages.at(-1).at, count: c.messages.length, last: c.messages.at(-1) }));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('  ok', name); };

async function open(url, vp = { width: 390, height: 844 }) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', timezoneId: 'Africa/Cairo', serviceWorkers: 'block', hasTouch: vp.width < 600, isMobile: vp.width < 600 });
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
const shown = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return !e.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel);

await t('/?app=whatsapp: only the conversations screen (no tab strip, no POS), own title, list from the API, hash #wa', async () => {
  const { ctx, page, errs, bad } = await open(BASE + '?app=whatsapp');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('app-whatsapp')), true);
  assert.equal(await page.title(), 'واتساب الصيدلية | NOVA Rx');
  assert.equal(await shown(page, '.nova-nav-row'), false, 'tab strip hidden');
  assert.equal(await shown(page, '.pos-root'), false, 'POS hidden');
  assert.equal(await shown(page, '#novaInboxView'), true, 'conversations shown');
  const txt = await page.locator('#novaInboxView').innerText(); assert.ok(txt.includes('منى (تجربة)') && txt.includes('سعيد (تجربة)'), 'both conversations listed');
  assert.equal(await page.evaluate(() => location.hash), '#wa'); assert.equal(await page.evaluate(() => document.body.dataset.activePage), 'inbox');
  assert.deepEqual(bad, []); assert.deepEqual(errs, []); await ctx.close();
});
await t('it stays on the conversations screen when something navigates away (hash change)', async () => {
  const { ctx, page, errs } = await open(BASE + '?app=whatsapp');
  await page.evaluate(() => { location.hash = '#sale'; }); await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => location.hash), '#wa'); assert.equal(await shown(page, '#novaInboxView'), true); assert.equal(await shown(page, '.pos-root'), false);
  await page.evaluate(() => { location.hash = '#products'; }); await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => location.hash), '#wa'); assert.equal(await shown(page, '#novaInboxView'), true);
  assert.deepEqual(errs, []); await ctx.close();
});
await t('desktop width too: same single screen', async () => {
  const { ctx, page, errs } = await open(BASE + '?app=whatsapp', { width: 1366, height: 768 });
  assert.equal(await shown(page, '.nova-nav-row'), false); assert.equal(await shown(page, '#novaInboxView'), true);
  assert.deepEqual(errs, []); await ctx.close();
});
await t('the normal app is unchanged: tab strip and POS visible, own title, no app class', async () => {
  const { ctx, page, errs } = await open(BASE);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('app-whatsapp')), false);
  assert.equal(await page.title(), 'NOVA Rx | صيدلية السوسي');
  assert.equal(await shown(page, '.nova-nav-row'), true); assert.equal(await shown(page, '#novaInboxView'), false);
  assert.deepEqual(errs, []); await ctx.close();
});
await t('a plain /#wa is not WhatsApp-only mode: full app, tab strip visible (unchanged)', async () => {
  const { ctx, page, errs } = await open(BASE + '#wa');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('app-whatsapp')), false);
  assert.equal(await shown(page, '.nova-nav-row'), true, 'tab strip stays in the full app');
  assert.deepEqual(errs, []); await ctx.close();
});
await browser.close(); console.log(`PASS wa app mode (NOVA): ${n} cases`);
