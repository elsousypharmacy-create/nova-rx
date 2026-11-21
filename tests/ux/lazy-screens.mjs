// RCV01 lazy screens: supplier accounts + supplier returns code does not run at startup (perf size ratchet), runs when the
// reports / receiving page opens, or on idle after load; sw.js precaches it for offline use. Local/fake data only.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = (process.env.NOVA_URL || process.env.NOVA_UX_URL || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8').split('\n')[0];
assert.ok(/app-550-supplier-accounts-ui\.[0-9a-f]+\.js/.test(sw) && /app-552-supplier-returns\.[0-9a-f]+\.js/.test(sw), 'lazy screens are in the service worker precache list');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
  await context.route('**/*', route => { const r = route.request(); return r.url().startsWith(BASE) && r.method() === 'GET' ? route.continue() : route.abort(); });
  const errors = [];
  const open = async () => { const p = await context.newPage(); p.on('pageerror', e => errors.push(String(e))); await p.addInitScript(() => { window.requestIdleCallback = () => 0; }); return p; };
  // 1) sale page: nothing lazy has run at startup
  const p1 = await open();
  await p1.goto(BASE + (BASE.includes('127.0.0.1') ? 'index.html' : '') + '#sale');
  await p1.locator('#novaSplash').waitFor({ state: 'hidden' });
  assert.equal(await p1.evaluate(() => typeof window.novaSupplierReturns + '/' + typeof window.NovaSupplierAccounts), 'undefined/undefined', 'lazy code not run on the sale screen');
  assert.equal(await p1.locator('link[rel="prefetch"][data-nova-lazy]').count(), 24);
  assert.equal(await p1.evaluate(() => typeof window.novaFullBackup + '/' + typeof window.novaControlled + '/' + typeof window.novaSensitiveLog + '/' + typeof window.novaOwnerDash), 'undefined/undefined/undefined/undefined', 'owner-decision screens not run at startup');
  assert.equal(await p1.evaluate(() => typeof window.novaItemCard + '/' + typeof window.novaCreditLimit), 'undefined/undefined', 'item card + credit limit not run at startup');
  // 2) opening the receiving page runs it, in order
  await p1.evaluate(() => { location.hash = '#receiving'; });
  await p1.locator('[data-sret-open]').waitFor({ timeout: 10000 });
  assert.equal(await p1.evaluate(() => typeof window.NovaSupplierAccounts.createSupplierAccounts), 'function');
  assert.equal(await p1.evaluate(() => document.querySelectorAll('script[src*="app-552-supplier-returns"]').length), 1, 'loaded once');
  await p1.evaluate(() => { location.hash = '#reports'; });
  await p1.evaluate(() => document.querySelector('.nova-tab[data-page="reports"]').click());
  await p1.locator('#novaSupplierAccountsSection').waitFor({ timeout: 10000 });
  assert.equal(await p1.evaluate(() => document.querySelectorAll('script[src*="app-550-supplier-accounts-ui"]').length), 1, 'still loaded once');
  // 3) opening the reports page directly also works
  const p2 = await open();
  await p2.goto(BASE + (BASE.includes('127.0.0.1') ? 'index.html' : '') + '#reports');
  await p2.evaluate(() => document.querySelector('.nova-tab[data-page="reports"]').click());
  await p2.locator('#novaSupplierAccountsSection').waitFor({ timeout: 10000 });
  assert.deepEqual(errors, [], 'no page errors');
  console.log('lazy-screens PASS');
} finally { await browser.close(); }
