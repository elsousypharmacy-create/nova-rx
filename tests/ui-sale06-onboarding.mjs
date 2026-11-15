// SALE-06: «تجهيز صيدلية جديدة (تجريبي)» Settings card. DEFAULT OFF. Fake/local data only: localStorage cleared, every
// request that is not local is aborted, EXCEPT production /api/v1/onboarding/* which is answered by a MOCK here (nothing
// reaches the real server; no live writes). Every other non-GET is aborted. No payment UI.
// Needs a static server on the repo root, e.g. `python3 -m http.server 8765`.
// Run: node tests/ui-sale06-onboarding.mjs   (NOVA_URL to override, CHROME_PATH for a system Chrome)
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const PROD = 'https://nova-rx-api.elsousypharmacy.workers.dev';
const OB = PROD + '/api/v1/onboarding/';
const TOKEN = 'fake-session-key-sale06';
const PASS = 'fake-owner-pass-06';
const snapshot = readFileSync(new URL('../data/emergency-stock.json', import.meta.url), 'utf8');
let passed = 0;
const t = async (name, fn) => {
  try { await fn(); } catch (e) { console.log('  FAIL', name, '\n   ', String(e.stack || e.message).split('\n').slice(0, 4).join('\n')); process.exit(1); }
  passed++; console.log('  ok', name);
};
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });

// Mock of the N121 routes (in-memory, this test only).
function mockServer() {
  const tenants = {};
  return (method, url, body) => {
    const p = url.slice(OB.length).split('?')[0];
    if (p === 'tenants' && method === 'POST') { tenants[body.tenantId] = { id: body.tenantId, name: body.name, status: 'active', sandbox: false, imp: 'pending' }; return [201, { ok: true, tenantId: body.tenantId, branchIds: body.branches.map((_, i) => 'br_' + i), nextStep: 'import' }]; }
    if (p === 'sandbox' && method === 'POST') { tenants['demo-mock0001'] = { id: 'demo-mock0001', name: 'صيدلية تجريبية', status: 'active', sandbox: true, imp: 'done' }; return [201, { ok: true, tenantId: 'demo-mock0001', seeded: 3, sandbox: true }]; }
    const id = method === 'GET' ? new URL(url).searchParams.get('tenantId') : body && body.tenantId;
    const tn = tenants[id];
    if (!tn) return [404, { ok: false, code: 'ONBOARDING_NOT_FOUND', message_ar: 'المستأجر غير موجود.' }];
    if (p === 'status' && method === 'GET') return [200, { ok: true, tenant: { id: tn.id, name: tn.name, status: tn.status, sandbox: tn.sandbox }, steps: ['tenant', 'branches', 'owner', 'roles', 'import'].map((s) => ({ step: s, status: s === 'import' ? tn.imp : 'done' })) }];
    if (p === 'disable' && method === 'POST') { tn.status = 'disabled'; return [200, { ok: true, status: 'disabled' }]; }
    if (p === 'enable' && method === 'POST') { tn.status = 'active'; return [200, { ok: true, status: 'active' }]; }
    if (p === 'import-step' && method === 'POST') { tn.imp = body.skipped ? 'skipped' : 'done'; return [200, { ok: true }]; }
    return [404, { ok: false, code: 'NOT_FOUND' }];
  };
}

async function open({ serverOff = false } = {}) {
  const origin = new URL(BASE).origin;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG', serviceWorkers: 'block' });
  const prodCalls = [], blocked = [], logs = [], nonGet = [];
  const server = mockServer();
  await ctx.route('**/*', (r) => {
    const req = r.request(), u = req.url(), m = req.method();
    if (u.startsWith(PROD)) {
      let body = null; try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch {}
      prodCalls.push({ url: u, method: m, auth: req.headers().authorization || '', body });
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
      if (u.startsWith(OB)) {
        const [st, j] = serverOff ? [404, { ok: false, code: 'ONBOARDING_DISABLED', message_ar: 'الميزة غير مفعّلة.' }] : server(m, u, body);
        return r.fulfill({ status: st, contentType: 'application/json', headers: cors, body: JSON.stringify(j) });
      }
      if (m !== 'GET') return r.abort();
      return r.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, conversations: [] }) });
    }
    if (m !== 'GET' && m !== 'HEAD') { blocked.push(u); nonGet.push(m + ' ' + u); return r.abort(); }
    if (u.startsWith(origin) || u.startsWith('data:')) return r.continue();
    blocked.push(u); return r.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => logs.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('seeded')) { localStorage.clear(); sessionStorage.setItem('seeded', '1'); }
      localStorage.setItem('nova-rx-language', 'ar'); localStorage.removeItem('nova.activePage');
    } catch {}
  });
  await page.goto(origin + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.novaOnboarding && window.novaBackendFlag, null, { timeout: 10000 });
  return { ctx, page, errors, prodCalls, blocked, logs, nonGet };
}
const openSettings = async (page) => {
  await page.evaluate(() => document.querySelector('.nova-tab[data-page=settings]').click());
  await page.waitForSelector('#novaBackendCard #novaBackendToggle', { timeout: 5000 });
};
const fillForm = async (page) => {
  await page.locator('#novaOnbTenant').fill('pharm-one');
  await page.locator('#novaOnbName').fill('صيدلية النور');
  await page.locator('#novaOnbBranches').fill('الرئيسي، الثاني');
  await page.locator('#novaOnbUser').fill('owner1');
  await page.locator('#novaOnbPass').fill(PASS);
};
const noLeak = async (s) => {
  assert.equal(await s.page.locator('#novaOnbPass').inputValue(), '', 'password cleared after submit');
  const ls = await s.page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)));
  assert.ok(!ls.includes(PASS), 'password not in localStorage');
  assert.ok(!(await s.page.locator('#novaOnboardingCard').innerHTML()).includes(PASS), 'password not in DOM');
  assert.ok(!s.logs.some((l) => l.includes(PASS) || l.includes(TOKEN)), 'password/token not in console');
};

try {
  // A) Default device: flag never touched.
  const a = await open();
  await t('default OFF: flag absent, mode off', async () => {
    assert.equal(await a.page.evaluate(() => localStorage.getItem('novaOnboarding.enabled')), null);
    assert.equal(await a.page.evaluate(() => window.novaOnboarding.mode()), 'off');
  });
  await t('flag OFF: onboarding card hidden and empty in Settings, zero onboarding/production calls', async () => {
    await openSettings(a.page);
    const card = a.page.locator('#novaOnboardingCard');
    assert.equal(await card.count(), 1);
    assert.equal(await card.isVisible(), false);
    assert.equal(await card.innerHTML(), '');
    assert.equal(await a.page.locator('#novaOnbCreate').count(), 0);
    await a.page.waitForTimeout(300);
    assert.equal(a.prodCalls.length, 0, JSON.stringify(a.prodCalls));
  });
  await t('flag OFF + backend ON with key: still hidden, zero onboarding calls', async () => {
    await a.page.evaluate(() => { window.novaBackendFlag.setEnabled(true); window.novaBackendFlag.setToken('k'); });
    await openSettings(a.page);
    assert.equal(await a.page.locator('#novaOnboardingCard').isVisible(), false);
    await a.page.waitForTimeout(300);
    assert.equal(a.prodCalls.filter((c) => c.url.startsWith(OB)).length, 0);
  });
  await t('no page errors (default)', () => assert.deepEqual(a.errors, [], JSON.stringify(a.errors)));
  await a.ctx.close();

  // B) Flag ON, backend OFF: local preview with fake data, no network.
  const b = await open();
  await t('flag ON (local): card visible, Arabic RTL, no payment, 44px controls', async () => {
    await b.page.evaluate(() => window.novaOnboarding.setEnabled(true));
    await openSettings(b.page);
    const card = b.page.locator('#novaOnboardingCard');
    assert.equal(await card.isVisible(), true);
    assert.match(await card.locator('h3').innerText(), /تجهيز صيدلية جديدة/);
    assert.equal(await b.page.locator('#novaOnbMode').getAttribute('data-mode'), 'local');
    assert.match(await b.page.locator('#novaOnbNoPay').innerText(), /بدون دفع/);
    assert.equal(await b.page.evaluate(() => document.documentElement.dir), 'rtl');
    assert.equal(await card.evaluate((el) => getComputedStyle(el).direction), 'rtl');
    const txt = await card.innerText();
    assert.doesNotMatch(txt, /stripe|paypal|visa|mastercard|ادفع|اشترك/i, 'no payment wording');
    assert.equal(await card.locator('input[autocomplete="cc-number"], input[name*=card]').count(), 0);
    for (const sel of ['#novaOnbCreate', '#novaOnbSandbox', '#novaOnbTenant', '#novaOnbPass']) {
      const h = await b.page.locator(sel).evaluate((x) => x.getBoundingClientRect().height);
      assert.ok(h >= 44, sel + ' height ' + h);
    }
  });
  await t('local: invalid input shows Arabic error, nothing created', async () => {
    await b.page.locator('#novaOnbTenant').fill('Bad ID');
    await b.page.locator('#novaOnbCreate').click();
    await b.page.waitForFunction(() => document.getElementById('novaOnbResult').dataset.kind === 'error');
    assert.match(await b.page.locator('#novaOnbResult').innerText(), /معرّف الصيدلية/);
    assert.equal(await b.page.evaluate(() => localStorage.getItem('novaOnboarding.local')), null);
  });
  await t('local: create pharmacy + branches + owner; import step pending', async () => {
    await fillForm(b.page);
    await b.page.locator('#novaOnbCreate').click();
    await b.page.waitForSelector('#novaOnbTenantState[data-status=active]');
    assert.equal(await b.page.locator('#novaOnbResult').getAttribute('data-kind'), 'ok');
    assert.equal(await b.page.locator('#novaOnbSteps li[data-step=owner]').getAttribute('data-status'), 'done');
    assert.equal(await b.page.locator('#novaOnbSteps li[data-step=import]').getAttribute('data-status'), 'pending');
    await noLeak(b);
  });
  await t('local: soft-disable then re-enable (nothing deleted)', async () => {
    await b.page.locator('#novaOnbDisable').click();
    await b.page.waitForSelector('#novaOnbTenantState[data-status=disabled]');
    const st = await b.page.evaluate(() => JSON.parse(localStorage.getItem('novaOnboarding.local')));
    assert.equal(st.tenants.length, 1); assert.equal(st.tenants[0].status, 'disabled');
    await b.page.locator('#novaOnbEnable').click();
    await b.page.waitForSelector('#novaOnbTenantState[data-status=active]');
  });
  await t('local: demo pharmacy with seed data', async () => {
    await b.page.locator('#novaOnbSandbox').click();
    await b.page.waitForFunction(() => /^demo-/.test(localStorage.getItem('novaOnboarding.last') || ''));
    await b.page.waitForSelector('#novaOnbSteps li[data-step=import][data-status=done]');
    assert.match(await b.page.locator('#novaOnbTenantState').innerText(), /تجريبية/);
  });
  await t('local: zero network calls (production or other)', () => {
    assert.equal(b.prodCalls.length, 0, JSON.stringify(b.prodCalls));
    assert.deepEqual(b.blocked.filter((u) => /\/api\/|onboarding/.test(u)), [], 'no other API requests (page fonts/logo GETs are pre-existing and aborted)');
  });
  await t('local: no non-GET request left the page', () => assert.deepEqual(b.nonGet, []));
  await t('no page errors (local)', () => assert.deepEqual(b.errors, [], JSON.stringify(b.errors)));
  await b.ctx.close();

  // C) Flag ON + backend ON + session key: calls existing N121 routes, answered by the mock.
  const c = await open();
  await t('flag ON (api): mode api, create calls POST /onboarding/tenants with Bearer (mocked)', async () => {
    await c.page.evaluate((k) => { window.novaOnboarding.setEnabled(true); window.novaBackendFlag.setEnabled(true); window.novaBackendFlag.setToken(k); }, TOKEN);
    await openSettings(c.page);
    assert.equal(await c.page.locator('#novaOnbMode').getAttribute('data-mode'), 'api');
    await fillForm(c.page);
    await c.page.locator('#novaOnbCreate').click();
    await c.page.waitForSelector('#novaOnbTenantState[data-status=active]');
    const post = c.prodCalls.find((x) => x.url === OB + 'tenants' && x.method === 'POST');
    assert.ok(post, JSON.stringify(c.prodCalls));
    assert.equal(post.auth, 'Bearer ' + TOKEN);
    assert.deepEqual(post.body.branches, ['الرئيسي', 'الثاني']);
    assert.ok(c.prodCalls.some((x) => x.method === 'GET' && x.url === OB + 'status?tenantId=pharm-one'));
    await noLeak(c);
  });
  await t('api: skip import, soft-disable, re-enable hit the mocked routes', async () => {
    await c.page.locator('#novaOnbSkipImport').click();
    await c.page.waitForSelector('#novaOnbSteps li[data-step=import][data-status=skipped]');
    await c.page.locator('#novaOnbDisable').click();
    await c.page.waitForSelector('#novaOnbTenantState[data-status=disabled]');
    await c.page.locator('#novaOnbEnable').click();
    await c.page.waitForSelector('#novaOnbTenantState[data-status=active]');
    for (const p of ['import-step', 'disable', 'enable']) assert.ok(c.prodCalls.some((x) => x.method === 'POST' && x.url === OB + p), p);
  });
  await t('api: demo sandbox via POST /onboarding/sandbox', async () => {
    await c.page.locator('#novaOnbSandbox').click();
    await c.page.waitForFunction(() => localStorage.getItem('novaOnboarding.last') === 'demo-mock0001');
    await c.page.waitForSelector('#novaOnbSteps li[data-step=import][data-status=done]');
  });
  await t('api: only onboarding routes written to; no billing/plan/payment route ever called', () => {
    const writes = c.prodCalls.filter((x) => x.method !== 'GET' && x.method !== 'OPTIONS');
    assert.ok(writes.every((x) => x.url.startsWith(OB)), JSON.stringify(writes.map((x) => x.url)));
    assert.ok(!c.prodCalls.some((x) => /billing|plans|quota|payment|checkout/i.test(x.url)));
  });
  await t('no page errors (api)', () => assert.deepEqual(c.errors, [], JSON.stringify(c.errors)));
  await c.ctx.close();

  // D) Server flag NOVA_ONBOARDING OFF => clear Arabic message.
  const d = await open({ serverOff: true });
  await t('api + server flag OFF: Arabic "مقفولة على السيرفر" message, nothing shown as created', async () => {
    await d.page.evaluate((k) => { window.novaOnboarding.setEnabled(true); window.novaBackendFlag.setEnabled(true); window.novaBackendFlag.setToken(k); }, TOKEN);
    await openSettings(d.page);
    await d.page.locator('#novaOnbSandbox').click();
    await d.page.waitForFunction(() => document.getElementById('novaOnbResult').dataset.kind === 'error');
    assert.match(await d.page.locator('#novaOnbResult').innerText(), /مقفولة على السيرفر/);
    assert.equal(await d.page.locator('#novaOnbTenantState').count(), 0);
  });
  await t('no page errors (server off)', () => assert.deepEqual(d.errors, [], JSON.stringify(d.errors)));
  await d.ctx.close();

  console.log(`SALE-06 onboarding OK (${passed} checks)`);
} finally {
  await browser.close();
}
