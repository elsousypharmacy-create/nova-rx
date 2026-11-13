// UX15: customer panel shows chronic meds + last purchase; one-tap refill of last invoice (<= 3 clicks from fresh sale).
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#btnAttachLoyalty');

  let clicks = 0;
  const click = async sel => { clicks++; await page.locator(sel).first().click(); };

  await click('#btnAttachLoyalty');                       // 1: ربط عميل
  await page.locator('#mainSearchInput').fill('طارق');
  await page.waitForSelector('#suggestionsBox .suggestion-item');
  await click('#suggestionsBox .suggestion-item');        // 2: اختيار
  await page.waitForSelector('#custRefillBox:not([hidden])');

  const chronic = await page.locator('#custChronicList').innerText();
  assert.match(chronic, /كونكور/, 'chronic meds line lists Concor');
  assert.doesNotMatch(chronic, /بانادول/, 'non-chronic excluded');
  assert.match(await page.locator('#custLastPurchase').innerText(), /2026-10-28/, 'last purchase date');

  await click('#btnRefillLast');                          // 3: إعادة صرف
  const rows = await page.locator('#invoiceTableBody tr').count();
  assert.equal(rows, 2, 'cart holds the 2 lines of the prior invoice');
  const text = await page.locator('#invoiceTableBody').innerText();
  assert.match(text, /كونكور/); assert.match(text, /ليبيتور/);
  assert.ok(clicks <= 3, `clicks ${clicks} <= 3`);
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).direction === 'rtl' || document.documentElement.dir === 'rtl'), true, 'RTL kept');
  assert.deepEqual(errors, []);
  console.log(`customer-refill passed (clicks=${clicks})`);
} finally { await browser.close(); }
