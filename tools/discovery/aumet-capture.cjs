// Discovery for the Aumet marketplace, run only inside the "Aumet discovery"
// workflow on GitHub's runner. Stage A looks at the public site (no login).
// Stage B logs in with the pharmacy's own account (secrets AUMET_USERNAME /
// AUMET_PASSWORD), searches one drug and opens one product. Writes a HAR to a
// temp folder (deleted by the workflow) and a small "steps" file that holds
// only: step names, host + path templates (no query, no ids), field NAMES and
// yes/no flags. No page titles or text after login. Never prints secrets.
const { chromium } = require('playwright');
const fs = require('fs');

const OUT = process.argv[2];
const START = process.env.START_URL || 'https://www.aumet.com';
const { AUMET_USERNAME, AUMET_PASSWORD } = process.env;
const steps = [];
const note = (name, data = {}) => { steps.push({ step: name, ...data }); console.log(`step: ${name}`); };
const tpl = (u) => {
  try {
    const x = new URL(u);
    const path = x.pathname.split('/').map((s) => (/\d{6,}/.test(s) || /^[0-9a-f]{16,}$/i.test(s) || /[@%=:+~]/.test(s) || s.length >= 24 || (s.length >= 10 && /[a-z]/i.test(s) && /\d/.test(s)) ? '{id}' : s)).join('/');
    return x.host + path;
  } catch { return 'invalid-url'; }
};
const BLOCK_WORDS = /captcha|verification code|one[- ]time|otp|two[- ]factor|2fa|رمز التحقق|كود التحقق/i;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ recordHar: { path: `${OUT}/raw.har`, content: 'embed' }, locale: 'en-US' });
  const page = await ctx.newPage();
  const pause = (ms) => page.waitForTimeout(ms + Math.floor(Math.random() * 1200));
  const flags = async () => ({
    captchaFrame: !!(await page.$('iframe[src*="recaptcha"], iframe[src*="captcha"], iframe[src*="turnstile"], iframe[src*="hcaptcha"]')),
    blockWords: BLOCK_WORDS.test(await page.evaluate(() => document.body.innerText.slice(0, 4000)).catch(() => '')),
  });
  try {
    // Stage A: public site
    await page.goto(START, { waitUntil: 'networkidle', timeout: 60000 });
    await pause(1500);
    const links = await page.$$eval('a[href]', (as) => as.map((a) => ({ href: a.href, text: (a.textContent || '').trim().slice(0, 30) })));
    const wanted = links.filter((l) => /log ?in|sign ?in|marketplace|shop|pharmac|buy|دخول|تسجيل/i.test(l.text + ' ' + l.href));
    note('public-site', { finalUrl: tpl(page.url()), candidateLinks: [...new Set(wanted.map((l) => `${l.text} -> ${tpl(l.href)}`))].slice(0, 25), hosts: [...new Set(links.map((l) => { try { return new URL(l.href).host; } catch { return null; } }).filter(Boolean))].slice(0, 25) });

    // find a login page
    let loginUrl = (wanted.find((l) => /log ?in|sign ?in|دخول/i.test(l.text)) || {}).href;
    if (!loginUrl) loginUrl = new URL('/login', START).href;
    await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await pause(1500);
    const form = await page.$$eval('input', (els) => els.map((e) => `${e.type || 'text'}:${e.name || e.getAttribute('formcontrolname') || e.id || ''}`.slice(0, 40)));
    note('login-page', { url: tpl(page.url()), inputs: form, ...(await flags()), socialButtons: await page.$$eval('button, a', (els) => els.filter((e) => /google|facebook|apple|microsoft|sso/i.test(e.textContent || '')).length) });

    const f1 = await flags();
    const emailSel = 'input[type="email"], input[name*="mail" i], input[name*="user" i], input[id*="mail" i], input[id*="user" i], input[type="text"]';
    const passSel = 'input[type="password"]';
    if (f1.captchaFrame || f1.blockWords) throw new Error('CAPTCHA/verification on login page; stopping');
    if (!AUMET_USERNAME || !AUMET_PASSWORD) throw new Error('missing AUMET_USERNAME / AUMET_PASSWORD secrets');
    if (!(await page.$(passSel))) throw new Error('no password field found on the login page');

    // Stage B: log in. Never ask Aumet to end the pharmacy's other sessions.
    await page.route('**/user/spa-login', async (route) => {
      const req = route.request();
      let data = null;
      try { data = JSON.parse(req.postData() || 'null'); } catch { data = null; }
      if (data && typeof data === 'object' && 'confirm_logout_others' in data) {
        data.confirm_logout_others = false;
        return route.continue({ postData: JSON.stringify(data) });
      }
      return route.continue();
    });
    await page.fill(emailSel, AUMET_USERNAME);
    await page.fill(passSel, AUMET_PASSWORD);
    await pause(700);
    await page.press(passSel, 'Enter');
    await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
    await pause(2500);
    const f2 = await flags();
    const stillLogin = /log ?in|sign ?in/i.test(page.url());
    note('after-login', { url: tpl(page.url()), stillOnLogin: stillLogin, ...f2 });
    if (f2.captchaFrame || f2.blockWords) throw new Error('verification step after login; stopping');
    if (stillLogin) throw new Error('login not confirmed');

    // search one drug
    const searchSel = 'input[type="search"], input[placeholder*="earch" i], input[placeholder*="بحث"], input[name*="search" i], input[aria-label*="earch" i]';
    const box = await page.$(searchSel);
    note('search-box', { found: !!box });
    if (box) {
      await box.fill('Panadol');
      await box.press('Enter');
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      await pause(3000);
      note('after-search', { url: tpl(page.url()), ...(await flags()) });
      const candidates = await page.$$eval('a[href]', (as) => as.map((a) => a.href).filter((h) => /product|item|drug|medicine|offer/i.test(h)));
      note('result-links', { count: candidates.length, sample: [...new Set(candidates.map(tpl))].slice(0, 5) });
      if (candidates[0]) {
        await page.goto(candidates[0], { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
        await pause(3000);
        note('product-page', { url: tpl(page.url()), ...(await flags()) });
      }
    }
  } catch (e) {
    note('stopped', { reason: String(e.message).replace(new RegExp(AUMET_USERNAME || '$^', 'gi'), '[login]').slice(0, 160) });
  } finally {
    fs.writeFileSync(`${OUT}/steps.json`, JSON.stringify(steps, null, 2));
    await ctx.close();
    await browser.close();
  }
})();
