// UX213: reports empty state has icon + CTA that switches to the sale tab; skeleton preview + demo disclosure.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
  await ctx.route('**/*', r => { const u = r.request().url(); return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.click('[data-page="reports"]');
  await page.waitForSelector('#novaRepEmpty');
  assert.equal(await page.locator('#novaRepEmpty svg.nova-empty-ico').count(), 1, 'icon');
  assert.equal((await page.locator('#novaRepStartSale').innerText()).trim(), 'ابدأ بيع');
  assert.equal(await page.locator('#novaRepSkeleton .nova-skel-card').count(), 4, 'skeleton');
  assert.match(await page.locator('#novaDemoData summary').innerText(), /ليست مبيعاتك الفعلية/);
  await page.click('#novaRepStartSale');
  assert.equal(await page.locator('[data-page="sale"]').getAttribute('class').then(c => c.includes('active')), true, 'sale tab active');
  assert.equal(await page.evaluate(() => document.body.dataset.activePage), 'sale');
  console.log('ui-ux213-reports-empty: all ok');
} finally { await browser.close(); }
