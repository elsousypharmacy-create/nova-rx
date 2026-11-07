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

async function openPanel(browser, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:8773/${FILE}#sale`, { waitUntil: 'domcontentloaded' });
  await sleep(900);
  for (const bc of CODES) { await page.fill('#mainSearchInput', bc); await page.press('#mainSearchInput', 'Enter'); await sleep(150); }
  await page.click('#novaAiLaunch');
  await sleep(700);
  return { page, errors };
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
    check(`${L}: the row summary follows what is typed`, (await page.$eval('#nlMedicineList .med-card:nth-child(2) .med-sum .ds', e => e.textContent)).includes('قرص'));
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
