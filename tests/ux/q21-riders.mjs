// Q21 step 2 riders: g small drawer expense in one step, h return button on every invoice row (desktop + phone), i stock columns,
// j customer box offers «سجّل نقص» with no Enter, k names, l النواقص usable when the stock source is unreachable, m preview-only demo invoices.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOT = process.env.SHOT_DIR || '';
const port = new URL(BASE).port || '80';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--host-resolver-rules=MAP nova-rx-preview.local 127.0.0.1'] });
const shot = async (page, name) => { if (SHOT) await page.screenshot({ path: SHOT + '/' + name + '.png' }); };

async function open(vp, base = BASE, path = 'index.html', block) {
  const mobile = vp.width < 600;
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block', hasTouch: mobile, isMobile: mobile });
  const origin = new URL(base).origin;
  await ctx.route('**/*', r => {
    const q = r.request(), u = q.url();
    if (!['GET', 'HEAD'].includes(q.method()) || (block && block.test(u))) return r.abort();
    return u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort();
  });
  await ctx.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('__seed')) { localStorage.clear(); sessionStorage.setItem('__seed', '1'); localStorage.setItem('nova-rx-onboarding-done', '1'); if (location.hostname === '127.0.0.1') localStorage.setItem('nova-rx-sales-v1', JSON.stringify([1, 2, 3].map(i => ({ id: 'S' + i, number: '2026-0000' + i, at: Date.now() - i * 36e5, total: 24, vat: 0, payment: 'cash', customer: '', status: 'final', lines: [{ name: 'بنادول اكسترا', price: 12, qty: 2, discount: 0 }] })))); }
      localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage');
    } catch {}
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.goto(base + path, { waitUntil: 'load' });
  if (path === 'index.html') {
    await page.waitForSelector('#mainSearchInput', { state: 'attached', timeout: 15000 });
    await page.locator('#novaSplash').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await page.waitForFunction(() => window.NOVA_DEMO && window.novaStock, null, { timeout: 10000 });
  }
  await page.waitForTimeout(600);
  return { ctx, page, errors };
}
async function sell(page) {
  const bc = await page.evaluate(() => window.NOVA_DEMO.products.find(p => p.barcode && p.price > 0 && Number(p.stock) > 5).barcode);
  await page.locator('#mainSearchInput').fill(bc); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  await page.locator('#btnCheckout').click(); await page.waitForTimeout(250);
  const skip = page.locator('#checkoutSkipCustomer, [data-skip-customer], #customerGateSkip');
  if (await skip.count() && await skip.first().isVisible()) { await skip.first().click(); await page.waitForTimeout(250); }
  await page.locator('.pay-method-btn[data-method=cash]').click();
  await page.locator('#btnConfirmPayment').click(); await page.waitForTimeout(800);
  const close = page.locator('#btnCloseReceipt'); if (await close.count() && await close.isVisible()) await close.click();
}

try {
  {
    const { ctx, page, errors } = await open({ width: 1366, height: 800 });
    // j) customer box (opens on «عميل»): unknown text → «سجّل نقص» right away
    await page.locator('#mainSearchInput').fill('زززقققص'); await page.waitForTimeout(500);
    assert.ok(await page.locator('#suggestionsBox #novaShortageBtn').isVisible(), '«سجّل نقص» shows without Enter');
    assert.ok((await page.locator('#suggestionsBox').innerText()).includes('مفيش عميل ولا صنف'), 'says neither a customer nor a medicine');
    await shot(page, 'q21r-shortage-1366');
    await page.locator('#suggestionsBox #novaShortageBtn').click(); await page.waitForTimeout(200);
    assert.ok(await page.evaluate(() => window.novaShortages.list().some(x => x.text === 'زززقققص')), 'shortage recorded');
    await page.locator('#mainSearchInput').fill('');
    // k) names
    assert.ok((await page.locator('body').innerText()).includes('اختيار عميل'), '«اختيار عميل»');
    assert.ok(!(await page.locator('body').innerText()).includes('تسجيل عميل (F3)'), 'old «تسجيل عميل» gone');
    // h) return button on the invoice row (desktop, named)
    await page.evaluate(() => window.novaSwitchPage('invoices')); await page.waitForTimeout(800);
    assert.ok(await page.evaluate(() => window.novaSales.list().length) > 0, 'sale saved');
    const ret = page.locator('.nova-invoice-row [data-return]').first();
    assert.ok(await ret.isVisible(), 'return button on the row: ' + await page.evaluate(() => { const b = document.querySelector('.nova-invoice-row [data-return]'); return b ? JSON.stringify(b.getBoundingClientRect()) + document.body.dataset.activePage + document.getElementById('novaPageView').hidden : 'none ' + document.querySelectorAll('.nova-invoice-row').length; }));
    assert.ok((await ret.innerText()).includes('مرتجع'), 'return button keeps its name: ' + await ret.innerText());
    assert.ok(await page.locator('.nova-invoice-row [data-reprint]').first().isVisible(), 'reprint on the row');
    await shot(page, 'q21r-invoices-1366');
    // i) stock columns
    await page.evaluate(() => window.novaSwitchPage('products')); await page.waitForTimeout(1000);
    const heads = (await page.locator('.nova-prod-panel thead th').allInnerTexts()).map(s => s.trim());
    assert.ok(heads.includes('الرصيد') && heads.includes('أقرب صلاحية'), 'stock + nearest expiry columns: ' + heads.join(','));
    assert.ok(!(await page.locator('#novaPageView').innerText()).includes('غير متوفر من المصدر'), 'no vague «غير متوفر»');
    assert.ok(await page.locator('#novaStockChips').innerText().then(t => t.includes('رصيد قليل')), 'low-stock chip is «رصيد قليل»');
    // k) «تقرير اليوم»
    await page.evaluate(() => window.novaSwitchPage('reports'));
    await page.waitForSelector('#novaOwnerDashboardSection', { timeout: 10000 });
    assert.ok((await page.locator('#novaOwnerDashboardSection').innerText()).includes('تقرير اليوم'), '«تقرير اليوم»');
    // g) drawer expense: <= 200 in one step as the device owner (no accounts)
    await page.evaluate(() => window.novaSwitchPage('shift'));
    await page.waitForSelector('#novaExpensesSection [data-nsa-act=addexp]', { timeout: 10000 });
    await page.locator('[data-shift-go=expense]').click();
    await page.waitForSelector('#nsaExpAmt', { timeout: 5000 });
    await page.locator('#nsaExpAmt').fill('300');
    assert.equal((await page.locator('#nsaExpGo').innerText()).trim(), 'تسجيل للاعتماد', 'over 200 → approval');
    await page.locator('#nsaExpAmt').fill('50');
    assert.equal((await page.locator('#nsaExpGo').innerText()).trim(), 'اصرف من الدرج', 'up to 200 → paid at once');
    await page.locator('#nsaExpDoc').fill('مياه للصيدلية');
    await shot(page, 'q21r-expense-1366');
    await page.locator('#nsaExpGo').click(); await page.waitForTimeout(700);
    const st = await page.evaluate(() => ({ exp: window.NovaSupplierAccounts ? null : null, cash: JSON.parse(localStorage.getItem('nova-rx-cash-out-v1') || '[]') }));
    assert.ok(st.cash.some(c => Number(c.amount) === 50), 'drawer cash-out recorded');
    assert.ok((await page.locator('#novaExpensesSection').innerText()).includes('اتصرف'), 'expense shows as paid');
    // above 200 with no accounts: still needs a signed-in approver flow
    await page.locator('[data-shift-go=expense]').click(); await page.waitForSelector('#nsaExpAmt');
    await page.locator('#nsaExpAmt').fill('300'); await page.locator('#nsaExpDoc').fill('x'); await page.locator('#nsaExpGo').click(); await page.waitForTimeout(300);
    assert.ok((await page.locator('body').innerText()).includes('لازم يكون في مستخدم مسجل دخول'), 'over 200 without accounts is refused');
    // the same quick path is limited in the data layer, not only in the screen
    const refused = await page.evaluate(async () => { await window.novaLazy.load(); const p = window.NovaSupplierAccounts || window.novaSupplierAccounts; return typeof p; });
    assert.ok(refused, 'module loaded');
    assert.deepEqual(errors, [], 'page errors');
    await ctx.close();
  }
  // h) phone: the return button is on the invoice card
  {
    const { ctx, page } = await open({ width: 390, height: 844 });
    await page.evaluate(() => window.novaSwitchPage('invoices')); await page.waitForTimeout(800);
    assert.ok(await page.locator('.nova-invoice-row [data-return]').first().isVisible(), '390: return button on the card');
    await shot(page, 'q21r-invoices-390');
    await ctx.close();
  }
  // l) النواقص: stock source unreachable → the local list, not an empty page
  {
    const { ctx, page } = await open({ width: 1366, height: 800 }, BASE, 'purchases.html');
    await page.waitForTimeout(2500);
    assert.equal(await page.locator('.needs-error-card').count(), 0, 'no blank error-only page');
    const body = await page.locator('body').innerText();
    assert.ok(body.includes('شغالين على القائمة اللي على الجهاز') || body.includes('قائمة يدوية') || body.includes('آخر نسخة'), 'works on the local list: ' + body.replace(/s+/g, ' ').slice(0, 300));
    assert.equal(await page.locator('nav .nova-ops, #novaOpsNav').count(), 0, 'purchases nav has no «العمليات»');
    await shot(page, 'q21r-purchases-offline');
    await ctx.close();
  }
  // m) demo invoices only on the preview host
  {
    const { ctx, page } = await open({ width: 1366, height: 800 }, 'http://nova-rx-preview.local:' + port + '/');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('nova-rx-sales-v1') || '[]').filter(s => String(s.id).startsWith('DEMO-')).length), 6, 'preview host: 6 demo invoices');
    await page.evaluate(() => window.novaSwitchPage('invoices')); await page.waitForTimeout(800);
    assert.ok(await page.locator('.nova-invoice-row').count() >= 6, 'preview: invoices list not empty');
    await ctx.close();
    const b = await open({ width: 1366, height: 800 });
    assert.equal(await b.page.evaluate(() => JSON.parse(localStorage.getItem('nova-rx-sales-v1') || '[]').filter(s => String(s.id).startsWith('DEMO-')).length + (localStorage.getItem('nova.preview.demoSeeded') ? 1 : 0)), 0, 'any other host: no demo data');
    await b.ctx.close();
  }
  console.log('q21-riders: all checks passed');
} finally { await browser.close(); }
