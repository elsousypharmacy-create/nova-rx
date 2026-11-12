const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');

test('blank customer search switches to product search', async ({ page }) => {
  // Smoke assertions are English; force EN so Arabic default UI does not flake CI.
  await page.addInitScript(() => localStorage.setItem('nova-rx-language', 'en'));
  await page.goto('http://127.0.0.1:8765/');
  await expect(page).toHaveTitle(/NOVA Rx/);
  const search = page.locator('#mainSearchInput');
  await expect(search).toBeVisible();
  await page.locator('#btnAddLoyalty').click();
  await expect(search).toHaveAttribute('placeholder', /Search customer/);
  await search.fill('');
  await search.press('Enter');
  await expect(search).toHaveAttribute('placeholder', /Scan barcode or type medicine/);
});

test('UX batch 1 checks (i18n, runtime language switch, sticker button, held invoices panel)', async () => {
  test.setTimeout(90000);
  execFileSync(process.execPath, ['tests/ux-batch1.mjs'], { stdio: 'inherit' });
});
