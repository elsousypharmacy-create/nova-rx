// UX-P40: sale side rail. Wide landscape: the four invoice tiles, held invoices (last 3 + «more») and stickers sit in the side column,
// an attached customer shows as a header chip that opens the customer card as a window. Narrow/portrait: buttons stay in the header.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || process.env.NOVA_UX_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const TILES = ['btnNewSale', 'holdCurrentInvoice', 'btnAddLoyalty', 'btnClearInvoice'];
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
    tiles: ids.map(id => !!document.getElementById(id)?.closest('.nova-rail-tiles')),
    held: !!document.getElementById('btnHeldInvoices')?.closest('.nova-rail-held-head'),
    stickers: !!document.getElementById('btnSaleLabels')?.closest('.nova-rail-foot'),
    sizes: ids.map(id => { const r = document.getElementById(id).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }),
    asideRight: (() => { const a = document.querySelector('.pos-root>.customer-sidebar').getBoundingClientRect(); const m = document.querySelector('.main-workspace').getBoundingClientRect(); return a.left >= m.right - 1; })(),
    chipShown: getComputedStyle(document.querySelector('.nova-cust-chip-wrap')).display !== 'none'
  }), TILES);
  assert.ok(lay.rail, 'rail mode on at 1280x800');
  assert.deepEqual(lay.tiles, [true, true, true, true], 'four tiles in the rail');
  assert.ok(lay.held && lay.stickers, 'held header and stickers in the rail');
  for (const [w, h] of lay.sizes) assert.ok(w >= 60 && h >= 90, 'tile size ' + w + 'x' + h);
  assert.ok(lay.asideRight, 'rail sits on the right (RTL start)');
  assert.ok(!lay.chipShown, 'no customer chip for a walk-in invoice');
  console.log('  ok rail layout', JSON.stringify(lay.sizes));

  // held invoices: five held -> three rows + «كمان 2»; resume restores one
  const search = page.locator('#mainSearchInput');
  await search.press('Enter'); // skip customer search
  const addAndHold = async () => {
    await search.fill('بان'); await page.waitForSelector('#suggestionsBox .suggestion-item');
    await page.locator('#suggestionsBox .suggestion-item').first().click();
    await page.locator('#holdCurrentInvoice').click(); await page.waitForTimeout(150);
  };
  for (let i = 0; i < 5; i++) await addAndHold();
  assert.equal(await page.locator('.nova-rail-row').count(), 3, 'three held rows');
  assert.match(await page.locator('[data-rail-more]').textContent(), /2/, 'more shows the rest');
  assert.equal(await page.locator('#heldInvoiceCount').textContent(), '5');
  await page.locator('[data-rail-resume]').first().click(); await page.waitForTimeout(250);
  assert.equal(await page.locator('#heldInvoiceCount').textContent(), '4', 'resume took one off the list');
  assert.equal(await page.locator('#invoiceTableBody tr').count(), 1, 'resumed invoice has its line');
  assert.equal(await page.locator('[data-rail-more]').textContent().then(t => /1/.test(t)), true);
  await page.locator('[data-rail-more]').click(); await page.waitForTimeout(200);
  assert.equal(await page.locator('#heldInvoicePanel').isHidden(), false, '«more» opens the full held list');
  await page.locator('#closeHeldInvoices').click();
  console.log('  ok held rows, resume, more');

  // customer: link -> chip + tile name; chip opens the card window; Escape closes; × removes
  await page.locator('#btnAddLoyalty').click();
  await search.fill('01'); await page.waitForSelector('#suggestionsBox .suggestion-item');
  await page.locator('#suggestionsBox .suggestion-item').first().click(); await page.waitForTimeout(300);
  const name = (await page.locator('#custCardName').textContent()).trim();
  assert.ok(name, 'customer attached');
  await page.locator('#novaCustChip').waitFor({ state: 'visible' });
  assert.equal((await page.locator('#novaCustChipName').textContent()).trim(), name);
  await page.evaluate(() => { document.body.classList.add('x-lang-pass'); document.body.classList.remove('x-lang-pass'); }); await page.waitForTimeout(150); // a translator pass must not touch the name
  assert.ok((await page.locator('#btnAddLoyalty').innerText()).includes(name), 'tile shows the customer name');
  assert.equal(await page.locator('#btnAddLoyalty').getAttribute('aria-label'), null, 'visible text names the tile');
  assert.equal(await page.locator('#customerSelectedBox').isVisible(), false, 'card is not on the screen until asked');
  await page.locator('#novaCustChip').click();
  await page.locator('#novaCustModal').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#novaCustModal #customerSelectedBox').isVisible(), true, 'card shows in the window');
  assert.equal(await page.evaluate(() => document.getElementById('custExtraDetails').open), true, 'past purchases open');
  await page.keyboard.press('Escape');
  await page.locator('#novaCustModal').waitFor({ state: 'hidden' });
  await page.locator('#novaCustChipX').click(); await page.waitForTimeout(300);
  assert.equal(await page.locator('#novaCustChip').isVisible(), false, 'chip gone after removing the customer');
  console.log('  ok customer chip and window');

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
