import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
// PUR-05a: one notice only; 403 source-auth-required -> calm unlock empty state (preview + production); PIN submitted to purchasingStock.
// Fake/local data only ('0000' is a fake typed into the field). Non-GET requests to the page are aborted except the fake stock/status API.
// Needs: python3 -m http.server 8766 in repo root. Optional NOVA_CHROMIUM. Screenshots -> qa/screens/PUR-05a/ (taken BEFORE typing any PIN).
const BASE = 'http://127.0.0.1:8766/purchases.html';
const shots = 'qa/screens/PUR-05a'; fs.mkdirSync(shots, { recursive: true });
const stock = [{ id: '1', code: '1301', name: 'صنف تجريبي', nameEn: 'Fake 500mg', stock: 1, minStock: 4, idealStock: 8, dailySales: null, observedDays: 0 }];
const FAKE = '0000';
const browser = await chromium.launch({ headless: true, executablePath: process.env.NOVA_CHROMIUM || undefined });
async function open(vp, { env, sessions = 'ok', hash = '', lock = false } = {}) {
  const ctx = await browser.newContext({ viewport: vp });
  await ctx.addInitScript(e => { if (e) window.NOVA_ENV = e; localStorage.setItem('novaPurchasePrefsV1', JSON.stringify({ days: 21, level: 'ideal', suppliers: ['aumet'], aumetSellers: ['one'] })); }, env);
  const stockBodies = [], logs = [];
  await ctx.route('**/*', async route => {
    const r = route.request(), u = new URL(r.url());
    if (u.hostname !== '127.0.0.1') return route.abort();
    if (!u.pathname.startsWith('/api/')) { if (r.method() !== 'GET') return route.abort(); return route.continue(); }
    let data, status = 200;
    if (u.pathname === '/api/purchases/stock') { const b = r.postDataJSON(); stockBodies.push(b); if (lock && b.dashboardPin !== FAKE) { status = 403; data = { ok: false, error: 'source-auth-required' }; } else if (!lock && !['staging', 'preview'].includes(env) && !b.dashboardPin) { status = 403; data = { ok: false, error: 'source-auth-required' }; } else data = { ok: true, schemaVersion: 1, generatedAt: new Date().toISOString(), items: stock }; }
    else if (u.pathname === '/api/suppliers/status') data = { suppliers: [{ id: 'aumet', state: sessions }, { id: 'pharmaoverseas', state: 'ok' }] };
    else if (u.pathname === '/api/suppliers/sellers') data = { sellers: [{ id: 'one', name: 'مخزن تجريبي' }] };
    else { status = 404; data = {}; }
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => logs.push(m.text()));
  await page.goto(BASE + hash); await page.waitForTimeout(900);
  return { ctx, page, errors, stockBodies, logs };
}
const visibleNotices = page => page.locator('#sessionBanner:visible, #status.warning:visible, #rows .load-error:visible').count();
for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  const tag = vp.width + 'x' + vp.height;
  // (a) session expired + source locked on preview -> one banner + unlock card, no stacked warning/red
  let t = await open(vp, { env: 'preview', sessions: 'off', lock: true });
  assert.equal(await t.page.locator('#sessionBanner').isVisible(), true);
  assert.equal(await visibleNotices(t.page), 1, 'one notice only');
  assert.equal(await t.page.locator('#rows .unlock-card').count(), 1);
  assert.equal(await t.page.locator('#rows .load-error').count(), 0);
  await t.page.screenshot({ path: `${shots}/needs-banner-${tag}.png` });
  await t.ctx.close();
  // (b) preview + 403: polished unlock, no banner; submit fake PIN -> purchasingStock gets it, list loads
  t = await open(vp, { env: 'preview', lock: true });
  assert.equal(t.stockBodies[0].dashboardPin, '', 'preview still auto-attempts on open');
  assert.equal(await visibleNotices(t.page), 0, 'no error/warning look');
  const txt = await t.page.locator('#rows').innerText();
  assert.ok(txt.includes('النواقص محمية برقم الدخول') && txt.includes('عرض النواقص'));
  const f = t.page.locator('#dashboard-style');
  assert.equal(await f.getAttribute('type'), 'password'); assert.equal(await f.getAttribute('autocomplete'), 'off');
  const box = await t.page.locator('#rows .unlock-card').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= vp.width, 'unlock card inside viewport');
  assert.ok((await t.page.locator('[data-empty-act=unlock]').boundingBox()).height >= 40, 'tap target');
  assert.ok(await t.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
  await t.page.screenshot({ path: `${shots}/needs-locked-${tag}.png` });
  // wrong PIN: same calm state + short hint, still no stacked banner
  await f.fill('1111'); await t.page.click('[data-empty-act=unlock]'); await t.page.waitForTimeout(500);
  assert.equal(t.stockBodies.at(-1).dashboardPin, '1111');
  assert.ok((await t.page.locator('#rows').innerText()).includes('الرقم غير صحيح'));
  assert.equal(await visibleNotices(t.page), 0);
  await t.page.locator('#dashboard-style').fill(FAKE); await t.page.click('[data-empty-act=unlock]'); await t.page.waitForTimeout(600);
  assert.equal(t.stockBodies.at(-1).dashboardPin, FAKE);
  assert.ok((await t.page.locator('#rows').innerText()).includes('صنف تجريبي'), 'needs list loads after unlock');
  // (d) PIN not persisted, not in DOM text or logs
  const leak = await t.page.evaluate(v => ({ ls: JSON.stringify(localStorage) + JSON.stringify(sessionStorage), dom: document.body.innerHTML.includes('value="' + v + '"') }), FAKE);
  assert.ok(!leak.ls.includes(FAKE) && !leak.dom && !t.logs.join('\n').includes(FAKE), 'PIN not persisted/logged');
  assert.deepEqual(t.errors, []); await t.ctx.close();
  // (c) production: not auto-unlocked, shows the unlock state, no extra banner
  for (const env of [undefined, 'production']) {
    t = await open(vp, { env, lock: true });
    assert.equal(t.stockBodies.length, 1); assert.equal(t.stockBodies[0].dashboardPin, '');
    assert.ok((await t.page.locator('#rows').innerText()).includes('النواقص محمية برقم الدخول'));
    assert.equal(await visibleNotices(t.page), 0);
    await t.ctx.close();
  }
  // other failure (network-ish) -> single calm retry notice
  // receive + history tabs for screenshots
  t = await open(vp, { env: 'preview' });
  await t.page.click('#tabReceive'); await t.page.waitForTimeout(1200); await t.page.screenshot({ path: `${shots}/receive-${tag}.png` });
  await t.page.click('#tabHistory'); await t.page.waitForTimeout(500); await t.page.screenshot({ path: `${shots}/history-${tag}.png` });
  await t.ctx.close();
}
await browser.close();
console.log('PASS: PUR-05a single notice, calm unlock state (preview + production), fake PIN submit, no PIN leak');
