// UX71: days since last dispense + calm early/late hint for chronic customers.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const iso = d => { const t = new Date(); t.setDate(t.getDate() - d); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  const errors = [];
  // days ago for the seeded last invoice (null = remove purchases); index.html is served with the date rewritten
  const show = async days => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
    await ctx.route('**/*', async r => {
      const u = r.request().url();
      if (new URL(u).pathname === '/' || u.endsWith('/index.html')) {
        const res = await r.fetch();
        let html = await res.text();
        html = days === null
          ? html.replace(/(طارق[\s\S]*?pastInvoices: )\[[\s\S]*?\n          \](?=,?\n)/, '$1[]')
          : html.replace('2026-10-28 18:45', iso(days) + ' 18:45');
        return r.fulfill({ response: res, body: html });
      }
      return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') ? r.continue() : r.abort();
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('#btnAttachLoyalty');
    await page.locator('#btnAttachLoyalty').click();
    await page.locator('#mainSearchInput').fill('طارق');
    await page.waitForSelector('#suggestionsBox .suggestion-item');
    await page.locator('#suggestionsBox .suggestion-item').first().click();
    await page.waitForSelector('#custRefillBox', { state: 'attached' }); await page.waitForTimeout(200);
    const out = await page.locator('#custDaysSince').evaluate(el => ({ hidden: el.hidden || el.closest('[hidden]') !== null, text: el.innerText.trim() }));
    out.rtl = await page.evaluate(() => document.documentElement.dir === 'rtl');
    await ctx.close();
    return out;
  };

  let r = await show(17);
  assert.equal(r.hidden, false);
  assert.match(r.text, /صُرف منذ 17 يوم/); assert.match(r.text, /مبكر/);
  r = await show(30);
  assert.match(r.text, /صُرف منذ 30 يوم/); assert.doesNotMatch(r.text, /مبكر|متأخر/);
  r = await show(50);
  assert.match(r.text, /صُرف منذ 50 يوم/); assert.match(r.text, /متأخر/);
  assert.equal(r.rtl, true, 'RTL kept');
  r = await show(null);
  assert.equal(r.hidden, true, 'no purchase shows nothing');
  assert.deepEqual(errors, []);
  console.log('refill-days passed');
} finally { await browser.close(); }
