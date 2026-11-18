import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const origin = process.env.NOVA_RECEIVING_URL || 'http://127.0.0.1:8790';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const [linked, width, height] of [[false, 1280, 800], [true, 1280, 800], [false, 1440, 900], [true, 1440, 900]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width === 1280 });
    await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on('dialog', dialog => dialog.accept());
    await page.goto(origin + '/purchases.html');
    if (linked) {
      await page.locator('.tools-menu summary').click();
      await page.locator('#openPo').click();
      await page.locator('#poSupplier').fill('Test supplier');
      await page.locator('#poLines').fill('6281001234567,4,25\n6281001234568,4,25');
      await page.locator('#poCreate').click();
      await page.locator('#poList [data-state="draft"]').getByRole('button', { name: 'إرسال', exact: true }).click();
      await page.locator('#poList [data-state="sent"]').getByRole('button', { name: 'قبول المورد', exact: true }).click();
      await page.locator('#poList [data-state="accepted"]').waitFor();
      await page.locator('#closePo').click();
    } else {
      await page.locator('#modeManual').click();
      assert.ok(await page.locator('#search').evaluate(input => input === document.activeElement));
    }
    await page.goto(origin + '/index.html#sale');
    await page.locator('#novaSplash').waitFor({ state: 'hidden' });
    await page.locator('#novaOpsNav summary').click();
    await page.locator('#novaOpsNav [data-page=receiving]').click();
    assert.equal(await page.locator('[data-rcv=new]:visible').count(), 1);
    await page.locator(linked ? '[data-rcv-po]' : '[data-rcv=new]').click();
    await page.locator('#rcvSup').fill('Test supplier');
    await page.locator('#rcvInv').fill('TEST-RESUME');
    const codes = ['6281001234567', '6281001234568'];
    for (const [index, code] of codes.entries()) {
      if (!linked && index) await page.locator('[data-rcv-add]').click();
      const row = page.locator('.rcv-line').nth(index);
      if (!linked) {
        await row.locator('[data-f=q]').fill(code);
        await row.locator('[data-pick]').first().click();
      }
      const quantity = row.locator('[data-f=qty]');
      await quantity.fill('4');
      await quantity.press('Enter');
      assert.ok(await row.locator('[data-f=exp]').evaluate(input => input === document.activeElement));
      await row.locator('[data-f=exp]').fill('2035-12');
      await row.locator('[data-f=cost]').fill('25');
    }
    await page.evaluate(() => {
      const write = Storage.prototype.setItem;
      let attempts = 0;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'nova-rx-lots-v1' && ++attempts === 2) throw new Error('simulated storage failure');
        return write.call(this, key, value);
      };
    });
    await page.locator('#rcvOk').click();
    await page.locator('#rcvMsg').getByText('اتحفظ 1 من 2', { exact: false }).waitFor();
    await page.reload();
    await page.locator('[data-rcv-resume]').click();
    assert.equal(await page.locator('.rcv-line:visible').count(), 1);
    assert.equal(await page.locator('#rcvInv').inputValue(), 'TEST-RESUME');
    await page.locator('#rcvOk').click();
    await page.locator('#rcvForm').waitFor({ state: 'hidden' });
    const receipt = await page.evaluate(() => {
      const [entry] = JSON.parse(localStorage.getItem('nova-rx-receipts-v1'));
      return { pending: entry.pending, stock: entry.lines.map(line => window.novaStock.lots(line.key).find(lot => lot.lot === line.lot)?.onHand) };
    });
    assert.deepEqual(receipt, { pending: false, stock: [4, 4] });
    if (linked) assert.equal(await page.locator('[data-rcv-po]').count(), 0);
    await page.locator('[data-rcv=new]').first().click();
    await page.locator('#rcvSup').fill('Test supplier');
    await page.locator('#rcvInv').fill('TEST-RESUME');
    await page.locator('#rcvOk').click();
    await page.locator('#rcvMsg').getByText('اتسجلت قبل كده', { exact: false }).waitFor();
    console.log(`PASS ${width}×${height}: ${linked ? 'linked order' : 'manual receipt'} resumes exactly once`);
    await context.close();
  }
} finally { await browser.close(); }
