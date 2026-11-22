// UX-P40/P40c: sale side rail. Wide landscape: a fixed customer card on top («تسجيل عميل» bar when empty), then new/hold tiles, a wide clear button,
// held invoices (last 3 + «more») and stickers. The card opens the customer history window. An unknown phone number offers quick registration.
// Narrow/portrait: buttons stay in the header.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || process.env.NOVA_UX_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const TILES = ['btnNewSale', 'holdCurrentInvoice', 'btnAddLoyalty', 'btnClearInvoice'];
const SQUARES = ['btnNewSale', 'holdCurrentInvoice'];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG', serviceWorkers: 'block' });
  await ctx.route('**/*', r => { const u = r.request().url(); return (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) ? r.continue() : r.abort(); });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova-rx-held-invoices-v1'); } catch {} });
  await page.goto(BASE + 'index.html#sale', { waitUntil: 'load' });
  await page.waitForSelector('#mainSearchInput');
  await page.waitForTimeout(900);

  // layout: tiles, held header and stickers live in the side column
  const lay = await page.evaluate(ids => ({
    rail: document.body.classList.contains('nova-rail'),
    tiles: ['btnNewSale', 'holdCurrentInvoice', 'btnClearInvoice'].map(id => !!document.getElementById(id)?.closest('.nova-rail-tiles')),
    custTop: !!document.getElementById('btnAddLoyalty')?.closest('.nova-rail-cust') && document.querySelector('.nova-rail-cust').getBoundingClientRect().bottom <= document.querySelector('.nova-rail-tiles').getBoundingClientRect().top,
    custLabel: document.getElementById('btnAddLoyalty').innerText,
    noSectionLabel: !document.querySelector('.nova-rail-box .nova-rail-sec'),
    clearWide: document.getElementById('btnClearInvoice').getBoundingClientRect().width > document.getElementById('btnNewSale').getBoundingClientRect().width * 1.6,
    held: !!document.getElementById('btnHeldInvoices')?.closest('.nova-rail-held-head'),
    stickers: !!document.getElementById('btnSaleLabels')?.closest('.nova-rail-foot'),
    sizes: ids.map(id => { const r = document.getElementById(id).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }),
    asideRight: (() => { const a = document.querySelector('.pos-root>.customer-sidebar').getBoundingClientRect(); const m = document.querySelector('.main-workspace').getBoundingClientRect(); return a.left >= m.right - 1; })(),
    cardShown: !!document.getElementById('novaCustCard')?.offsetParent
  }), SQUARES);
  assert.ok(lay.rail, 'rail mode on at 1280x800');
  assert.deepEqual(lay.tiles, [true, true, true], 'new, hold and clear in the rail tiles');
  assert.ok(lay.custTop, 'customer bar fixed above the invoice tiles');
  assert.match(lay.custLabel, /اختيار عميل/, 'empty customer bar says «اختيار عميل» (Q21-2k)');
  assert.ok(lay.noSectionLabel, 'no «الفاتورة» section label');
  assert.ok(lay.clearWide, 'clear is a separate wide button');
  assert.ok(lay.held && lay.stickers, 'held header and stickers in the rail');
  for (const [w, h] of lay.sizes) assert.ok(w >= 60 && h >= 90, 'tile size ' + w + 'x' + h);
  assert.ok(lay.asideRight, 'rail sits on the right (RTL start)');
  assert.ok(!lay.cardShown, 'no customer card for a walk-in invoice');
  console.log('  ok rail layout', JSON.stringify(lay.sizes));

  // held invoices (UI-BATCH1: the rail is the ONE held list on desktop): five held -> five rows, each «رجّعها» + «حذف»; resume restores one; delete removes one; the held button opens no popup
  const search = page.locator('#mainSearchInput');
  await search.press('Enter'); // skip customer search
  const addAndHold = async () => {
    await search.fill('بان'); await page.waitForSelector('#suggestionsBox .suggestion-item');
    await page.locator('#suggestionsBox .suggestion-item').first().click();
    await page.locator('#holdCurrentInvoice').click(); await page.waitForTimeout(150);
  };
  for (let i = 0; i < 5; i++) await addAndHold();
  assert.equal(await page.locator('.nova-rail-row').count(), 5, 'every held invoice in the rail');
  assert.equal(await page.locator('[data-rail-delete]').count(), 5, 'each row has a delete');
  assert.equal(await page.locator('#heldInvoiceCount').textContent(), '5');
  await page.locator('[data-rail-resume]').first().click(); await page.waitForTimeout(250);
  assert.equal(await page.locator('#heldInvoiceCount').textContent(), '4', 'resume took one off the list');
  assert.equal(await page.locator('#invoiceTableBody tr').count(), 1, 'resumed invoice has its line');
  assert.equal(await page.locator('.nova-rail-row').count(), 4);
  await page.locator('[data-rail-delete]').first().click(); await page.waitForTimeout(250);
  assert.equal(await page.locator('#heldInvoiceCount').textContent(), '3', 'delete took one off the list');
  await page.locator('#btnHeldInvoices').click(); await page.waitForTimeout(200);
  assert.equal(await page.locator('#heldInvoicePanel').isHidden(), true, 'no duplicate held popup on desktop');
  console.log('  ok held rows, resume, delete, one held UI');

  // customer: link -> card on top with name/phone/points; card opens the history window; Escape closes; × removes
  await page.locator('#btnAddLoyalty').click();
  await search.fill('01'); await page.waitForSelector('#suggestionsBox .suggestion-item');
  await page.locator('#suggestionsBox .suggestion-item').first().click(); await page.waitForTimeout(300);
  const name = (await page.locator('#custCardName').textContent()).trim();
  const phone = (await page.locator('#custCardPhone').textContent()).trim();
  assert.ok(name, 'customer attached');
  await page.locator('#novaCustCard').waitFor({ state: 'visible' });
  await page.evaluate(() => { document.body.classList.add('x-lang-pass'); document.body.classList.remove('x-lang-pass'); }); await page.waitForTimeout(150); // a translator pass must not touch the name
  const cardText = await page.locator('#novaCustCard').innerText();
  assert.ok(cardText.includes(name) && cardText.includes(phone), 'card shows name and phone');
  assert.match(cardText, /نقطة/, 'card shows the points');
  assert.equal(await page.locator('#btnAddLoyalty').isVisible(), false, 'register bar hidden while a customer is attached');
  assert.equal(await page.locator('#btnAddLoyalty').getAttribute('data-nova-original-aria-label'), null, 'translator has no aria-label to re-apply in the rail');
  assert.equal(await page.locator('#btnAddLoyalty').getAttribute('aria-keyshortcuts'), 'F3', 'shortcut exposed as aria-keyshortcuts');
  assert.equal(await page.locator('#btnAddLoyalty .nx-k').getAttribute('aria-hidden'), 'true', 'F3 badge is not read as part of the name');
  assert.equal(await page.locator('#customerSelectedBox').isVisible(), false, 'full card is not on the screen until asked');
  await page.locator('#novaCustCard').click();
  await page.locator('#novaCustModal').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#novaCustModal #customerSelectedBox').isVisible(), true, 'card shows in the window');
  assert.equal(await page.evaluate(() => document.getElementById('custExtraDetails').open), true, 'past purchases open');
  assert.equal(await page.evaluate(() => document.querySelector('.pos-root').inert), true, 'POS behind the window is inert');
  await page.keyboard.press('Escape');
  await page.locator('#novaCustModal').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => document.querySelector('.pos-root').inert), false, 'POS usable again after closing');
  await page.locator('#novaCustCardX').click(); await page.waitForTimeout(300);
  assert.equal(await page.locator('#novaCustCard').isVisible(), false, 'card gone after removing the customer');
  assert.equal(await page.locator('#btnAddLoyalty').isVisible(), true, 'register bar back');
  console.log('  ok customer card and window');

  // unknown name: no registration offer (names repeat); unknown phone: «مش مسجل» + register -> saved and attached
  await page.locator('#btnAddLoyalty').click();
  await search.fill('زززز');
  await page.waitForSelector('#suggestionsBox.open'); await page.waitForTimeout(150);
  assert.equal(await page.locator('#novaCustRegBtn').count(), 0, 'no register button for a name');
  assert.match(await page.locator('#suggestionsBox').innerText(), /اكتب رقم موبايله/, 'name miss asks for the mobile number');
  await search.fill('01099887766');
  await page.locator('#novaCustRegBtn').waitFor({ state: 'visible' });
  assert.match(await page.locator('#suggestionsBox').innerText(), /مش مسجل/);
  await search.press('Enter');
  await page.locator('#novaQuickReg').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#novaQrPhone').inputValue(), '01099887766', 'number carried into the form');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'novaQrName', 'name field focused');
  await page.locator('#novaQuickReg button[type=submit]').click();
  assert.match(await page.locator('#novaQrErr').textContent(), /اسم/, 'name is required');
  await page.locator('#novaQrName').fill('منى عادل');
  await page.keyboard.press('Enter');
  await page.locator('#novaQuickReg').waitFor({ state: 'detached' });
  await page.locator('#novaCustCard').waitFor({ state: 'visible' });
  assert.ok((await page.locator('#novaCustCard').innerText()).includes('منى عادل'), 'new customer attached on the card');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('nova-rx-demo-customers-v1') || '[]').some(c => c.phone === '01099887766' && c.name === 'منى عادل'));
  assert.ok(saved, 'new customer saved on this browser');
  await page.locator('#novaCustCardX').click(); await page.waitForTimeout(200);
  await page.locator('#btnAddLoyalty').click();
  await search.fill('01099887766'); await page.waitForSelector('#suggestionsBox .suggestion-item');
  assert.equal(await page.locator('#novaCustRegBtn').count(), 0, 'registered number is found, not offered again');
  await search.press('Escape'); await search.fill(''); await search.press('Enter');
  console.log('  ok register from phone only');
  // narrow portrait: everything back in the header, card back in the sidebar
  await page.setViewportSize({ width: 600, height: 900 }); await page.waitForTimeout(300);
  const narrow = await page.evaluate(ids => ({
    rail: document.body.classList.contains('nova-rail'),
    inHeader: ids.concat(['btnHeldInvoices', 'btnSaleLabels']).every(id => !!document.getElementById(id)?.closest('.nova-sale-actions')),
    cardHome: !!document.getElementById('customerSelectedBox')?.closest('.pos-root>.customer-sidebar'),
    leftovers: document.querySelectorAll('.nx-rail-add').length
  }), TILES);
  assert.deepEqual(narrow, { rail: false, inHeader: true, cardHome: true, leftovers: 0 }, 'narrow screen keeps the header layout');
  await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.body.classList.contains('nova-rail')), true, 'back to the rail when wide again');
  console.log('  ok narrow/wide switch');
  assert.deepEqual(errors, []);
  await ctx.close();
  console.log('sale-rail passed');
} finally { await browser.close(); }
