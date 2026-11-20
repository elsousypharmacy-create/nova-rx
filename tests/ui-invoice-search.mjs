import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';

const url = new URL(process.env.NOVA_URL || 'http://127.0.0.1:8765/');
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox'],
});
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    serviceWorkers: 'block',
  });
  await context.route('**/*', route => route.request().url().startsWith(url.origin) ? route.continue() : route.abort());
  await context.addInitScript(() => {
    localStorage.setItem('nova-rx-language', 'ar');
    localStorage.setItem('nova-rx-demo-customers-v1', JSON.stringify([
      {id: 'DEMO-search-1', name: 'عميل اختبار أول', phone: '01000000001', tier: 'جديد', visits: 0, points: 0},
      {id: 'DEMO-search-2', name: 'عميل اختبار ثان', phone: '01000000002', tier: 'جديد', visits: 0, points: 0},
    ]));
  });
  const page = await context.newPage();
  await page.goto(new URL('#sale', url).href);
  await expect(page.locator('#novaSplash')).toHaveCount(0);
  const saleSearch = page.locator('#mainSearchInput');
  await expect(saleSearch).toBeFocused();
  await expect(page.locator('#searchModeTag')).toHaveClass(/customer/);

  await saleSearch.fill('عميل اختبار');
  await saleSearch.press('Enter');
  await expect(page.locator('#searchModeTag')).toHaveClass(/customer/);
  await expect(page.locator('#suggestionsBox .suggestion-item.selected')).toHaveCount(0);
  await saleSearch.press('ArrowDown');
  await saleSearch.press('Enter');
  await expect(page.locator('#searchModeTag')).toHaveClass(/product/);

  await page.locator('#btnNewSale').click();
  await expect(saleSearch).toBeFocused();
  await expect(page.locator('#searchModeTag')).toHaveClass(/customer/);
  await saleSearch.fill('٠١٠٠٠٠٠٠٠٠٢');
  await expect(page.locator('#suggestionsBox .suggestion-item')).toHaveCount(1);
  await saleSearch.press('Enter');
  await expect(page.locator('#searchModeTag')).toHaveClass(/product/);

  for (const query of ['', 'zz-no-customer']) {
    await page.locator('#btnNewSale').click();
    await saleSearch.fill(query);
    await saleSearch.press('Enter');
    await expect(page.locator('#searchModeTag')).toHaveClass(/product/);
    await expect(saleSearch).toBeFocused();
  }

  await page.evaluate(() => {
    const makeInvoice = (id, number, phone, customer, at) => window.novaSales.add({
      id, number, customer, phone, at, payment: 'cash',
      lines: [{ name: 'صنف اختبار', qty: 4, price: 25 }], subtotal: 100, total: 100,
    });
    makeInvoice('seed-1', 'S-1042', '01000000002', 'عميل اختبار ثان', '2024-01-01T00:00:00Z');
    makeInvoice('seed-2', 'S-1051', '01000000001', 'عميل اختبار أول', new Date().toISOString());
    const sale = window.novaSales.list().find(x => x.id === 'seed-1');
    window.novaSales.addReturn(sale, {0: 1}, 'اختبار');
  });
  // NAV-01: on phones the page tabs live in the bottom bar
  if (await page.locator('#novaBottomNav [data-bnav="invoices"]').isVisible()) await page.locator('#novaBottomNav [data-bnav="invoices"]').click();
  else await page.locator('.nova-tab[data-page="invoices"]').click();
  const invoiceSearch = page.locator('#novaFilter');
  await expect(invoiceSearch).toBeFocused();
  await invoiceSearch.fill('٠١٠٠٠٠٠٠٠٠٢');
  const rows = page.locator('.nova-invoice-row');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('S-1042');
  await invoiceSearch.fill('');
  await page.locator('[data-inv-per="today"]').click();
  await expect(rows).not.toContainText('S-1042');

  // Keyboard-wedge scanners type the receipt barcode and send Enter.
  await invoiceSearch.pressSequentially('*s-1042*');
  await invoiceSearch.press('Enter');
  const details = page.locator('#novaInvoiceDetails');
  await expect(details).toBeVisible();
  await expect(details).toContainText('المُباع 4 · المرتجع 1 · المتاح للإرجاع 3');
  assert.equal(await page.evaluate(() => window.novaSales.returns().length), 1);
  await details.locator('[data-detail-return]').click();
  await expect(page.locator('[data-ret-idx="0"]')).toHaveAttribute('max', '3');
  await expect(page.locator('[data-ret-idx="0"]')).toHaveValue('0');
  await page.keyboard.press('Escape');
  await expect(invoiceSearch).toBeFocused();
  await invoiceSearch.fill('S-DOES-NOT-EXIST');
  await invoiceSearch.press('Enter');
  await expect(page.locator('#novaInvoiceSearchStatus')).toHaveText('الفاتورة مش موجودة');

  await invoiceSearch.fill('عميل اختبار أول');
  await rows.first().locator('td[data-label="العميل"]').click();
  await expect(details).toContainText('S-1051');
  await details.locator('summary').click();
  await details.locator('[data-detail-cancel]').click();
  await expect(page.locator('#novaCxOk')).toBeVisible();
  await expect(page.locator('#novaRetOk')).toBeHidden();
  console.log('PASS new sale customer search, invoice lookup, partial return and cancel entry');
} finally {
  await browser.close();
}
