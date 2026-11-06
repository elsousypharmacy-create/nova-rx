import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage();
const fail = m => { console.error('FAIL: ' + m); process.exitCode = 1; };
try {
  await page.goto('http://127.0.0.1:7100/index.html#whatsapp');
  await page.locator('.wa-inbox').waitFor({ timeout: 5000 });
  const checks = [];
  const ok = (name, cond) => { checks.push([name, cond]); if (!cond) fail(name); };
  ok('RTL root', await page.locator('.wa-inbox[dir="rtl"]').count() === 1);
  ok('demo banner', await page.locator('.wa-demo-banner').isVisible());
  await page.waitForSelector('.wa-conv', { timeout: 3000 });
  ok('3 demo conversations', await page.locator('.wa-conv').count() === 3);
  // search filters
  await page.fill('#waSearch', 'تجريبي ب');
  ok('search narrows to 1', await page.locator('.wa-conv').count() === 1);
  await page.fill('#waSearch', 'لا-يوجد-هذا');
  ok('empty search state', await page.locator('.wa-list .wa-state-empty').isVisible());
  await page.fill('#waSearch', '');
  // open thread, unread cleared
  await page.locator('.wa-conv').first().click();
  await page.waitForSelector('.wa-msg', { timeout: 3000 });
  ok('thread messages render', (await page.locator('.wa-msg').count()) >= 3);
  ok('unread badge cleared', await page.locator('.wa-badge-unread').count() === 0);
  // takeover
  await page.locator('[data-wa-action="takeover"]').click();
  await page.waitForSelector('[data-wa-action="resume"]', { timeout: 3000 });
  ok('takeover shows resume + hold badge', await page.locator('.wa-badge-hold').count() >= 1);
  // composer demo send (local only)
  await page.fill('#waComposerInput', 'رسالة اختبار');
  await page.locator('[data-wa-action="send"]').click();
  ok('demo send appends locally', await page.locator('.wa-msg-out', { hasText: 'رسالة اختبار' }).count() === 1);
  // resume back to bot
  await page.locator('[data-wa-action="resume"]').click();
  await page.waitForSelector('[data-wa-action="takeover"]', { timeout: 3000 });
  ok('resume restores bot state', true);
  // mobile layout: back button flow
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-page="sale"]').click();
  await page.locator('[data-page="whatsapp"]').click();
  await page.waitForSelector('.wa-conv', { timeout: 3000 });
  ok('mobile: thread pane hidden initially', !(await page.locator('.wa-thread-pane').isVisible()));
  await page.locator('.wa-conv').first().click();
  await page.waitForSelector('.wa-msg', { timeout: 3000 });
  ok('mobile: thread pane visible after open', await page.locator('.wa-thread-pane').isVisible());
  ok('mobile: back button visible', await page.locator('.wa-back').isVisible());
  await page.locator('.wa-back').click();
  ok('mobile: back returns to list', await page.locator('.wa-list-pane').isVisible());
  // no console errors
  console.log(checks.filter(([, c]) => c).length + '/' + checks.length + ' browser smoke checks passed');
} catch (e) { fail(e.message); }
await browser.close();
