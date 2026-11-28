// Batch 1 behavioral verification: shift double-close guard, autoPrint non-blocking,
// #products live refresh + close button clearance, #customers credit sync + profit report,
// embed=receiving + mouse autocomplete pick, and #settings form overlap checks.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs, { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p0 = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = (p0 === '/' ? 'index.html' : p0.replace(/^\/+/, ''));
  const f = path.resolve(ROOT, rel);
  if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end('nf'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });

async function newCtx(vp) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block' });
  await ctx.route('**/*', r => {
    const q = r.request(), u = q.url();
    if (u.includes('/emergency/stock.json')) return r.fulfill({ status: 200, contentType: 'application/json', body: snapshot });
    if (!['GET', 'HEAD'].includes(q.method())) return r.abort();
    return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort();
  });
  await ctx.addInitScript(() => {
    window.NOVA_STOCK_PROBE = true;
    try {
      if (!sessionStorage.getItem('__b1seed')) {
        localStorage.clear();
        sessionStorage.setItem('__b1seed', '1');
        localStorage.setItem('nova-rx-onboarding-done', '1');
      }
      localStorage.setItem('nova-rx-language', 'ar');
      localStorage.removeItem('nova.activePage');
    } catch {}
    window.__prints = 0;
    window.print = () => { window.__prints++; };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  return { ctx, page, errors };
}

try {
  // 1-3 & 5: Core POS, Credit sync, Profit, Products receive, Shift double-close, Settings overlap
  {
    const { ctx, page, errors } = await newCtx({ width: 1280, height: 800 });
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('#mainSearchInput', { timeout: 15000 });
    await page.locator('#novaSplash').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE' && window.novaSales && window.NovaCredit, null, { timeout: 12000 });

    // A) Credit sale with new customer + autoPrint active (must NOT freeze #sale) + immediate #customers sync + profit report
    const item = await page.evaluate(() => window.NOVA_DEMO.products.find(p => p && p.barcode && Number(p.price) > 0));
    assert.ok(item, 'STOCK LIVE item exists');
    await page.locator('#mainSearchInput').fill(item.barcode);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#invoiceTableBody tr');
    await page.locator('#btnCheckout').click();
    await page.locator('#checkoutModal.active').waitFor({ timeout: 5000 });
    await page.locator('#checkoutAddCustomer').click();
    await page.locator('#customerCheckoutGate').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#gatePhone').fill('01012345678');
    await page.locator('#gateFindCustomer').click();
    await page.locator('#gateNewCustomerFields').waitFor({ state: 'visible', timeout: 3000 });
    await page.locator('#gateCustomerName').fill('عميل آجل اختباري');
    await page.locator('#gateFindCustomer').click();
    await page.locator('#checkoutModal.active').waitFor({ timeout: 5000 });
    await page.locator('.pay-method-btn[data-method="credit"]').click();
    await page.locator('#btnConfirmPayment').click();
    await page.waitForFunction(() => window.novaSales.list().length === 1, null, { timeout: 5000 });
    await page.waitForTimeout(120);
    assert.equal(await page.evaluate(() => window.__prints), 1, 'autoPrint fired without blocking');
    await page.locator('#mainSearchInput').fill('ok');
    assert.equal(await page.locator('#mainSearchInput').inputValue(), 'ok', '#sale stays responsive after credit sale');
    await page.locator('#mainSearchInput').fill('');

    await page.locator('.nova-tab[data-page="customers"]').click();
    await page.waitForSelector('#novaDebtTotal');
    const debtTxt = await page.locator('#novaDebtTotal').innerText();
    const debtorsTxt = await page.locator('#novaDebtorCount').innerText();
    assert.ok(parseFloat(debtTxt.replace(/[^\d.]/g, '')) > 0, 'total debt updated immediately: ' + debtTxt);
    assert.ok(Number(debtorsTxt.trim()) >= 1, 'debtors count updated immediately: ' + debtorsTxt);
    const custRowDebt = await page.locator('tr[data-cust-row] td[data-debt]').first().innerText();
    assert.ok(parseFloat(custRowDebt.replace(/[^\d.]/g, '')) > 0, 'customer row debt updated immediately: ' + custRowDebt);

    // Profit report check
    await page.locator('.nova-tab[data-page="reports"]').click();
    await page.evaluate(() => window.novaLazy && window.novaLazy.load());
    await page.waitForSelector('#novaProfitSlow', { timeout: 8000 });
    const psText = await page.locator('#novaProfitSlow').innerText();
    assert.ok(!/لا توجد مبيعات في الفترة/.test(psText), 'profit report sees the saved sale');

    // B) #products live refresh after receive + close X clearance
    await page.locator('.nova-tab[data-page="products"]').click();
    await page.waitForSelector('#novaManualReceive');
    await page.locator('#novaFilter').fill(item.barcode);
    await page.waitForTimeout(150);
    const beforeStock = await page.locator('#novaRows tr').first().locator('td.pc-stock').innerText();
    assert.equal(beforeStock.trim(), '—', 'initial STOCK LIVE stock is —');

    await page.locator('#novaManualReceive').click();
    await page.waitForSelector('#novaManualRecv');
    const padCheck = await page.locator('#novaManualRecv').evaluate(ov => {
      const h2 = ov.querySelector('h2'), x = ov.querySelector('.nova-dlg-x');
      const pad = parseFloat(getComputedStyle(h2).paddingInlineStart);
      const hr = h2.getBoundingClientRect(), xr = x.getBoundingClientRect();
      return { pad, clearRtl: xr.left >= hr.right - pad - 2 };
    });
    assert.ok(padCheck.pad >= 44 && padCheck.clearRtl, 'close button cleared from h2: ' + JSON.stringify(padCheck));

    await page.locator('#novaRcvSearch').fill(item.barcode);
    await page.waitForSelector('#novaRcvList [data-rcv-pick="0"]');
    await page.locator('#novaRcvList [data-rcv-pick="0"]').click();
    await page.locator('#novaRcvQty').fill('5');
    await page.locator('#novaRcvLot').fill('LOT-B1');
    await page.locator('#novaRcvExp').fill('2027-12');
    await page.locator('#novaRcvOk').click();
    await page.waitForSelector('#novaManualRecv', { state: 'detached' });
    const afterStock = await page.locator('#novaRows tr').first().locator('td.pc-stock').innerText();
    const afterExp = await page.locator('#novaRows tr').first().locator('td.pc-exp').innerText();
    assert.match(afterStock, /4/, 'products row stock live-refreshed (5 received - 1 sold): ' + afterStock);
    assert.match(afterExp, /2027-12-31/, 'products row expiry live-refreshed: ' + afterExp);

    // C) Shift double-close guard
    await page.locator('.nova-tab[data-page="shift"]').click();
    await page.waitForSelector('#novaShiftClose');
    assert.equal(await page.locator('#novaShiftDo').isDisabled(), false, 'initial shift close enabled');
    const expAmt = await page.locator('#novaShiftExpected').getAttribute('data-amount');
    await page.locator('#novaShiftCount').fill(expAmt);
    await page.locator('#novaShiftDo').click();
    await page.waitForSelector('#novaShiftSummary');
    assert.equal(await page.locator('#novaShiftDo').isDisabled(), true, 'close button disabled after first close');
    await page.locator('#novaShiftCount').fill('10');
    await page.locator('#novaShiftCount').press('Enter');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('nova-rx-shift-closings-v1') || '[]').length), 1, 'Enter blocked from double close');

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.nova-tab[data-page="shift"]');
    await page.locator('.nova-tab[data-page="shift"]').click();
    await page.waitForSelector('#novaShiftDo');
    assert.equal(await page.locator('#novaShiftDo').isDisabled(), true, 'close button stays disabled after reload');

    await page.locator('#novaShiftOpenBtn').click();
    await page.locator('[role=dialog][aria-modal=true]').last().locator('input[type=number]').fill('100');
    await page.locator('[role=dialog][aria-modal=true]').last().locator('button[type=submit]').click();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#novaShiftDo').isDisabled(), false, 'opening new shift re-enables close button');

    // D) Settings cards overlap check (desktop 1280x800 & mobile 428x926)
    await page.locator('.nova-tab[data-page="settings"]').click();
    await page.evaluate(() => window.novaLazy && window.novaLazy.load());
    await page.waitForSelector('#novaSaleSettingsCard', { timeout: 8000 });
    await page.waitForSelector('#novaOffersCard', { timeout: 8000 });
    for (const vp of [{ width: 1280, height: 800 }, { width: 428, height: 926 }]) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(150);
      const overlaps = await page.evaluate(() => {
        const bad = [];
        for (const cid of ['novaSaleSettingsCard', 'novaOffersCard']) {
          const card = document.getElementById(cid);
          if (!card) { bad.push('missing:' + cid); continue; }
          const cr = card.getBoundingClientRect();
          const els = [...card.querySelectorAll('label, .form-control, button')].filter(el => el.offsetParent !== null);
          for (let i = 0; i < els.length; i++) {
            const a = els[i].getBoundingClientRect();
            if (a.right > cr.right + 2 || a.left < cr.left - 2) bad.push(`${cid}:overflow:${els[i].tagName}:${els[i].id}`);
            for (let j = i + 1; j < els.length; j++) {
              const b = els[j].getBoundingClientRect();
              if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
              const inter = !(a.bottom <= b.top + 1 || b.bottom <= a.top + 1 || a.right <= b.left + 1 || b.right <= a.left + 1);
              if (inter) bad.push(`${cid}:overlap:${els[i].id || els[i].tagName}-${els[j].id || els[j].tagName}`);
            }
          }
        }
        return bad;
      });
      assert.deepEqual(overlaps, [], 'settings cards clean at ' + vp.width + ': ' + overlaps.join(', '));
    }

    assert.deepEqual(errors, [], 'no page errors in core checks');
    await ctx.close();
  }

  // 4: embed=receiving + mouse-click autocomplete pick
  {
    const { ctx, page, errors } = await newCtx({ width: 1280, height: 800 });
    await page.goto(BASE + '?embed=receiving#receiving', { waitUntil: 'load' });
    await page.waitForSelector('[data-rcv="new"]', { timeout: 12000 });
    await page.locator('[data-rcv="new"]').click();
    await page.waitForSelector('#rcvForm [data-f="q"]');
    const qInput = page.locator('#rcvForm [data-f="q"]').first();
    await qInput.fill('بوسكوبان');
    const opt = page.locator('#rcvForm .rcv-sug [data-pick="0"]').first();
    await opt.waitFor({ state: 'visible', timeout: 5000 });
    await opt.click();
    assert.equal(await qInput.getAttribute('data-ok'), '1', 'mouse click selected drug in receiving');
    assert.deepEqual(errors, [], 'no page errors in embed=receiving');
    await ctx.close();
  }

  console.log('batch1-fixes PASS');
} finally {
  await browser.close();
  server.close();
}
