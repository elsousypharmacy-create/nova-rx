import { chromium } from 'playwright';

var BASE = (process.env.NOVA_URL || process.env.NOVA_UX_URL || 'http://127.0.0.1:8765/').replace(/\/?$/, '/');
var BASE_ORIGIN = new URL(BASE).origin;

function assert(cond, msg) {
  if (!cond) {
    throw new Error('Assertion failed: ' + msg);
  }
}

async function run() {
  var browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  var pageErrors = [];
  var dialogs = [];

  try {
    var context = await browser.newContext({
      serviceWorkers: 'block'
    });

    await context.route('**/*', function (route) {
      var req = route.request();
      var url = req.url();
      var isAllowedOrigin = url.indexOf(BASE_ORIGIN) === 0;
      if (req.method() !== 'GET' || !isAllowedOrigin) {
        return route.abort();
      }
      return route.continue();
    });

    await context.addInitScript(function () {
      var now = Date.now();

      var seedSale = {
        id: 'sale-test-1',
        no: 'INV-9001',
        at: now,
        total: 150,
        payment: 'cash',
        by: 'أحمد',
        lines: [
          { name: 'أوجمنتين 1 جم', qty: 2, price: 100, discount: 50 }
        ]
      };

      var seedReturn = {
        id: 'ret-test-1',
        saleId: 'INV-9001',
        at: now,
        kind: 'cancel',
        reason: 'خطأ في الصنف',
        amount: 150,
        by: 'كاشير',
        approvedBy: 'المالك',
        lines: [{ idx: 0, qty: 2 }]
      };

      var seedAdjust = {
        id: 'adj-test-1',
        at: now,
        by: { name: 'سارة' },
        reason: 'جرد دوري',
        note: 'عجز علبتين',
        total: 80,
        lines: [{ name: 'بانادول إكسترا', qty: -2 }]
      };

      var seedCashOut = {
        id: 'co-test-1',
        at: now,
        amount: 200,
        note: 'توصيل طارئ',
        by: 'محمود'
      };

      try {
        localStorage.setItem('nova-rx-sales-v1', JSON.stringify([seedSale]));
        localStorage.setItem('nova-rx-returns-v1', JSON.stringify([seedReturn]));
        localStorage.setItem('nova-rx-stock-adjust-v1', JSON.stringify([seedAdjust]));
        localStorage.setItem('nova-rx-cash-out-v1', JSON.stringify([seedCashOut]));
      } catch (e) {
        // ignore storage errors in init script
      }
    });

    var page = await context.newPage();

    page.on('pageerror', function (err) {
      pageErrors.push(err && err.message ? err.message : String(err));
    });

    page.on('dialog', function (dlg) {
      dialogs.push(dlg.type() + ': ' + dlg.message());
      dlg.dismiss().catch(function () {});
    });

    await page.goto(BASE + (BASE.indexOf('127.0.0.1') >= 0 ? 'index.html' : '') + '#sale', { waitUntil: 'domcontentloaded' });

    await page.evaluate(function () {
      location.hash = '#reports';
    });

    var reportsTab = page.locator('.nova-tab[data-page="reports"]');
    await reportsTab.waitFor({ state: 'visible', timeout: 10000 });
    await reportsTab.click();

    await page.evaluate(function () {
      if (window.novaLazy && typeof window.novaLazy.load === 'function') {
        return window.novaLazy.load();
      }
    });

    var section = page.locator('#novaSensitiveLogSection');
    await section.waitFor({ state: 'visible', timeout: 10000 });

    var rowsLocator = section.locator('tbody[data-role="rows"] tr[data-type]');
    await rowsLocator.first().waitFor({ state: 'visible', timeout: 10000 });

    var sectionText = await section.innerText();
    assert(sectionText.indexOf('سجل العمليات الحساسة') !== -1, 'Missing section title');
    assert(sectionText.indexOf('خصم على صنف') !== -1, 'Missing discount row');
    assert(sectionText.indexOf('إلغاء فاتورة') !== -1, 'Missing cancel row');
    assert(sectionText.indexOf('تسوية مخزون') !== -1, 'Missing stock_adjust row');
    assert(sectionText.indexOf('صرف / دفعة مورد') !== -1, 'Missing cash_out row');
    assert(sectionText.indexOf('خصم كبير') !== -1, 'Missing «خصم كبير» badge for 25% discount');
    assert(sectionText.indexOf('المالك') !== -1, 'Missing approver name «المالك»');

    var initialCount = await rowsLocator.count();
    assert(initialCount >= 4, 'Expected at least 4 rows, got ' + String(initialCount));

    var personInput = section.locator('input[data-filter="person"]');
    await personInput.fill('المالك');

    var filteredCount = await rowsLocator.count();
    assert(filteredCount === 1, 'Expected person filter «المالك» to narrow to 1 row, got ' + String(filteredCount));

    var filteredText = await rowsLocator.first().innerText();
    assert(filteredText.indexOf('كاشير') !== -1 && filteredText.indexOf('المالك') !== -1, 'Filtered row should be the cancellation approved by المالك');

    await personInput.fill('');
    var restoredCount = await rowsLocator.count();
    assert(restoredCount === initialCount, 'Clearing person filter should restore all rows');

    assert(dialogs.length === 0, 'Unexpected native dialogs: ' + dialogs.join('; '));
    assert(pageErrors.length === 0, 'Page errors detected: ' + pageErrors.join('; '));

    console.log('PASS: sensitive-log UX test (' + String(initialCount) + ' rows verified)');
  } finally {
    await browser.close();
  }
}

run().catch(function (err) {
  console.error(err);
  process.exit(1);
});