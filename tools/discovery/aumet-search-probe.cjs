// Finds how the Aumet marketplace sends a product search. Logs in with the pharmacy's own account
// (repo secrets), opens the search page, waits for the page to finish loading, types one drug name
// like a person would, and records every request the site makes in the next seconds.
// Output holds only: host + path template, query/body parameter NAMES, and values for
// non-identifying keys (search text, sort, paging). No headers, cookies, tokens or ids.
const { chromium } = require('playwright');
const fs = require('fs');

const OUT = process.argv[2];
const { AUMET_USERNAME, AUMET_PASSWORD } = process.env;
const log = [];
const note = (name, data = {}) => { log.push({ step: name, ...data }); console.log(`step: ${name}`); };
const tpl = (u) => {
  try {
    const x = new URL(u);
    return x.host + x.pathname.split('/').map((s) => (/\d{4,}/.test(s) || /^[0-9a-f]{16,}$/i.test(s) || /[@%=:+~]/.test(s) || s.length >= 24 ? '{id}' : s)).join('/');
  } catch { return 'invalid-url'; }
};
const HIDE = /id$|token|user|entity|pharmacy|customer|phone|email|address|coverage|country|city|area|location|lat|long/i;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1366, height: 800 } });
  const page = await ctx.newPage();
  let recording = false;
  const seen = [];
  page.on('request', (r) => {
    if (!recording) return;
    const t = r.resourceType();
    if (!['xhr', 'fetch'].includes(t)) return;
    if (/cookieyes|google|facebook|arabot|intercom|sentry/.test(r.url())) return;
    const u = new URL(r.url());
    const params = {};
    for (const [k, v] of u.searchParams.entries()) params[k] = HIDE.test(k) ? '[hidden]' : v.slice(0, 40);
    let body = null;
    const post = r.postData();
    if (post) {
      try { const j = JSON.parse(post); body = {}; for (const [k, v] of Object.entries(j)) body[k] = HIDE.test(k) || typeof v === 'object' ? '[hidden]' : String(v).slice(0, 40); } catch { body = '[non-json]'; }
    }
    seen.push({ method: r.method(), url: tpl(r.url()), params, body });
  });
  try {
    await page.route('**/user/spa-login', async (route) => {
      let data = null;
      try { data = JSON.parse(route.request().postData() || 'null'); } catch { data = null; }
      if (data && typeof data === 'object' && 'confirm_logout_others' in data) {
        data.confirm_logout_others = false;
        return route.continue({ postData: JSON.stringify(data) });
      }
      return route.continue();
    });
    await page.goto('https://marketplace.aumet.com/user/login', { waitUntil: 'networkidle', timeout: 60000 });
    if (await page.$('iframe[src*="recaptcha"], iframe[src*="captcha"], iframe[src*="turnstile"]')) throw new Error('CAPTCHA on login');
    // What the login page looks like (before login: generic page text only, no account data).
    await page.waitForTimeout(4000);
    note('login-page', {
      url: tpl(page.url()),
      title: (await page.title()).slice(0, 60),
      inputs: await page.$$eval('input', (els) => els.map((e) => `${e.type || 'text'}:${e.name || e.id || ''}:${e.offsetParent ? 'visible' : 'hidden'}`).slice(0, 12)),
      text: (await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 220))),
    });
    await page.fill('input[name="email"], input[type="email"], input[type="text"]:not([class*="cky"])', AUMET_USERNAME, { timeout: 20000 });
    await page.fill('input[type="password"]', AUMET_PASSWORD);
    let loginStatus = null;
    page.on('response', (r) => { if (/\/user\/spa-login/.test(r.url())) loginStatus = r.status(); });
    await page.press('input[type="password"]', 'Enter');
    await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(4000);
    if (/login/i.test(page.url())) {
      const messages = await page.$$eval('[role="alert"], .alert, .error, .invalid-feedback, .toast, [class*="error"], [class*="alert"], [class*="toast"]', (els) => els.map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140)).filter(Boolean).slice(0, 4));
      note('login-refused', { loginStatus, messages });
      throw new Error('login not confirmed');
    }
    note('logged-in', { url: tpl(page.url()) });

    await page.goto('https://marketplace.aumet.com/pharmacy/product/search', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(8000); // the single-page app draws the search box late
    note('search-page', { url: tpl(page.url()) });

    // every element that could take typed text, wherever it lives on the page
    const candidates = await page.evaluate(() => {
      const out = [];
      const sel = 'input, textarea, [contenteditable="true"], [role="searchbox"], [role="combobox"], [role="textbox"]';
      for (const e of document.querySelectorAll(sel)) {
        const r = e.getBoundingClientRect();
        out.push({ tag: e.tagName.toLowerCase(), type: e.type || '', role: e.getAttribute('role') || '', ph: (e.placeholder || e.getAttribute('aria-label') || '').slice(0, 40), cky: !!e.closest('[class*="cky"], [id*="cky"]'), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) });
      }
      return out;
    });
    note('input-candidates', { count: candidates.length, items: candidates.filter((c) => !c.cky && c.w > 0 && c.h > 0 && c.type !== 'checkbox' && c.type !== 'hidden').slice(0, 12) });
    const buttons = await page.$$eval('button, [role="button"], a', (els) => els.map((e) => ((e.getAttribute('aria-label') || '') + ' ' + (e.textContent || '')).trim().slice(0, 30)).filter((t) => /search|بحث|ابحث/i.test(t)).slice(0, 8));
    note('search-buttons', { buttons });

    // choose the first visible, non-cookie text input; else click a search button and retry
    const pick = async () => {
      for (const el of await page.$$('input:not([type=checkbox]):not([type=hidden]), textarea, [contenteditable="true"], [role="searchbox"], [role="combobox"]')) {
        const ok = await el.evaluate((e) => { const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 12 && !e.closest('[class*="cky"], [id*="cky"]') && !(e.type === 'password'); });
        if (ok) return el;
      }
      return null;
    };
    let box = await pick();
    if (!box) {
      const btn = await page.$('button[aria-label*="earch" i], button:has-text("بحث"), [role="button"][aria-label*="earch" i]');
      if (btn) { await btn.click(); await page.waitForTimeout(2000); box = await pick(); }
    }
    note('search-box', { found: !!box });
    if (box) {
      await box.click();
      recording = true;
      await page.keyboard.type('Panadol', { delay: 140 });
      await page.waitForTimeout(3500);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(6000);
      recording = false;
      note('after-search', { url: tpl(page.url()) });
    }
  } catch (e) {
    note('stopped', { reason: String(e.message).replace(new RegExp(AUMET_USERNAME || '$^', 'gi'), '[login]').slice(0, 160) });
  } finally {
    log.push({ step: 'requests-while-typing', count: seen.length, requests: seen.slice(0, 40) });
    fs.writeFileSync(`${OUT}/aumet-search-probe.json`, JSON.stringify(log, null, 2));
    await ctx.close();
    await browser.close();
  }
})();
