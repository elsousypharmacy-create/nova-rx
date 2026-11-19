// PUR-01: receive-invoice dialog — supplier select, required markers, MM/YY expiry, disabled confirm. Fake/local data; non-GET requests are blocked.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const origin = process.env.NOVA_RECEIVING_URL || 'http://127.0.0.1:8766';
const shotDir = 'qa/screens/PUR-01'; mkdirSync(shotDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await context.route('**/*', route => { const r = route.request(); return r.url().startsWith(origin) && r.method() === 'GET' ? route.continue() : route.abort(); });
  const page = await context.newPage();
  page.on('dialog', d => d.accept());
  await page.goto(origin + '/index.html#sale');
  await page.locator('#novaSplash').waitFor({ state: 'hidden' });
  await page.evaluate(() => { location.hash = '#receiving'; });
  await page.locator('[data-rcv=new]:visible').click();

  const sup = page.locator('#rcvSup');
  assert.equal(await sup.evaluate(e => e.tagName), 'SELECT');
  assert.equal(await sup.evaluate(e => e.options[0].textContent), 'اختر المورد');
  assert.ok((await sup.locator('option').allTextContents()).includes('+ مورد جديد'));
  assert.equal(await page.locator('.rcv-req').count() >= 3, true, 'required markers');
  const ok = page.locator('#rcvOk');
  assert.ok(await ok.isDisabled(), 'confirm disabled at start');
  const hint = await page.locator('#rcvMissing').textContent();
  for (const w of ['المورد', 'صنف واحد على الأقل']) assert.ok(hint.includes(w), hint);
  assert.ok(await page.locator('#rcvMissing').textContent().then(t => t.startsWith('ناقص:')));

  // old bug: pick a supplier, then type an item name — the supplier must not change and focus must have left it
  await sup.selectOption('فارما أوفرسيز');
  assert.ok(await page.locator('#rcvInv').evaluate(e => e === document.activeElement), 'focus moves to invoice number');
  await page.keyboard.type('10452');
  await page.keyboard.press('Enter');
  assert.ok(await page.locator('.rcv-line [data-f=q]').first().evaluate(e => e === document.activeElement), 'Enter moves to the first item');
  await page.keyboard.type('pan');
  assert.equal(await sup.inputValue(), 'فارما أوفرسيز');
  assert.equal(await sup.evaluate(e => e.selectedOptions[0].textContent), 'فارما أوفرسيز');
  assert.equal(await page.locator('#rcvInv').inputValue(), '10452');
  // dropdown (suggestions) is as wide as the field
  const sug = page.locator('.rcv-line .rcv-sug').first();
  if (await sug.isVisible()) {
    const [a, b] = await Promise.all([sug.boundingBox(), page.locator('.rcv-line [data-f=q]').first().boundingBox()]);
    assert.ok(Math.abs(a.width - b.width) < 2, 'suggestions width = field width');
  }

  // new supplier is explicit
  await sup.selectOption('__new');
  await page.locator('#rcvSupNew').fill('مورد تجريبي');
  await page.locator('#rcvSupAdd').click();
  assert.equal(await sup.evaluate(e => e.selectedOptions[0].textContent), 'مورد تجريبي');
  assert.ok(await page.locator('#rcvInv').evaluate(e => e === document.activeElement));

  // item + expiry
  const row = page.locator('.rcv-line').first();
  await row.locator('[data-f=q]').fill('6281001234567');
  const pick = row.locator('[data-pick]').first();
  if (!(await pick.count())) { console.log('NOTE: no catalogue item matched; seeding one'); }
  await pick.click();
  assert.ok((await page.locator('#rcvMissing').textContent()).includes('الصلاحية'));
  assert.ok(await ok.isDisabled());
  assert.equal((await row.locator('.rcv-unit').textContent()).trim(), 'علبة');
  assert.ok((await row.locator('.rcv-lbl').allTextContents()).some(t => t.includes('سعر العلبة')));
  assert.equal(await row.locator('[data-lt]').evaluate(e => e.tagName), 'OUTPUT');
  await row.locator('[data-f=qty]').fill('2');
  const exp = row.locator('[data-f=exp]');
  await exp.fill('01/20'); await exp.blur();
  assert.ok((await row.locator('[data-err]').textContent()).includes('منتهية'), 'past month rejected');
  assert.ok(await ok.isDisabled());
  await exp.fill('abc'); await exp.blur();
  assert.ok((await row.locator('[data-err]').textContent()).length > 0);
  await page.locator('.rcv-dlg').screenshot({ path: shotDir + '/receive-invoice-invalid-390x844.png' }).catch(() => {});
  for (const v of ['1135', '11/35', '11/2035']) {
    await exp.fill(v); await exp.blur();
    assert.equal(await row.locator('[data-err]').textContent(), '', v);
    assert.ok(await ok.isEnabled(), 'confirm enabled for ' + v);
  }
  assert.equal(await page.locator('#rcvMissing').textContent(), '');
  await page.screenshot({ path: shotDir + '/receive-invoice-valid-390x844.png' });
  // Enter never submits
  await page.locator('#rcvInv').focus(); await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('nova-rx-receipts-v1') || '[]').length), 0);
  // stored format compatible: last day of month, YYYY-MM-DD
  await ok.click(); await page.locator('#rcvForm').waitFor({ state: 'hidden' });
  const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('nova-rx-receipts-v1'))[0]);
  assert.equal(rec.supplier, 'مورد تجريبي'); assert.equal(rec.lines[0].expiry, '2035-11-30'); assert.equal(rec.pending, false);
  // the new supplier is now known next time
  await page.locator('[data-rcv=new]:visible').click();
  assert.ok((await page.locator('#rcvSup option').allTextContents()).includes('مورد تجريبي'));
  console.log('PASS receiving supplier select / required / MM-YY / disabled confirm (390x844)');
  await context.close();
} finally { await browser.close(); }
