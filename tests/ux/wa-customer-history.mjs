// WA-CUSTHIST: tap the customer's name in the chat header -> purchase-history sheet (mocked API, fake data, GET only).
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/wa-customer-history.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const T = Date.now() - 3600e3;
const mk = (id, name) => ({ id, customer: name, updatedAt: T, count: 1, last: { id: 'm_' + id, dir: 'in', kind: 'in', text: 'أهلا', at: T, status: null } });
const CONVS = [mk('wa_201000000001', 'منى التجريبية'), mk('wa_user_abc', 'حساب بيوزرنيم')];
const full = (c) => ({ id: c.id, customer: c.customer, updatedAt: T, messages: [c.last] });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
let mode = 'ok', calls = 0, release; const nonGet = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG', serviceWorkers: 'block', hasTouch: true, isMobile: true });
await ctx.route('**/*', async (r) => {
  const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin };
  if (u.includes('/api/v1/inbox/history/')) {
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': 'Content-Type,X-Nova-Pin', 'Access-Control-Allow-Methods': 'GET,POST' } });
    const json = (o, status = 200) => r.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.includes('/customer-history')) {
      calls++;
      if (/user_abc/.test(u)) return json({ ok: true, available: false, reason: 'no-phone', purchases: [], debt: null, partial: false });
      if (mode === 'slow') await new Promise((res) => { release = res; });
      if (mode === 'err') return json({ ok: false, code: 'HIST_FAILED', message_ar: 'تعذّر تحميل سجل الفواتير. حاول مرة تانية.' }, 502);
      if (mode === 'empty') return json({ ok: true, available: true, purchases: [], debt: null, partial: false });
      return json({ ok: true, available: true, purchases: [
        { date: '2026-11-10', invoice: '1234', total: 145.5, discount: 5, points: 7, items: [{ name: 'بنادول إكسترا', qty: 2, price: 30 }, { name: 'فيتامين C', qty: 1, price: 60 }, { name: 'شاش', qty: 1, price: 10 }, { name: 'قطرة', qty: 1, price: 20.5 }] },
        { date: '2026-11-02', invoice: '1190', total: 60, discount: 0, items: [{ name: '<b>x</b>', qty: 1, price: 60 }] }], debt: { net: 40 }, points: { total: 42 }, partial: true });
    }
    if (u.includes('/link-names')) return json({ ok: true });
    if (u.includes('/conversations')) return json({ ok: true, conversations: CONVS });
    const id = decodeURIComponent(/id=([^&]+)/.exec(u)[1]); return json({ ok: true, conversation: full(CONVS.find((c) => c.id === id)) });
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(q.method())) { nonGet.push(u); return r.abort(); }
  return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
});
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
await page.goto(BASE, { waitUntil: 'load' }); await page.waitForTimeout(500);
await page.locator('#novaWaBtn').click();
const view = page.locator('#novaInboxView');
const sheet = view.locator('[data-wa-cust]');
const openChat = async (id) => { await view.locator(`[data-conv="${id}"]`).click(); await view.locator(`[data-mid="m_${id}"]`).waitFor(); };
await openChat('wa_201000000001');
// 1) loading, then invoices (nothing posted, no PIN header needed)
mode = 'slow';
await view.locator('[data-wa-cust-open]').click();
await sheet.locator('[role=status]').waitFor();
assert.ok((await sheet.innerText()).includes('جاري تحميل الفواتير'));
release();
await sheet.locator('.wa-inv').first().waitFor();
const txt = await sheet.innerText();
assert.equal(await sheet.locator('.wa-inv').count(), 2);
assert.ok(txt.includes('فاتورة #1234') && txt.includes('10/11/2026') && txt.includes('145.5'), txt);
assert.ok(txt.includes('بنادول إكسترا ×2') && txt.includes('و 1 صنف تاني'), 'items summarised (3 + 1 more)');
assert.ok(txt.includes('عليه مديونية') && txt.includes('40'), 'debt shown');
assert.ok(!txt.includes('نقاط'), 'points are not shown (owner removed them)');
assert.ok(txt.includes('القائمة ممكن تكون ناقصة'), 'partial note');
assert.equal(await sheet.locator('b', { hasText: 'x' }).count(), 0, 'item name is escaped, not HTML');
// 1b) tap an invoice -> details (lines, discount, total, points); back returns to the list; Esc backs out one level first
await sheet.locator('.wa-inv').first().click();
await sheet.locator('.wa-line').first().waitFor();
let dt = await sheet.innerText();
assert.ok(dt.includes('تفاصيل الفاتورة') && dt.includes('فاتورة #1234'), dt);
assert.equal(await sheet.locator('.wa-line').count(), 4);
assert.ok(dt.includes('بنادول إكسترا') && dt.includes('2 × 30') && dt.includes('60'), dt);
assert.ok(dt.includes('مجموع الأصناف') && dt.includes('150.5') && dt.includes('الخصم') && dt.includes('الإجمالي المدفوع') && dt.includes('145.5'), dt);
assert.ok(!dt.includes('نقاط'), 'no points in the details');
await page.waitForTimeout(4800);
assert.equal(await sheet.locator('.wa-line').count(), 4, 'details kept after the live refresh');
await sheet.locator('[data-wa-cust-backlist]').click(); await sheet.locator('.wa-inv').first().waitFor();
await sheet.locator('.wa-inv').nth(1).click(); await sheet.locator('.wa-line').first().waitFor();
dt = await sheet.innerText(); assert.ok(!dt.includes('الخصم'), 'no discount row when 0');
assert.equal(await sheet.locator('b', { hasText: 'x' }).count(), 0, 'escaped in details');
await page.keyboard.press('Escape'); await sheet.locator('.wa-inv').first().waitFor();   // Esc from details = back to the list, sheet stays
await sheet.locator('.wa-inv').first().click(); await sheet.locator('.wa-line').first().waitFor();
await sheet.locator('[data-wa-cust-close]').click(); await sheet.waitFor({ state: 'detached' });
await view.locator('[data-wa-cust-open]').click(); await sheet.locator('.wa-inv').first().waitFor();   // reopen starts at the list
// 2) survives the 4s live refresh
await page.waitForTimeout(4800);
assert.equal(await sheet.locator('.wa-inv').count(), 2, 'sheet kept after poll');
// 3) closes with the button, with Esc, and by tapping outside; chat still there
await sheet.locator('[data-wa-cust-close]').click(); await sheet.waitFor({ state: 'detached' });
mode = 'ok'; await view.locator('[data-wa-cust-open]').click(); await sheet.locator('.wa-inv').first().waitFor();
await page.keyboard.press('Escape'); await sheet.waitFor({ state: 'detached' });
await view.locator('[data-wa-cust-open]').click(); await sheet.waitFor();
await sheet.click({ position: { x: 5, y: 5 } }); await sheet.waitFor({ state: 'detached' });
assert.ok(await view.locator('#waInput').count() > 0, 'chat still open');
// 4) cached for 5 min: reopening does not call the API again
const before = calls; await view.locator('[data-wa-cust-open]').click(); await sheet.locator('.wa-inv').first().waitFor(); assert.equal(calls, before);
await page.keyboard.press('Escape');
// 5) error + retry
await page.evaluate(() => 0);
mode = 'err'; await page.reload({ waitUntil: 'load' }); await page.locator('#novaWaBtn').click(); await openChat('wa_201000000001');
await view.locator('[data-wa-cust-open]').click();
await sheet.locator('[role=alert]').waitFor();
assert.ok((await sheet.innerText()).includes('تعذّر تحميل سجل الفواتير'));
mode = 'empty'; await sheet.locator('[data-wa-cust-retry]').click();
await sheet.locator('.wa-cust-msg', { hasText: 'مفيش فواتير' }).waitFor();
await page.keyboard.press('Escape');
// 6) username chat (no phone): explained, no invoices
await view.locator('[data-wa-back]').click(); await openChat('wa_user_abc');
await view.locator('[data-wa-cust-open]').click();
await sheet.locator('.wa-cust-msg', { hasText: 'مفيش له رقم تليفون' }).waitFor();
assert.deepEqual(nonGet, []); assert.deepEqual(errors, []);
await browser.close(); console.log('wa-customer-history: all passed');
