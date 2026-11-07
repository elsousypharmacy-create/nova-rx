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
  const page = await browser.newPage({ viewport: { width, height } });
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
    await page.click('#nlMedicineList .med-card:nth-child(2) .med-sum');
    await sleep(300);
    check(`${L}: tapping a row opens exactly one edit window`, (await page.$$eval('.med-card.editing', a => a.length)) === 1);
    check(`${L}: the edit window shows the fields`, await page.isVisible('.med-card.editing [data-field="dose"]'));
    check(`${L}: the sticker preview is visible next to the window`, await page.isVisible('#nlHeroStage'));
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
    check(`${L}: zero page errors`, errors.length === 0);
    await page.close();
  }

  // ---- narrow
  {
    const { page, errors } = await openPanel(browser, 820, 1100);
    const L = 'narrow';
    check(`${L}: inline fields are visible, no summary rows`, await page.isVisible('#nlMedicineList .med-card:nth-child(1) [data-field="name"]') && (await page.$$eval('#nlMedicineList .med-sum', a => a.filter(e => e.getBoundingClientRect().height > 0).length)) === 0);
    check(`${L}: zero page errors`, errors.length === 0);
    await page.close();
  }

  await browser.close();
  console.log('ALL STICKER-LIST-EDIT CHECKS PASSED');
} finally {
  server.kill();
}
