// tests/ux/customer-requests.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const full = path.resolve(ROOT, rel);
  if ((full !== ROOT && !full.startsWith(ROOT + path.sep)) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  const ext = path.extname(full);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true
});

try {
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('__ncr_cleared__')) {
      localStorage.clear();
      sessionStorage.setItem('__ncr_cleared__', '1');
    }
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  const apiRes = await page.evaluate(async () => {
    if (window.novaLazy && typeof window.novaLazy.load === 'function') {
      await window.novaLazy.load();
    }
    const CR = window.novaCustomerRequests;

    // Corrupt JSON must not crash
    localStorage.setItem('nova-rx-customer-requests-v1', '{bad-json');
    const corruptListLen = CR.list().length;
    localStorage.removeItem('nova-rx-customer-requests-v1');

    window.NOVA_DEMO = window.NOVA_DEMO || { products: [] };
    const prod = { id: 'req-prod-1', name: 'دواء اختبار ٥٠٠', barcode: '622999111222', price: 45 };
    window.NOVA_DEMO.products.push(prod);
    const key = window.novaStock.keyOf(prod);

    const noCustomer = CR.add({ customer: '', phone: '01012345678', item: prod.name, itemKey: key });
    const noItem = CR.add({ customer: 'أحمد', phone: '01012345678', item: '', itemKey: key });
    const badPhone = CR.add({ customer: 'أحمد', phone: '01312345678', item: prod.name, itemKey: key });

    const req1 = CR.add({
      customer: 'أحمد علي',
      phone: '٠١٠١٢٣٤٥٦٧٨',
      item: prod.name,
      itemKey: key,
      qty: '٢',
      note: 'مساءً'
    });

    const arrivedBefore = CR.arrived().length;

    window.novaStock.addLot({ key: key, lot: 'LR1', expiry: '2030-01-31', qty: 5, cost: 30 });
    const arrivedAfter = CR.arrived();
    const link = CR.waLink(req1.id);

    const req2 = CR.add({ customer: 'منى حسن', phone: '', item: 'صنف غير مربوط', itemKey: '' });
    const unlinkedInArrived = CR.arrived().some((r) => r.id === req2.id);
    const linkNoPhone = CR.waLink(req2.id);

    const notified1 = CR.markNotified(req2.id);
    const notified2 = CR.markNotified(req2.id);
    const cancelNoReason = CR.close(req2.id, '');
    const cancelWithReason = CR.close(req2.id, 'العميل غير رأيه');
    const doubleClose = CR.close(req2.id, 'سبب آخر');
    const notifyClosed = CR.markNotified(req2.id);

    // 500-record cap drops closed records first
    const savedBeforeCap = localStorage.getItem('nova-rx-customer-requests-v1');
    const bulk = [];
    for (let i = 0; i < 499; i++) {
      bulk.push({
        id: 'open_' + i,
        at: '2026-01-01T00:00:00.000Z',
        by: '',
        customer: 'عميل ' + i,
        phone: '',
        item: 'صنف',
        itemKey: '',
        qty: 1,
        note: '',
        status: 'open'
      });
    }
    bulk.push({
      id: 'closed_drop_me',
      at: '2026-01-01T00:00:00.000Z',
      by: '',
      customer: 'مغلق',
      phone: '',
      item: 'صنف',
      itemKey: '',
      qty: 1,
      note: '',
      status: 'closed',
      closeReason: 'delivered'
    });
    localStorage.setItem('nova-rx-customer-requests-v1', JSON.stringify(bulk));
    CR.add({ customer: 'عميل ٥٠٠', phone: '', item: 'صنف جديد' });
    const afterCap = CR.list();
    const capLen = afterCap.length;
    const closedDropped = !afterCap.some((r) => r.id === 'closed_drop_me');
    localStorage.setItem('nova-rx-customer-requests-v1', savedBeforeCap);

    return {
      corruptListLen,
      noCustomer,
      noItem,
      badPhone,
      req1,
      arrivedBefore,
      arrivedAfterCount: arrivedAfter.length,
      arrivedAfterId: arrivedAfter[0] && arrivedAfter[0].id,
      link,
      unlinkedInArrived,
      linkNoPhone,
      notifiedAt1: notified1 && notified1.notifiedAt,
      notifiedAt2: notified2 && notified2.notifiedAt,
      notifiedStatus: notified1 && notified1.status,
      cancelNoReason,
      cancelStatus: cancelWithReason && cancelWithReason.status,
      cancelReason: cancelWithReason && cancelWithReason.closeReason,
      doubleClose,
      notifyClosed,
      capLen,
      closedDropped
    };
  });

  assert.equal(apiRes.corruptListLen, 0, 'corrupt JSON returns empty list without crashing');
  assert.equal(apiRes.noCustomer, false, 'add without customer must be refused');
  assert.equal(apiRes.noItem, false, 'add without item must be refused');
  assert.equal(apiRes.badPhone, false, 'bad phone must be refused');
  assert.equal(apiRes.req1.phone, '01012345678', 'Arabic-Indic phone normalised');
  assert.equal(apiRes.req1.qty, 2, 'Arabic-Indic qty normalised');
  assert.equal(apiRes.arrivedBefore, 0, '0 stock item not in arrived()');
  assert.equal(apiRes.arrivedAfterCount, 1, 'item in arrived() after addLot');
  assert.equal(apiRes.arrivedAfterId, apiRes.req1.id);
  assert.ok(apiRes.link && apiRes.link.startsWith('https://wa.me/201012345678?text='), 'waLink has 2010...');
  assert.ok(apiRes.link.includes(encodeURIComponent('أحمد علي')), 'waLink has encoded customer name');
  assert.equal(apiRes.unlinkedInArrived, false, 'unlinked request never auto-arrives');
  assert.equal(apiRes.linkNoPhone, null, 'waLink is null when no phone');
  assert.ok(apiRes.notifiedAt1, 'markNotified sets notifiedAt');
  assert.equal(apiRes.notifiedAt1, apiRes.notifiedAt2, 'markNotified is idempotent');
  assert.equal(apiRes.notifiedStatus, 'notified');
  assert.equal(apiRes.cancelNoReason, false, 'cancel without reason refused');
  assert.equal(apiRes.cancelStatus, 'closed', 'cancel with reason closes');
  assert.equal(apiRes.cancelReason, 'العميل غير رأيه');
  assert.equal(apiRes.doubleClose, false, 'closing an already-closed record refused');
  assert.equal(apiRes.notifyClosed, false, 'markNotified on closed record refused');
  assert.equal(apiRes.capLen, 500, 'storage keeps at most 500 records');
  assert.equal(apiRes.closedDropped, true, 'closed records dropped before open records');

  const tabClicked = await page.evaluate(() => {
    const tab = document.querySelector('.nova-tab[data-page="products"]');
    if (!tab) return false;
    tab.click();
    return true;
  });
  await page.evaluate(id => window.novaPageViews.openTool(id), 'novaCustomerRequests'); await page.waitForTimeout(400); // Q21-2c: the card is a tool in «الأدوات»
  assert.equal(tabClicked, true, 'products tab exists and was clicked');

  await page.waitForSelector('#novaCustomerRequests', { timeout: 5000 });
  assert.equal(await page.locator('#novaCustomerRequests').count(), 1, 'card mounted once');
  assert.equal(await page.locator('#ncrArrivedBadge').textContent(), '1', 'arrived badge shows 1');

  // Verify in-app cancel dialog (no window.confirm) & no horizontal overflow
  await page.locator('#ncrArrivedList .ncr-row button', { hasText: /إلغاء|Cancel/ }).first().click();
  await page.waitForSelector('.ncr-dialog', { timeout: 3000 });
  const dialogOverflow = await page.evaluate(() => {
    const dlg = document.querySelector('.ncr-dialog');
    const inp = dlg && dlg.querySelector('input');
    return {
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      inpFits: inp ? inp.getBoundingClientRect().right <= dlg.getBoundingClientRect().right + 1 : false
    };
  });
  assert.ok(dialogOverflow.sw <= dialogOverflow.cw, 'no overflow with cancel dialog open');
  assert.equal(dialogOverflow.inpFits, true, 'dialog input fits inside dialog');
  await page.locator('.ncr-dialog button', { hasText: /رجوع|Back/ }).click();

  const lay = await page.evaluate(() => {
    const c = document.getElementById('novaCustomerRequests');
    const small = [...c.querySelectorAll('button,input')].filter((x) => x.offsetParent && x.getBoundingClientRect().height < 43).length;
    return {
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      small,
      bg: getComputedStyle(c).backgroundColor
    };
  });
  assert.ok(lay.sw <= lay.cw, 'no horizontal overflow at 390px: ' + lay.sw + '>' + lay.cw);
  assert.equal(lay.small, 0, 'all visible controls at least 44px high');
  assert.ok(lay.bg.match(/[0-9]+/g).slice(0, 3).every((n) => +n < 50), 'dark card background');

  assert.equal(errors.length, 0, 'page errors: ' + errors.join('|'));
  console.log('customer-requests PASS');
} finally {
  await browser.close();
  server.close();
}