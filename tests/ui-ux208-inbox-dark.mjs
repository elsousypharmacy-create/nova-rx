// UX208: inbox (#novaInboxTab view) uses Black Edition dark surfaces, contrast >= 4.5:1, empty state with icon. Local only.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const origin = new URL(BASE).origin;
mkdirSync('.nova/qa/ux208', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const lum = c => { const [r, g, b] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
try {
  for (const [name, vp] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block' });
    await ctx.route('**/*', r => { const u = r.request().url(); return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort(); });
    await ctx.addInitScript(() => { if (!sessionStorage.getItem('__s')) { localStorage.setItem('nova.flags.inbox', '1'); sessionStorage.setItem('__s', '1'); } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('#novaInboxTab', { state: 'attached' });
    await page.evaluate(() => document.getElementById('novaInboxTab').click());
    await page.waitForSelector('.wa-root');
    const probe = sel => page.evaluate(s => {
      const e = document.querySelector(s), cs = getComputedStyle(e);
      const p = v => (v.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      return { bg: p(cs.backgroundColor), fg: p(cs.color) };
    }, sel);
    // empty state (list view on mobile, main pane on desktop)
    if (name === 'desktop') {
      assert.equal(await page.locator('.wa-main .wa-empty svg').count(), 1, 'empty icon');
      assert.match(await page.locator('.wa-main .wa-empty').innerText(), /اختر محادثة لعرضها/);
      const r = await probe('.wa-empty'); assert.ok(ratio(r.fg, [15, 17, 21]) >= 4.5, 'empty contrast');
    }
    await page.screenshot({ path: `.nova/qa/ux208/${name}-list.png` });
    for (const s of ['.wa-root', '.wa-side', '.wa-chat']) {
      const { bg } = await probe(s); assert.ok(lum(bg) < .06, `${name} ${s} bg dark: ${bg}`);
    }
    for (const s of ['.wa-chat .wa-preview', '.wa-chat .wa-name', '.wa-side-head']) {
      const { fg } = await probe(s); const { bg } = await probe('.wa-chat');
      assert.ok(ratio(fg, bg) >= 4.5, `${name} ${s} contrast ${ratio(fg, bg).toFixed(2)}`);
    }
    await page.click('.wa-chat');
    await page.waitForSelector('.wa-bubble');
    for (const s of ['.wa-main', '.wa-in .wa-bubble', '.wa-out .wa-bubble', '.wa-composer']) {
      const { bg } = await probe(s); assert.ok(lum(bg) < .06, `${name} ${s} bg dark: ${bg}`);
    }
    for (const s of ['.wa-in .wa-bubble', '.wa-out .wa-bubble']) {
      const { bg, fg } = await probe(s); assert.ok(ratio(fg, bg) >= 4.5, `${name} ${s} contrast ${ratio(fg, bg).toFixed(2)}`);
    }
    assert.equal(await page.locator('.wa-root').getAttribute('dir'), 'rtl');
    await page.screenshot({ path: `.nova/qa/ux208/${name}-chat.png` });
    await ctx.close();
  }
  console.log('ui-ux208-inbox-dark: all ok');
} finally { await browser.close(); }
