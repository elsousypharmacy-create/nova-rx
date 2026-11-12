// POS-05: Arabic PDF receipt, 58mm/80mm thermal layouts with SVG barcode,
// printer disconnect/reconnect recovery, reprint with copy mark, and mock Bluetooth scanner
// across desktop and tablet layouts.
// Run against a static server on PORT (default 8765):
//   python3 -m http.server 8765 --bind 127.0.0.1 &
//   node tests/ui-pos05-receipt-scanner.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const BASE = process.env.BASE_URL || process.env.NOVA_URL || 'http://127.0.0.1:8765/index.html';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });

try {
  // 1. Desktop (mouse) layout + full receipt, thermal 58/80mm, barcode, PDF, printer disconnect, reprint, and Bluetooth scanner flow
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: false });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));

    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Install print spy
    await page.evaluate(() => {
      window.__printCalls = 0;
      window.print = () => { window.__printCalls += 1; };
    });

    // Mock Bluetooth scanner: scan while in initial CUSTOMER mode should switch to PRODUCT and add item
    const scan1 = await page.evaluate(() => window.novaScanner.scan('6281001234567'));
    assert.equal(scan1.ok, true, 'Bluetooth scanner should add Concor 5mg');
    assert.equal(scan1.lines, 1);

    // Scan unknown barcode -> not-found, lines unchanged
    const scanUnknown = await page.evaluate(() => window.novaScanner.scan('9999999999'));
    assert.equal(scanUnknown.ok, false);
    assert.equal(scanUnknown.error, 'not-found');

    // Disconnect Bluetooth scanner -> scanner-disconnected, lines unchanged
    const scanOffline = await page.evaluate(() => {
      window.novaScanner.setConnected(false);
      const res = window.novaScanner.scan('6281001234568');
      window.novaScanner.setConnected(true);
      return res;
    });
    assert.equal(scanOffline.ok, false);
    assert.equal(scanOffline.error, 'scanner-disconnected');

    // Scan second product after reconnecting Bluetooth scanner
    const scan2 = await page.evaluate(() => window.novaScanner.scan('6281001234568'));
    assert.equal(scan2.ok, true);
    assert.equal(scan2.lines, 2);

    // Complete sale to open receipt modal
    await page.click('#btnCheckout');
    await page.click('#btnConfirmPayment');
    await page.waitForSelector('#receiptModal.active');

    // Verify original receipt content: Arabic headers, invoice number, SVG barcode, no COPY mark
    const origReceipt = await page.evaluate(() => {
      const slip = document.getElementById('receiptSlipContent');
      const doc = slip.querySelector('.nova-receipt-doc');
      const svg = slip.querySelector('svg.receipt-barcode-svg');
      const rects = svg ? svg.querySelectorAll('rect').length : 0;
      const copyEl = slip.querySelector('[data-receipt-copy="true"]');
      return {
        widthAttr: slip.getAttribute('data-width'),
        boxWidth: Math.round(slip.getBoundingClientRect().width),
        number: doc?.getAttribute('data-receipt-number'),
        isCopy: doc?.getAttribute('data-is-copy'),
        hasCopyBanner: !!copyEl,
        text: slip.innerText,
        barcodeValue: svg?.getAttribute('data-barcode-value'),
        barcodeRects: rects
      };
    });

    assert.equal(origReceipt.widthAttr, '80mm', 'default thermal width should be 80mm');
    assert.ok(origReceipt.number && origReceipt.number.startsWith('S-'), `expected sale number, got ${origReceipt.number}`);
    assert.equal(origReceipt.isCopy, 'false', 'first receipt after checkout must not be marked as copy');
    assert.equal(origReceipt.hasCopyBanner, false, 'original receipt must not display copy banner');
    assert.ok(origReceipt.text.includes('صيدلية السوسي'), 'receipt must include Arabic pharmacy header');
    assert.ok(origReceipt.text.includes('الإجمالي المستحق'), 'receipt must include Arabic net total label');
    assert.equal(origReceipt.barcodeValue, origReceipt.number, 'SVG barcode must encode invoice number');
    assert.ok(origReceipt.barcodeRects >= 25, `SVG barcode should render bars, got ${origReceipt.barcodeRects}`);

    // Switch to 58mm thermal layout and verify narrower width + persistence
    await page.click('#btnReceiptWidth58');
    const width58 = await page.evaluate(() => {
      const slip = document.getElementById('receiptSlipContent');
      return {
        widthAttr: slip.getAttribute('data-width'),
        boxWidth: Math.round(slip.getBoundingClientRect().width),
        stored: localStorage.getItem('nova-rx-receipt-width-v1'),
        text: slip.innerText
      };
    });
    assert.equal(width58.widthAttr, '58mm');
    assert.equal(width58.stored, '58mm');
    assert.ok(width58.text.includes('(58mm)'), '58mm receipt header should indicate 58mm thermal layout');
    assert.ok(width58.boxWidth < origReceipt.boxWidth, `58mm slip (${width58.boxWidth}px) must be narrower than 80mm slip (${origReceipt.boxWidth}px)`);

    // Switch back to 80mm and verify
    await page.click('#btnReceiptWidth80');
    assert.equal(await page.getAttribute('#receiptSlipContent', 'data-width'), '80mm');

    // Export Arabic PDF receipt via download button and inspect PDF bytes
    const downloadPromise = page.waitForEvent('download');
    await page.click('#btnExportReceiptPdf');
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), `receipt-${origReceipt.number}.pdf`);
    const pdfPath = await download.path();
    const pdfContent = await fs.readFile(pdfPath, 'utf8');
    assert.ok(pdfContent.startsWith('%PDF-1.4'), 'exported file must be a valid PDF-1.4 document');
    assert.ok(pdfContent.includes('/Lang (ar-EG)'), 'PDF catalog must declare Arabic language');
    assert.ok(pdfContent.includes(origReceipt.number), 'PDF must contain the invoice number');
    assert.ok(pdfContent.includes('<FEFF0635064A062F0644064A0629'), 'PDF must contain UTF-16BE encoded Arabic pharmacy title');
    assert.ok(pdfContent.includes('ORIGINAL'), 'original PDF must be marked ORIGINAL');

    // Printer disconnect handling: toggle printer offline, attempt print -> alert shown, window.print not called
    await page.click('#btnPrinterStatus');
    const offlineState = await page.getAttribute('#btnPrinterStatus', 'data-connected');
    assert.equal(offlineState, 'false', 'clicking printer toggle should simulate printer disconnect');

    await page.click('#btnPrintReceiptBtn');
    const afterDisconnectPrint = await page.evaluate(() => ({
      printCalls: window.__printCalls,
      alertHidden: document.getElementById('receiptPrinterAlert').hidden
    }));
    assert.equal(afterDisconnectPrint.printCalls, 0, 'window.print must not run while printer is disconnected');
    assert.equal(afterDisconnectPrint.alertHidden, false, 'disconnect alert banner must become visible');

    // Reconnect & Retry button should restore connection, hide alert, and invoke print
    await page.click('#btnReconnectPrinter');
    const afterReconnect = await page.evaluate(() => ({
      connected: document.getElementById('btnPrinterStatus').getAttribute('data-connected'),
      alertHidden: document.getElementById('receiptPrinterAlert').hidden,
      printCalls: window.__printCalls
    }));
    assert.equal(afterReconnect.connected, 'true');
    assert.equal(afterReconnect.alertHidden, true);
    assert.equal(afterReconnect.printCalls, 1, 'reconnect & retry must execute the queued print job');

    // Reprint with copy mark from inside the receipt modal
    await page.click('#btnReprintReceipt');
    const afterReprint1 = await page.evaluate(() => {
      const slip = document.getElementById('receiptSlipContent');
      const doc = slip.querySelector('.nova-receipt-doc');
      const copyEl = slip.querySelector('[data-receipt-copy="true"]');
      return {
        isCopy: doc?.getAttribute('data-is-copy'),
        copyText: copyEl?.textContent?.trim() || '',
        reprintCount: window.novaReceipt.reprintCount(doc?.getAttribute('data-receipt-number')),
        printCalls: window.__printCalls
      };
    });
    assert.equal(afterReprint1.isCopy, 'true');
    assert.ok(afterReprint1.copyText.includes('نسخة مكررة — COPY'), `expected copy banner, got ${afterReprint1.copyText}`);
    assert.equal(afterReprint1.reprintCount, 1);
    assert.equal(afterReprint1.printCalls, 2);

    // Export PDF while in copy state -> filename & content reflect COPY
    const copyPdf = await page.evaluate(() => window.novaReceipt.buildPdf());
    assert.ok(copyPdf.filename.endsWith('-copy.pdf'), `expected -copy.pdf filename, got ${copyPdf.filename}`);
    assert.ok(copyPdf.text.includes('COPY #1'), 'copy PDF must include COPY #1 mark');

    // Close receipt modal (from checkout -> starts new sale)
    await page.click('#btnReceiptNewSale');
    await page.waitForFunction(() => !document.getElementById('receiptModal').classList.contains('active'));

    // Add an item to active cart, then go to Invoices tab and reprint the saved invoice -> copy #2, and closing does NOT wipe active cart
    await page.evaluate(() => window.novaScanner.scan('6281001234567'));
    await page.click('.nova-tab[data-page="invoices"]');
    await page.click('[data-reprint]');
    await page.waitForSelector('#receiptModal.active');

    const afterReprint2 = await page.evaluate(() => {
      const slip = document.getElementById('receiptSlipContent');
      const copyEl = slip.querySelector('[data-receipt-copy="true"]');
      return {
        copyText: copyEl?.textContent?.trim() || '',
        count: window.novaReceipt.reprintCount(
          slip.querySelector('.nova-receipt-doc')?.getAttribute('data-receipt-number')
        )
      };
    });
    assert.ok(afterReprint2.copyText.includes('COPY #2'), `second reprint should show COPY #2, got ${afterReprint2.copyText}`);
    assert.equal(afterReprint2.count, 2);

    // Close reprinted receipt opened from Invoices tab and confirm active cart still has its item
    await page.click('#btnReceiptNewSale');
    await page.click('.nova-tab[data-page="sale"]');
    const cartCountAfterReprintClose = await page.locator('#invoiceTableBody tr[data-id]').count();
    assert.equal(cartCountAfterReprintClose, 1, 'closing a reprint opened from Invoices must not clear an in-progress sale cart');

    assert.deepEqual(errors, []);
    await ctx.close();
  }

  // 2. Tablet (touch / coarse pointer) layout verification at 1280x800
  {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      hasTouch: true,
      isMobile: true
    });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      window.print = () => {};
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.evaluate(() => window.novaScanner.scan('6281001234567'));
    await page.click('#btnCheckout');
    await page.click('#btnConfirmPayment');
    await page.waitForSelector('#receiptModal.active');

    const tabletMetrics = await page.evaluate(() => {
      const modal = document.querySelector('#receiptModal .modal-card');
      const mRect = modal.getBoundingClientRect();
      const ids = ['btnReceiptWidth80', 'btnReceiptWidth58', 'btnPrinterStatus', 'btnPrintReceiptBtn', 'btnReprintReceipt', 'btnExportReceiptPdf', 'btnReceiptNewSale'];
      const buttons = ids.map(id => {
        const r = document.getElementById(id).getBoundingClientRect();
        return { id, height: Math.round(r.height), width: Math.round(r.width) };
      });
      return {
        overflowX: document.documentElement.scrollWidth > window.innerWidth,
        modalFitsViewport: mRect.left >= 0 && mRect.right <= window.innerWidth && mRect.top >= 0 && mRect.bottom <= window.innerHeight,
        buttons
      };
    });

    assert.equal(tabletMetrics.overflowX, false, 'tablet layout must not overflow horizontally');
    assert.equal(tabletMetrics.modalFitsViewport, true, 'receipt modal must fit inside 1280x800 tablet viewport');
    for (const b of tabletMetrics.buttons) {
      assert.ok(b.height >= 44, `tablet button #${b.id} must meet 44px touch target height (got ${b.height}px)`);
    }

    await ctx.close();
  }

  console.log('PASS ui-pos05-receipt-scanner: Arabic PDF, 58/80mm thermal + barcode, printer disconnect/reconnect, copy mark reprint, Bluetooth scanner, desktop & tablet');
} finally {
  await browser.close();
}
