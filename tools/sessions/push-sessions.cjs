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
    body: JSON.stringify({ supplierId, session, expiresAt: new Date(expiresAt).toISOString() }),
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
  let phase = 'prepare';
  try {
    let observedProductUrl = null;
    let sellers = [];
    let capturedCartRequest = null;
    let sellersTask = Promise.resolve();
    let auth = null;
    let xsrf = null;
    let loginStatus = null;
    let loginResponseTask = Promise.resolve();
    let loginSignals = {};
    page.on('response', (response) => {
      if (!/^\/api\/entity\/[^/]+\/all-distributors$/.test(new URL(response.url()).pathname)) return;
      sellersTask = response.json().then(data => {
        sellers = (Array.isArray(data.data) ? data.data : []).filter(s => s && s.id != null && typeof s.name === 'string').map(s => ({ id: String(s.id), name: s.name.slice(0, 150), locked: !!s.is_locked }));
      }).catch(() => {});
    });
    page.on('response', (response) => {
      if (new URL(response.url()).pathname !== '/user/spa-login') return;
      loginStatus = response.status();
      loginResponseTask = response.text().then((body) => {
        // Emit fixed booleans only. Server messages can contain account data.
        loginSignals = {
          credentialsRejected: /invalid credentials|incorrect password|wrong password|invalid email|بيانات.*غير صحيحة|كلمة المرور.*غير صحيحة/i.test(body),
          otherSession: /another device|other device|already logged|logout.others|log.out.other|جهاز آخر|جهاز اخر/i.test(body),
          verificationRequired: /captcha|verification.code|one.time.password|two.factor|رمز التحقق/i.test(body),
          rateLimited: /too many|rate.limit|محاولات كثيرة/i.test(body),
        };
      }).catch(() => { loginSignals = { responseUnreadable: true }; });
    });
    page.on('request', (r) => {
      if (!/marketplace\.aumet\.com\/api\//.test(r.url())) return;
      if (new URL(r.url()).pathname === '/api/products') observedProductUrl = r.url();
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
    phase = 'open-login-page';
    await page.goto('https://marketplace.aumet.com/user/login', { waitUntil: 'networkidle', timeout: 60000 });
    if (await page.$('iframe[src*="recaptcha"], iframe[src*="captcha"], iframe[src*="turnstile"]')) return { id: 'aumet', result: 'stopped: CAPTCHA on login' };
    phase = 'fill-username';
    await page.locator('input[type="text"]:visible, input[type="email"]:visible').first().fill(AUMET_USERNAME);
    phase = 'fill-password';
    await page.fill('input[type="password"]', AUMET_PASSWORD);
    phase = 'submit-login';
    await page.press('input[type="password"]', 'Enter');
    phase = 'wait-for-login';
    await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
    for (let i = 0; i < 20 && !auth; i += 1) await page.waitForTimeout(500);
    await loginResponseTask;
    if (/login/i.test(page.url()) || !auth) {
      const diagnostics = {
        httpStatus: loginStatus,
        stillOnLogin: /login/i.test(page.url()),
        apiAuthorizationObserved: Boolean(auth),
        ...loginSignals,
      };
      console.log('aumet login diagnostics: ' + JSON.stringify(diagnostics));
      return { id: 'aumet', result: 'login failed (see safe diagnostics)' };
    }
    phase = 'inspect-search';
    await page.goto('https://marketplace.aumet.com/pharmacy/product/search', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(8000);
    for (const input of await page.$$('input')) {
      const eligible = await input.evaluate(e => e.offsetParent && !e.closest('[class*="cky"],[id*="cky"]') && /search|بحث|ابحث/i.test(e.placeholder || ''));
      if (!eligible) continue;
      await input.fill('Panadol');
      await page.waitForTimeout(2000);
      await input.press('Enter');
      await page.waitForTimeout(3000);
      break;
    }
    if (process.env.INSPECT_CART === 'true') {
      const fs = require('node:fs');
      const urls = await page.$$eval('script[src]', nodes => nodes.map(n => n.src));
      // Intercept and abort every write to cart/order APIs before touching quantity controls.
      // This discovers the client request without adding/removing any account cart item.
      await page.route('**/api/**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        if (request.method() !== 'GET' && /\/(?:cart|order)(?:\/|$)/.test(path)) {
          if (path.includes('/cart/')) {
            let body = null;
            try { body = request.postDataJSON(); } catch {}
            capturedCartRequest = { method: request.method(), path, body };
          }
          return route.abort();
        }
        return route.continue();
      });
      const reject = page.locator('.cky-btn-reject:visible');
      if (await reject.count()) await reject.first().click();
      const quantityButton = page.locator('button.dialerQuantity.show-details:visible');
      if (await quantityButton.count()) {
        await quantityButton.first().click();
        await page.waitForTimeout(600);
        const numeric = page.locator('input[type="number"]:visible');
        if (!capturedCartRequest && await numeric.count()) {
          await numeric.first().fill('1');
          await numeric.first().press('Tab');
          await page.waitForTimeout(1500);
        }
      }
      const snippets = [];
      for (const u of urls.filter(u => new URL(u).hostname === 'marketplace.aumet.com').slice(0, 12)) {
        const response = await ctx.request.get(u);
        if (!response.ok()) continue;
        const text = await response.text();
        for (const m of text.matchAll(/api\.v[23]\.cart\.store|entity_product_id|addToCart/g)) {
          if (snippets.length >= 60) break;
          const near = text.slice(Math.max(0,m.index-100),m.index+900);
          if (/add|quantity|post|put|delete|products-quantities|entity_product/i.test(near)) snippets.push(near);
        }
      }
      const inputs = await page.$$eval('input', nodes => nodes.filter(n=>n.offsetParent).map(n=>({type:n.type,name:n.name,placeholder:n.placeholder,class:n.className})));
      const buttons = await page.$$eval('button', nodes => nodes.filter(n => n.offsetParent).map(n => ({text:(n.innerText||'').trim().slice(0,100),aria:n.getAttribute('aria-label'),class:n.className})).slice(0,60));
      fs.mkdirSync('reports',{recursive:true});
      fs.writeFileSync('reports/aumet-cart-contract.json',JSON.stringify({publicStaticSnippets:snippets,buttons,inputs,cartRequest:capturedCartRequest ? {method:capturedCartRequest.method,path:capturedCartRequest.path.replace(/\d+/g,'{id}'),body:JSON.parse(JSON.stringify(capturedCartRequest.body), (k,v)=>/token|cookie|password|email|authorization/i.test(k)?'[withheld]':/id$/i.test(k)&&v!=null?'[id]':v)} : null,noCartWrites:true},null,2));
    }
    phase = 'save-session';
    const cookie = (await ctx.cookies('https://marketplace.aumet.com')).map((c) => `${c.name}=${c.value}`).join('; ');
    const searchParams = observedProductUrl ? Object.fromEntries(new URL(observedProductUrl).searchParams) : {};
    const task = searchParams.task || '';
    const searchTaskTemplate = task.includes('Panadol') ? task.replaceAll('Panadol', '__NOVA_QUERY__') : null;
    if (!searchTaskTemplate) return { id: 'aumet', result: 'error: query template not captured' };
    delete searchParams.task;
    await sellersTask;
    const code = await send('aumet', { authorization: auth, cookie, xsrf: xsrf || '', searchParams, searchTaskTemplate, sellers, cartRequestTemplate: capturedCartRequest }, Date.now() + 10 * 3600 * 1000);
    return { id: 'aumet', result: code === 200 ? 'session saved' : `worker answered ${code}` };
  } catch (error) {
    return { id: 'aumet', result: `error at ${phase} (${error.name === 'TimeoutError' ? 'timeout' : /context.*destroyed/i.test(error.message) ? 'navigation interrupted inspection' : /net::/i.test(error.message) ? 'navigation network error' : 'operation failed'})` };
  } finally {
    await ctx.close();
  }
}

(async () => {
  if (!WORKER || !INGEST) { console.log('Not configured yet: set repo secrets NOVA_WORKER_URL and NOVA_INGEST_SECRET. Nothing was done.'); process.exit(0); }
  const browser = await chromium.launch();
  for (const [id, fn] of [['pharmaoverseas', pharmaoverseas], ['aumet', aumet]]) {
    if (only !== 'all' && only !== id) continue;
    try { report.push(await fn(browser)); } catch (e) { report.push({ id, result: 'error (details withheld to protect session credentials)' }); }
  }
  await browser.close();
  for (const r of report) console.log(`${r.id}: ${r.result}`);
  if (report.some((r) => /error|failed|worker answered|stopped/.test(r.result))) process.exitCode = 1;
})();

