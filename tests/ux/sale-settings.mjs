// #94/#100: the settings card saves the cash rounding step and the discount limit; non-managers cannot change them.
import { chromium } from 'playwright';
const URL = process.env.NOVA_UX_URL || process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
let failed = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) failed++; };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(URL + '#settings');
  await page.waitForFunction(() => window.novaLazy && window.novaLazy.load);
  await page.evaluate(() => window.novaLazy.load());
  await page.evaluate(() => { const t = document.querySelector('.nova-tab[data-page=settings]'); if (t) t.click(); });
  await page.waitForSelector('#novaSaleSettingsCard', { timeout: 15000 });
  check(await page.$eval('#nssRound', e => e.value) === '0', 'rounding is off by default');
  check(await page.$eval('#nssDisc', e => e.value) === '10', 'discount limit defaults to 10%');
  await page.selectOption('#nssRound', '0.5');
  await page.fill('#nssDisc', '15');
  await page.click('#nssSave');
  const saved = await page.evaluate(() => [localStorage.getItem('nova-rx-round-step'), localStorage.getItem('nova-rx-discount-limit-pct')]);
  check(saved[0] === '0.5' && saved[1] === '15', 'save writes both settings: ' + saved.join(','));
  await page.fill('#nssDisc', '150');
  await page.click('#nssSave');
  check(await page.evaluate(() => localStorage.getItem('nova-rx-discount-limit-pct')) === '15', 'an out-of-range limit is refused');
  await page.selectOption('#nssRound', '0');
  await page.fill('#nssDisc', '10');
  await page.click('#nssSave');
  check(await page.evaluate(() => localStorage.getItem('nova-rx-round-step')) === null, 'choosing no rounding removes the step');
  // a cashier (accounts exist, not a manager) sees the fields locked
  await page.evaluate(() => { window.novaAuth = { hasAccounts: () => true, current: () => ({ role: 'cashier' }) }; document.getElementById('novaSaleSettingsCard').remove(); document.getElementById('novaPageView').appendChild(document.createElement('i')); });
  await page.waitForSelector('#novaSaleSettingsCard');
  check(await page.$eval('#nssSave', e => e.disabled) && await page.$eval('#nssDisc', e => e.disabled), 'a cashier cannot change the sale rules');
} catch (e) { console.log('FAIL ' + (e && e.stack || e)); failed++; }
await browser.close();
process.exit(failed ? 1 : 0);
