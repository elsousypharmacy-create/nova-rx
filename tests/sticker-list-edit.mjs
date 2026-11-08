import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

// Wide tablets: medicines are a list; tapping a row opens an edit window. Narrow screens keep the inline cards.
const root = process.cwd();
const FILE = process.env.UX_FILE || 'index.html';
const candidates = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
const executablePath = candidates.find(existsSync);
assert(executablePath, 'Set CHROME_PATH to an installed Chromium browser');
const server = spawn(process.execPath, ['scripts/dev-server.mjs', '--port', '8773'], { cwd: root, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const check = (name, cond) => { assert(cond, name); console.log('PASS ' + name); };
const CODES = ['6281001234567', '6281001234568', '6281001234569'];

async function openPanel(browser, width, height, mode = 'ok') {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  const calls = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/ai/medication-labels', async r => {
    const body = JSON.parse(r.request().postData() || '{}');
    calls.push(body);
    await sleep(400);
    if (mode === '403') return r.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'GEMINI_HTTP_ERROR', error: 'Gemini models/x returned HTTP 403.', details: { model: 'models/x', status: 403, geminiStatus: 'PERMISSION_DENIED', code: 403, message: 'API key not valid' } }) });
    const cond = (body.patient && body.patient.condition) || '';
    const warnMode = mode === 'warn';
    const items = body.medications.map((m, i) => {
      const it = { index: i, dose: 'قرص', frequency: 'مرتين يوميًا', duration: '٥ أيام', instructions: 'بعد الأكل مع كوب ماء', warnings: [] };
      if (i === 1 && !warnMode) it.duration = null;
      if (i === 0 && warnMode) it.warnings = ['حساسية بنسلين: الدواء من فصيلة البنسلين'];
      if (i === 0 && /بنسلين/.test(cond)) it.warnings = ['حساسية بنسلين: الدواء من فصيلة البنسلين'];
      return it;
    });
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, items, interactions: body.medications.length > 2 ? ['تداخل تجريبي بين الدواءين الأول والثاني'] : [] }) });
  });
  await page.goto(`http://127.0.0.1:8773/${FILE}#sale`, { waitUntil: 'domcontentloaded' });
  await sleep(900);
  for (const bc of CODES) { await page.fill('#mainSearchInput', bc); await page.press('#mainSearchInput', 'Enter'); await sleep(150); }
  await page.click('#novaAiLaunch');
  await sleep(700);
  return { page, errors, calls };
}

try {
  const browser = await chromium.launch({ executablePath });

  // ---- wide
  {
    const { page, errors } = await openPanel(browser, 1194, 834);
    const L = 'wide';
    check(`${L}: three medicines are listed as rows`, (await page.$$eval('#nlMedicineList .med-sum', a => a.filter(e => e.getBoundingClientRect().height > 40).length)) === 3);
    check(`${L}: edit fields are hidden until a row is tapped`, !(await page.isVisible('#nlMedicineList .med-card:nth-child(1) [data-field="name"]')));
    await page.click('.nl-prevtoggle');
    await sleep(200);
    check(`${L}: the preview button reveals every sticker`, await page.isVisible('#nlPreviewGrid'));
    await page.click('.nl-prevtoggle');
    await sleep(200);
    check(`${L}: and hides them again`, !(await page.isVisible('#nlPreviewGrid')));
    await page.click('#nlMedicineList .med-card:nth-child(2) .med-sum');
    await sleep(300);
    check(`${L}: tapping a row opens exactly one edit window`, (await page.$$eval('.med-card.editing', a => a.length)) === 1);
    check(`${L}: the edit window shows the fields`, await page.isVisible('.med-card.editing [data-field="dose"]'));
    check(`${L}: no stickers are shown by default (only medicines)`, !(await page.isVisible('#nlHeroStage')) && !(await page.isVisible('#nlPreviewGrid')));
    await page.click('.med-card.editing .med-prev');
    await sleep(200);
    check(`${L}: the sticker preview opens next to the window on demand`, await page.isVisible('#nlHeroStage'));
    await page.click('.med-card.editing .med-prev');
    await sleep(200);
    check(`${L}: and hides again`, !(await page.isVisible('#nlHeroStage')));
    await page.fill('.med-card.editing [data-field="dose"]', 'قرص');
    await sleep(200);
    check(`${L}: the row summary follows what is typed`, (await page.$eval('#nlMedicineList .med-card:nth-child(2) .med-sum .dose', e => e.textContent)).includes('قرص'));
    await page.keyboard.press('Escape');
    await sleep(200);
    check(`${L}: Esc closes only the edit window`, (await page.$$eval('.med-card.editing', a => a.length)) === 0 && await page.$eval('#novaLabelsPanel', e => e.classList.contains('open')));
    await page.click('#nlMedicineList .med-card:nth-child(1) .med-sum');
    await sleep(200);
    await page.click('.med-card.editing .med-done');
    await sleep(200);
    check(`${L}: the Done button closes the window`, (await page.$$eval('.med-card.editing', a => a.length)) === 0);
    await page.click('#nlMedicineList .med-card:nth-child(3) .med-sum');
    await sleep(200);
    await page.mouse.click(600, 25);
    await sleep(200);
    check(`${L}: tapping outside closes the window`, (await page.$$eval('.med-card.editing', a => a.length)) === 0);
    // quick customer type
    check(`${L}: four customer types and no old safety questions`, (await page.$$eval('.nl-quick button', a => a.length)) === 4 && !(await page.isVisible('.safety-choices')));
    check(`${L}: nothing is chosen at first and the bar asks for it`, (await page.$eval('.nl-quick', e => !e.dataset.q)) && (await page.$eval('#nlBarWhy', e => e.textContent)).includes('نوع العميل'));
    check(`${L}: rows are full width and show the full medicine name`, await page.$$eval('#nlMedicineList .med-sum', a => a.every(e => e.getBoundingClientRect().width > 600 && e.querySelector('.nm').scrollWidth <= e.querySelector('.nm').clientWidth + 1)));
    check(`${L}: no text boxes inside the list`, !(await page.isVisible('#nlMedicineList .med-card:nth-child(1) textarea[data-field="instructions"]')));
    await page.click('.nl-quick button[data-q="adult"]');
    await sleep(300);
    check(`${L}: adult = not pregnant, not breastfeeding, adult age`, await page.evaluate(() => document.querySelector('input[name="nlPregnancy"][value="no"]').checked && document.querySelector('input[name="nlBreastfeeding"][value="no"]').checked && Number(document.getElementById('nlPatientAge').value) >= 18));
    await page.click('.nl-quick button[data-q="preg"]');
    await sleep(300);
    check(`${L}: pregnant is recorded and only that button is pressed`, await page.evaluate(() => document.querySelector('input[name="nlPregnancy"][value="yes"]').checked && [...document.querySelectorAll('.nl-quick button')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.q).join() === 'preg'));
    await page.click('.nl-quick button[data-q="child"]');
    await sleep(300);
    check(`${L}: child asks for the age and weight`, await page.isVisible('#nlPatientAge') && await page.isVisible('#nlPatientWeight'));
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('nova:sticker-print', { detail: { count: 1, test: false } })));
    await sleep(900);
    check(`${L}: after printing the window closes by itself`, !(await page.$eval('#novaLabelsPanel', e => e.classList.contains('open'))));
    check(`${L}: zero page errors (quick type)`, errors.length === 0);
    await page.close();
  }

  // ---- AI: one request, condition box, readable errors
  {
    const { page, errors, calls } = await openPanel(browser, 1194, 834, 'ok');
    const L = 'ai';
    await page.click('.nl-quick button[data-q="adult"]');
    for (let i = 0; i < 40 && calls.length < 1; i++) await sleep(150);
    await page.waitForFunction(() => !document.getElementById('nlPrintAll').disabled, null, { timeout: 8000 });
    await sleep(300);
    check(`${L}: ONE request carries all the medicines`, calls.length === 1 && calls[0].medications.length === 3);
    check(`${L}: adult data is sent (not pregnant, adult age)`, calls[0].patient.pregnancy === false && Number(calls[0].patient.age) >= 18);
    check(`${L}: the dose cell is filled`, (await page.$eval('#nlMedicineList .med-card:nth-child(1) .med-sum .dose', e => e.textContent)).includes('قرص'));
    check(`${L}: a missing field is marked in its own cell`, await page.$eval('#nlMedicineList .med-card:nth-child(2) .med-sum .dur', e => e.classList.contains('gap')));
    check(`${L}: interactions between the invoice medicines are shown`, await page.isVisible('.nl-inter') && (await page.$eval('.nl-inter', e => e.textContent)).includes('تداخل'));
    check(`${L}: the table has a header row and a note that doses are AI suggestions`, await page.isVisible('.nl-thead') && (await page.$eval('.nl-note', e => e.textContent)).includes('اقتراحات'));
    check(`${L}: no ready-made condition buttons under the box (the pharmacist just types)`, (await page.$$('.nl-cond button:not(.nl-info)')).length === 0);
    // the small i next to the label replaces the long caption and hint
    check(`${L}: one small i button next to the label, tip hidden at first, no long caption`, (await page.$$('.nl-cond .nl-info')).length === 1 && !(await page.isVisible('.nl-infotip')) && (await page.$$('.nl-cond .hint, .nl-cond .lbl em')).length === 0);
    await page.click('.nl-info');
    await sleep(150);
    check(`${L}: tapping i shows the tip`, await page.isVisible('.nl-infotip') && (await page.$eval('.nl-infotip', e => e.textContent)).includes('اختياري') && (await page.$eval('.nl-info', e => e.getAttribute('aria-expanded'))) === 'true');
    await page.click('.nl-info');
    await sleep(150);
    check(`${L}: tapping i again hides it`, !(await page.isVisible('.nl-infotip')));
    await page.click('.nl-info');
    await sleep(100);
    await page.click('#nlCondition');
    await sleep(100);
    check(`${L}: tapping elsewhere closes the tip`, !(await page.isVisible('.nl-infotip')));
    await page.fill('#nlCondition', 'حساسية بنسلين');
    for (let i = 0; i < 40 && calls.length < 2; i++) await sleep(200);
    await page.waitForFunction(() => !document.getElementById('nlPrintAll').disabled, null, { timeout: 8000 });
    await sleep(300);
    check(`${L}: the typed condition is sent with the next request`, calls.length === 2 && calls[1].patient.condition === 'حساسية بنسلين');
    check(`${L}: the AI warning shows in the row`, (await page.$eval('#nlMedicineList .med-card:nth-child(1) .med-sum', e => e.textContent)).includes('بنسلين'));
    await page.fill('#nlCondition', 'ضغط مرتفع');
    for (let i = 0; i < 40 && !calls.some(c => c.patient.condition === 'ضغط مرتفع'); i++) await sleep(200);
    check(`${L}: typing waits until you stop, then sends it`, calls.some(c => c.patient.condition === 'ضغط مرتفع'));
    check(`${L}: zero page errors`, errors.length === 0);
    await page.close();
  }
  // ---- child: age + weight are right under the buttons, required, and the table stays quiet until then
  {
    const { page, errors, calls } = await openPanel(browser, 1194, 834, 'ok');
    const L = 'child';
    await page.click('.nl-quick button[data-q="child"]');
    await sleep(400);
    const pos = await page.evaluate(() => { const y = id => document.getElementById(id).getBoundingClientRect().y; return { age: y('nlPatientAge'), weight: y('nlPatientWeight'), cond: y('nlCondition'), pad: document.querySelector('.nl-quick').getBoundingClientRect().bottom, ageVal: document.getElementById('nlPatientAge').value, wVal: document.getElementById('nlPatientWeight').value }; });
    check(`${L}: age and weight sit right under the buttons, above the condition box`, pos.age > pos.pad - 2 && pos.age < pos.cond && pos.weight < pos.cond);
    check(`${L}: they start empty (no adult age left over)`, pos.ageVal === '' && pos.wVal === '');
    check(`${L}: the table is quiet (dashes, no amber "missing" cells) until there is data`, (await page.$$eval('#nlMedicineList .med-sum .gap', a => a.length)) === 0 && (await page.$eval('#nlMedicineList .med-card:nth-child(1)', e => e.classList.contains('idle'))));
    check(`${L}: the bar asks for the age`, (await page.$eval('#nlBarWhy', e => e.textContent)).includes('عمر'));
    await page.fill('#nlPatientAge', '4');
    await page.dispatchEvent('#nlPatientAge', 'input');
    await sleep(1200);
    check(`${L}: age alone is not enough - nothing is sent and the bar asks for the weight`, calls.length === 0 && (await page.$eval('#nlBarWhy', e => e.textContent)).includes('وزن'));
    await page.click('.nl-wunk');
    for (let i = 0; i < 30 && calls.length < 1; i++) await sleep(200);
    check(`${L}: "weight unknown" lets the AI run and says so`, calls.length === 1 && calls[0].patient.weightUnknown === true && !calls[0].patient.weightKg);
    check(`${L}: the weight box is disabled while unknown`, await page.$eval('#nlPatientWeight', e => e.disabled));
    await page.click('.nl-quick button[data-q="adult"]');
    await sleep(400);
    check(`${L}: switching to adult clears the child state`, await page.evaluate(() => !document.getElementById('nlPatientWeight').disabled && document.getElementById('nlPatientWeight').value === ''));
    check(`${L}: zero page errors`, errors.length === 0);
    await page.close();
  }
  // ---- warnings must be read before printing
  {
    const { page, errors } = await openPanel(browser, 1194, 834, 'warn');
    const L = 'warning';
    await page.click('.nl-quick button[data-q="adult"]');
    await page.waitForFunction(() => document.querySelector('#nlMedicineList .med-card .st.err'), null, { timeout: 8000 });
    await sleep(300);
    check(`${L}: the row says "tap me" and printing is blocked`, (await page.$eval('#nlMedicineList .med-card:nth-child(1) .st', e => e.textContent)).includes('المس') && (await page.$eval('#nlBarWhy', e => e.textContent)).includes('المس'));
    await page.$eval('#nlPrintAll', e => e.click());
    await sleep(200);
    check(`${L}: a print attempt is refused`, (await page.evaluate(() => (document.querySelector('.nlx-toast') || {}).textContent || '')).includes('التحذير'));
    await page.click('#nlMedicineList .med-card:nth-child(1) .med-sum');
    await sleep(300);
    check(`${L}: the window shows the warning text`, (await page.$eval('.med-card.editing', e => e.textContent)).includes('بنسلين'));
    await page.click('.med-card.editing .med-done');
    await sleep(300);
    check(`${L}: after reading it the row shows "reviewed" and the bar is clear`, (await page.$eval('#nlMedicineList .med-card:nth-child(1) .st', e => e.textContent)).includes('اطلعت') && (await page.$eval('#nlBarWhy', e => e.textContent)) === '');
    check(`${L}: zero page errors`, errors.length === 0);
    await page.close();
  }
  // ---- safe frame and layout on the common tablet / computer sizes
  for (const [w, h] of [[1024, 768], [1080, 810], [1180, 820], [1194, 834], [1280, 800], [1366, 1024], [834, 1194]]) {
    const { page, errors } = await openPanel(browser, w, h, 'ok');
    const L = `${w}x${h}`;
    await page.click('.nl-quick button[data-q="adult"]');
    await sleep(2200);
    const m = await page.evaluate(() => {
      const R = e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
      const sh = R(document.querySelector('#novaLabelsPanel .labels-sheet')), pa = R(document.getElementById('nlPrintAll')), tb = document.getElementById('nlMedicineList'), first = R(tb.querySelector('.med-card'));
      return { left: sh.x, right: innerWidth - sh.r, top: sh.y, bottom: innerHeight - sh.b, pa, sh, hscroll: tb.scrollWidth > tb.clientWidth + 1, first, firstVisible: first.y >= 0 && first.b <= innerHeight, vw: innerWidth, vh: innerHeight };
    });
    check(`${L}: the window keeps at least 24px from every screen edge`, m.left >= 24 && m.right >= 24 && m.top >= 20 && m.bottom >= 24);
    check(`${L}: the print button stays inside the window with room to spare`, m.pa.r <= m.sh.r - 12 && m.pa.b <= m.sh.b - 8 && m.pa.x >= m.sh.x);
    check(`${L}: the table fits without sideways scrolling and its first row is on screen`, !m.hscroll && m.firstVisible);
    check(`${L}: zero page errors`, errors.length === 0);
    await page.close();
  }

  {
    const { page, errors } = await openPanel(browser, 1194, 834, '403');
    const L = 'ai failure';
    await page.click('.nl-quick button[data-q="adult"]');
    await page.waitForFunction(() => document.querySelector('#nlMedicineList .med-card.ai-fail'), null, { timeout: 8000 });
    const txt = await page.$eval('#nlMedicineList .med-card:nth-child(1) .med-sum', e => e.textContent);
    check(`${L}: the reason is written in plain Arabic`, txt.includes('مفتاح Gemini مش مقبول') && txt.includes('GEMINI_HTTP_ERROR'));
    check(`${L}: a retry button appears`, await page.isVisible('.nl-retry'));
    check(`${L}: printing stays blocked`, await page.$eval('#nlPrintAll', e => e.classList.contains('is-blocked') || e.disabled));
    check(`${L}: zero page errors`, errors.length === 0);
    await page.close();
  }

  // ---- narrow
  {
    {
      const { page, errors } = await openPanel(browser, 834, 1194);
      const L = 'tablet portrait';
      check(`${L}: quick customer type and rows are used`, await page.isVisible('.nl-quick') && (await page.$$eval('#nlMedicineList .med-sum', a => a.filter(e => e.getBoundingClientRect().height > 40).length)) === 3);
      await page.tap('.nl-quick button[data-q="adult"]');
      await sleep(300);
      check(`${L}: one tap answers the safety questions`, await page.evaluate(() => document.querySelector('input[name="nlPregnancy"][value="no"]').checked && document.querySelector('input[name="nlBreastfeeding"][value="no"]').checked));
      await page.tap('#nlMedicineList .med-card:nth-child(1) .med-sum');
      await sleep(300);
      check(`${L}: the edit window fits the screen`, await page.$eval('.med-card.editing', e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; }));
      check(`${L}: zero page errors`, errors.length === 0);
      await page.close();
    }
    const { page, errors } = await openPanel(browser, 600, 1000);
    const L = 'narrow';
    check(`${L}: no quick customer type buttons`, !(await page.isVisible('.nl-quick')));
    check(`${L}: inline fields are visible, no summary rows`, await page.isVisible('#nlMedicineList .med-card:nth-child(1) [data-field="name"]') && (await page.$$eval('#nlMedicineList .med-sum', a => a.filter(e => e.getBoundingClientRect().height > 0).length)) === 0);
    check(`${L}: zero page errors`, errors.length === 0);
    await page.close();
  }

  await browser.close();
  console.log('ALL STICKER-LIST-EDIT CHECKS PASSED');
} finally {
  server.kill();
}
