import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// PUR-04: history tab wired+rendered, single banner, receive tab full width, pinless only on staging/preview.
// Fake/local data only. Non-GET requests are aborted. Needs python3 -m http.server 8766 in repo root.
// Optional NOVA_CHROMIUM=/path/to/chromium. Screenshots -> qa/screens/PUR-04/
const BASE = 'http://127.0.0.1:8766/purchases.html';
const shots = 'qa/screens/PUR-04'; fs.mkdirSync(shots, { recursive: true });
const stock = [{ id: '1', code: '1301', name: 'صنف تجريبي', nameEn: 'Fake 500mg', stock: 1, minStock: 4, idealStock: 8, dailySales: null, observedDays: 0 }];
const browser = await chromium.launch({ headless: true, executablePath: process.env.NOVA_CHROMIUM || undefined });
async function open(vp, { env, sessions = 'ok', hash = '' } = {}) {
  const ctx = await browser.newContext({ viewport: vp });
  await ctx.addInitScript(e => { if (e) window.NOVA_ENV = e; localStorage.setItem('novaPurchasePrefsV1', JSON.stringify({ days: 21, level: 'ideal', suppliers: ['aumet'], aumetSellers: ['one'] })); }, env);
  const stockBodies = [];
  await ctx.route('**/*', async route => {
    const r = route.request(), u = new URL(r.url());
    if (u.hostname !== '127.0.0.1') return route.abort();
    if (!u.pathname.startsWith('/api/')) { if (r.method() !== 'GET') return route.abort(); return route.continue(); }
    let data, status = 200;
    if (u.pathname === '/api/purchases/stock') { const b = r.postDataJSON(); stockBodies.push(b); if (!['staging', 'preview'].includes(env) && !b.dashboardPin) { status = 403; data = { ok: false, error: 'source-auth-required' }; } else data = { ok: true, schemaVersion: 1, sourceUpdatedAt: new Date().toISOString(), items: stock }; }
    else if (u.pathname === '/api/suppliers/status') data = { suppliers: [{ id: 'aumet', state: sessions }, { id: 'pharmaoverseas', state: 'ok' }] };
    else if (u.pathname === '/api/suppliers/sellers') data = { sellers: [{ id: 'one', name: 'مخزن تجريبي' }] };
    else { status = 404; data = {}; }
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE + hash); await page.waitForTimeout(900);
  return { ctx, page, errors, stockBodies };
}
for (const vp of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  const tag = vp.width + 'x' + vp.height;
  // 1) history wired + rendered (empty list), placeholder gone
  let t = await open(vp, { env: 'preview', hash: '#history' });
  const hist = await t.page.locator('#panelHistory').innerText();
  assert.ok(!hist.includes('هيظهر هنا قريبًا'), 'placeholder must be replaced');
  assert.ok(hist.includes('لسه مفيش فواتير'), 'history empty state');
  assert.equal(await t.page.evaluate(() => typeof window.mountInvoiceHistory), 'function');
  await t.page.screenshot({ path: `${shots}/history-${tag}.png` });
  assert.deepEqual(t.errors, []); await t.ctx.close();
  // 2) pinless preview: auto-load, no pin prompt
  t = await open(vp, { env: 'preview', sessions: 'off' });
  assert.equal(t.stockBodies.length, 1); assert.equal(t.stockBodies[0].dashboardPin, '');
  const rows = await t.page.locator('#rows').innerText();
  assert.ok(!rows.includes('رقم دخول الداشبورد'), 'no PIN prompt on preview'); assert.ok(rows.includes('صنف تجريبي'));
  // 3) single banner: session banner visible, duplicate warning status hidden
  assert.equal(await t.page.locator('#sessionBanner').isVisible(), false, 'owner 20 Nov: no supplier session banner');
  const visibleWarnings = await t.page.locator('#sessionBanner:visible, #status.warning:visible').count();
  assert.ok(visibleWarnings <= 1, 'at most one warning');
  await t.page.screenshot({ path: `${shots}/needs-banner-${tag}.png` });
  // 4) receive tab full width like needs tab
  await t.page.click('#tabReceive'); await t.page.waitForTimeout(1500);
  const fw = await t.page.evaluate(() => { const f = document.getElementById('receiveFrame'), tabs = document.querySelector('.pur-tabs'); const d = f.contentDocument; const el = d && (d.querySelector('.rcv') || d.body); return { tabs: tabs.getBoundingClientRect().width, frame: f.getBoundingClientRect().width, inner: el ? el.getBoundingClientRect().width : 0 }; });
  assert.ok(fw.frame >= fw.tabs - 2, 'iframe spans tab bar width ' + JSON.stringify(fw));
  if (vp.width > 800) assert.ok(fw.inner > 900 || fw.inner >= fw.frame - 60, 'receive content full width ' + JSON.stringify(fw));
  await t.page.screenshot({ path: `${shots}/receive-${tag}.png` });
  await t.ctx.close();
  // 5) production/unknown host stays gated (no env flag, 127.0.0.1 host)
  t = await open(vp, {});
  assert.equal(t.stockBodies[0].dashboardPin, ''); // the page attempted, server fake says 403
  const prod = await t.page.locator('#rows').innerText();
  assert.ok(prod.includes('رقم دخول الداشبورد'), 'production still asks for the dashboard number');
  await t.ctx.close();
  // production env explicitly
  t = await open(vp, { env: 'production' });
  assert.ok((await t.page.locator('#rows').innerText()).includes('رقم دخول الداشبورد'));
  await t.ctx.close();
}
await browser.close();
console.log('PASS: PUR-04 history wired, single banner, receive width, pinless only on staging/preview');
