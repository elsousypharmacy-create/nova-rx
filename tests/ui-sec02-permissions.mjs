// N46 SEC-02 UI: permissions matrix card, cashier denied export with a logged denial, no role escalation in the form.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8');
let n = 0;
const t = async (name, fn) => { try { await fn(); } catch (e) { console.log('  FAIL', name, '\n   ', String(e.message).split('\n')[0]); process.exit(1); } n++; console.log('  ok', name); };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', acceptDownloads: true });
await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(new URL(BASE).origin) || u.startsWith('data:')) return r.continue(); return r.abort(); });
const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**/emergency/stock.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); } localStorage.setItem('nova-rx-language', 'en'); localStorage.removeItem('nova.activePage'); } catch {} });
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.novaAuth && window.novaAuthUI && window.novaPerms && window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });
const openTab = p => page.locator(`.nova-tab[data-page=${p}]`).click();
await t('no accounts yet: export downloads without a prompt', async () => {
  await openTab('invoices');
  const [d] = await Promise.all([page.waitForEvent('download'), page.locator('#novaSalesExport').click()]);
  assert.match(d.suggestedFilename(), /^nova-rx-sales-/); assert.equal(await page.locator('#novaReauth').count(), 0);
});
const mkAccounts = () => page.evaluate(async () => {
  await novaAuth.createAccount({ name: 'Ahmed', password: 'secret1' }); await novaAuth.signIn('Ahmed', 'secret1');
  await novaAuth.createAccount({ name: 'Sara', role: 'cashier', password: 'pass123' }); await novaAuth.createAccount({ name: 'Mona', role: 'manager', password: 'pass123' });
  novaAuth.signOut();
});
await t('matrix card lists seven roles in Settings', async () => {
  await openTab('settings'); await page.waitForSelector('#novaPermMatrix', { state: 'attached' });
  assert.equal(await page.locator('#novaPermMatrix thead th').count(), 8);
});
await t('cashier export is blocked, no download, and the denial is logged and shown', async () => {
  await mkAccounts(); await page.evaluate(() => novaAuth.signIn('Sara', 'pass123'));
  page.on('dialog', d => d.accept());
  await openTab('invoices');
  let downloaded = false; page.once('download', () => { downloaded = true; });
  await page.locator('#novaSalesExport').click(); await page.waitForTimeout(400);
  assert.equal(downloaded, false); assert.equal(await page.locator('#novaReauth').count(), 0);
  const log = await page.evaluate(() => novaPerms.denied());
  assert.equal(log.length, 1); assert.equal(log[0].action, 'data.export'); assert.equal(log[0].role, 'cashier');
  await openTab('settings'); await page.waitForSelector('#novaPermDenied');
  assert.match(await page.locator('#novaPermDenied').innerText(), /Sara.*الكاشير.*تصدير البيانات/);
});
await t('manager sees no owner/manager role to grant; owner does', async () => {
  await page.evaluate(() => novaAuth.signIn('Mona', 'pass123')); await openTab('invoices'); await openTab('settings');
  await page.locator('#novaAuthCard details:not(#novaPermDetails) > summary').click();
  const opts = await page.locator('#novaNewRole option').evaluateAll(o => o.map(x => x.value));
  assert.ok(!opts.includes('owner') && !opts.includes('manager') && opts.includes('cashier'));
  await page.evaluate(() => novaAuth.signIn('Ahmed', 'secret1')); await openTab('invoices'); await openTab('settings');
  await page.locator('#novaAuthCard details:not(#novaPermDetails) > summary').click();
  assert.ok((await page.locator('#novaNewRole option').evaluateAll(o => o.map(x => x.value))).includes('owner'));
});
await t('role cannot be escalated from the page: matrix is frozen', async () => {
  const r = await page.evaluate(() => { try { NovaPerms.MATRIX.cashier.push('data.export'); } catch (e) {} return novaAuth.signIn('Sara', 'pass123').then(() => novaPerms.can('data.export')); });
  assert.equal(r, false);
});
assert.deepEqual(errors, []);
console.log(`ui-sec02: ${n} passed`); await browser.close();
