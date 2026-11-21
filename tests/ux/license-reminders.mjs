// tests/ux/license-reminders.mjs
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
    if (!sessionStorage.getItem('__nlr_cleared__')) {
      localStorage.clear();
      sessionStorage.setItem('__nlr_cleared__', '1');
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
    const L = window.novaLicenses;
    window.novaPerms = { require: () => true };
    const fmt = (offsetDays) => {
      const d = new Date(Date.now() + offsetDays * 86400000);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const noTitle = L.add({ title: '', kind: 'pharmacy', expiresAt: fmt(10), remindDays: 30 });

    const origPerms = window.novaPerms;
    window.novaPerms = undefined;
    const permMissing = L.add({ title: 'رخصة بدون صلاحيات', kind: 'pharmacy', expiresAt: fmt(10), remindDays: 30 });
    window.novaPerms = { require: () => false };
    const permFalse = L.add({ title: 'رخصة مرفوضة', kind: 'pharmacy', expiresAt: fmt(10), remindDays: 30 });
    window.novaPerms = { require: () => { throw new Error('denied'); } };
    const permThrow = L.add({ title: 'رخصة خطأ', kind: 'pharmacy', expiresAt: fmt(10), remindDays: 30 });
    window.novaPerms = origPerms;

    const due10 = L.add({ title: 'رخصة الصيدلية', kind: 'pharmacy', number: '١٢٣٤', holder: 'د. أحمد', expiresAt: fmt(10), remindDays: '٣٠' });
    const far60 = L.add({ title: 'السجل التجاري', kind: 'commercial', expiresAt: fmt(60), remindDays: 30 });
    const exp5 = L.add({ title: 'الدفاع المدني', kind: 'civil', expiresAt: fmt(-5), remindDays: 30 });

    const dueBefore = L.due(Date.now());

    window.novaPerms = { require: () => false };
    const renewPermFalse = L.renew(due10.id, fmt(90), 'مرفوض');
    const removePermFalse = L.remove(far60.id, 'مرفوض');
    window.novaPerms = { require: () => { throw new Error('denied'); } };
    const renewPermThrow = L.renew(due10.id, fmt(90), 'خطأ');
    const removePermThrow = L.remove(far60.id, 'خطأ');
    window.novaPerms = origPerms;

    const renewEarlier = L.renew(due10.id, fmt(5), 'تاريخ أقدم');
    const renewSame = L.renew(due10.id, due10.expiresAt, 'نفس التاريخ');
    const renewLater = L.renew(due10.id, fmt(90), 'تم التجديد');
    const dueAfter = L.due(Date.now());

    const removeNoReason = L.remove(far60.id, '   ');
    const removeOk = L.remove(far60.id, 'مكرر');
    const listAfterRemove = L.list();

    return {
      noTitle,
      permMissing,
      permFalse,
      permThrow,
      renewPermFalse,
      removePermFalse,
      renewPermThrow,
      removePermThrow,
      due10,
      far60,
      exp5,
      dueBefore,
      renewEarlier,
      renewSame,
      renewLater,
      dueAfter,
      removeNoReason,
      removeOk,
      listAfterRemove
    };
  });

  assert.equal(apiRes.noTitle, false, 'add without title refused');
  assert.equal(apiRes.permMissing, false, 'missing novaPerms fails closed');
  assert.equal(apiRes.permFalse, false, 'permission false refused');
  assert.equal(apiRes.permThrow, false, 'permission throw refused');
  assert.equal(apiRes.renewPermFalse, false, 'renew permission false refused');
  assert.equal(apiRes.removePermFalse, false, 'remove permission false refused');
  assert.equal(apiRes.renewPermThrow, false, 'renew permission throw refused');
  assert.equal(apiRes.removePermThrow, false, 'remove permission throw refused');

  assert.equal(apiRes.due10.number, '1234', 'Arabic-Indic number normalized');
  assert.equal(apiRes.due10.remindDays, 30, 'Arabic-Indic remindDays normalized');

  const dueBeforeIds = apiRes.dueBefore.map((x) => x.id);
  assert.ok(dueBeforeIds.includes(apiRes.due10.id), '10-day item is in due()');
  assert.ok(!dueBeforeIds.includes(apiRes.far60.id), '60-day item is not in due()');
  assert.ok(dueBeforeIds.includes(apiRes.exp5.id), 'expired item is in due()');
  assert.equal(dueBeforeIds[0], apiRes.exp5.id, 'due() sorted by expiresAt ascending');
  const expEntry = apiRes.dueBefore.find((x) => x.id === apiRes.exp5.id);
  assert.ok(expEntry.daysLeft < 0, 'expired item has negative daysLeft');

  assert.equal(apiRes.renewEarlier, false, 'renew with earlier date refused');
  assert.equal(apiRes.renewSame, false, 'renew with same date refused');
  assert.ok(apiRes.renewLater && apiRes.renewLater.history.length === 1, 'renew keeps history length 1');
  assert.equal(apiRes.renewLater.history[0].oldExpiresAt, apiRes.due10.expiresAt, 'history records oldExpiresAt');
  assert.equal(apiRes.renewLater.history[0].newExpiresAt, apiRes.renewLater.expiresAt, 'history records newExpiresAt');
  assert.ok(!apiRes.dueAfter.some((x) => x.id === apiRes.due10.id), 'renewed item moved out of due()');

  assert.equal(apiRes.removeNoReason, false, 'remove without reason refused');
  assert.equal(apiRes.removeOk, true, 'remove with reason succeeds');
  assert.ok(!apiRes.listAfterRemove.some((x) => x.id === apiRes.far60.id), 'removed item hidden from list()');

  await page.evaluate(() => {
    const tab = document.querySelector('.nova-tab[data-page="reports"]');
    if (!tab) throw new Error('reports tab not found');
    tab.click();
  });
  await page.waitForSelector('#novaLicenseReminders', { timeout: 5000 });
  assert.equal(await page.locator('#novaLicenseReminders').count(), 1, 'mounted once');

  const bannerVisible = await page.locator('#nlrBanner').isVisible();
  const bannerText = await page.locator('#nlrBanner').textContent();
  assert.ok(bannerVisible && bannerText.includes('في رخص محتاجة تجديد'), 'banner visible on reports');

  const lay = await page.evaluate(() => {
    const c = document.getElementById('novaLicenseReminders');
    const small = [...c.querySelectorAll('button,input,select')].filter((x) => x.offsetParent && x.getBoundingClientRect().height < 43).length;
    return {
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      small,
      bg: getComputedStyle(c).backgroundColor
    };
  });
  assert.ok(lay.sw <= lay.cw, 'no horizontal overflow at 390px: ' + lay.sw + '>' + lay.cw);
  assert.equal(lay.small, 0, 'controls are at least 44px high');
  assert.ok(lay.bg.match(/[0-9]+/g).slice(0, 3).every((n) => +n < 50), 'dark card background: ' + lay.bg);

  assert.equal(errors.length, 0, 'page errors: ' + errors.join('|'));
  console.log('license-reminders PASS');
} finally {
  await browser.close();
  server.close();
}