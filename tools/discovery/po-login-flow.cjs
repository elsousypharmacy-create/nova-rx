// Records HOW the PharmaOverseas login works at the page level (redirects,
// form posts), so the Worker can repeat it with plain HTTP. Output holds only:
// method, host + path template, query/form field NAMES, status codes and
// redirect targets as templates. No values, no cookies, no headers.
// Runs only inside the "PO login flow" workflow (secrets PO_USERNAME / PO_PASSWORD).
const { chromium } = require('playwright');
const fs = require('fs');

const OUT = process.argv[2];
const BASE = 'https://shop.pharmaemarket.com/pharma/en/EGP';
const tpl = (u) => {
  try {
    const x = new URL(u);
    const path = x.pathname.split('/').map((s) => (/\d{4,}/.test(s) || /^[0-9a-f]{16,}$/i.test(s) || /[@%=:+~]/.test(s) || s.length >= 24 ? '{id}' : s)).join('/');
    return x.host + path;
  } catch { return 'invalid-url'; }
};
const names = (u) => { try { return [...new URL(u).searchParams.keys()].sort(); } catch { return []; } };
const events = [];

(async () => {
  const { PO_USERNAME, PO_PASSWORD } = process.env;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'en-US' });
  const page = await ctx.newPage();
  const seen = new Map();
  page.on('request', (r) => {
    const t = r.resourceType();
    if (!['document', 'xhr', 'fetch'].includes(t)) return;
    if (!/pharmaemarket/.test(r.url())) return;
    const post = r.postData();
    let formNames = [];
    if (post) {
      try { formNames = [...new URLSearchParams(post).keys()].sort(); } catch { formNames = []; }
      if (!formNames.length) { try { formNames = Object.keys(JSON.parse(post)).sort(); } catch { formNames = []; } }
    }
    const ev = { n: events.length + 1, type: t, method: r.method(), url: tpl(r.url()), query: names(r.url()), bodyFields: formNames, redirectedFrom: r.redirectedFrom() ? tpl(r.redirectedFrom().url()) : null };
    seen.set(r, ev);
    events.push(ev);
  });
  page.on('response', (res) => {
    const ev = seen.get(res.request());
    if (!ev) return;
    ev.status = res.status();
    const loc = res.headers()['location'];
    if (loc) ev.location = tpl(new URL(loc, res.url()).href) + ' ?' + names(new URL(loc, res.url()).href).join(',');
    const ct = res.headers()['content-type'] || '';
    ev.contentType = ct.split(';')[0];
    const sc = res.headers()['set-cookie'];
    ev.setsCookie = !!sc;
  });
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60000 });
    const marker = events.length;
    await page.fill('input[name="username"], input[type="email"]', PO_USERNAME);
    await page.fill('input[name="password"], input[type="password"]', PO_PASSWORD);
    await page.press('input[type="password"]', 'Enter');
    await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(3000);
    events.push({ note: 'after-login url', url: tpl(page.url()) });
    events.splice(0, 0, { note: `events before submit: ${marker}` });
  } catch (e) {
    events.push({ note: 'stopped', reason: String(e.message).slice(0, 120) });
  } finally {
    fs.writeFileSync(`${OUT}/po-login-flow.json`, JSON.stringify(events, null, 2));
    await ctx.close();
    await browser.close();
  }
})();
