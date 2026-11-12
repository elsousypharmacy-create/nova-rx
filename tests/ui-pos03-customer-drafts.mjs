// POS-03 browser proof: customer phone prompt with policy-based skip, draft persistence/restoration across refresh & disconnect, clear cashier/branch display, and strict per-user isolation of active & parked drafts.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8');
const candidates = [process.env.CHROME_PATH, chromium.executablePath(), '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
const executablePath = candidates.find(existsSync);

const browser = await chromium.launch({ executablePath: executablePath || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ar-EG' });
await ctx.route('**/*', r => {
  const u = r.request().url();
  if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:')) return r.continue();
  return r.abort();
});
const page = await ctx.newPage();
await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
const errors = [];
page.on('pageerror', e => errors.push(e.message));

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });

  // 1. Cashier and branch are shown clearly in the POS header and can be switched
  const branchBadge = await page.locator('#posBranchBadge').textContent();
  const cashierBadge = await page.locator('#posCashierBadge').textContent();
  assert.ok(branchBadge && branchBadge.includes('فرع السليمانية'), 'default branch shown clearly: ' + branchBadge);
  assert.ok(cashierBadge && cashierBadge.includes('د. أحمد السوسي'), 'default cashier shown clearly: ' + cashierBadge);

  await page.selectOption('#posBranchSelect', 'BR-02');
  const updatedBranch = await page.locator('#posBranchBadge').textContent();
  assert.ok(updatedBranch && updatedBranch.includes('فرع العليا'), 'branch switch updates badge: ' + updatedBranch);

  // 2. Customer phone prompt & policy-based skip (prompt, reason-required, required)
  await page.fill('#mainSearchInput', 'Panadol');
  await page.locator('#suggestionsBox .suggestion-item').first().click();

  // Policy: prompt (skip allowed)
  await page.evaluate(() => window.novaPos03.setCustomerPolicy('prompt'));
  await page.click('#btnCheckout');
  assert.ok(await page.locator('#customerCheckoutGate').isVisible(), 'customer gate opens under prompt policy');
  await page.click('#gateSkipCustomer');
  await page.waitForSelector('#checkoutModal.active', { timeout: 3000 });
  await page.click('#btnCancelCheckout');

  // Policy: reason-required (skip blocked without reason, allowed with reason)
  await page.evaluate(() => window.novaPos03.setCustomerPolicy('reason-required'));
  await page.click('#btnCheckout');
  assert.ok(await page.locator('#customerCheckoutGate').isVisible(), 'customer gate opens under reason-required policy');
  assert.ok(await page.locator('#gateSkipReasonWrap').isVisible(), 'skip reason selector visible under reason-required policy');
  await page.selectOption('#gateSkipReason', '');
  await page.click('#gateSkipCustomer');
  assert.ok(!(await page.locator('#checkoutModal').evaluate(el => el.classList.contains('active'))), 'skip without reason is blocked');
  const reasonErr = await page.locator('#gateCustomerResult').textContent();
  assert.ok(reasonErr && reasonErr.includes('سبب'), 'error shown when skipping without reason: ' + reasonErr);

  await page.selectOption('#gateSkipReason', 'walk-in-declined');
  await page.click('#gateSkipCustomer');
  await page.waitForSelector('#checkoutModal.active', { timeout: 3000 });
  const draftAfterSkip = await page.evaluate(() => window.novaPos03.getActiveDraft());
  assert.equal(draftAfterSkip && draftAfterSkip.customerSkipReason, 'walk-in-declined', 'skip reason persisted in draft');
  await page.click('#btnCancelCheckout');

  // Policy: required (skip blocked, phone required; supports Arabic digits)
  await page.evaluate(() => window.novaPos03.setCustomerPolicy('required'));
  await page.click('#btnCheckout');
  assert.ok(await page.locator('#customerCheckoutGate').isVisible(), 'customer gate opens under required policy');
  assert.ok(await page.locator('#gateSkipCustomer').isHidden(), 'skip button hidden under required policy');
  await page.locator('#gatePhone').press('Enter');
  assert.ok(!(await page.locator('#checkoutModal').evaluate(el => el.classList.contains('active'))), 'Enter on empty phone does not skip under required policy');

  // Attach new customer using Arabic-Indic digits
  await page.fill('#gatePhone', '٠١٠٩٨٧٦٥٤٣٢');
  await page.click('#gateFindCustomer');
  assert.ok(await page.locator('#gateNewCustomerFields').isVisible(), 'new customer name field appears');
  await page.fill('#gateCustomerName', 'عميل اختبار POS03');
  await page.click('#gateFindCustomer');
  await page.waitForSelector('#checkoutModal.active', { timeout: 3000 });
  assert.equal(await page.locator('#custCardName').textContent(), 'عميل اختبار POS03', 'customer attached from gate');
  await page.click('#btnCancelCheckout');

  // 3. Persist and restore active draft across refresh and disconnect/reconnect
  await page.locator('.qty-input').first().fill('3');
  await page.locator('.qty-input').first().dispatchEvent('change');
  await page.fill('#inputPercentDiscount', '10');
  await page.fill('#inputFixedDiscount', '5');
  const saleNoBefore = await page.locator('#activeSaleNumber').textContent();
  const netBefore = await page.locator('#displayGrandTotal').textContent();

  // Simulate disconnect and reconnect
  await page.evaluate(() => {
    window.novaPos03.simulateDisconnect();
    window.novaPos03.simulateReconnect();
  });
  // Reload page (refresh)
  await page.reload({ waitUntil: 'domcontentloaded' });

  assert.equal(await page.locator('#activeSaleNumber').textContent(), saleNoBefore, 'sale number restored after refresh');
  assert.equal(await page.locator('#displayGrandTotal').textContent(), netBefore, 'net total restored after refresh');
  assert.equal(await page.locator('.qty-input').first().inputValue(), '3', 'line qty restored after refresh');
  assert.equal(await page.locator('#inputPercentDiscount').inputValue(), '10', 'percent discount restored after refresh');
  assert.equal(await page.locator('#inputFixedDiscount').inputValue(), '5', 'fixed discount restored after refresh');
  assert.equal(await page.locator('#custCardName').textContent(), 'عميل اختبار POS03', 'attached customer restored after refresh');
  assert.ok((await page.locator('#posBranchBadge').textContent()).includes('فرع العليا'), 'branch session restored after refresh');

  // 4. Local user isolation: never mix active drafts or parked (held) invoices across local users
  // Park current invoice under Cashier 1 (cashier-1) and also create a second active draft for Cashier 1
  await page.click('#holdCurrentInvoice');
  assert.equal(await page.locator('#heldInvoiceCount').textContent(), '1', 'Cashier 1 has 1 held invoice');

  // Add an active draft for Cashier 1
  await page.fill('#mainSearchInput', 'Augmentin');
  await page.locator('#suggestionsBox .suggestion-item').first().click();
  await page.locator('.qty-input').first().fill('2');
  await page.locator('.qty-input').first().dispatchEvent('change');
  const cashier1ActiveSaleNo = await page.locator('#activeSaleNumber').textContent();

  // Switch to Cashier 2 (cashier-2: د. سارة المنصور)
  await page.selectOption('#posCashierSelect', 'cashier-2');
  assert.ok((await page.locator('#posCashierBadge').textContent()).includes('د. سارة المنصور'), 'Cashier 2 badge displayed');
  assert.equal(await page.locator('#heldInvoiceCount').textContent(), '0', 'Cashier 2 sees 0 held invoices (Cashier 1 parked draft is isolated)');
  assert.equal(await page.locator('#invoiceTableBody .qty-input').count(), 0, 'Cashier 2 starts with clean active draft');
  assert.equal(await page.locator('#customerSelectedBox').isVisible(), false, 'Cashier 2 has no leaked customer from Cashier 1');

  // Cashier 2 creates their own active draft and held invoice
  await page.fill('#mainSearchInput', 'Concor');
  await page.locator('#suggestionsBox .suggestion-item').first().click();
  await page.click('#holdCurrentInvoice');
  assert.equal(await page.locator('#heldInvoiceCount').textContent(), '1', 'Cashier 2 has 1 held invoice of their own');

  await page.fill('#mainSearchInput', 'Nexium');
  await page.locator('#suggestionsBox .suggestion-item').first().click();
  const cashier2ActiveSaleNo = await page.locator('#activeSaleNumber').textContent();
  assert.notEqual(cashier2ActiveSaleNo, cashier1ActiveSaleNo, 'Cashier 2 has distinct sale number');

  // Reload while on Cashier 2 -> Cashier 2's draft & held count stay intact
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.ok((await page.locator('#posCashierBadge').textContent()).includes('د. سارة المنصور'), 'Cashier 2 session persists after reload');
  assert.equal(await page.locator('#activeSaleNumber').textContent(), cashier2ActiveSaleNo, 'Cashier 2 active sale number persists');
  assert.equal(await page.locator('#heldInvoiceCount').textContent(), '1', 'Cashier 2 held count is still 1');

  // Switch back to Cashier 1 -> Cashier 1's active draft (Augmentin x2) and Cashier 1's held invoice (Panadol x3) are restored
  await page.selectOption('#posCashierSelect', 'cashier-1');
  assert.ok((await page.locator('#posCashierBadge').textContent()).includes('د. أحمد السوسي'), 'Switched back to Cashier 1');
  assert.equal(await page.locator('#activeSaleNumber').textContent(), cashier1ActiveSaleNo, 'Cashier 1 active sale number restored');
  assert.equal(await page.locator('.qty-input').first().inputValue(), '2', 'Cashier 1 active draft line qty restored');
  assert.equal(await page.locator('#heldInvoiceCount').textContent(), '1', 'Cashier 1 sees only their 1 held invoice');

  // Resume Cashier 1's held invoice and complete sale to verify receipt shows branch & cashier
  page.once('dialog', d => d.accept());
  await page.click('#btnHeldInvoices');
  const heldRowText = await page.locator('#heldInvoiceList .nova-held-row').first().textContent();
  assert.ok(heldRowText.includes('د. أحمد السوسي') && heldRowText.includes('فرع العليا'), 'Held row clearly displays cashier and branch: ' + heldRowText);
  await page.click('#heldInvoiceList [data-held-resume]');
  assert.equal(await page.locator('#activeSaleNumber').textContent(), saleNoBefore, 'Held invoice sale number restored on resume');
  assert.equal(await page.locator('.qty-input').first().inputValue(), '3', 'Held invoice qty restored on resume');
  assert.equal(await page.locator('#custCardName').textContent(), 'عميل اختبار POS03', 'Held invoice customer restored on resume');

  await page.click('#btnCheckout');
  await page.waitForSelector('#checkoutModal.active', { timeout: 3000 });
  await page.click('.quick-cash-btn[data-val="exact"]');
  await page.click('#btnConfirmPayment');
  await page.waitForSelector('#receiptModal.active', { timeout: 3000 });
  const receiptText = await page.locator('#receiptSlipContent').textContent();
  assert.ok(receiptText.includes('فرع العليا') && receiptText.includes('د. أحمد السوسي'), 'Receipt clearly shows active branch and cashier');

  assert.equal(errors.length, 0, 'page errors: ' + errors.join('; '));
  console.log('PASS: POS-03 customer phone policy, draft persistence, cashier/branch display, and local user isolation verified');
} finally {
  await browser.close();
}
