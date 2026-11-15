// UX324: emergency-sales.html must look like Black Edition (dark), use Arabic file/date controls, have >=44px targets,
// and not tell the user to «open the prices tab» while they are already on it.
// Fake data only: tests/fixtures/emergency/snapshot-sample.csv; every non-GET request is aborted, external hosts blocked.
// Run: CHROME_PATH=/usr/bin/chromium node tests/ux324-emergency-browser.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const req = createRequire(import.meta.url);
let chromium; try { ({ chromium } = req('@playwright/test')); } catch { ({ chromium } = req('playwright')); }
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CSV = path.join(root, 'tests/fixtures/emergency/snapshot-sample.csv');
const exe = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
const PORT = 8774;
const server = spawn(process.execPath, ['scripts/dev-server.mjs', '--port', String(PORT)], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
let fail = 0; const log = (ok, m) => { console.log((ok ? 'PASS ' : 'FAIL ') + m); if (!ok) fail++; };
const lum = c => { const [a, b, d] = c.map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * a + .7152 * b + .0722 * d; };
const rgb = s => s.match(/\d+(\.\d+)?/g).map(Number).slice(0, 4);
const ARABIC = /[؀-ۿ]/;
const browser = await chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}), args: ['--no-sandbox'] });
const blocked = [];
try {
  for (const [label, url] of [['http', `http://127.0.0.1:${PORT}/emergency-sales.html`], ['file', 'file://' + path.join(root, 'emergency-sales.html')]]) {
    for (const [w, h] of [[1366, 768], [390, 844]]) {
      const t = `${label} ${w}x${h}`;
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'en-US', hasTouch: w < 500 }); // en-US: worst case for native control chrome
      await ctx.route('**/*', r => {
        const q = r.request(); const u = new URL(q.url());
        if (q.method() !== 'GET') { blocked.push(q.method() + ' ' + u.pathname); return r.abort(); }
        if (u.protocol === 'file:') return r.continue();
        if (u.hostname !== '127.0.0.1') return r.abort();
        if (u.pathname === '/emergency/stock.json') return r.fulfill({ status: 404, body: '' }); // start without a price list
        return r.continue();
      });
      const pg = await ctx.newPage();
      const errors = []; pg.on('pageerror', e => errors.push(String(e)));
      await pg.goto(url, { waitUntil: 'load' }); await pg.waitForTimeout(400);
      // No snapshot -> page opens on the prices tab.
      log(await pg.isVisible('#vData'), `${t} opens on prices tab without snapshot`);
      const banner = await pg.textContent('#srcBanner');
      log(!/افتح تبويب/.test(banner) && /من الأسفل/.test(banner), `${t} banner copy does not say «open the prices tab» while on it: ${banner}`);
      const st = await pg.evaluate(() => {
        const cs = e => getComputedStyle(e); const q = s => document.querySelector(s);
        const de = document.documentElement;
        const small = [];
        for (const el of document.querySelectorAll('button,a[href],label.pick-btn,input:not([type=hidden]):not(.sr-only),select')) {
          const b = el.getBoundingClientRect(); if (b.width < 2 || b.height < 2 || cs(el).visibility === 'hidden') continue;
          if (b.height < 43.5 || b.width < 43.5) small.push((el.id || el.className || el.tagName) + ':' + Math.round(b.width) + 'x' + Math.round(b.height));
        }
        const fb = q('#file').getBoundingClientRect();
        return {
          rtl: de.dir === 'rtl' && cs(document.body).direction === 'rtl', lang: de.lang,
          bodyBg: cs(document.body).backgroundColor, bodyFg: cs(document.body).color,
          headerBg: cs(q('header')).backgroundColor, cardBg: cs(q('#vData .card')).backgroundColor,
          expColor: cs(q('#exp')).color, expH: q('#exp').getBoundingClientRect().height,
          expView: q('#expView').textContent, expViewVisible: cs(q('#expView')).visibility === 'visible',
          pick: q('#filePick').textContent, pickFor: q('#filePick').htmlFor, fileName: q('#fileName').textContent,
          fileHidden: fb.width <= 1 && fb.height <= 1, small, overflowX: de.scrollWidth - de.clientWidth,
        };
      });
      log(st.rtl && st.lang === 'ar', `${t} Arabic RTL`);
      const bg = rgb(st.bodyBg), hd = rgb(st.headerBg), cd = rgb(st.cardBg);
      log(lum(bg) < 0.02 && lum(hd) < 0.02 && lum(cd) < 0.02, `${t} Black Edition dark body/header/card (${st.bodyBg} / ${st.headerBg} / ${st.cardBg})`);
      const cr = (Math.max(lum(bg), lum(rgb(st.bodyFg))) + .05) / (Math.min(lum(bg), lum(rgb(st.bodyFg))) + .05);
      log(cr >= 7, `${t} body contrast ${cr.toFixed(1)}:1`);
      log(st.fileHidden && st.pickFor === 'file' && ARABIC.test(st.pick) && ARABIC.test(st.fileName) && !/Choose|No file/i.test(st.pick + st.fileName), `${t} Arabic file picker («${st.pick}» / «${st.fileName}»), native English chrome hidden`);
      log(rgb(st.expColor)[3] === 0 && st.expViewVisible && ARABIC.test(st.expView) && !/mm|dd|yyyy/i.test(st.expView), `${t} date shows Arabic readout («${st.expView}»), native mm/dd/yyyy hidden`);
      log(st.expH >= 44, `${t} date field height ${Math.round(st.expH)}px >= 44`);
      log(st.small.length === 0, `${t} touch targets >= 44px${st.small.length ? ' small: ' + st.small.join(', ') : ''}`);
      log(st.overflowX <= 0, `${t} no horizontal overflow (${st.overflowX})`);
      // Date: «الآن» fills the field and the readout turns into an Arabic date.
      await pg.click('#bExpNow');
      const after = await pg.evaluate(() => ({ v: document.getElementById('exp').value, view: document.getElementById('expView').textContent }));
      log(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(after.v) && ARABIC.test(after.view) && /[٠-٩]/.test(after.view), `${t} «الآن» sets date, Arabic readout «${after.view}»`);
      // Keyboard editing reveals the native segments; blur hides them again.
      await pg.focus('#exp'); await pg.keyboard.press('ArrowUp');
      const kb = await pg.evaluate(() => getComputedStyle(document.getElementById('exp')).color);
      log(rgb(kb)[3] !== 0 && rgb(kb).length >= 3, `${t} keyboard edit reveals native field text`);
      await pg.focus('#q').catch(() => {}); await pg.evaluate(() => document.activeElement && document.activeElement.blur());
      // File picker: clicking the Arabic label opens the native chooser; choose the fake CSV.
      const [chooser] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#filePick')]);
      await chooser.setFiles(CSV);
      await pg.waitForSelector('#dataMsg:has-text("تم تحميل 4")');
      log(/snapshot-sample\.csv/.test(await pg.textContent('#fileName')) && ARABIC.test(await pg.textContent('#fileName')), `${t} chosen file name shown in Arabic sentence`);
      const b2 = await pg.textContent('#srcBanner');
      log(!/لا توجد أسعار/.test(b2) && /STOCK LIVE/.test(b2), `${t} banner switches to loaded source`);
      // Sell-tab copy when no snapshot: from another tab the hint to open the prices tab is correct.
      await pg.evaluate(() => localStorage.clear()); await pg.reload(); await pg.waitForTimeout(300);
      await pg.click('#nSell');
      log(/افتح تبويب «الأسعار»/.test(await pg.textContent('#srcBanner')), `${t} from sell tab the banner points to the prices tab`);
      await pg.click('#nData');
      await pg.screenshot({ path: `/tmp/ux324-${label}-${w}.png` });
      log(errors.length === 0, `${t} no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
      await ctx.close();
    }
  }
} finally { await browser.close(); server.kill(); }
log(blocked.length === 0, `no write requests attempted (${blocked.join(', ') || 'none'})`);
console.log(fail ? `FAILED ${fail}` : 'ALL PASS'); process.exit(fail ? 1 : 0);
