// UX batch 3 (tablet/desktop first): toasts, Arabic totals, touch targets, text floor, walk-in shortcut.
// Run: CHROME_PATH=/path/to/chromium node tests/ux-batch3.mjs   (needs @playwright/test)
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const candidates = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
const executablePath = candidates.find(existsSync);
assert(executablePath, 'Set CHROME_PATH to an installed Chromium browser');
const PORT = 8772, URL_ = `http://127.0.0.1:${PORT}/index.html#sale`;
const server = spawn(process.execPath, ['scripts/dev-server.mjs', '--port', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (name, cond, detail = '') => { if (!cond) failures++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' -> ' + detail}`); };
const AR = /[؀-ۿ]/, LAT = /[A-Za-z]{3,}/;

async function open(browser, lang, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1194, height: 834 }, ...opts }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(l => { try { localStorage.setItem('nova-rx-language', l); } catch (e) {} }, lang);
  await page.goto(URL_, { waitUntil: 'domcontentloaded' }); await sleep(900);
  return { ctx, page, errs };
}
async function addItems(page, qs) {
  await page.fill('#mainSearchInput', ''); await page.keyboard.press('Enter'); await sleep(150);
  for (const q of qs) { await page.fill('#mainSearchInput', q); await sleep(300); await page.keyboard.press('Enter'); await sleep(250); }
}

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
try {
  for (const lang of ['ar', 'en']) {
    const { ctx, page, errs } = await open(browser, lang);
    await addItems(page, ['pana', 'augm', 'vita']);
    // toasts: only one at a time, and never over the totals bar / CHECKOUT
    const t = await page.evaluate(() => {
      const toasts = [...document.querySelectorAll('#toastContainer .toast')], co = document.getElementById('btnCheckout').getBoundingClientRect();
      const boxes = toasts.map(e => e.getBoundingClientRect());
      return { count: toasts.length, overlap: boxes.some(r => r.left < co.right && r.right > co.left && r.top < co.bottom && r.bottom > co.top), text: toasts.map(e => e.innerText.replace(/\s+/g, ' ').trim()).join('|') };
    });
    check(`${lang}: only one toast after 3 quick additions`, t.count === 1, `count=${t.count}`);
    check(`${lang}: toast does not cover the CHECKOUT button`, !t.overlap);
    if (lang === 'ar') check('ar: toast text is Arabic', AR.test(t.text) && !/Added|added/.test(t.text), t.text);
    else check('en: toast text is English (product names are data)', /^● ?Added to invoice:/.test(t.text) && !AR.test(t.text.split(':')[0]), t.text);
    await sleep(2800);
    check(`${lang}: toast disappears by itself`, (await page.locator('#toastContainer .toast').count()) === 0);
    // totals area labels
    const foot = await page.evaluate(() => document.querySelector('.totals-breakdown, #displayGrandTotal')?.closest('.invoice-footer, .totals-breakdown, body').innerText.replace(/\s+/g, ' ') || '');
    const btn = (await page.textContent('#btnCheckout')).replace(/\s+/g, ' ').trim();
    if (lang === 'ar') {
      check('ar: CHECKOUT / NET TOTAL / SAR are Arabic', !/CHECKOUT|NET TOTAL|SAR|items/.test(foot + ' ' + btn) && /إتمام الدفع/.test(btn), `${btn} | ${foot.slice(0, 120)}`);
    } else {
      check('en: totals labels are English', /CHECKOUT/.test(btn) && /SAR/.test(foot) && !AR.test(btn), `${btn} | ${foot.slice(0, 100)}`);
    }
    check(`${lang}: no page errors`, errs.length === 0, errs.join(';'));
    await ctx.close();
  }

  // walk-in customer in one key: F9, then Enter on the empty number
  {
    const { ctx, page } = await open(browser, 'ar');
    await addItems(page, ['pana']);
    await page.keyboard.press('F9'); await sleep(400);
    check('F9 opens payment directly (one step, no forced customer step)', await page.evaluate(() => document.getElementById('customerCheckoutGate').hidden && document.getElementById('checkoutModal').classList.contains('active')));
    const st = await page.evaluate(() => ({ gate: document.getElementById('customerCheckoutGate').hidden, pay: !document.getElementById('checkoutModal').classList.contains('hidden') && getComputedStyle(document.getElementById('checkoutModal')).display !== 'none' }));
    check('payment window keeps an optional add-customer button and no English leftovers', st.gate && st.pay && await page.evaluate(() => { const b = document.getElementById('checkoutAddCustomer'); const txt = document.querySelector('#checkoutModal .modal-card').innerText; return !!b && b.getBoundingClientRect().height > 0 && !/Total Amount Payable|Cancel \(Esc\)|\bExact\b/i.test(txt); }), JSON.stringify(st));
    await ctx.close();
  }

  // touch screen (tablet): every visible control on the sale screen is at least 44px
  {
    const { ctx, page } = await open(browser, 'ar', { hasTouch: true });
    check('touch emulation is coarse', await page.evaluate(() => matchMedia('(pointer:coarse)').matches));
    await addItems(page, ['pana', 'augm']);
    const small = await page.evaluate(() => {
      const vis = e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
      return [...document.querySelectorAll('.nova-tab,.nova-new-sale,.nova-hold-action,.nova-held-action,.nova-customer-action,.nova-more-action,.search-mode-tag,.nova-refresh-icon,.qty-btn,.qty-input,.btn-icon-del,#inputPercentDiscount,#inputFixedDiscount')].filter(vis)
        .map(e => ({ n: (e.id || e.className.toString().split(' ')[0]), w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) })).filter(x => x.h < 43.5 || (/customer-action|more-action|refresh|qty-btn|btn-icon-del/.test(x.n) && x.w < 43.5));
    });
    check('touch: tabs, invoice buttons and quantity controls are >= 44px', small.length === 0, JSON.stringify(small.slice(0, 5)));
    await page.keyboard.press('F9'); await sleep(500);
    const pay = await page.evaluate(() => [...document.querySelectorAll('.quick-cash-btn,#btnConfirmPayment,#btnCancelCheckout,#inputCashReceived')].filter(e => e.getBoundingClientRect().height > 0).map(e => Math.round(e.getBoundingClientRect().height)));
    check('touch: payment buttons and cash field are >= 44px', pay.length > 0 && pay.every(h => h >= 43.5), JSON.stringify(pay));
    await ctx.close();
  }

  // readable text: nothing functional below 12px on the sale screen and the pages
  {
    const { ctx, page } = await open(browser, 'ar');
    await addItems(page, ['pana']);
    const tiny = new Set();
    for (const pg of ['sale', 'invoices', 'products', 'customers', 'reports', 'settings']) {
      await page.click(`.nova-tab[data-page="${pg}"]`); await sleep(300);
      (await page.evaluate(() => { const o = [], vis = e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.top < innerHeight; };
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); while (w.nextNode()) { const n = w.currentNode, el = n.parentElement; if (!el || !n.nodeValue.trim() || !vis(el) || el.closest('script,style,.nova-data-table tbody,#novaLabelsPanel,#novaAiPanel,#receiptModal,#helpModal')) continue; const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 11.95) o.push(fs + 'px ' + n.nodeValue.trim().slice(0, 22)); } return o; })).forEach(x => tiny.add(x));
    }
    check('no visible functional text under 12px', tiny.size === 0, [...tiny].slice(0, 5).join(' | '));
    await ctx.close();
  }
} finally { await browser.close(); server.kill(); }
console.log(failures ? `FAILED: ${failures}` : 'ALL UX-BATCH3 CHECKS PASSED');
process.exit(failures ? 1 : 0);
