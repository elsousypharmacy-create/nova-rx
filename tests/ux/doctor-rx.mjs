// tests/ux/doctor-rx.mjs
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
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
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
    if (!sessionStorage.getItem('__ndr_cleared__')) {
      localStorage.clear();
      sessionStorage.setItem('__ndr_cleared__', '1');
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
    const api = window.novaDoctorRx;
    const noDoctor = api.add({ doctor: '', items: [{ name: 'بانادول', qty: 1 }] });
    const zeroQty = api.add({ doctor: 'د. كريم', items: [{ name: 'بانادول', qty: 0 }] });

    const r1 = api.add({
      doctor: 'د. كريم',
      clinic: 'عيادة النور',
      customerPhone: '٠١٠١٢٣٤٥٦٧٨',
      items: [{ name: 'صنف غير موجود إطلاقا ٩٩', qty: '٣' }]
    });
    const r2 = api.add({
      doctor: 'د. كريم',
      items: [
        { name: 'صنف غير موجود إطلاقا ٩٩', qty: 2 },
        { name: 'أوجمنتين', qty: 1 }
      ]
    });
    const r3 = api.add({
      doctor: 'د. سارة',
      items: [{ name: 'أوجمنتين', qty: 4 }]
    });

    const docs = api.doctors();
    const top = api.topItems();
    const missing = api.missingItems();
    const byDoc = api.byDoctor('د. كريم');

    const remNoReason = api.remove(r3.id, '');
    const remWithReason = api.remove(r3.id, 'مكرر');
    const listAfterRem = api.list();

    return {
      noDoctor,
      zeroQty,
      r1,
      r2,
      r3,
      docs,
      top,
      missing,
      byDocCount: byDoc.length,
      remNoReason,
      remWithReason,
      listIds: listAfterRem.map((x) => x.id)
    };
  });

  assert.equal(apiRes.noDoctor, false, 'add without doctor refused');
  assert.equal(apiRes.zeroQty, false, 'item qty 0 refused');
  assert.ok(apiRes.r1 && apiRes.r1.items[0].qty === 3, 'Arabic-Indic digit ٣ accepted');
  assert.equal(apiRes.r1.customerPhone, '01012345678', 'Egyptian mobile normalized');
  assert.equal(apiRes.docs[0].doctor, 'د. كريم');
  assert.equal(apiRes.docs[0].count, 2, 'two prescriptions by same doctor -> count 2');
  assert.equal(apiRes.byDocCount, 2);

  const madeUpTop = apiRes.top.find((x) => x.name === 'صنف غير موجود إطلاقا ٩٩');
  assert.ok(madeUpTop && madeUpTop.qty === 5, 'topItems sums qty (3 + 2 = 5)');
  assert.ok(apiRes.missing.some((x) => x.name === 'صنف غير موجود إطلاقا ٩٩'), 'made-up item appears in missingItems');

  assert.equal(apiRes.remNoReason, false, 'soft remove without reason refused');
  assert.equal(apiRes.remWithReason, true, 'soft remove with reason accepted');
  assert.ok(!apiRes.listIds.includes(apiRes.r3.id), 'soft-removed record hidden from list');

  await page.evaluate(() => {
    const tab = document.querySelector('.nova-tab[data-page="reports"]');
    if (!tab) throw new Error('reports tab not found');
    tab.click();
  });
  await page.waitForSelector('#novaDoctorRx', { timeout: 5000 });
  assert.equal(await page.locator('#novaDoctorRx').count(), 1, 'card mounted once on reports');

  const cardText = await page.locator('#novaDoctorRx').textContent();
  assert.ok(cardText && cardText.includes('د. كريم'), 'doctor shown in table');
  assert.ok(cardText.includes('صنف غير موجود إطلاقا ٩٩'), 'missing item shown in card');

  const lay = await page.evaluate(() => {
    const c = document.getElementById('novaDoctorRx');
    const small = [...c.querySelectorAll('button,input')].filter((x) => x.offsetParent && x.getBoundingClientRect().height < 43).length;
    return {
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      small,
      bg: getComputedStyle(c).backgroundColor
    };
  });
  assert.ok(lay.sw <= lay.cw, 'no horizontal overflow at 390px: ' + lay.sw + '>' + lay.cw);
  assert.equal(lay.small, 0, 'all visible controls >= 44px');
  assert.ok(lay.bg.match(/[0-9]+/g).slice(0, 3).every((n) => +n < 50), 'dark card background');
  assert.equal(errors.length, 0, 'page errors: ' + errors.join('|'));

  console.log('doctor-rx PASS');
} finally {
  await browser.close();
  server.close();
}