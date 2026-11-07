// UX batch 2: UX-SEARCH-EMPTY (translated), UX-DISCOUNT-NO-FEEDBACK, UX-PRODUCTS-FILTER-EMPTY, UX-AI-NO-RETRY.
// Run: CHROME_PATH=/path/to/chromium node tests/ux-batch2.mjs   (needs @playwright/test)
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const candidates = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
const executablePath = candidates.find(existsSync);
assert(executablePath, 'Set CHROME_PATH to an installed Chromium browser');
const PORT = 8770, URL_ = `http://127.0.0.1:${PORT}/index.html#sale`;
const server = spawn(process.execPath, ['scripts/dev-server.mjs', '--port', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (name, cond, detail = '') => { if (!cond) failures++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' -> ' + detail}`); };
const AR = /[؀-ۿ]/, LAT = /[A-Za-z]{3,}/;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

async function open(browser, lang, vp = { width: 1194, height: 834 }) {
  const ctx = await browser.newContext({ viewport: vp }); const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(l => { try { localStorage.setItem('nova-rx-language', l); } catch (e) {} }, lang);
  await page.goto(URL_, { waitUntil: 'domcontentloaded' }); await sleep(900);
  return { ctx, page, errs };
}
const text = (page, sel) => page.evaluate(s => (document.querySelector(s)?.innerText || '').replace(/\s+/g, ' ').trim(), sel);

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
try {
  for (const lang of ['ar', 'en']) {
    const { ctx, page, errs } = await open(browser, lang);

    // UX-SEARCH-EMPTY: both empty states are shown, in the UI language.
    await page.fill('#mainSearchInput', 'zzzqq'); await sleep(350);
    const custMsg = await text(page, '#suggestionsBox');
    check(`${lang}: customer search empty state shown`, custMsg.length > 5, custMsg);
    await page.fill('#mainSearchInput', ''); await page.keyboard.press('Enter'); await sleep(250);
    await page.fill('#mainSearchInput', 'zzzqq'); await sleep(350);
    const prodMsg = await text(page, '#suggestionsBox');
    check(`${lang}: product search empty state shown`, /zzzqq/.test(prodMsg), prodMsg);
    if (lang === 'ar') check('ar: search empty states are Arabic', AR.test(prodMsg) && !/found/i.test(prodMsg), prodMsg);
    else check('en: search empty states are English', !AR.test(prodMsg) && /No products found/.test(prodMsg), prodMsg);
    await page.fill('#mainSearchInput', 'pana'); await sleep(350); await page.keyboard.press('Enter'); await sleep(400);

    // UX-DISCOUNT-NO-FEEDBACK
    const hint = () => page.evaluate(() => { const h = document.getElementById('discountHint'); return h ? { hidden: h.hidden, text: h.innerText.trim() } : { hidden: true, text: '', missing: true }; });
    const inv = id => page.getAttribute('#' + id, 'aria-invalid');
    await page.fill('#inputPercentDiscount', '10'); await sleep(250);
    let h = await hint(); check(`${lang}: valid discount shows no warning`, !h.missing && h.hidden && (await inv('inputPercentDiscount')) === 'false', JSON.stringify(h));
    await page.fill('#inputPercentDiscount', '150'); await sleep(250); h = await hint();
    check(`${lang}: percent over 100 is explained`, !h.hidden && h.text.length > 5 && (await inv('inputPercentDiscount')) === 'true', JSON.stringify(h));
    if (lang === 'ar') check('ar: warning is Arabic', AR.test(h.text) && !LAT.test(h.text), h.text);
    await page.fill('#inputPercentDiscount', '-5'); await sleep(250); h = await hint();
    check(`${lang}: negative discount is explained`, !h.hidden && (await inv('inputPercentDiscount')) === 'true', JSON.stringify(h));
    await page.fill('#inputPercentDiscount', ''); await page.fill('#inputFixedDiscount', '99999'); await sleep(250); h = await hint();
    check(`${lang}: discount larger than the invoice is explained`, !h.hidden && (await inv('inputFixedDiscount')) === 'true', JSON.stringify(h));
    await page.fill('#inputFixedDiscount', ''); await sleep(250); h = await hint();
    check(`${lang}: warning clears when the value is fixed`, h.hidden && (await inv('inputFixedDiscount')) === 'false', JSON.stringify(h));

    // UX-PRODUCTS-FILTER-EMPTY (products, customers, invoices)
    for (const pg of ['products', 'customers', 'invoices']) {
      await page.click(`.nova-tab[data-page="${pg}"]`); await sleep(350);
      await page.fill('#novaFilter', 'zzzqq'); await sleep(300);
      const e = await text(page, '#novaPageView .nova-empty');
      check(`${lang}: ${pg} filter with no match shows a message`, e.length > 3 && (lang === 'ar' ? AR.test(e) : /No matching results/.test(e)), e);
      await page.fill('#novaFilter', ''); await sleep(300);
      check(`${lang}: ${pg} message disappears when the filter is cleared`, (await page.locator('#novaPageView .nova-empty').count()) === 0);
    }
    check(`${lang}: no page errors`, errs.length === 0, errs.join(';'));
    await ctx.close();
  }

  // UX-AI-NO-RETRY: failed purchase-invoice reading offers a retry that really calls the server again.
  {
    const { ctx, page, errs } = await open(browser, 'ar'); let calls = 0;
    await page.route('**/api/ai/purchase', r => { calls++; r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'خطأ تجريبي' }) }); });
    await page.click('.nova-tab[data-page="products"]'); await sleep(350);
    await page.click('#novaInventoryPurchase'); await sleep(300);
    await page.setInputFiles('#novaAiFiles', { name: 'inv.png', mimeType: 'image/png', buffer: PNG });
    await page.click('#novaAiRun'); await sleep(600);
    check('ai: failure is reported', /تعذر التحليل/.test(await text(page, '#novaAiStatus')), await text(page, '#novaAiStatus'));
    check('ai: button becomes «إعادة المحاولة»', (await text(page, '#novaAiRun')) === 'إعادة المحاولة', await text(page, '#novaAiRun'));
    await page.click('#novaAiRun'); await sleep(600);
    check('ai: retry calls the server again', calls === 2, `calls=${calls}`);
    check('ai: no page errors', errs.length === 0, errs.join(';'));
    await ctx.close();
  }
} finally { await browser.close(); server.kill(); }
console.log(failures ? `FAILED: ${failures}` : 'ALL UX-BATCH2 CHECKS PASSED');
process.exit(failures ? 1 : 0);
