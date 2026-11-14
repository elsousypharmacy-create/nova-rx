// UX216: disabled pay button contrast >= 3:1; single merged empty-state block.
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
  await page.waitForSelector('#btnCheckout');
  const lum = c => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
  const st = await page.evaluate(() => { const b = document.getElementById('btnCheckout'), c = getComputedStyle(b); return { disabled: b.disabled, color: c.color, bg: c.backgroundColor, opacity: c.opacity, border: c.borderTopStyle, kc: getComputedStyle(b.querySelector('kbd')).color, kbg: getComputedStyle(b.querySelector('kbd')).backgroundColor }; });
  assert.equal(st.disabled, true);
  assert.equal(st.opacity, '1');
  assert.equal(st.border, 'dashed');
  const r1 = ratio(st.color, st.bg);
  console.log('  pay text contrast', r1.toFixed(2));
  assert.ok(r1 >= 3, 'text contrast ' + r1);
  // single empty-state block: while tips are visible, no duplicate sub-message is visible
  const vis = sel => page.locator(sel).isVisible();
  assert.equal(await page.locator('#emptyInvoiceState').count(), 1);
  assert.equal(await vis('#novaFirstRunHint'), true);
  assert.equal(await vis('#emptyInvoiceSub'), false, 'sub message must be hidden while tips shown');
  await page.locator('#novaHintHide').click();
  assert.equal(await vis('#novaFirstRunHint'), false);
  assert.equal(await vis('#emptyInvoiceSub'), true, 'sub message returns after tips hidden');
  console.log('ui-ux216-empty-pay: all ok');
} finally { await browser.close(); }
