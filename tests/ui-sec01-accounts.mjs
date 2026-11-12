// N45 SEC-01 UI: Settings accounts card, session/devices, export needs re-auth once an account exists (mock auth).
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
await page.waitForFunction(() => window.novaAuth && window.novaAuthUI && window.novaCatalog && window.novaCatalog.source === 'STOCK LIVE', null, { timeout: 8000 });
const openTab = p => page.locator(`.nova-tab[data-page=${p}]`).click();
await t('no accounts yet: export downloads without a prompt', async () => {
  await openTab('invoices');
  const [d] = await Promise.all([page.waitForEvent('download'), page.locator('#novaSalesExport').click()]);
  assert.match(d.suggestedFilename(), /^nova-rx-sales-/); assert.equal(await page.locator('#novaReauth').count(), 0);
});
await t('first account created in Settings becomes owner and can sign in', async () => {
  await openTab('settings'); await page.locator('#novaAuthCard summary').click();
  await page.fill('#novaNewName', 'Ahmed'); await page.fill('#novaNewPw', 'secret1'); await page.click('#novaNewOk');
  await page.waitForSelector('#novaAuthIn');
  await page.fill('#novaAuthName', 'Ahmed'); await page.fill('#novaAuthPw', 'wrong'); await page.click('#novaAuthIn');
  await page.waitForFunction(() => document.querySelector('#novaAuthMsg').textContent.includes('Wrong'));
  await page.fill('#novaAuthPw', 'secret1'); await page.click('#novaAuthIn');
  await page.waitForSelector('#novaAuthOut');
  assert.equal(await page.locator('#novaAuthSessions li').count(), 1); assert.equal(await page.locator('#novaAuthDevices li').count(), 1);
});
await t('export after the re-auth window is blocked until the password is re-entered', async () => {
  await page.evaluate(() => { const real = Date.now; Date.now = () => real() + 6 * 60 * 1000; });
  await openTab('invoices'); await page.locator('#novaSalesExport').click();
  await page.waitForSelector('#novaReauth');
  await page.fill('#novaReauthPw', 'bad'); await page.click('#novaReauthOk');
  await page.waitForFunction(() => document.querySelector('#novaReauthMsg').textContent.includes('Wrong'));
  const [d] = await Promise.all([page.waitForEvent('download'), (async () => { await page.fill('#novaReauthPw', 'secret1'); await page.click('#novaReauthOk'); })()]);
  assert.ok(d.suggestedFilename().endsWith('.json'));
});
await t('signing out blocks export; revoking the session in Settings ends it', async () => {
  await openTab('settings'); await page.click('#novaAuthOut');
  assert.equal(await page.evaluate(() => window.novaAuth.sensitiveAllowed()), false);
  await page.fill('#novaAuthName', 'Ahmed'); await page.fill('#novaAuthPw', 'secret1'); await page.click('#novaAuthIn'); await page.waitForSelector('#novaAuthOut');
  await page.click('[data-revoke]'); await page.waitForSelector('#novaAuthIn');
  assert.equal(await page.evaluate(() => window.novaAuth.current()), null);
});
assert.deepEqual(errors, []);
console.log(`ui-sec01: ${n} passed`); await browser.close();
