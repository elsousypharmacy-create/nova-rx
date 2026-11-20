// ITEM-CARD (#104/#105): products-page row opens «كارت الصنف» (lots, movement timeline, opening stock, balance check);
// a damage adjustment reduces the lot and shows −qty. Fake/local data; external and non-GET requests blocked.
import { chromium } from 'playwright';

const BASE = (process.env.NOVA_URL || process.env.NOVA_UX_URL || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
const baseOrigin = new URL(BASE).origin;

function assert(cond, msg) {
  if (!cond) throw new Error('Assertion failed: ' + msg);
}

async function run() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  const context = await browser.newContext({ serviceWorkers: 'block' });

  await context.route('**/*', (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (method !== 'GET' || !url.startsWith(baseOrigin)) {
      return route.abort();
    }
    return route.continue();
  });

  const page = await context.newPage();
  const pageErrors = [];
  const nativeDialogs = [];

  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('dialog', async (dlg) => {
    nativeDialogs.push(dlg.type() + ': ' + dlg.message());
    await dlg.dismiss();
  });

  try {
    await page.goto(BASE + (BASE.includes('127.0.0.1') ? 'index.html' : '') + '#sale', { waitUntil: 'domcontentloaded' });
    await page.locator('#novaSplash').waitFor({ state: 'hidden', timeout: 15000 });

    // Pick a product with a barcode and seed a lot
    const seeded = await page.evaluate(() => {
      const queries = ['6281001234567', 'panadol', 'a'];
      let prod = null;
      for (let i = 0; i < queries.length; i++) {
        const list = window.novaSearch && window.novaSearch.search(queries[i], 1);
        if (list && list[0] && (list[0].barcode || list[0].code)) {
          prod = list[0];
          break;
        }
      }
      if (!prod) throw new Error('No product with barcode found');
      const key = window.novaStock.keyOf(prod);
      const barcode = String(prod.barcode || prod.code).trim();
      window.novaStock.addLot({
        key: key,
        lot: 'L1',
        expiry: '2027-01-31',
        qty: 10,
        cost: 5
      });
      return { key: key, barcode: barcode, name: prod.name || '' };
    });

    // Navigate to products page
    await page.evaluate(() => { location.hash = '#products'; });
    await page.evaluate(() => { const t = document.querySelector('.nova-tab[data-page="products"]'); if (t && !t.classList.contains('active')) t.click(); });
    await page.locator('.nova-prod-panel').waitFor({ state: 'visible', timeout: 10000 });

    // Find row; type barcode in products search if not immediately visible
    let targetRow = page.locator('.nova-prod-panel tr.nova-row-focus', { hasText: seeded.barcode }).first();
    if (!(await targetRow.isVisible().catch(() => false))) {
      await page.locator('#novaFilter').fill(seeded.barcode);
      await page.waitForTimeout(600);
    }
    targetRow = page.locator('.nova-prod-panel tr.nova-row-focus:visible', { hasText: seeded.barcode }).first();
    await targetRow.waitFor({ state: 'visible', timeout: 10000 });

    await targetRow.click();

    // Verify item card dialog opens with L1 onHand 10 and opening stock row of 10
    const dialog = page.locator('.nova-ic-dialog[role="dialog"]');
    await dialog.waitFor({ state: 'visible', timeout: 5000 });

    const onHandBefore = await dialog.locator('[data-ic-onhand]').textContent();
    assert(onHandBefore.trim() === '10', 'Expected initial onHand 10, got ' + onHandBefore);

    const dialogTextBefore = await dialog.textContent();
    assert(dialogTextBefore.includes('L1'), 'Expected lot L1 in card');
    assert(dialogTextBefore.includes('رصيد افتتاحي/يدوي'), 'Expected opening stock row');
    assert(dialogTextBefore.includes('+10'), 'Expected +10 in opening stock row');

    // Open adjustment form and record adjustment of 2 "تالف أو كسر"
    await dialog.locator('[data-ic-act="open-adj"]').click();
    await dialog.locator('#nova-ic-adj-form').waitFor({ state: 'visible', timeout: 5000 });

    await dialog.locator('#nova-ic-qty').fill('2');
    await dialog.locator('#nova-ic-reason').selectOption('تالف أو كسر');
    await dialog.locator('#nova-ic-adj-submit').click();

    // Verify refreshed state: banner, onHand 8, timeline -2, no warning
    await dialog.locator('.nova-ic-banner-ok').waitFor({ state: 'visible', timeout: 5000 });
    const bannerText = await dialog.locator('.nova-ic-banner-ok').textContent();
    assert(bannerText.includes('اتسجلت التسوية'), 'Expected success banner, got ' + bannerText);

    const onHandAfter = await dialog.locator('[data-ic-onhand]').textContent();
    assert(onHandAfter.trim() === '8', 'Expected onHand 8 after adjustment, got ' + onHandAfter);

    const dialogTextAfter = await dialog.textContent();
    assert(dialogTextAfter.includes('\u22122'), 'Expected −2 in timeline');
    assert(!dialogTextAfter.includes('فيه فرق — راجع الجرد'), 'Unexpected mismatch warning in check line');

    assert(nativeDialogs.length === 0, 'Native dialogs triggered: ' + nativeDialogs.join('; '));
    assert(pageErrors.length === 0, 'Page errors: ' + pageErrors.join('; '));

    console.log('PASS: item-card.mjs');
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});