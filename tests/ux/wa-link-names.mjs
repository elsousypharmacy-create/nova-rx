// WA-LINK: the conversations screen asks the server to attach the registered pharmacy customer names (GET history/link-names), then shows
// them in place (list + chat header); number-only chats show a readable number. Fake data only; every non-GET request is aborted (must stay zero).
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/wa-link-names.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-15T18:17:00+03:00');
const msg = (id, dir, text, at) => ({ id, dir, kind: dir === 'in' ? 'user' : 'pharm', text, at, status: dir === 'out' ? 'delivered' : null });
const mk = (id, customer, last) => ({ id, customer, updatedAt: last.at, count: 1, last });
let linked = false, linkCalls = 0, linkMode = 'ok';
const raw = [mk('wa_201142677350', '201142677350', msg('m1', 'in', 'كام الحساب', NOW - 60000)), mk('wa_201222333444', 'Sara (profile)', msg('m2', 'in', 'عايزة بنادول', NOW - 120000)), mk('wa_201555000111', '201555000111', msg('m3', 'in', 'مساء الخير', NOW - 180000)), mk('wa_US.1349xyz', 'wa_US.1349xyz', msg('m4', 'in', 'hi', NOW - 240000))];
const names = { wa_201142677350: 'محمد السيد', wa_201222333444: 'سارة أحمد' };
const listNow = () => raw.map((c) => (linked && names[c.id] ? { ...c, customer: names[c.id] } : c));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
let n = 0; const ok = (name) => { n++; console.log('  ok', name); };
async function open(vp, mode) {
  linked = false; linkCalls = 0; linkMode = mode || 'ok';
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', timezoneId: 'Asia/Riyadh', serviceWorkers: 'block', hasTouch: !!vp.touch, isMobile: !!vp.touch });
  const other = [];
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin };
    if (q.method() !== 'GET' && q.method() !== 'HEAD') { other.push(q.method() + ' ' + u); return r.abort(); }
    if (u.includes('/api/v1/inbox/history/')) {
      const json = (o, status = 200) => r.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(o) });
      if (u.includes('/link-names')) { linkCalls++; if (linkMode === 'fail') return json({ ok: false }, 502); linked = true; return json({ ok: true, throttled: false, checked: 4, linked: 2 }); }
      if (u.includes('/conversations')) return json({ ok: true, conversations: listNow() });
      if (u.includes('/conversation?')) { const id = decodeURIComponent(/id=([^&]+)/.exec(u)[1]), c = listNow().find((x) => x.id === id); return json({ ok: true, conversation: { id, customer: c.customer, updatedAt: c.updatedAt, messages: [c.last] } }); }
      return json({ ok: true });
    }
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.goto(BASE, { waitUntil: 'load' }); await page.waitForTimeout(300);
  await page.locator('#novaWaBtn').click();
  const view = page.locator('#novaInboxView'); await view.locator('[data-conv="wa_201142677350"]').waitFor();
  return { ctx, page, view, other, errors };
}
const nameOf = (view, id) => view.locator(`[data-conv="${id}"] .wa-name`).innerText();

for (const vp of [{ width: 390, height: 844, touch: true }, { width: 1366, height: 768 }]) {
  const { ctx, page, view, other, errors } = await open(vp);
  await page.waitForFunction(() => /محمد السيد/.test(document.querySelector('#novaInboxView').innerText), null, { timeout: 8000 });
  assert.equal(await nameOf(view, 'wa_201142677350'), 'محمد السيد'); assert.equal(await nameOf(view, 'wa_201222333444'), 'سارة أحمد'); ok(vp.width + ': registered names replace the number and the profile name in the list, without a reload');
  assert.equal(await nameOf(view, 'wa_201555000111'), '0155 500 0111'); assert.match(await nameOf(view, 'wa_US.1349xyz'), /يوزرنيم واتساب/); ok(vp.width + ': unregistered chats show a readable number / a clear label, never bare digits');
  assert.equal(await view.locator('[data-conv="wa_201555000111"] .wa-avatar svg').count(), 1); assert.equal(await view.locator('[data-conv="wa_201142677350"] .wa-avatar svg').count(), 0); ok(vp.width + ': number-only chats get the person avatar, named ones a letter');
  await view.locator('[data-conv="wa_201142677350"]').click(); await view.locator('.wa-head-name').waitFor();
  assert.equal(await view.locator('.wa-head-name').innerText(), 'محمد السيد'); assert.match(await view.locator('[data-wa-sub]').innerText(), /0114 267 7350/);
  assert.equal(await view.locator('a[data-wa-call]').getAttribute('href'), 'tel:+201142677350'); ok(vp.width + ': chat header shows the registered name, the number under it, and a call link');
  await page.waitForTimeout(5500); assert.equal(linkCalls, 1, 'link-names is requested once, not on every 4 s poll'); ok(vp.width + ': one link request (throttled client side)');
  assert.deepEqual(other, [], 'no non-GET request'); assert.deepEqual(errors, []); ok(vp.width + ': GET only, no page errors');
  await ctx.close();
}
{ // server failure: the list still works and stays readable
  const { ctx, page, view, other, errors } = await open({ width: 1366, height: 768 }, 'fail');
  await page.waitForTimeout(1500); assert.ok(linkCalls >= 1);
  assert.equal(await nameOf(view, 'wa_201142677350'), '0114 267 7350'); assert.equal(await nameOf(view, 'wa_201222333444'), 'Sara (profile)'); assert.deepEqual(other, []); assert.deepEqual(errors, []);
  ok('link failure (502): list unchanged, readable, no errors'); await ctx.close();
}
console.log('PASS wa-link-names:', n, 'cases'); await browser.close();
