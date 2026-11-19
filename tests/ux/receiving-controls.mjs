import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// PERF-02: receipt-before.html is main's index.html (a shell). Its split files /assets/app-*.<hash> may not exist in this
// checkout when the branch changed them, so serve those from the fetched main commit instead.
const mainAsset = (p) => { for (const ref of ['FETCH_HEAD', 'origin/main']) { try { return execFileSync('git', ['show', ref + ':' + p], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }); } catch {} } return null; };

const origin = process.env.NOVA_RECEIVING_URL || 'http://127.0.0.1:8766';
const output = process.env.NOVA_RECEIVING_OUTPUT || 'reports/receiving';
fs.mkdirSync(output, { recursive: true });
async function prepareReceipt(page) {
  await page.evaluate(async () => {
      await window.novaAuth.createAccount({ name: 'Test operator', password: 'test-local-123' });
      await window.novaAuth.signIn('Test operator', 'test-local-123');
      const store = window.NovaPurchaseOrders.createStore(localStorage, window.NovaStockLedger.createLedger(localStorage));
      const order = store.create({ supplier: 'مورد الاختبار', lines: [
        { code: '6281001234567', name: 'صنف الاختبار الأول', qty: 10, cost: 25 },
        { code: '6281001234568', name: 'صنف الاختبار الثاني', qty: 8, cost: 30 }
      ] });
      store.send(order.id, { confirmed: true });
      window.novaReceiving.render();
    });
    await page.locator('[data-rcv-po]').click();
    await page.locator('#rcvInv').fill('TEST-550');
    for (const [index, quantity, cost] of [[0, 4, 27], [1, 9, 30]]) {
      const row = page.locator('.rcv-line').nth(index);
      await row.locator('[data-f=qty]').fill(String(quantity));
      await row.locator('[data-f=exp]').fill('2035-12');
      await row.locator('[data-f=cost]').fill(String(cost));
    }
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  for (const width of [1280, 1440]) {
    if (fs.existsSync('receipt-before.html')) {
      const beforeContext = await browser.newContext({ viewport: { width, height: width === 1280 ? 800 : 900 } });
      await beforeContext.route('**/*', route => {
        const url = route.request().url();
        if (!url.startsWith(origin)) return route.abort();
        const p = new URL(url).pathname.slice(1);
        if (/^assets\/app-[\w.-]+\.(js|css)$/.test(p) && !fs.existsSync(p)) {
          const body = mainAsset(p);
          if (body) return route.fulfill({ status: 200, contentType: p.endsWith('.js') ? 'application/javascript' : 'text/css', body });
        }
        return route.continue();
      });
      const beforePage = await beforeContext.newPage();
      beforePage.on('dialog', dialog => dialog.accept());
      await beforePage.goto(origin + '/receipt-before.html#receiving');
      await beforePage.locator('#novaSplash').waitFor({ state: 'hidden' });
      await prepareReceipt(beforePage);
      await beforePage.screenshot({ path: `${output}/before-review-${width}.png` });
      await beforeContext.close();
    }
    const context = await browser.newContext({ viewport: { width, height: width === 1280 ? 800 : 900 }, hasTouch: width === 1280 });
    await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(origin + '/index.html#receiving');
    await page.locator('#novaSplash').waitFor({ state: 'hidden' });
    await prepareReceipt(page);
    const review = page.locator('#rcvReview');
    assert.ok((await review.innerText()).includes('سعر الطلبية'));
    assert.equal(await review.locator('tbody tr').count(), 2);
    assert.equal(await review.locator('.rcv-difference').count(), 2);
    await page.screenshot({ path: `${output}/after-review-${width}.png` });
    await page.locator('#rcvOk').click();
    await page.locator('#rcvForm').waitFor({ state: 'hidden' });
    const receiptId = await page.evaluate(() => JSON.parse(localStorage.getItem('nova-rx-receipts-v1'))[0].id);
    await page.locator('.rcv-row summary').click();
    await page.locator('[data-rcv-correct]').click();
    await page.locator('[data-correct-index="0"]').fill('3');
    await page.locator('#rcvCorrectionReason').fill('تصحيح عد العبوات');
    await page.screenshot({ path: `${output}/after-correction-${width}.png` });
    await page.locator('#rcvCorrectionSave').click();
    await page.getByRole('dialog', { name: 'حركة المخزون · فاتورة TEST-550', exact: true }).waitFor();
    assert.ok((await page.getByRole('dialog').innerText()).includes('Test operator'));
    await page.screenshot({ path: `${output}/after-audit-${width}.png` });
    const check = await page.evaluate(id => {
      const receipt = JSON.parse(localStorage.getItem('nova-rx-receipts-v1')).find(row => row.id === id);
      const order = JSON.parse(localStorage.getItem('nova.purchase.orders'))[0];
      const stock = window.novaStock.lots(receipt.lines[0].key)[0].onHand;
      return { qty: receipt.lines[0].qty, corrections: receipt.corrections.length, received: order.lines[0].received, stock };
    }, receiptId);
    assert.deepEqual(check, { qty: 4, corrections: 1, received: 3, stock: 3 });
    await page.getByRole('dialog').getByRole('button', { name: 'إغلاق', exact: true }).click();
    await page.locator('[data-rcv-order]').first().click();
    await page.locator('[data-rcv-close-rest]').click();
    await page.locator('#rcvCloseReason').fill('المورد أكد عدم توفر الباقي');
    await page.screenshot({ path: `${output}/after-remainder-${width}.png` });
    await page.locator('#rcvCloseSave').click();
    await page.locator('#rcvCloseSave').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('[data-rcv-po]').count(), 0);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('nova.purchase.orders'))[0].state), 'closed-short');
    await page.locator('.rcv-row summary').click();
    await page.locator('[data-rcv-order]').click();
    assert.ok((await page.getByRole('dialog').innerText()).includes('المورد أكد عدم توفر الباقي'));
    await page.locator('[data-open-receipt]').click();
    assert.equal(await page.locator('.rcv-row').getAttribute('open'), '');
    await page.reload();
    await page.locator('.rcv-row summary').click();
    await page.locator('[data-rcv-moves]').click();
    assert.ok((await page.getByRole('dialog').innerText()).includes('تصحيح عد العبوات'));
    await page.getByRole('dialog').getByRole('button', { name: 'إغلاق', exact: true }).click();
    await page.goto(origin + '/purchases.html');
    await page.locator('.tools-menu summary').click();
    await page.locator('#openPo').click();
    await page.getByRole('link', { name: 'تفاصيل الطلبية وفواتير الاستلام' }).click();
    await page.getByRole('dialog', { name: 'الطلبية PO-1', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}: review, audited correction, remainder closure, reload and linked navigation`);
    await context.close();
  }
} finally { await browser.close(); }
