// UI-BATCH1 (queue 15): look/bug fixes only, the cashier flow is unchanged.
// 1 pay button/dialog never covered (bottom nav, toast, handover-notes pill)  2 dominant pay button, big totals, payment order
// 3 language/RTL leaks  4 one held-invoices UI on desktop  5 one stock number + readable invoice refs  6 receiving header reachable
// (7 reports tabs: replaced by Q21 step 2, see q21-simplify.mjs.)  q16: toasts never cover an open dialog's title/amount/buttons.   SHOT_DIR=<dir> also saves after-screenshots.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const SHOT = process.env.SHOT_DIR || '';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const hit = (a, b) => !!a && !!b && !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
const box = (page, sel) => page.locator(sel).first().boundingBox();
const shot = async (page, name) => { if (SHOT) await page.screenshot({ path: SHOT + '/' + name + '.png' }); };

async function open(vp, lang = 'ar', init, block) {
  const mobile = vp.width < 600;
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', serviceWorkers: 'block', hasTouch: mobile, isMobile: mobile });
  await ctx.route('**/*', r => {
    const q = r.request(), u = q.url();
    if (u.includes('/emergency/stock.json')) return r.fulfill({ status: 200, contentType: 'application/json', body: snapshot });
    if (!['GET', 'HEAD'].includes(q.method()) || (block && block.test(u))) return r.abort();
    return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort();
  });
  await ctx.addInitScript(([lang]) => {
    try {
      if (!sessionStorage.getItem('__seed')) { localStorage.clear(); sessionStorage.setItem('__seed', '1'); localStorage.setItem('nova.flags.inbox', '1'); localStorage.setItem('nova-rx-onboarding-done', '1'); }
      localStorage.setItem('nova-rx-language', lang); localStorage.removeItem('nova.activePage');
    } catch {}
  }, [lang]);
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  page.on('dialog', d => d.accept().catch(() => {}));
  await page.goto(BASE + 'index.html', { waitUntil: 'load' });
  await page.waitForSelector('#mainSearchInput', { timeout: 15000 });
  await page.locator('#novaSplash').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => window.NOVA_DEMO && window.novaStock && window.NovaFmt, null, { timeout: 10000 });
  await page.waitForTimeout(500);
  return { ctx, page, errors };
}
async function addByBarcode(page, quantities) {
  const items = await page.evaluate(n => window.NOVA_DEMO.products.filter(p => p && p.barcode && p.price > 0 && Number(p.stock) > 5).slice(0, n).map(p => ({ barcode: p.barcode, name: p.name, stock: p.stock })), quantities.length);
  for (let i = 0; i < items.length; i++) for (let k = 0; k < quantities[i]; k++) {
    await page.locator('#mainSearchInput').fill(items[i].barcode); await page.keyboard.press('Enter'); await page.waitForTimeout(120);
  }
  return items;
}
async function openCheckout(page) {
  await page.locator('#btnCheckout').click(); await page.waitForTimeout(250);
  const skip = page.locator('#checkoutSkipCustomer, [data-skip-customer], #customerGateSkip');
  if (await skip.count() && await skip.first().isVisible()) { await skip.first().click(); await page.waitForTimeout(250); }
  await page.waitForFunction(() => document.getElementById('checkoutModal').classList.contains('active'), null, { timeout: 3000 });
}
async function sell(page) {
  const [it] = await addByBarcode(page, [1]);
  await openCheckout(page); await page.locator('.pay-method-btn[data-method=cash]').click();
  await page.locator('#btnConfirmPayment').click(); await page.waitForTimeout(600);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  return it;
}
const tab = async (page, name) => { await page.evaluate(n => { const t = document.querySelector('.nova-tab[data-page="' + n + '"]'); if (t) t.click(); else if (window.novaSwitchPage) window.novaSwitchPage(n); }, name); await page.waitForTimeout(700); };
// the toast is not the element painted at the centre / both ends of each protected dialog element
const underToast = (page, sels) => page.evaluate(ss => ss.filter(s => { const el = document.querySelector(s); if (!el) return false; const r = el.getBoundingClientRect(); return [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 4, r.top + r.height / 2], [r.right - 4, r.top + r.height / 2]].some(([x, y]) => { const t = document.elementFromPoint(x, y); return !!(t && t.closest('#toastContainer')); }); }), sels);
const DLG = ['#checkoutTitle', '#modalAmountDue', '#inputCashReceived', '#displayChangeDue', '#btnConfirmPayment', '#btnCancelCheckout'];
const covered = (page, sel) => page.evaluate(s => { const el = document.querySelector(s); const r = el.getBoundingClientRect(); const pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 6, r.bottom - 4], [r.right - 6, r.bottom - 4]]; return pts.filter(([x, y]) => { const t = document.elementFromPoint(x, y); return !(t && (t === el || el.contains(t))); }).length; }, sel);

try {
  // ---------- 1 + 2 + 3: sale screen, phone ----------
  {
    const { ctx, page, errors } = await open({ width: 390, height: 844 });
    await addByBarcode(page, [2, 1, 1]);
    await page.waitForSelector('#toastContainer .toast');
    const t = await box(page, '#toastContainer .toast');
    for (const s of ['#btnCheckout', '#novaBottomNav', '.invoice-footer']) assert.ok(!hit(t, await box(page, s)), `390: toast covers ${s}`);
    const pill = page.locator('#novaShiftNotesBadge');
    await pill.waitFor({ state: 'attached', timeout: 4000 });
    assert.equal(await pill.evaluate(el => !!el.closest('#novaSaleMoreMenu') && getComputedStyle(el).position), 'static', '390: notes pill docked in the «…» menu');
    assert.match(await pill.textContent(), /\(\d+\)/, 'pill keeps its count');
    assert.ok((await box(page, '.top-header')).height <= 150, '390: sale header stays two rows: ' + (await box(page, '.top-header')).height);
    await page.locator('#btnSaleMore').click(); await page.waitForTimeout(150);
    assert.equal(await pill.isVisible(), true, '390: notes reachable from «…»');
    const pb = await pill.boundingBox();
    assert.ok(!hit(pb, await box(page, '#btnCheckout')), '390: pill over the pay bar');
    await page.locator('#btnSaleMore').click(); await page.waitForTimeout(150);
    assert.equal(await page.locator('#totalItemsCount').innerText(), '3 أصناف', '390: «(N صنف)» counts lines with the receipt wording');
    const gt = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('displayGrandTotal')).fontSize));
    assert.ok(gt >= 28, `390: grand total ${gt}px >= 28`);
    await shot(page, '01-sale-3items-390-after');
    await openCheckout(page);
    await page.evaluate(() => document.querySelector('#toastContainer').replaceChildren());
    assert.equal(await covered(page, '#btnConfirmPayment'), 0, '390: «تأكيد البيع» covered (bottom nav / pill)');
    assert.equal(await covered(page, '#btnCancelCheckout'), 0, '390: cancel covered');
    const y = async s => (await box(page, s)).y;
    const yM = await y('.pay-methods-grid'), yA = await y('#inputCashReceived'), yC = await y('#displayChangeDue'), yK = await y('#checkoutAddCustomer');
    assert.ok(yM < yA && yA < yC && yC < yK, `390: payment order method ${yM} < amount ${yA} < change ${yC} < customer ${yK}`);
    if (await page.locator('#novaCouponBox').count()) assert.ok(await y('#novaCouponBox') > yC, 'coupon after the change');
    const ch = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('displayChangeDue')).fontSize));
    assert.ok(ch >= 32, `390: «الباقي» ${ch}px >= 32`);
    // an error toast raised inside the dialog is visible and does not cover its buttons
    await page.evaluate(() => document.getElementById('toastContainer').insertAdjacentHTML('beforeend', '<div class="toast" role="status">المبلغ المستلم أقل من الإجمالي</div>')); // same container/position as showToast
    await page.waitForSelector('#toastContainer .toast');
    const t2 = await box(page, '#toastContainer .toast');
    for (const s of DLG) assert.ok(!hit(t2, await box(page, s)), `390: dialog toast covers ${s}`);
    assert.deepEqual(await underToast(page, DLG), [], '390: elementFromPoint finds the toast on the dialog title/amount/buttons');
    assert.ok(await page.evaluate(() => { const t = document.querySelector('#toastContainer .toast').getBoundingClientRect(); return t.top >= 0 && t.bottom <= innerHeight && document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2).closest('.toast'); }), '390: the dialog toast itself is on screen and visible');
    // with the amount field focused (the cashier is typing) the toast still avoids it
    await page.evaluate(() => document.getElementById('toastContainer').replaceChildren()); await page.locator('#inputCashReceived').focus();
    await page.evaluate(() => document.getElementById('toastContainer').insertAdjacentHTML('beforeend', '<div class="toast" role="alert">تنبيه طويل شوية عشان نتأكد إن مكانه مش فوق خانة المبلغ ولا العنوان</div>')); await page.waitForTimeout(50);
    assert.deepEqual(await underToast(page, DLG), [], '390: toast covers the dialog while typing the amount');
    await page.evaluate(() => document.getElementById('toastContainer').replaceChildren()); await page.evaluate(() => document.getElementById('toastContainer').insertAdjacentHTML('beforeend', '<div class="toast" role="status">المبلغ المستلم أقل من الإجمالي</div>')); await page.waitForTimeout(50);
    await shot(page, '02-payment-390-after');
    assert.deepEqual(errors, [], '390 page errors');
    await ctx.close();
  }
  // ---------- 2 + 4: desktop sale, dominant pay button, one held UI ----------
  {
    const { ctx, page, errors } = await open({ width: 1366, height: 768 });
    await addByBarcode(page, [2, 1, 1]);
    const st = await page.evaluate(() => { const f = el => { const c = getComputedStyle(el); return { fs: parseFloat(c.fontSize), bg: c.backgroundColor }; }; return { pay: f(document.getElementById('btnCheckout')), add: f(document.getElementById('btnAddLoyalty')), gt: parseFloat(getComputedStyle(document.getElementById('displayGrandTotal')).fontSize) }; });
    const lum = rgb => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    assert.ok(st.pay.fs >= 20 && st.pay.fs > st.add.fs, `1366: pay button font ${st.pay.fs} > register-customer ${st.add.fs}`);
    assert.ok(lum(st.pay.bg) > lum(st.add.bg), `1366: pay button brighter (${st.pay.bg}) than register-customer (${st.add.bg})`);
    assert.ok(st.gt >= 28, `1366: grand total ${st.gt}px`);
    assert.equal(await page.locator('#novaShiftNotesBadge').evaluate(el => !!el.closest('.nova-sale-actions')), true, '1366: pill in the header');
    await shot(page, '01-sale-3items-1366-after');
    await openCheckout(page);
    assert.equal(await covered(page, '#btnConfirmPayment'), 0, '1366: confirm covered');
    await page.evaluate(() => document.getElementById('toastContainer').insertAdjacentHTML('beforeend', '<div class="toast" role="status">المبلغ المستلم أقل من الإجمالي</div>'));
    await page.waitForTimeout(50);
    assert.deepEqual(await underToast(page, DLG), [], '1366: dialog toast covers the title/amount/buttons');
    await page.evaluate(() => document.getElementById('toastContainer').replaceChildren()); await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => document.getElementById('toastContainer').style.top), '', 'placement is cleared once the toast is gone');
    await shot(page, '02-payment-1366-after');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    // hold two invoices -> the rail lists both with «رجّعها» + «حذف»; the held button opens no second popup
    await page.locator('#holdCurrentInvoice').click(); await page.waitForTimeout(250);
    await addByBarcode(page, [1]); await page.locator('#holdCurrentInvoice').click(); await page.waitForTimeout(300);
    assert.equal(await page.locator('.nova-rail-held .nova-rail-row').count(), 2, 'rail lists every held invoice');
    assert.equal(await page.locator('.nova-rail-held [data-rail-delete]').count(), 2, 'rail rows have a delete');
    await page.locator('#btnHeldInvoices').click(); await page.waitForTimeout(250);
    assert.equal(await page.locator('#heldInvoicePanel').isHidden(), true, 'desktop: no duplicate held popup');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-rail-resume')), true, 'held button focuses the rail list');
    assert.doesNotMatch(await page.locator('.nova-rail-held').innerText(), /Resume|Delete|items|[٠-٩]/, 'rail: Arabic only, Latin digits');
    await shot(page, '04-held-1366-after');
    await page.locator('.nova-rail-held [data-rail-delete]').first().click(); await page.waitForTimeout(300);
    assert.equal(await page.locator('.nova-rail-held .nova-rail-row').count(), 1, 'rail delete removes one');
    assert.deepEqual(errors, [], '1366 page errors');
    await ctx.close();
  }
  // ---------- 3 + 4: phone held popup in Arabic, one digit style ----------
  {
    const { ctx, page } = await open({ width: 390, height: 844 });
    await addByBarcode(page, [2, 1]); await page.locator('#holdCurrentInvoice').click(); await page.waitForTimeout(250);
    await page.locator('#btnHeldInvoices').click(); await page.waitForTimeout(250);
    assert.equal(await page.locator('#heldInvoicePanel').isHidden(), false, 'phone: held popup is the held UI');
    const txt = await page.locator('#heldInvoiceList').innerText();
    assert.doesNotMatch(txt, /Resume|Delete|items|[٠-٩]/, 'held popup: no English words, no Arabic-Indic digits: ' + txt);
    assert.match(txt, /استرجاع/); assert.match(txt, /صنفان/);   // Q21-2k: «رجّعها» → «استرجاع»
    await shot(page, '03-held-390-after');
    await ctx.close();
  }
  // ---------- 3: customer file title/× and buttons; English «Chats» ----------
  for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    const { ctx, page } = await open(vp);
    await tab(page, 'customers');
    await page.locator('tr[data-cust-row] td').first().click(); await page.locator('#novaCustDetail').waitFor();
    const r = await page.evaluate(() => {
      const h = document.getElementById('novaCustDetailT'), x = document.querySelector('#novaCustDetail .nova-dlg-x'), b = h.querySelectorAll('bdi');
      const R = el => el.getBoundingClientRect(), xr = R(x), over = [...b].some(e => { const q = R(e); return !(q.right <= xr.left || xr.right <= q.left || q.bottom <= xr.top || xr.bottom <= q.top); });
      const btns = [...document.querySelectorAll('#novaCustDetail [data-cd-wa], #novaCustDetail [data-cd-refill]')].map(e => getComputedStyle(e).backgroundColor);
      return { bdi: b.length, latinOwnLine: b.length === 2 && b[1].dir === 'ltr' && getComputedStyle(b[1].parentElement).display === 'block' && b[1].getBoundingClientRect().right > b[0].getBoundingClientRect().left, over, btns };
    });
    assert.ok(r.bdi >= 1 && !r.over, `${vp.width}: × overlaps the customer name`);
    assert.ok(r.latinOwnLine, `${vp.width}: Latin name on its own isolated line`);
    for (const bg of r.btns) { const [rr, g, b] = bg.match(/\d+/g).map(Number); assert.ok(0.2126 * rr + 0.7152 * g + 0.0722 * b < 128, `${vp.width}: customer-file button is light ${bg}`); }
    await shot(page, `05-customer-file-${vp.width}-after`);
    await ctx.close();
  }
  {
    const { ctx, page } = await open({ width: 1366, height: 768 }, 'en');
    await page.waitForSelector('#novaInboxTab', { timeout: 5000 });
    await page.waitForTimeout(300);
    assert.equal((await page.locator('#novaInboxTab').innerText()).trim().replace(/\s*\d+$/, ''), 'Chats', 'English nav: «المحادثات» translated');
    await ctx.close();
  }
  // ---------- 5: one stock number (list = item card) + readable invoice reference ----------
  {
    const { ctx, page } = await open({ width: 1366, height: 768 });
    const [it] = await addByBarcode(page, [1]);
    await openCheckout(page); await page.locator('.pay-method-btn[data-method=cash]').click();
    await page.locator('#btnConfirmPayment').click(); await page.waitForTimeout(600);
    const num = await page.evaluate(() => window.novaSales.list().slice(-1)[0].number);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await tab(page, 'products');
    const listN = await page.evaluate(name => { const row = [...document.querySelectorAll('#novaPageView tr')].find(r => r.textContent.includes(name)); const c = row && row.querySelector('.pc-stock'); return c ? Number((c.textContent.match(/-?\d+(\.\d+)?/) || [])[0]) : null; }, it.barcode);
    assert.equal(listN, Number(it.stock) - 1, `products list = catalogue - sold (${listN})`);
    await page.evaluate(b => window.novaItemCard.open(b), it.barcode); await page.locator('.nova-ic-dialog').waitFor();
    const card = await page.evaluate(() => ({ onhand: document.querySelector('.nova-ic-dialog [data-ic-onhand]')?.textContent || [...document.querySelectorAll('.nova-ic-check strong')].pop()?.textContent, text: document.querySelector('.nova-ic-dialog').innerText }));
    assert.equal(Number(String(card.onhand).replace(/[^\d.-]/g, '')), listN, `item card balance ${card.onhand} = list ${listN}`);
    assert.ok(card.text.includes(num), 'item card shows the invoice number ' + num);
    assert.doesNotMatch(card.text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i, 'no raw UUID in the item card');
    await shot(page, '06-item-card-1366-after');
    await ctx.close();
  }
  // ---------- 6: receiving header reachable on the phone after another page was scrolled ----------
  {
    const { ctx, page } = await open({ width: 390, height: 844 });
    await tab(page, 'settings'); await page.evaluate(() => window.scrollTo(0, 1500)); await page.waitForTimeout(200);
    await tab(page, 'receiving'); await page.waitForTimeout(900);
    const r = await page.evaluate(() => {
      const b = [...document.querySelectorAll('#novaPageView button')].find(x => /استلام فاتورة/.test(x.textContent) && x.offsetParent);
      const top = document.querySelector('.nova-nav-brand, .nova-topbar, .nova-nav')?.getBoundingClientRect().bottom || 0;
      const q = b && b.getBoundingClientRect(); return { y: scrollY, ok: !!q && q.top >= top - 1 && q.bottom <= innerHeight, top, bt: q && q.top };
    });
    assert.ok(r.ok, `receiving: «استلام فاتورة» visible below the top bar (${JSON.stringify(r)})`);
    await shot(page, '07-receiving-390-after');
    await ctx.close();
  }
  // 7 / 1b (reports tabs, fail closed) were replaced in Q21 step 2: the reports page has no tabs any more; «الوردية» is its own entry and
  // the role nav fails closed — see tests/ux/q21-simplify.mjs.
  console.log('ui-batch1: all checks passed');
} finally { await browser.close(); }
