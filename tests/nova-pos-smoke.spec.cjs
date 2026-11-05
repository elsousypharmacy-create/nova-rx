const { test, expect } = require('@playwright/test');

test('blank customer search switches to product search', async ({ page }) => {
  await page.goto('http://127.0.0.1:8765/');
  await expect(page).toHaveTitle(/NOVA Rx/);
  const search = page.locator('#mainSearchInput');
  await expect(search).toBeVisible();
  // Current UI starts in PRODUCT mode; F3 explicitly opens customer lookup.
  await page.keyboard.press('F3');
  await expect(search).toHaveAttribute('placeholder', /Search customer/);
  await search.fill('');
  await search.press('Enter');
  await expect(search).toHaveAttribute('placeholder', /Scan barcode or type medicine/);
});
