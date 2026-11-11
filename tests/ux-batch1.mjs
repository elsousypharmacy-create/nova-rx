// UX batch 1: UX-MIXED-LANG, UX-LANG-SWITCH-WEAK, UX-FAB-OVERLAP-mobile (+ FAB label).
// Run: CHROME_PATH=/path/to/chromium node tests/ux-batch1.mjs   (needs @playwright/test)
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const candidates = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
const executablePath = candidates.find(existsSync);
assert(executablePath, 'Set CHROME_PATH to an installed Chromium browser');
const PORT = 8768, URL_ = `http://127.0.0.1:${PORT}/index.html#sale`;
const server = spawn(process.execPath, ['scripts/dev-server.mjs', '--port', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (name, cond, detail = '') => { if (!cond) failures++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' -> ' + detail}`); };

// UX_SKIP_EXTRA: extra CSS selectors to ignore (e.g. '#nlSimple' for the Arabic-only sticker panel on the live Worker).
// UI text outside data areas, as [text...] and attribute values.
const collect = (extra) => {
  const skip = (extra ? extra + ',' : '') + 'script,style,option,.nova-data-table tbody,.cust-name,.cust-phone,.sugg-primary,.sugg-sub,.past-item-row,.past-inv-card,.offer-item,.invoice-table tbody,#novaLabelsPanel,#novaAiPanel';
  const texts = [], attrs = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const n = w.currentNode; if (!n.parentElement || n.parentElement.closest(skip)) continue; const t = n.nodeValue.replace(/\s+/g, ' ').trim(); if (t) texts.push(t); }
  document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(e => { if (extra && e.closest(extra)) return; for (const a of ['placeholder', 'title', 'aria-label']) { const v = e.getAttribute(a); if (v) attrs.push(v); } });
  return { texts, attrs };
};
const AR = /[؀-ۿ]/, LAT = /[A-Za-z]{3,}/;
// Demo customer names ("عربي (English)"), brand/tech words are data, not UI text.
const isData = t => /\([A-Za-z .'-]+\)\s*$/.test(t);
const brandOnly = t => !LAT.test(t.replace(/NOVA Rx|PWA|Black Edition|Cairo|API|Gemini|F\d+|Enter|Esc|POS|PDF|AI|SAR|EGP|VAT/g, ''));

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
try {
  await sleep(1200);
  for (const lang of ['en', 'ar']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.addInitScript(l => { try { localStorage.setItem('nova-rx-language', l); } catch (e) {} }, lang);
    await page.goto(URL_, { waitUntil: 'domcontentloaded' }); await sleep(1000);
    const [htmlLang, htmlDir] = await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir]);
    check(`${lang}: html lang/dir`, htmlLang === lang && htmlDir === (lang === 'ar' ? 'rtl' : 'ltr'), `${htmlLang}/${htmlDir}`);
    const bad = new Set();
    for (const pg of ['sale', 'invoices', 'products', 'customers', 'reports', 'settings']) {
      await page.click(`.nova-tab[data-page="${pg}"]`); await sleep(350);
      const { texts, attrs } = await page.evaluate(collect, process.env.UX_SKIP_EXTRA || '');
      for (const t of [...texts, ...attrs]) {
        if (isData(t)) continue;
        if (lang === 'en' && AR.test(t)) bad.add(t);
        if (lang === 'ar' && AR.test(t) && LAT.test(t) && !brandOnly(t)) bad.add(t);
      }
    }
    check(`${lang}: no ${lang === 'en' ? 'Arabic' : 'mixed Arabic/English'} UI text on any page`, bad.size === 0, [...bad].slice(0, 5).join(' | '));
    check(`${lang}: no page errors`, errs.length === 0, errs.join(';'));
    if (lang === 'en') {
      const mixedNow = await page.evaluate(() => document.body.innerText.includes('Cash / ') || document.body.innerText.includes('إنهاء الفاتورة'));
      check('en: payment labels are English only', !mixedNow);
    }
    await ctx.close();
  }

  // Switching at runtime (settings buttons) changes lang/dir and the UI both ways.
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage();
    await page.goto(URL_, { waitUntil: 'domcontentloaded' }); await sleep(900);
    await page.click('.nova-tab[data-page="settings"]'); await sleep(300);
    await page.click('.nova-lang-btn[data-lang="en"]'); await sleep(500);
    check('switch → en: lang/dir', await page.evaluate(() => document.documentElement.lang === 'en' && document.documentElement.dir === 'ltr'));
    check('switch → en: tabs are English', (await page.textContent('.nova-tab[data-page="sale"]')).trim() === 'Sales');
    await page.click('.nova-lang-btn[data-lang="ar"]'); await sleep(500);
    check('switch → ar: lang/dir', await page.evaluate(() => document.documentElement.lang === 'ar' && document.documentElement.dir === 'rtl'));
    check('switch → ar: tabs are Arabic', (await page.textContent('.nova-tab[data-page="sale"]')).trim() === 'البيع');
    await ctx.close();
  }

  // Sticker button never covers the checkout button or other controls.
  for (const vp of [[390, 844], [360, 640], [412, 915], [834, 1112], [1194, 834], [1440, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: vp[0], height: vp[1] } }); const page = await ctx.newPage();
    await page.goto(URL_, { waitUntil: 'domcontentloaded' }); await sleep(900);
    const r = await page.evaluate(() => {
      const f = document.getElementById('novaAiLaunch'), fr = f.getBoundingClientRect(), hits = new Set();
      for (let x = fr.left + 2; x < fr.right; x += 6) for (let y = fr.top + 2; y < fr.bottom; y += 6) {
        const hit = document.elementsFromPoint(x, y).find(e => e !== f && !f.contains(e) && e.matches('button,input,a,select,textarea,[role=button]') && getComputedStyle(e).visibility !== 'hidden');
        if (hit) hits.add(hit.id || hit.className || hit.tagName);
      }
      return { hits: [...hits], inView: fr.left >= 0 && fr.right <= innerWidth && fr.top >= 0 && fr.bottom <= innerHeight, label: f.textContent.trim(), aria: f.getAttribute('aria-label') };
    });
    check(`${vp[0]}x${vp[1]}: sticker button covers no control`, r.hits.length === 0, r.hits.join(','));
    check(`${vp[0]}x${vp[1]}: sticker button inside viewport`, r.inView);
    check(`${vp[0]}x${vp[1]}: visible label is part of accessible name`, r.aria.includes(r.label.replace('✦', '').trim()), `${r.label} / ${r.aria}`);
    await ctx.close();
  }

  // UX-HELD-PANEL-OFFSCREEN: «الفواتير المعلقة» opened below the screen (anchored to the whole workspace) and was never visible.
  for (const vp of [[390, 844], [360, 640], [834, 1112], [1194, 834], [1440, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: vp[0], height: vp[1] } }); const page = await ctx.newPage();
    await page.goto(URL_, { waitUntil: 'domcontentloaded' }); await sleep(900);
    await page.click('#btnHeldInvoices'); await sleep(300);
    const r = await page.evaluate(() => {
      const el = document.getElementById('heldInvoicePanel'), pr = el.getBoundingClientRect();
      const x = pr.left + pr.width / 2, y = Math.min(pr.top + 24, innerHeight - 2);
      const top = document.elementFromPoint(x, y);
      return { hidden: el.hidden, inView: pr.top >= 0 && pr.left >= 0 && pr.right <= innerWidth && pr.top < innerHeight - 40, top: Math.round(pr.top), vh: innerHeight, reachable: !!top && (el === top || el.contains(top)) };
    });
    check(`${vp[0]}x${vp[1]}: held invoices panel opens inside the screen`, !r.hidden && r.inView, `top=${r.top} vh=${r.vh}`);
    check(`${vp[0]}x${vp[1]}: held invoices panel is not covered`, r.reachable);
    await ctx.close();
  }
} finally { await browser.close(); server.kill(); }
console.log(failures ? `FAILED: ${failures}` : 'ALL UX-BATCH1 CHECKS PASSED');
process.exit(failures ? 1 : 0);
