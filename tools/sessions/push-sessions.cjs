// Logs in to each supplier with a REAL browser (the pharmacy's own account, repo secrets) and
// sends the fresh session to the NOVA Worker over HTTPS, which stores it encrypted.
// Never prints tokens, cookies or passwords. Skips a supplier whose secrets are missing.
// Env: NOVA_WORKER_URL, NOVA_INGEST_SECRET, PO_USERNAME/PO_PASSWORD, AUMET_USERNAME/AUMET_PASSWORD
const { chromium } = require('playwright');
const { classifyLogin } = require('./aumet-login-signals.cjs');
const { guardAumetApi, captureAumetCart, verifyAumetCart } = require('./aumet-renewal.cjs');

const WORKER = (process.env.NOVA_WORKER_URL || '').replace(/\/+$/, '');
const INGEST = process.env.NOVA_INGEST_SECRET || '';
const only = process.argv[2] || 'all';
const report = [];
// Opt-in contract discovery: static shipped code only; no cart/order writes.
async function inspectStatic(page, request, supplierId, host) {
  const fs = require('node:fs');
  const urls = await page.$$eval('script[src]', nodes => nodes.map(n => n.src));
  const queue=urls.filter(u=>new URL(u).hostname===host),seen=new Set(),snippets=[];
  for(let j=0;j<queue.length&&seen.size<100;j++) {
    const url=queue[j];if(seen.has(url))continue;seen.add(url);
    const res=await request.get(url,{timeout:15000});if(!res.ok())continue;
    const text=await res.text();if(text.length>16000000)continue;
    const folder='reports/public-static/'+supplierId;fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(folder+'/'+new URL(url).pathname.split('/').pop(),text);
    if(supplierId==='pharmaoverseas')for(const m of text.matchAll(/(?:from|import\()\s*["'](\.\/[^"']+\.js)["']/g)){
      const u=new URL(m[1],url).href;if(!seen.has(u)&&!queue.includes(u))queue.push(u);
    }
    // Technical adapters first; skip human copy/translation dictionaries.
    for(const pattern of [/\/(?:orgUsers|users)\/[^"']{0,160}(?:carts|orders)/g,/cartAddEntry|cartUpdateEntry|loadAll\(|placeOrder\(|addEntries:|cart:[{]|createCart\(|loadCart\(/g,/api\.v[23]\.(?:order|cart)[.\w]*|Fe\.post\(["']api\/v2\/order/g]){
      let count=0;for(const m of text.matchAll(pattern)){
        if(++count>18)break;
        const snippet=text.slice(Math.max(0,m.index-300),m.index+2200);
        if(!snippets.some(n=>n.snippet===snippet))snippets.push({file:new URL(url).pathname,snippet});
      }
    }
  }
  fs.mkdirSync('reports',{recursive:true});
  fs.writeFileSync('reports/'+supplierId+'-static-contract.json',JSON.stringify({supplierId,scripts:seen.size,publicStaticSnippets:snippets.slice(0,400),noCartWrites:true,noOrders:true},null,2));
}
function schema(value, depth=0){
  if(depth>7)return 'depth-limit';
  if(Array.isArray(value))return value.length?[schema(value[0],depth+1)]:[];
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,90).map(([k,v])=>[k,schema(v,depth+1)]));
  return value===null?'null':typeof value;
}

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
    let cartReadTemplates=[];
    if(process.env.INSPECT_CART==='true') {
      const reads=[],tasks=[];
      page.on('response',res=>{const url=new URL(res.url());if(url.hostname!=='api.pharmaemarket.com'||!/(?:carts|orders)/.test(url.pathname)||res.request().method()!=='GET')return;
        cartReadTemplates.push({method:'GET',url:url.href});
        tasks.push(res.json().then(v=>reads.push({path:url.pathname.replace(/[^/]*%40[^/]*/ig,'{user}').replace(/\/[^/]*@[^/]*/g,'/{user}').replace(/\d{4,}/g,'{id}'),queryKeys:[...url.searchParams.keys()],status:res.status(),schema:schema(v)})).catch(()=>{}));
      });
      await page.route('https://api.pharmaemarket.com/**',route=>['GET','HEAD','OPTIONS'].includes(route.request().method())?route.continue():route.abort());
      await page.goto('https://shop.pharmaemarket.com/pharma/en/EGP/my-account/quick-order',{waitUntil:'networkidle',timeout:45000}).catch(()=>{});
      await Promise.allSettled(tasks);
      const fs=require('node:fs');fs.mkdirSync('reports',{recursive:true});fs.writeFileSync('reports/pharmaoverseas-cart-reads.json',JSON.stringify({reads,noCartWrites:true,noOrders:true},null,2));
    }
    const expiresAt = Date.now() + (Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600) * 1000;
    if(process.env.INSPECT_CART==='true') {
      await page.waitForLoadState('networkidle',{timeout:30000}).catch(()=>{});
      await inspectStatic(page,page.request,'pharmaoverseas','shop.pharmaemarket.com');
    }
    const code = await send('pharmaoverseas', { accessToken: body.access_token, cartReadTemplates }, expiresAt);
    return { id: 'pharmaoverseas', result: code === 200 ? 'session saved' : `worker answered ${code}` };
  } finally {
    await page.close();
  }
}

async function aumet(browser) {
  const { AUMET_USERNAME, AUMET_PASSWORD } = process.env;
  if (!AUMET_USERNAME || !AUMET_PASSWORD) return { id: 'aumet', result: 'skipped (no secrets)' };
  // serviceWorkers blocked: ctx.route (the write guard) does not see requests made by a service worker.
  const ctx = await browser.newContext({ locale: 'en-US', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  let phase = 'prepare';
  try {
    let observedProductUrl = null;
    let sellers = [];
    let capturedCartRequest = null;
    const capturedCart = await guardAumetApi(ctx);
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
        loginSignals = classifyLogin(loginStatus, body);
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
      return { id: 'aumet', result: loginSignals.credentialsRejected ? 'login failed: AUMET credentials rejected by server (update AUMET_USERNAME/AUMET_PASSWORD)' : 'login failed (see safe diagnostics)' };
    }
    let searchQuery = 'Panadol';
    phase = 'inspect-search';
    await page.goto('https://marketplace.aumet.com/pharmacy/product/search', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(8000);
    for (const input of await page.$$('input')) {
      const eligible = await input.evaluate(e => e.offsetParent && !e.closest('[class*="cky"],[id*="cky"]') && /search|بحث|ابحث/i.test(e.placeholder || ''));
      if (!eligible) continue;
      await input.fill(searchQuery);
      await page.waitForTimeout(2000);
      await input.press('Enter');
      await page.waitForTimeout(3000);
      break;
    }
    phase = 'capture-cart-context';
    capturedCartRequest = await captureAumetCart(page, capturedCart);
    // A product absent from this account cannot expose its quantity control.
    // One alternate observed catalogue query; never retry a supplier mutation.
    if (!capturedCartRequest) {
      searchQuery = 'Augmentin';
      for (const input of await page.$$('input')) {
        const eligible = await input.evaluate(e => e.offsetParent && !e.closest('[class*="cky"],[id*="cky"]') && /search|بحث|ابحث/i.test(e.placeholder || ''));
        if (!eligible) continue;
        await input.fill(searchQuery);
        await page.waitForTimeout(2000);
        await input.press('Enter');
        await page.waitForTimeout(3000);
        break;
      }
      capturedCartRequest = await captureAumetCart(page, capturedCart);
    }
    phase = 'verify-cart-session';
    // Cart verification is best-effort (FIX44): search needs only the login session. If the cart
    // contract was not captured or does not verify, drop the template (cart writes then stay
    // fail-closed in the Worker) but still save the read-only search session.
    let cartVerified = true;
    try { await verifyAumetCart(ctx.request, capturedCartRequest, auth, xsrf); } catch { cartVerified = false; capturedCartRequest = null; }
    if (process.env.INSPECT_CART === 'true') {
      await inspectStatic(page,ctx.request,'aumet','marketplace.aumet.com');
      const fs = require('node:fs');
      const urls = await page.$$eval('script[src]', nodes => nodes.map(n => n.src));
      if(capturedCartRequest){
        const cartPath=capturedCartRequest.path.replace(/\/items$/,'/items');
        const response=await ctx.request.get('https://marketplace.aumet.com'+cartPath,{headers:{Authorization:auth||'','X-XSRF-TOKEN':xsrf||''}});
        let data=null;try{data=await response.json();}catch{}
        fs.mkdirSync('reports',{recursive:true});fs.writeFileSync('reports/aumet-cart-reads.json',JSON.stringify({status:response.status(),path:cartPath.replace(/\d+/g,'{id}'),schema:schema(data),noCartWrites:true,noOrders:true},null,2));
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
    const searchTaskTemplate = task.includes(searchQuery) ? task.replaceAll(searchQuery, '__NOVA_QUERY__') : null;
    if (!searchTaskTemplate) return { id: 'aumet', result: 'error: query template not captured' };
    delete searchParams.task;
    await sellersTask;
    const code = await send('aumet', { authorization: auth, cookie, xsrf: xsrf || '', searchParams, searchTaskTemplate, sellers, cartRequestTemplate: capturedCartRequest }, Date.now() + 10 * 3600 * 1000);
    return { id: 'aumet', result: code === 200 ? 'session saved (' + (cartVerified ? 'cart read verified' : 'search only, cart not verified') + '; no cart writes)' : `worker answered ${code}` };
  } catch (error) {
    return { id: 'aumet', result: `error at ${phase} (${error.name === 'TimeoutError' ? 'timeout' : /context.*destroyed/i.test(error.message) ? 'navigation interrupted inspection' : /net::/i.test(error.message) ? 'navigation network error' : 'operation failed'})` };
  } finally {
    await ctx.close();
  }
}

(async () => {
  if (!WORKER || !INGEST) { console.log('Session refresh not configured; no session saved.'); process.exit(1); }
  const browser = await chromium.launch();
  for (const [id, fn] of [['pharmaoverseas', pharmaoverseas], ['aumet', aumet]]) {
    if (only !== 'all' && only !== id) continue;
    try { report.push(await fn(browser)); } catch (e) { report.push({ id, result: 'error (details withheld to protect session credentials)' }); }
  }
  await browser.close();
  for (const r of report) console.log(`${r.id}: ${r.result}`);
  if (report.some((r) => /error|failed|worker answered|stopped|skipped/.test(r.result))) process.exitCode = 1;
})();


