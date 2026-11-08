// Logged-in discovery capture for PharmaOverseas (shop.pharmaemarket.com).
// Runs only inside the "Supplier discovery" GitHub workflow. Reads the
// pharmacy's own login from env (PO_USERNAME / PO_PASSWORD), records a HAR to
// a temp folder, and never prints values. The workflow sanitizes the HAR and
// deletes it; only the sanitized JSON is uploaded.
const { chromium } = require('playwright');

const OUT = process.argv[2];
const WITH_CART = process.env.WITH_CART === 'true';
const BASE = 'https://shop.pharmaemarket.com/pharma/en/EGP';

(async () => {
  const { PO_USERNAME, PO_PASSWORD } = process.env;
  if (!PO_USERNAME || !PO_PASSWORD) { console.log('Missing PO_USERNAME / PO_PASSWORD secrets'); process.exit(2); }
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ recordHar: { path: `${OUT}/raw.har`, content: 'embed' }, locale: 'en-US' });
  const page = await ctx.newPage();
  const pause = (ms) => page.waitForTimeout(ms + Math.floor(Math.random() * 1500));
  const step = (msg) => console.log(`step: ${msg}`);
  let blocked = false;
  page.on('response', (r) => {
    if ([401, 403, 429].includes(r.status()) && /pharmaemarket/.test(r.url())) {
      blocked = true;
      console.log(`status ${r.status()} on ${new URL(r.url()).pathname}`);
    }
  });

  try {
    step('open login');
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60000 });
    if (await page.$('iframe[src*="recaptcha"], iframe[src*="captcha"]')) throw new Error('CAPTCHA on login page; stopping');
    await page.fill('input[name="username"], input[type="email"]', PO_USERNAME);
    await page.fill('input[name="password"], input[type="password"]', PO_PASSWORD);
    await pause(800);
    await Promise.all([
      page.waitForResponse((r) => /oauth\/token/.test(r.url()), { timeout: 30000 }).catch(() => null),
      page.press('input[type="password"]', 'Enter'),
    ]);
    await page.waitForLoadState('networkidle').catch(() => {});
    await pause(2000);
    const stillLogin = /\/login/.test(page.url());
    step(stillLogin ? 'login NOT confirmed (still on login page)' : 'login ok');
    if (stillLogin) throw new Error('login failed');

    step('search Panadol');
    await page.goto(`${BASE}/search/Panadol`, { waitUntil: 'networkidle', timeout: 60000 });
    await pause(2500);
    step('search Augmentin page 2');
    await page.goto(`${BASE}/search/Augmentin?currentPage=1`, { waitUntil: 'networkidle', timeout: 60000 });
    await pause(2500);
    step('open product detail');
    await page.goto(`${BASE}/product/000000000000028851/x`, { waitUntil: 'networkidle', timeout: 60000 });
    await pause(2500);

    if (WITH_CART) {
      step('add one item to cart');
      const add = await page.$('button:has-text("Add to cart"), button:has-text("Add To Cart"), button:has-text("أضف")');
      if (add) {
        await add.click();
        await page.waitForLoadState('networkidle').catch(() => {});
        await pause(2500);
        step('open cart');
        await page.goto(`${BASE}/cart`, { waitUntil: 'networkidle', timeout: 60000 });
        await pause(2500);
        step('remove item from cart');
        const rm = await page.$('button:has-text("Remove"), a:has-text("Remove"), button:has-text("حذف")');
        if (rm) {
          await rm.click();
          await page.waitForLoadState('networkidle').catch(() => {});
          await pause(2000);
          step('removed');
        } else step('remove button not found: please empty the cart manually');
      } else step('add-to-cart button not found');
    }
  } catch (e) {
    console.log(`stopped: ${e.message}`);
  } finally {
    await ctx.close();
    await browser.close();
    if (blocked) console.log('note: the site returned 401/403/429 at least once');
  }
})();
