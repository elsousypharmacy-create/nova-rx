// PUR-01b: confirm stays disabled for empty qty / half-filled later line; «ناقص» hint lists الصلاحية. Fake/local data; non-GET blocked.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const origin = process.env.NOVA_RECEIVING_URL || 'http://127.0.0.1:8766';
const shotDir = 'qa/screens/PUR-01b'; mkdirSync(shotDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await context.route('**/*', route => { const r = route.request(); return r.url().startsWith(origin) && r.method() === 'GET' ? route.continue() : route.abort(); });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(origin + '/index.html#sale');
  await page.locator('#novaSplash').waitFor({ state: 'hidden' });
  await page.evaluate(() => { location.hash = '#receiving'; });
  await page.locator('[data-rcv=new]:visible').click();
  const ok = page.locator('#rcvOk'), hintEl = page.locator('#rcvMissing');
  assert.ok(await ok.isDisabled());
  assert.ok((await hintEl.textContent()).includes('الصلاحية'), 'expiry in hint from the start');

  await page.locator('#rcvSup').selectOption({ index: 1 });
  await page.locator('#rcvInv').fill('B01');
  const pickItem = async row => {
    await row.locator('[data-f=q]').fill('6281001234567');
    const p = row.locator('[data-pick]').first(); await p.waitFor({ timeout: 5000 }); await p.click();
  };
  const row1 = page.locator('.rcv-line').nth(0);
  await pickItem(row1);
  await row1.locator('[data-f=exp]').fill('11/35');
  // (a) valid expiry but empty qty -> disabled, no error on click
  assert.ok(await ok.isDisabled(), 'empty qty keeps confirm disabled');
  assert.ok((await hintEl.textContent()).includes('الكمية'));
  await ok.click({ force: true });
  await row1.locator('[data-f=qty]').fill('0');
  assert.ok(await ok.isDisabled(), 'qty 0 keeps confirm disabled');
  await row1.locator('[data-f=qty]').fill('2');
  assert.ok(await ok.isEnabled(), 'valid line enables confirm');
  assert.equal(await hintEl.textContent(), '');

  // (b) half-filled second line
  await page.locator('[data-rcv-add]').click();
  const row2 = page.locator('.rcv-line').nth(1);
  await pickItem(row2);
  assert.ok(await ok.isDisabled(), 'half-filled second line disables confirm');
  const h = await hintEl.textContent(); assert.ok(h.includes('الكمية') && h.includes('الصلاحية'), h);
  await ok.click({ force: true });
  await page.screenshot({ path: shotDir + '/receive-invoice-half-line-390x844.png' });
  await row2.locator('[data-f=qty]').fill('1');
  await row2.locator('[data-f=exp]').fill('12/35');
  assert.ok(await ok.isEnabled(), 'completed second line enables confirm');
  // removing a bad line also works
  await row2.locator('[data-f=exp]').fill('');
  assert.ok(await ok.isDisabled());
  await row2.locator('[data-rcv-del]').click();
  assert.ok(await ok.isEnabled(), 'removing the half-filled line re-enables confirm');
  assert.deepEqual(errors, [], 'no page errors');
  console.log('receiving-confirm PASS');
} finally { await browser.close(); }
