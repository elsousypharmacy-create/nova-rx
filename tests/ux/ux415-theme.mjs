// UX416: light mode. Settings > Appearance (داكن / فاتح / تلقائي), saved on the device, applied before first paint, also on /purchases.
// Light = the same page colour-inverted (filter on <html>) with photos kept; dark stays the default and is untouched.
// Fake data only. Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux415-theme.mjs   (SHOTS=dir to save screenshots)
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/', SHOTS = process.env.SHOTS || '';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const origin = new URL(BASE).origin;
const NOW = Date.parse('2026-11-18T21:17:00+03:00');
const PHOTO = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#4a90a4"/></svg>';
const msgs = [{ id: 'm1', dir: 'in', kind: 'in', text: 'عندكم بانادول؟', at: NOW - 3600e3 }, { id: 'm2', dir: 'in', kind: 'in', text: '[صورة]', at: NOW - 3000e3, media: { type: 'image', cached: true } }];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
let n = 0; const ok = (m) => { n++; console.log('ok -', m); };
async function open({ pref, scheme = 'dark', lang = 'ar', vp = { width: 1280, height: 800 }, hash = '', path = 'index.html', touch = false }) {
  const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, locale: lang === 'en' ? 'en-US' : 'ar-EG', serviceWorkers: 'block', hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  await ctx.addInitScript(([p, l]) => { try { if (p) localStorage.setItem('nova-theme', p); localStorage.setItem('nova-rx-language', l); } catch (e) {} }, [pref, lang]);
  await ctx.route('**/*', (r) => {
    const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin };
    if (q.method() !== 'GET' && q.method() !== 'HEAD') return r.abort();
    if (u.includes('/emergency/stock.json')) return r.fulfill({ status: 200, contentType: 'application/json', body: snapshot });
    if (u.includes('/api/v1/inbox/history/')) {
      const j = (b) => r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(b) });
      if (u.includes('/media?')) return r.fulfill({ status: 200, headers: cors, contentType: 'image/svg+xml', body: PHOTO });
      if (u.includes('/send-media')) return j({ ok: true, enabled: false });
      if (u.includes('/conversations')) return j({ ok: true, conversations: [{ id: 'wa_1', customer: 'منى حسن', updatedAt: msgs.at(-1).at, count: 2, last: msgs.at(-1) }] });
      if (u.includes('/conversation?')) return j({ ok: true, conversation: { id: 'wa_1', customer: 'منى حسن', updatedAt: NOW, messages: msgs } });
      return j({ ok: true });
    }
    return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(BASE + path + (hash ? '#' + hash : ''), { waitUntil: 'load' }); await page.waitForTimeout(700);
  return { ctx, page, errors };
}
const root = (page) => page.evaluate(() => ({ t: document.documentElement.getAttribute('data-nova-theme'), p: document.documentElement.getAttribute('data-nova-theme-pref'), f: getComputedStyle(document.documentElement).filter, ls: localStorage.getItem('nova-theme'), tc: (document.querySelector('meta[name=theme-color]') || {}).content }));
// average brightness of the page (0-255) from a screenshot
const bright = async (page, clip) => { const buf = await page.screenshot(clip ? { clip } : {}); return page.evaluate(async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3; return s / (d.length / 4); }, buf.toString('base64')); };
const pix = async (page, x, y) => { const buf = await page.screenshot({ clip: { x, y, width: 1, height: 1 } }); return page.evaluate(async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = 1; c.height = 1; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return Array.from(x.getImageData(0, 0, 1, 1).data.slice(0, 3)); }, buf.toString('base64')); };

{ // default = dark, nothing changes
  const { ctx, page, errors } = await open({});
  const r = await root(page); assert.equal(r.t, 'dark'); assert.equal(r.p, 'dark'); assert.equal(r.f, 'none'); assert.equal(r.ls, null, 'nothing stored by default');
  assert.ok(await bright(page) < 60, 'dark page is dark: ' + await bright(page)); assert.deepEqual(errors, []); await ctx.close(); ok('default is dark: no filter, nothing stored, page is dark');
}
{ // settings: the card, choose Light, saved, page turns light
  const { ctx, page, errors } = await open({ hash: 'settings' });
  const card = page.locator('#novaThemeCard'); await card.waitFor();
  const btns = await card.locator('[data-nova-theme-btn]').evaluateAll((bs) => bs.map((b) => [b.dataset.novaThemeBtn, b.textContent.trim(), b.getAttribute('aria-pressed'), b.classList.contains('active')]));
  assert.deepEqual(btns, [['dark', 'داكن', 'true', true], ['light', 'فاتح', 'false', false], ['auto', 'تلقائي', 'false', false]], 'three choices, dark pressed: ' + JSON.stringify(btns));
  for (const b of await card.locator('[data-nova-theme-btn]').all()) { const bb = await b.boundingBox(); assert.ok(bb.width >= 44 && bb.height >= 40, 'touch size ' + JSON.stringify(bb)); }
  await card.locator('[data-nova-theme-btn=light]').click(); await page.waitForTimeout(300);
  let r = await root(page); assert.equal(r.t, 'light'); assert.equal(r.p, 'light'); assert.ok(/invert/.test(r.f), r.f); assert.equal(r.ls, 'light'); assert.equal(r.tc, '#f2f3f5', 'browser bar colour follows');
  assert.equal(await card.locator('[data-nova-theme-btn=light]').getAttribute('aria-pressed'), 'true'); assert.ok(await card.locator('[data-nova-theme-btn=light]').evaluate((b) => b.classList.contains('active')) && !(await card.locator('[data-nova-theme-btn=dark]').evaluate((b) => b.classList.contains('active'))), 'highlight follows the choice'); assert.equal(await card.locator('[data-nova-theme-btn=dark]').getAttribute('aria-pressed'), 'false');
  assert.ok(await bright(page) > 200, 'light page is light: ' + await bright(page));
  if (SHOTS) await page.screenshot({ path: SHOTS + '/ux416-settings-light.png' });
  await card.locator('[data-nova-theme-btn=dark]').click(); await page.waitForTimeout(200); r = await root(page); assert.equal(r.t, 'dark'); assert.equal(r.f, 'none'); assert.ok(await bright(page) < 60); assert.equal(r.tc, '#0A0B0E', 'bar colour restored');
  assert.deepEqual(errors, []); await ctx.close(); ok('Settings > Appearance: dark/light switch live, pressed state follows, saved, bar colour follows, back to dark exact');
}
{ // persists across reload and is in place BEFORE first paint
  const { ctx, page } = await open({ pref: 'light' });
  assert.equal((await root(page)).t, 'light'); await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-nova-theme')), 'light', 'set at DOMContentLoaded, before the app scripts');
  await ctx.close();
  const { ctx: c2, page: p2 } = await open({ pref: 'light', hash: 'invoices' }); assert.equal((await root(p2)).t, 'light'); await c2.close(); ok('light survives reload and page changes; set before first paint');
}
{ // auto follows the device, live
  const { ctx, page } = await open({ pref: 'auto', scheme: 'light' });
  let r = await root(page); assert.equal(r.p, 'auto'); assert.equal(r.t, 'light', 'device light -> light');
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(200); r = await root(page); assert.equal(r.t, 'dark', 'device turns dark -> dark live'); assert.equal(r.f, 'none');
  await page.emulateMedia({ colorScheme: 'light' }); await page.waitForTimeout(200); assert.equal((await root(page)).t, 'light');
  await ctx.close();
  const { ctx: c2, page: p2 } = await open({ pref: 'dark', scheme: 'light' }); assert.equal((await root(p2)).t, 'dark', 'dark means dark even on a light device'); await c2.close();
  const { ctx: c3, page: p3 } = await open({ pref: 'light', scheme: 'dark' }); assert.equal((await root(p3)).t, 'light', 'light means light even on a dark device'); await c3.close();
  ok('auto follows the device live; explicit dark/light ignore the device');
}
{ // junk in storage falls back to dark
  const { ctx, page } = await open({ pref: '<script>' }); const r = await root(page); assert.equal(r.t, 'dark'); assert.equal(r.p, 'dark'); await ctx.close(); ok('an unknown stored value falls back to dark');
}
{ // photos keep their real colours, UI inverts, fixed layout intact, print is not inverted
  const { ctx, page, errors } = await open({ pref: 'light', hash: 'sale', vp: { width: 390, height: 844 }, touch: true });
  await page.locator('#novaWaBtn').click(); await page.locator('[data-conv="wa_1"]').click(); await page.locator('img.wa-mimg').waitFor(); await page.waitForTimeout(900);
  const box = await page.locator('img.wa-mimg').boundingBox();
  const c = await pix(page, Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
  assert.ok(c.every((v, i) => Math.abs(v - [0x4a, 0x90, 0xa4][i]) <= 6), 'the photo keeps its colours (#4a90a4): ' + c);
  const bg = await pix(page, 195, 700); assert.ok(bg.every((v) => v > 200), 'chat background is light: ' + bg);
  assert.ok(/invert/.test(await page.locator('img.wa-mimg').evaluate((e) => getComputedStyle(e).filter)), 'photo is re-inverted');
  if (SHOTS) await page.screenshot({ path: SHOTS + '/ux416-chat-light.png' });
  await page.emulateMedia({ media: 'print' }); const pf = await page.evaluate(() => [getComputedStyle(document.documentElement).filter, getComputedStyle(document.querySelector('img.wa-mimg')).filter]); assert.deepEqual(pf, ['none', 'none'], 'printing is never inverted');
  await page.emulateMedia({ media: 'screen' });
  assert.deepEqual(errors, []); await ctx.close(); ok('photos keep their colours, chat is light, printing is not inverted');
}
{ // a fixed element stays put while the page scrolls (the filter is on <html>: no containing-block side effect)
  const { ctx, page } = await open({ pref: 'light', hash: 'products' });
  const probe = async () => page.evaluate(() => { const e = document.querySelector('.nova-nav'); const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height)]; });
  const before = await probe(); await page.evaluate(() => { window.scrollTo(0, 300); document.scrollingElement.scrollTop = 300; }); await page.waitForTimeout(200);
  const f = await page.evaluate(() => { const d = document.createElement('div'); d.id = 'fx'; d.style.cssText = 'position:fixed;left:10px;bottom:10px;width:20px;height:20px;background:#f00'; document.body.appendChild(d); const r = d.getBoundingClientRect(); window.scrollTo(0, 600); const r2 = d.getBoundingClientRect(); return [Math.round(r.bottom), Math.round(r2.bottom), innerHeight - 10]; });
  assert.equal(f[0], f[2]); assert.equal(f[1], f[2], 'position:fixed is still relative to the screen'); assert.deepEqual(await probe(), before); await ctx.close(); ok('position:fixed elements stay relative to the screen in light mode');
}
{ // English labels
  const { ctx, page } = await open({ lang: 'en', hash: 'settings' });
  const card = page.locator('#novaThemeCard'); await card.waitFor(); await page.waitForTimeout(300);
  const t = (await card.innerText()).replace(/\s+/g, ' '); assert.ok(/Appearance/.test(t) && /Dark/.test(t) && /Light/.test(t) && /Auto/.test(t), t); assert.ok(!/[؀-ۿ]/.test(t), 'no Arabic left in English mode: ' + t); await ctx.close(); ok('English labels for the appearance card');
}
{ // other pages: purchases page follows the same choice; the old --nx light tokens do not double-invert
  const { ctx, page, errors } = await open({ pref: 'light', path: 'purchases.html' });
  const r = await root(page); assert.equal(r.t, 'light'); assert.ok(/invert/.test(r.f)); assert.ok(await bright(page) > 200, 'purchases page is light: ' + await bright(page));
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark', 'the page keeps its own data-theme (ux-tokens light palette is NOT switched on)');
  if (SHOTS) await page.screenshot({ path: SHOTS + '/ux416-purchases-light.png' }); assert.deepEqual(errors, []); await ctx.close(); ok('purchases page follows the saved choice and does not double-invert');
}
{ // the theme code is identical on both pages
  const grab = (f) => { const h = readFileSync(new URL('../../' + f, import.meta.url), 'utf8'); const a = h.indexOf('<script id="NOVA_THEME_JS">'), b = h.indexOf('</style>', h.indexOf('id="NOVA_THEME_CSS"')) + 8; return h.slice(a, b); };
  assert.ok(grab('index.html').includes('NovaTheme') && grab('index.html') === grab('purchases.html'), 'index.html and purchases.html carry the same theme block'); ok('same theme block in index.html and purchases.html');
}
await browser.close();
console.log(`PASS ux415 theme: ${n} groups`);
