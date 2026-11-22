// tests/ux/family-accounts.mjs
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
    if (!sessionStorage.getItem('__nfa_cleared__')) {
      localStorage.clear();
      sessionStorage.setItem('__nfa_cleared__', '1');
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
    const F = window.novaFamilyAccounts;

    // 1. Arabic-Indic phone normalised + duplicate phone refused
    const fam = F.createFamily({ name: 'عائلة منصور', phone: '٠١٠١٢٣٤٥٦٧٨', headName: 'أحمد منصور' });
    const dup = F.createFamily({ name: 'عائلة أخرى', phone: '01012345678', headName: 'خالد' });
    const foundLatin = F.findByPhone('01012345678');
    const foundAr = F.findByPhone('٠١٠١٢٣٤٥٦٧٨');

    // 2. Add 11 more members (total 12), 13th refused
    const addedIds = [];
    for (let i = 1; i <= 11; i++) {
      const m = F.addMember(fam.id, {
        name: 'فرد ' + i,
        relation: i === 1 ? 'spouse' : 'child',
        birthYear: i === 1 ? '١٩٩٠' : 2010,
        allergies: i === 1 ? 'بنسلين' : ''
      });
      if (m && m.id) addedIds.push(m.id);
    }
    const thirteenth = F.addMember(fam.id, { name: 'فرد 13', relation: 'other' });

    // 3. Removal permission missing / false / throw refused (fail closed)
    const targetId = addedIds[0];
    const origPerms = window.novaPerms;
    window.novaPerms = undefined;
    const permMissing = F.removeMember(fam.id, targetId, 'انتقال');
    window.novaPerms = { require: () => false };
    const permFalse = F.removeMember(fam.id, targetId, 'انتقال');
    window.novaPerms = { require: () => { throw new Error('boom'); } };
    const permThrow = F.removeMember(fam.id, targetId, 'انتقال');

    // 4. With permission granted: head cannot be removed, empty reason refused, valid reason succeeds
    window.novaPerms = { require: (p) => p === 'accounts.manage' };
    const headId = fam.members[0].id;
    const removeHead = F.removeMember(fam.id, headId, 'سبب اختبار');
    const noReason = F.removeMember(fam.id, targetId, '   ');
    const withReason = F.removeMember(fam.id, targetId, 'انتقل لعنوان آخر');
    window.novaPerms = origPerms;

    // 5. Notes append-only (length grows, no edit API)
    const noteTarget = addedIds[1];
    const n0 = F.notes(fam.id, noteTarget).length;
    F.addNote(fam.id, noteTarget, 'يفضل الشراب');
    const n1 = F.notes(fam.id, noteTarget).length;
    F.addNote(fam.id, noteTarget, 'توصيل مساءً');
    const n2 = F.notes(fam.id, noteTarget).length;
    const apiKeys = Object.keys(F);

    return {
      phone: fam && fam.phone,
      dup,
      foundId: foundLatin && foundLatin.id,
      foundArId: foundAr && foundAr.id,
      famId: fam && fam.id,
      addedCount: addedIds.length,
      thirteenth,
      permMissing,
      permFalse,
      permThrow,
      removeHead,
      noReason,
      withReason,
      n0,
      n1,
      n2,
      hasEditNote: apiKeys.some((k) => /edit|delete|update|remove.*note/i.test(k))
    };
  });

  assert.equal(apiRes.phone, '01012345678', 'Arabic-Indic phone normalised');
  assert.equal(apiRes.dup, false, 'duplicate phone refused');
  assert.equal(apiRes.foundId, apiRes.famId, 'findByPhone finds by Latin digits');
  assert.equal(apiRes.foundArId, apiRes.famId, 'findByPhone finds by Arabic-Indic digits');
  assert.equal(apiRes.addedCount, 11, '11 additional members added (12 total)');
  assert.equal(apiRes.thirteenth, false, '13th member refused');
  assert.equal(apiRes.permMissing, false, 'removal refused when novaPerms is missing (fail closed)');
  assert.equal(apiRes.permFalse, false, 'removal refused when permission returns false');
  assert.equal(apiRes.permThrow, false, 'removal refused when permission throws');
  assert.equal(apiRes.removeHead, false, 'head cannot be removed');
  assert.equal(apiRes.noReason, false, 'removal without reason refused');
  assert.equal(apiRes.withReason, true, 'removal with reason succeeds');
  assert.deepEqual([apiRes.n0, apiRes.n1, apiRes.n2], [0, 1, 2], 'notes append-only length grows');
  assert.equal(apiRes.hasEditNote, false, 'no edit/delete note API');

  // Card visible on products page
  await page.evaluate(() => {
    const t = document.querySelector('.nova-tab[data-page="products"]');
    if (t) t.click();
  });
  await page.evaluate(id => window.novaPageViews.openTool(id), 'novaFamilyAccounts'); await page.waitForTimeout(400); // Q21-2c: the card is a tool in «الأدوات»
  await page.waitForSelector('#novaFamilyAccounts', { timeout: 5000 });
  assert.equal(await page.locator('#novaFamilyAccounts').count(), 1, 'card mounted once');

  // Open family panel and verify 390px layout has no horizontal overflow
  await page.locator('#nfaFamilyList .nfa-fam-btn').first().click();
  await page.waitForSelector('#nfaSelectedPanel .nfa-table', { timeout: 5000 });

  const layout = await page.evaluate(() => {
    const c = document.getElementById('novaFamilyAccounts');
    return {
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
      bg: getComputedStyle(c).backgroundColor
    };
  });
  assert.ok(layout.sw <= layout.cw, 'no horizontal overflow at 390px: ' + layout.sw + '>' + layout.cw);
  assert.ok(layout.bg.match(/[0-9]+/g).slice(0, 3).every((n) => +n < 50), 'dark card background');
  assert.equal(errors.length, 0, 'page errors: ' + errors.join('|'));

  console.log('family-accounts PASS');
} finally {
  await browser.close();
  server.close();
}