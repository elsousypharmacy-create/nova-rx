// UX422: main SPA pages (index.html, all tabs except المحادثات) use the UX420 design system; RTL/mobile-correct.
// Fake/no live writes: every non-GET request and every non-local host is aborted; localStorage starts empty (demo/local data only).
// Run: node tests/ux422-app-browser.mjs   (needs @playwright/test + Chrome; SHOTS=1 writes /tmp/ux422-*.png)
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
const exe = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
assert(exe, 'Set CHROME_PATH');
const PORT = 8772;
const server = spawn(process.execPath, ['scripts/dev-server.mjs', '--port', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const tabs = ['sale', 'invoices', 'products', 'customers', 'reports', 'settings'];
const views = [[1366, 768], [390, 844]];
let fail = 0, blockedWrites = 0; const log = (ok, m) => { console.log((ok ? 'PASS ' : 'FAIL ') + m); if (!ok) fail++; };
const lum = c => { const [a, b, d] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }); return .2126 * a + .7152 * b + .0722 * d };
const ratio = (x, y) => { const [a, b] = [lum(x), lum(y)]; return (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
const browser = await chromium.launch({ headless: true, executablePath: exe, args: ['--no-sandbox'] });
try {
  for (const [w, h] of views) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-EG', hasTouch: w < 500, isMobile: w < 500 });
    await ctx.route('**/*', r => { const q = r.request(); const u = new URL(q.url()); if (q.method() !== 'GET') { blockedWrites++; return r.abort() } if (u.hostname !== '127.0.0.1' && !u.protocol.startsWith('data')) return r.abort(); return r.continue() });
    const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e.message || e)));
    await pg.addInitScript(() => { try { if (!sessionStorage.getItem('ux422')) { localStorage.clear(); sessionStorage.setItem('ux422', '1') } localStorage.setItem('nova-rx-language', 'ar') } catch {} });
    await pg.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' }); await pg.waitForTimeout(900);
    const inboxBefore = await pg.evaluate(() => { const v = document.getElementById('novaInboxView'); return v ? v.outerHTML.length : -1 });
    for (const t of tabs) {
      await pg.evaluate(p => { const b = document.querySelector(`.nova-tab[data-page="${p}"]`); b && b.click() }, t); await pg.waitForTimeout(450);
      const r = await pg.evaluate(() => {
        const de = document.documentElement, out = {}, cs = e => getComputedStyle(e);
        const rgb = s => (s.match(/\d+(\.\d+)?/g) || [0, 0, 0]).map(Number).slice(0, 3);
        out.skin = !!document.getElementById('UX422_APP_SKIN') && cs(document.body).getPropertyValue('--nx-accent').trim() !== '';
        out.font = /Cairo/.test(cs(document.body).fontFamily);
        out.rtl = de.dir === 'rtl' && cs(document.querySelector('.nova-nav')).direction === 'rtl';
        out.overflowX = de.scrollWidth - de.clientWidth;
        const act = document.querySelector('.nova-tab.active'); out.active = act && act.dataset.page;
        out.tabH = act ? Math.round(act.getBoundingClientRect().height) : 0;
        out.tabContrast = act ? [rgb(cs(act).color), rgb(cs(act).backgroundColor)] : null;
        const pv = document.getElementById('novaPageView'); const root = out.active === 'sale' ? document.querySelector('.pos-root') : pv;
        out.visible = !!root && root.getBoundingClientRect().height > 50 && cs(root).display !== 'none';
        // primary buttons inside the active page: >=44px tall on touch screens, readable text
        const btns = [...root.querySelectorAll('button,.btn')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 2 && r.height > 2 && cs(b).visibility !== 'hidden' && !b.closest('#novaInboxView,[data-wa-root],.wa-root') });
        out.smallBtns = matchMedia('(pointer:coarse)').matches ? btns.filter(b => b.getBoundingClientRect().height < 43.5).map(b => (b.id || b.className || b.tagName).toString().slice(0, 40) + ':' + Math.round(b.getBoundingClientRect().height)) : [];
        const lowC = []; for (const b of btns) { const bg = rgb(cs(b).backgroundColor); if ((cs(b).backgroundColor.match(/[\d.]+/g) || [])[3] === '0') continue; lowC.push([b.id || b.className, rgb(cs(b).color), bg]) } out.btnColors = lowC.slice(0, 60);
        out.cardRadius = (() => { const c = root.querySelector('.nova-card,.nova-kpi,.nova-panel,.settings-card,.nova-section'); return c ? parseFloat(cs(c).borderTopLeftRadius) : null })();
        return out
      });
      const k = `${t} ${w}x${h}`;
      log(r.active === t, `${k} tab active`); log(r.visible, `${k} page visible`);
      log(r.skin, `${k} UX422 skin + --nx tokens`); log(r.font, `${k} Cairo font`); log(r.rtl, `${k} RTL`);
      log(r.overflowX <= 0, `${k} no horizontal page overflow (${r.overflowX})`);
      log(r.tabH >= (w < 500 ? 44 : 36), `${k} active tab height ${r.tabH}px`);
      log(r.tabContrast && ratio(...r.tabContrast) >= 4.5, `${k} active tab contrast ${r.tabContrast && ratio(...r.tabContrast).toFixed(2)}:1`);
      const bad = r.btnColors.filter(([, f, b]) => ratio(f, b) < 4.5); log(bad.length === 0, `${k} filled buttons text contrast >=4.5${bad.length ? ' low: ' + bad.slice(0, 4).map(x => x[0] + '=' + ratio(x[1], x[2]).toFixed(2)).join(', ') : ''}`);
      log(r.smallBtns.length === 0, `${k} touch targets >=44px${r.smallBtns.length ? ' small: ' + r.smallBtns.slice(0, 6).join(', ') : ''}`);
      if (process.env.SHOTS) await pg.screenshot({ path: `/tmp/ux422-${t}-${w}.png` });
    }
    const inboxAfter = await pg.evaluate(() => { const v = document.getElementById('novaInboxView'); return v ? v.outerHTML.length : -1 });
    log(inboxAfter === inboxBefore, `${w}x${h} conversations view untouched by page walk`);
    log(errs.length === 0, `${w}x${h} no page errors${errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''}`);
    await ctx.close();
  }
} finally { await browser.close(); server.kill() }
console.log(`blocked non-GET requests: ${blockedWrites}`);
console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
