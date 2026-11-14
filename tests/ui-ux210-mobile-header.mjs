// UX210: mobile sale header <=110px on 390x844, single action row, F1 chip hidden on touch, 44px targets.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'ar-EG' });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForTimeout(1200);
  const m = await page.evaluate(() => {
    const box = s => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { top: r.top, h: r.height, w: r.width, d: getComputedStyle(e).display }; };
    const ids = ['#btnNewSale', '#holdCurrentInvoice', '#btnHeldInvoices', '#btnAddLoyalty', '#btnSaleMore'];
    return { header: box('.top-header'), chip: box('#novaHelpChip'), btns: ids.map(box), dir: document.documentElement.dir || document.body.dir };
  });
  assert.ok(m.header.h <= 110, 'header height ' + m.header.h);
  assert.equal(m.chip.d, 'none', 'F1 chip hidden on touch');
  assert.equal(new Set(m.btns.map(b => Math.round(b.top))).size, 1, 'actions on a single row');
  for (const b of m.btns) assert.ok(b.h >= 44 && b.w >= 44, 'target ' + b.w + 'x' + b.h);
  console.log('  ok UX210 header', m.header.h + 'px, chip hidden, single row, 44px targets');
} finally { await browser.close(); }
