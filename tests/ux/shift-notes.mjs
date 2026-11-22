/* tests/ux/shift-notes.mjs */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0];
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const fullPath = path.resolve(ROOT, rel);
      if (!fullPath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      fs.readFile(fullPath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = path.extname(fullPath).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}/` });
    });
  });
}

async function run() {
  const { server, url } = await startServer();
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined
  });

  try {
    const context = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width: 390, height: 844 }
    });
    await context.addInitScript(() => {
      if (!sessionStorage.getItem('__nova_test_cleared')) {
        localStorage.clear();
        sessionStorage.setItem('__nova_test_cleared', '1');
      }
    });

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => window.novaLazy.load());

    // 1. Test corrupt storage resilience & fail-closed auth
    const guardResult = await page.evaluate(() => {
      localStorage.setItem('nova-rx-shift-notes-v1', '{not-valid-json');
      const corruptList = window.novaShiftNotes.list();
      localStorage.removeItem('nova-rx-shift-notes-v1');

      window.novaAuth = { current: () => null };
      const unauthAdd = window.novaShiftNotes.add({ text: 'ملاحظة بدون دخول', priority: 'عادي' });

      window.novaAuth = { current: () => ({ name: 'أحمد', role: 'pharmacist' }) };
      const validNote = window.novaShiftNotes.add({ text: 'تأكد من رصيد الأنسولين', priority: 'عادي' });

      window.novaAuth = { current: () => null };
      const unauthDone = window.novaShiftNotes.markDone(validNote.id);

      return { corruptList, unauthAdd, validNote, unauthDone };
    });

    assert.deepEqual(guardResult.corruptList, [], 'Corrupt JSON must not crash and should return []');
    assert.equal(guardResult.unauthAdd, null, 'Signed-out user must not be able to add');
    assert.equal(guardResult.unauthDone, null, 'Signed-out user must not be able to markDone');

    // 2. Test add, list order, markDone (including idempotency), open() excludes done
    const apiResult = await page.evaluate((firstId) => {
      window.novaAuth = {
        current: () => ({ name: 'أحمد', role: 'pharmacist' })
      };

      const invalidEmpty = window.novaShiftNotes.add({ text: '   ', priority: 'عادي' });
      const invalidLong = window.novaShiftNotes.add({ text: 'أ'.repeat(301), priority: 'عادي' });

      const n2 = window.novaShiftNotes.add({ text: 'طلبية المخزن وصلت ناقصة', priority: 'مهم' });
      const n3 = window.novaShiftNotes.add({ text: 'مراجعة درج النقدية', priority: 'عادي' });

      const doneRes = window.novaShiftNotes.markDone(firstId);

      window.novaAuth = {
        current: () => ({ name: 'سارة', role: 'cashier' })
      };
      const doneAgain = window.novaShiftNotes.markDone(firstId);

      const listed = window.novaShiftNotes.list();
      const opened = window.novaShiftNotes.open();

      return { invalidEmpty, invalidLong, n2, n3, doneRes, doneAgain, listed, opened };
    }, guardResult.validNote.id);

    assert.equal(apiResult.invalidEmpty, null, 'Empty note must be rejected');
    assert.equal(apiResult.invalidLong, null, 'Note > 300 chars must be rejected');
    assert.equal(guardResult.validNote.by, 'أحمد');
    assert.equal(apiResult.n2.priority, 'مهم');
    assert.equal(apiResult.doneRes.doneBy, 'أحمد');
    assert.ok(apiResult.doneRes.doneAt, 'doneAt should be set');
    assert.equal(apiResult.doneAgain.doneBy, 'أحمد', 'markDone must be idempotent');
    assert.equal(apiResult.doneAgain.doneAt, apiResult.doneRes.doneAt, 'markDone must preserve original doneAt');

    // Open notes must come first, important before normal, done at the end
    assert.equal(apiResult.listed.length, 3);
    assert.equal(apiResult.listed[0].id, apiResult.n2.id, 'Important open note first');
    assert.equal(apiResult.listed[1].id, apiResult.n3.id, 'Normal open note second');
    assert.equal(apiResult.listed[2].id, guardResult.validNote.id, 'Done note last');

    // open() excludes done notes
    assert.equal(apiResult.opened.length, 2);
    assert.ok(apiResult.opened.every((n) => !n.doneAt), 'open() must exclude done notes');

    // 3. Test toast shown once on load for important note from another user
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      window.__shiftToasts = [];
      window.showToast = (msg, type) => window.__shiftToasts.push({ msg, type });
      window.novaAuth = { current: () => ({ name: 'سارة', role: 'cashier' }) };
      return window.novaLazy.load();
    });

    const toasts = await page.evaluate(() => window.__shiftToasts);
    const impToasts = toasts.filter((t) => t.msg === 'فيه ملاحظة مهمة من الوردية اللي فاتت');
    assert.equal(impToasts.length, 1, 'Important note toast should be shown exactly once');

    // 4. Test sale badge visible on sale page
    const saleTab = page.locator('.nova-tab[data-page="sale"]').first();
    if (await saleTab.count()) {
      await page.evaluate(() => document.querySelector('.nova-tab[data-page="sale"]').click());
      const badge = page.locator('#novaShiftNotesBadge');
      await badge.waitFor({ state: 'attached', timeout: 5000 });
      if (await page.evaluate(() => !!document.querySelector('#novaSaleMoreMenu #novaShiftNotesBadge'))) await page.locator('#btnSaleMore').click(); // UI-BATCH1: phones keep it in «…»
      await badge.waitFor({ state: 'visible', timeout: 5000 });
      assert.equal(await badge.isVisible(), true, 'Sale badge #novaShiftNotesBadge must be visible');
    }

    // 5. Test reports card visible on reports page and no overflow at 390px
    const reportsTab = page.locator('.nova-tab[data-page="reports"]').first();
    await page.evaluate(() => document.querySelector('.nova-tab[data-page="shift"]').click()); // Q21-2f: «الوردية» entry
    const card = page.locator('#novaPageView #novaShiftNotes');
    await card.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await card.isVisible(), true, 'Reports card #novaShiftNotes must be visible');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, 'Page must not overflow horizontally at 390px');

    assert.equal(pageErrors.length, 0, `Unexpected page errors: ${pageErrors.map((e) => e.message).join('; ')}`);
    console.log('shift-notes PASS');
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});