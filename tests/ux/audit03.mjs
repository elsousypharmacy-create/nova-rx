// AUDIT-03: supplier accounts + expenses screen on the reports page (supplier-accounts.js logic, reviewed Gemini UI).
// Add supplier, purchase invoice, cash payment (leaves the shift drawer), statement, expense with real manager approval.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const BASE = process.env.NOVA_URL || process.env.NOVA_UX_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ar-EG', serviceWorkers: 'block' });
  await ctx.route('**/*', r => { const u = r.request().url(); return (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) ? r.continue() : r.abort(); });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  let native = 0; p.on('dialog', d => { native++; d.dismiss(); });
  await p.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); } catch {} window.print = () => { window.__prints = (window.__prints || 0) + 1; }; });
  await p.goto(BASE + (BASE.includes('127.0.0.1') ? 'index.html' : '') + '#reports', { waitUntil: 'load' }); await p.waitForTimeout(900);
  await p.evaluate(() => window.novaPageViews.openTool('novaSupplierAccountsSection')); await p.waitForTimeout(800); // Q21-2c: supplier accounts = a tool in «الأدوات»
  const sec = p.locator('#novaSupplierAccountsSection');
  await sec.waitFor();
  assert.match(await sec.innerText(), /حسابات الموردين/);
  assert.match(await sec.innerText(), /مفيش موردين لسه/);
  const dlg = p.locator('#novaSupplierAccountsDialogHost');
  // add supplier (+ duplicate blocked)
  await sec.locator('[data-nsa-act="addsup"]').first().click(); await dlg.waitFor();
  await p.locator('#nsaSupName').fill('شركة تجربة للأدوية'); await dlg.locator('button[type="submit"]').click();
  await dlg.waitFor({ state: 'detached' });
  await sec.locator('[data-nsa-act="addsup"]').first().click(); await p.locator('#nsaSupName').fill('شركة تجربة للأدوية'); await dlg.locator('button[type="submit"]').click();
  assert.match(await dlg.locator('.nsa-dialog-err').innerText(), /نفس الاسم/); await p.keyboard.press('Escape'); await dlg.waitFor({ state: 'detached' });
  // purchase invoice 500, cash payment 200
  await sec.locator('[data-nsa-act="inv"]').click(); await p.locator('#nsaInvAmt').fill('500'); await p.locator('#nsaInvRef').fill('INV-1'); await dlg.locator('button[type="submit"]').click(); await dlg.waitFor({ state: 'detached' });
  const before = await p.evaluate(() => window.__novaRepData && window.__novaRepData.expected);
  await sec.locator('[data-nsa-act="pay"]').click(); await p.locator('#nsaPayAmt').fill('200'); await dlg.locator('button[type="submit"]').click(); await dlg.waitFor({ state: 'detached' });
  assert.match(await sec.innerText(), /300/, 'balance 300 left');
  assert.equal(await p.evaluate(() => window.novaCashOut.list().reduce((t, x) => t + x.amount, 0)), 200, 'cash out recorded');
  // the shift close subtracts it right away (the reports page re-renders after a cash-out; no navigation needed)
  await p.waitForTimeout(800); await p.locator('#novaSupplierAccountsSection').waitFor();
  const after = await p.evaluate(() => window.__novaRepData.expected);
  assert.equal(Math.round((before - after) * 100) / 100, 200, 'expected drawer dropped by the cash payment (' + before + ' → ' + after + ')');
  await p.evaluate(() => window.novaSwitchPage('shift')); await p.waitForTimeout(600); // Q21-2f: «الوردية» entry
  if (await p.locator('#novaShiftClose').count()) { await p.locator('#novaShiftClose').click(); await p.waitForTimeout(300); }
  if (await p.locator('[data-shift-row]').count()) assert.equal(await p.locator('[data-shift-row="out"]').count(), 1, 'paid-out row shown in the shift close');
  await p.evaluate(() => window.novaPageViews.openTool('novaSupplierAccountsSection')); await p.waitForTimeout(600); // Q21-2c: a tool in «الأدوات»
  // statement + print
  await p.locator('#novaSupplierAccountsSection [data-nsa-act="stmt"]').click(); await dlg.waitFor();
  assert.match(await dlg.innerText(), /INV-1/); await dlg.locator('[data-nsa-print]').click(); await p.keyboard.press('Escape');
  console.log('  ok suppliers: add, invoice, cash payment → drawer, statement');
  // expenses: needs a signed-in user; approval by another manager/owner with password
  await p.evaluate(async () => { const A = window.novaAuth; await A.createAccount({ name: 'مالك تجربة', role: 'owner', password: 'owner-pass-1' }); await A.signIn('مالك تجربة', 'owner-pass-1'); await A.createAccount({ name: 'كاشير تجربة', role: 'cashier', password: 'cash-pass-1' }); await A.signIn('كاشير تجربة', 'cash-pass-1'); });
  // q17: expenses live in the «الوردية» tab, visible to the cashier
  await p.evaluate(() => window.novaSwitchPage('shift')); await p.waitForTimeout(2000);
  const S = p.locator('#novaExpensesSection');
  assert.ok(await S.isVisible(), 'expenses section visible in the shift tab');
  await S.locator('[data-nsa-act="addexp"]').click(); await dlg.waitFor();
  await p.locator('#nsaExpAmt').fill('250'); /* Q21-2g: above 200 still needs the approval */ await p.locator('#nsaExpCat').selectOption('cleaning'); await p.locator('#nsaExpDoc').fill('إيصال 9'); await dlg.locator('button[type="submit"]').click(); await dlg.waitFor({ state: 'detached' });
  await S.locator('[data-nsa-act="approve"]').click(); await dlg.waitFor();
  await p.locator('#nsaAppUser').fill('مالك تجربة'); await p.locator('#nsaAppPass').fill('wrong'); await dlg.locator('[data-nsa-submit]').click(); await p.waitForTimeout(300);
  assert.match(await dlg.locator('.nsa-dialog-err').innerText(), /مش صحيحة/);
  await p.locator('#nsaAppPass').fill('owner-pass-1'); await dlg.locator('[data-nsa-submit]').click(); await dlg.waitFor({ state: 'detached' });
  await S.locator('[data-nsa-act="payexp"]').click(); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => window.novaCashOut.list().reduce((t, x) => t + x.amount, 0)), 450, 'expense paid out of the drawer');
  assert.match(await S.innerText(), /اتصرف/);
  // Q21-2g: up to 200 → one step (recorded, approved by the same signed-in person, paid)
  await S.locator('[data-nsa-act="addexp"]').click(); await dlg.waitFor();
  await p.locator('#nsaExpAmt').fill('75'); await p.locator('#nsaExpCat').selectOption('cleaning'); await p.locator('#nsaExpDoc').fill('إيصال 10'); await dlg.locator('button[type="submit"]').click(); await dlg.waitFor({ state: 'detached' }); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => window.novaCashOut.list().reduce((t, x) => t + x.amount, 0)), 525, 'small expense paid at once');
  console.log('  ok expenses: add, approval by owner password, pay from drawer');
  assert.equal(native, 0, 'no native dialogs');
  assert.deepEqual(errors, []);
  console.log('audit03 passed');
} finally { await browser.close(); }
