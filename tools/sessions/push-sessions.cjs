// Logs in to each supplier with a REAL browser (the pharmacy's own account, repo secrets) and
// sends the fresh session to the NOVA Worker over HTTPS, which stores it encrypted.
// Never prints tokens, cookies or passwords. Skips a supplier whose secrets are missing.
// Env: NOVA_WORKER_URL, NOVA_INGEST_SECRET, PO_USERNAME/PO_PASSWORD, AUMET_USERNAME/AUMET_PASSWORD
const { chromium } = require('playwright');

const WORKER = (process.env.NOVA_WORKER_URL || '').replace(/\/+$/, '');
const INGEST = process.env.NOVA_INGEST_SECRET || '';
const only = process.argv[2] || 'all';
const report = [];

async function send(supplierId, session, expiresAt) {
  const res = await fetch(`${WORKER}/api/suppliers/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ingest-Secret': INGEST },
    body: JSON.stringify({ supplierId, session, expiresAt }),
  });
  return res.status;
}

async function pharmaoverseas(browser) {
  const { PO_USERNAME, PO_PASSWORD } = process.env;
  if (!PO_USERNAME || !PO_PASSWORD) return { id: 'pharmaoverseas', result: 'skipped (no secrets)' };
  const page = await browser.newPage();
  try {
    await page.goto('https://shop.pharmaemarket.com/pharma/en/EGP/login', { waitUntil: 'networkidle', timeout: 60000 });
    if (await page.$('iframe[src*="recaptcha"], iframe[src*="captcha"]')) return { id: 'pharmaoverseas', result: 'stopped: CAPTCHA on login' };
    await page.fill('input[name="username"], input[type="email"]', PO_USERNAME);
    await page.fill('input[name="password"], input[type="password"]', PO_PASSWORD);
    let body = null;
    let status = null;
    await page.route('**/authorizationserver/oauth/token', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const resp = await route.fetch();
      try { body = await resp.json(); } catch { body = null; }
      status = resp.status();
      return route.fulfill({ response: resp });
    });
    await page.press('input[type="password"]', 'Enter');
    for (let i = 0; i < 60 && status === null; i += 1) await page.waitForTimeout(500);
    if (status !== 200 || !body || !body.access_token) return { id: 'pharmaoverseas', result: `login failed (status ${status})` };
    const expiresAt = Date.now() + (Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600) * 1000;
    const code = await send('pharmaoverseas', { accessToken: body.access_token }, expiresAt);
    return { id: 'pharmaoverseas', result: code === 200 ? 'session saved' : `worker answered ${code}` };
  } finally {
    await page.close();
  }
}

async function aumet(browser) {
  const { AUMET_USERNAME, AUMET_PASSWORD } = process.env;
  if (!AUMET_USERNAME || !AUMET_PASSWORD) return { id: 'aumet', result: 'skipped (no secrets)' };
  const ctx = await browser.newContext({ locale: 'en-US' });
  const page = await ctx.newPage();
  try {
    let auth = null;
    let xsrf = null;
    page.on('request', (r) => {
      if (!/marketplace\.aumet\.com\/api\//.test(r.url())) return;
      const h = r.headers();
      if (h.authorization) auth = h.authorization;
      if (h['x-xsrf-token']) xsrf = h['x-xsrf-token'];
    });
    // Never ask Aumet to end the pharmacy's other sessions.
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
    if (await page.$('iframe[src*="recaptcha"], iframe[src*="captcha"], iframe[src*="turnstile"]')) return { id: 'aumet', result: 'stopped: CAPTCHA on login' };
    await page.fill('input[name="email"], input[type="email"]', AUMET_USERNAME);
    await page.fill('input[type="password"]', AUMET_PASSWORD);
    await page.press('input[type="password"]', 'Enter');
    await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
    for (let i = 0; i < 20 && !auth; i += 1) await page.waitForTimeout(500);
    if (/login/i.test(page.url()) || !auth) return { id: 'aumet', result: 'login not confirmed' };
    const cookie = (await ctx.cookies('https://marketplace.aumet.com')).map((c) => `${c.name}=${c.value}`).join('; ');
    const code = await send('aumet', { authorization: auth, cookie, xsrf: xsrf || '' }, Date.now() + 10 * 3600 * 1000);
    return { id: 'aumet', result: code === 200 ? 'session saved' : `worker answered ${code}` };
  } finally {
    await ctx.close();
  }
}

(async () => {
  if (!WORKER || !INGEST) { console.log('Missing NOVA_WORKER_URL / NOVA_INGEST_SECRET'); process.exit(2); }
  const browser = await chromium.launch();
  for (const [id, fn] of [['pharmaoverseas', pharmaoverseas], ['aumet', aumet]]) {
    if (only !== 'all' && only !== id) continue;
    try { report.push(await fn(browser)); } catch (e) { report.push({ id, result: `error: ${String(e.message).slice(0, 80)}` }); }
  }
  await browser.close();
  for (const r of report) console.log(`${r.id}: ${r.result}`);
  if (report.some((r) => /error|failed|worker answered|stopped/.test(r.result))) process.exitCode = 1;
})();
