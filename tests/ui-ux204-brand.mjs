// UX204: 'NOVA Rx' wordmark fully visible, >=12px from viewport edges, at 1366 and 390 widths.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const [w, h, mobile] of [[1366, 768, false], [390, 844, true]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: mobile, isMobile: mobile, locale: 'ar-EG' });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(1200);
    const m = await page.evaluate(() => {
      const el = document.querySelector('.nova-brand-name');
      const r = el.getBoundingClientRect();
      const host = el.closest('.nova-nav-brand').getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom, sw: el.scrollWidth, cw: el.clientWidth, hl: host.left, hr: host.right, vw: document.documentElement.clientWidth, text: el.textContent.replace(/\s+/g, ' ').trim() };
    });
    assert.equal(m.text, 'NOVA Rx');
    assert.ok(m.l >= 12, w + ': left margin ' + m.l);
    assert.ok(m.vw - m.r >= 12, w + ': right margin ' + (m.vw - m.r));
    assert.ok(m.t >= 0 && m.b <= h, w + ': vertical bounds');
    assert.ok(m.l >= m.hl - 0.5 && m.r <= m.hr + 0.5, w + ': inside brand block ' + JSON.stringify(m));
    assert.ok(m.sw <= m.cw + 1, w + ': not clipped');
    await page.screenshot({ path: `/tmp/ux204-${w}.png`, clip: { x: 0, y: 0, width: w, height: 110 } });
    console.log(`  ok UX204 ${w}px wordmark L=${m.l.toFixed(1)} R-margin=${(m.vw - m.r).toFixed(1)}`);
    await ctx.close();
  }
} finally { await browser.close(); }
