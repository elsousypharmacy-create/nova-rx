// UX323: sticker studio preview — no broken logo image, the «يتطلب مراجعة» pill never overlaps the
// draft/warning text, and #pharmacistApproval is a >=44px touch target. 1366x768 + 390x844, fake data,
// non-GET blocked, every off-origin request aborted (so the remote logo fails like it does offline).
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.UX323_PORT || 8793);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const URL_ = `${ORIGIN}/sticker-studio.html`;
const DRAFT_KEY = 'nova.stickerStudio.draft.v1';
const LOGO = 'https://elsousypharmacy-create.github.io/pharmacy/logo-mark.png';
// 1x1 transparent PNG (fake logo for the "logo available" scenario).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const hit = (a, b) => !(a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5);
const inside = (a, o) => a.x >= o.x - 0.5 && a.y >= o.y - 0.5 && a.x + a.width <= o.x + o.width + 0.5 && a.y + a.height <= o.y + o.height + 0.5;

const server = spawn(process.execPath, ['scripts/dev-server.mjs', '--port', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let browser;
let failed = 0;
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(URL_)).ok) break; } catch {} await sleep(150); }
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    for (const logoMode of ['broken', 'ok']) {
      const tag = `${vp.width}/${logoMode}`;
      const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG', hasTouch: vp.width < 500 });
      const blocked = [];
      await ctx.route('**/*', r => {
        const q = r.request(), u = q.url();
        if (u.startsWith('data:')) return r.continue();
        if (q.method() !== 'GET') { blocked.push(q.method() + ' ' + u); return r.abort(); }
        if (u === LOGO && logoMode === 'ok') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
        return u.startsWith(ORIGIN) ? r.continue() : r.abort();
      });
      await ctx.addInitScript(({ key }) => {
        window.print = () => {}; window.confirm = () => true;
        if (!localStorage.getItem(key)) {
          // Fake, incomplete draft (missing duration) => draft warning line + review pill both render.
          localStorage.setItem(key, JSON.stringify({
            patient: { name: 'مريض تجريبي', phone: '', age: '6', ageUnit: 'years', weight: '20', pregnancy: '', breastfeeding: '' },
            medications: [{ id: 'm1', name: 'دواء تجريبي', dose: '٥ مل', frequency: 'مرتين يوميًا', duration: '', instructions: 'بعد الأكل', warnings: [], selected: true, editRevision: 0 },
                          { id: 'm2', name: '', dose: '', frequency: '', duration: '', instructions: '', warnings: [], selected: true, editRevision: 0 }],
            approved: false, selectedInvoice: null }));
        }
      }, { key: DRAFT_KEY });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(URL_, { waitUntil: 'load' });
      await page.waitForSelector('.sticker-hero .label-inner');
      await page.waitForTimeout(600);
      await page.locator('.sticker-hero').scrollIntoViewIfNeeded();

      // 1) No broken image anywhere on the page.
      const broken = await page.evaluate(() => [...document.images].filter(i => {
        const cs = getComputedStyle(i);
        const shown = cs.display !== 'none' && cs.visibility !== 'hidden' && i.getClientRects().length > 0;
        return shown && i.getAttribute('src') && i.complete && i.naturalWidth === 0;
      }).map(i => i.id || i.className || i.src));
      assert.deepEqual(broken, [], `${tag}: broken images visible: ${broken.join(', ')}`);
      const heroImgs = await page.locator('.sticker-hero .label-brand img').count();
      if (logoMode === 'broken') assert.equal(heroImgs, 0, `${tag}: failed logo must be removed from the preview`);
      else assert.equal(heroImgs, 1, `${tag}: available logo must still render`);
      const word = await page.locator('.sticker-hero .label-brand strong').textContent();
      assert.equal(word.trim(), 'صيدلية السوسي', `${tag}: pharmacy wordmark shown`);

      // 2) Review pill visible, inside the sticker, and overlapping no text block.
      const hero = await page.locator('.sticker-hero').boundingBox();
      const pill = page.locator('.sticker-hero .review');
      assert.equal(await pill.count(), 1, `${tag}: review pill rendered for incomplete draft`);
      const pb = await pill.boundingBox();
      assert.ok(pb && pb.width > 0 && pb.height > 0, `${tag}: pill has a box`);
      assert.ok(inside(pb, hero), `${tag}: pill inside sticker ${JSON.stringify(pb)} vs ${JSON.stringify(hero)}`);
      const warnText = await page.locator('.sticker-hero .warning').textContent();
      assert.match(warnText, /مسودة غير مكتملة/, `${tag}: draft warning line rendered`);
      let checked = 0;
      for (const sel of ['.warning', '.med', '.instruction', '.patient', '.label-brand strong', '.label-brand img']) {
        const loc = page.locator('.sticker-hero ' + sel);
        for (let i = 0; i < await loc.count(); i++) {
          const b = await loc.nth(i).boundingBox();
          if (!b || !b.width || !b.height) continue;
          checked++;
          assert.ok(!hit(pb, b), `${tag}: pill overlaps ${sel} ${JSON.stringify(pb)} ${JSON.stringify(b)}`);
        }
      }
      assert.ok(checked >= 4, `${tag}: compared pill against ${checked} blocks`);
      // Warning line starts inside the sticker (dense logo+patient drafts may still clip its 2nd line: pre-existing, see commit notes).
      const wb = await page.locator('.sticker-hero .warning').boundingBox();
      assert.ok(wb.y >= hero.y && wb.y + 12 <= hero.y + hero.height, `${tag}: warning line visible inside sticker`);

      // Thumbnails: pill must not sit under the selection tick or the wordmark.
      const thumbs = page.locator('.preview-grid .sticker-preview');
      for (let i = 0; i < await thumbs.count(); i++) {
        const tp = thumbs.nth(i).locator('.review');
        if (!(await tp.count())) continue;
        const tpb = await tp.boundingBox();
        for (const sel of ['.pick', '.label-brand strong']) {
          const ob = await thumbs.nth(i).locator(sel).boundingBox();
          if (ob) { checked++; assert.ok(!hit(tpb, ob), `${tag}: thumbnail #${i} pill overlaps ${sel}`); }
        }
      }

      // 3) Approval checkbox is a >=44px target and still toggles approval.
      const cb = page.locator('#pharmacistApproval');
      await cb.scrollIntoViewIfNeeded();
      const cbb = await cb.boundingBox();
      assert.ok(cbb.width >= 44 && cbb.height >= 44, `${tag}: checkbox ${cbb.width}x${cbb.height} < 44`);
      assert.equal(await cb.isChecked(), false, `${tag}: starts unapproved`);
      if (vp.width < 500) await cb.tap(); else await cb.click();
      assert.equal(await cb.isChecked(), true, `${tag}: checkbox toggles`);
      assert.equal(await page.locator('.approval').evaluate(e => e.classList.contains('pending')), false, `${tag}: approval state updated`);

      // 4) No horizontal overflow, no page errors, no write requests attempted.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `${tag}: horizontal overflow ${overflow}px`);
      assert.deepEqual(errors, [], `${tag}: page errors`);
      assert.deepEqual(blocked, [], `${tag}: non-GET requests attempted`);
      console.log(`PASS ${tag}: no broken image, pill ${Math.round(pb.width)}x${Math.round(pb.height)} clear of ${checked} blocks, checkbox ${cbb.width}x${cbb.height}`);
      await ctx.close();
    }
  }
  console.log('ux323: ok');
} catch (e) {
  failed = 1;
  console.error('FAIL', e.message);
} finally {
  if (browser) await browser.close();
  server.kill();
  process.exitCode = failed;
}
