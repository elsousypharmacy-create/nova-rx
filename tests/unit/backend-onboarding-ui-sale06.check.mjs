// SALE-06: «تجهيز صيدلية جديدة (تجريبي)» inline helper (index.html <script id="sale06-onboarding">). DEFAULT OFF.
// No network: every fetch is a mock. No payment code. Run: node tests/unit/backend-onboarding-ui-sale06.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const PROD = 'https://nova-rx-api.elsousypharmacy.workers.dev';
const html = readFileSync('index.html', 'utf8');
const src = /<script id="sale06-onboarding">([\s\S]*?)<\/script>/.exec(html)[1];
const flagSrc = /<script id="sale01-backend-flag">([\s\S]*?)<\/script>/.exec(html)[1];
const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
function mkFetch(reply) {
  const f = async (url, o) => { f.calls.push({ url, o, body: o && o.body ? JSON.parse(o.body) : null }); const r = reply(url, o); return { ok: r.status < 400, status: r.status, json: async () => r.body }; };
  f.calls = []; return f;
}
function load(local = {}, session = {}, fetch) {
  const ls = mem(local), ss = mem(session);
  const ctx = { localStorage: ls, sessionStorage: ss, String, JSON, Math, Date, Promise, encodeURIComponent, window: {} };
  if (fetch) ctx.fetch = fetch;
  vm.runInNewContext(flagSrc, ctx);
  vm.runInNewContext(src, ctx);
  return { o: ctx.window.novaOnboarding, ls, ss };
}
const GOOD = { tenantId: 'pharm-one', name: 'صيدلية النور', branches: 'الرئيسي، الثاني', username: 'owner1', password: 'longpass1' };

// 1) Default OFF: mode off, card hidden + empty, zero calls for every operation.
{
  const f = mkFetch(() => ({ status: 200, body: { ok: true } }));
  const { o, ls } = load({ 'novaBackend.enabled': 'true' }, { 'novaBackend.token': 'k' }, f);
  assert.equal(o.enabled(), false); assert.equal(o.mode(), 'off');
  for (const r of [await o.createTenant(GOOD), await o.createSandbox(), await o.status('x'), await o.disable('x'), await o.enable('x'), await o.skipImport('x')])
    assert.equal(r.code, 'ONBOARDING_OFF');
  assert.equal(f.calls.length, 0, 'flag off: zero calls even with backend ON');
  assert.equal(ls.getItem('novaOnboarding.local'), null, 'flag off: nothing stored');
  const el = { innerHTML: 'x', hidden: false };
  o.mount(el); assert.equal(el.hidden, true); assert.equal(el.innerHTML, '');
  assert.equal(load({ 'novaOnboarding.enabled': '1' }).o.mode(), 'off', 'only exact "true" enables');
}

// 2) Validation mirrors backend createTenant.
{
  const { o } = load({ 'novaOnboarding.enabled': 'true' });
  assert.equal(o.validate({ ...GOOD, tenantId: 'A!' }).code, 'ONBOARDING_BAD_TENANT');
  assert.equal(o.validate({ ...GOOD, name: ' ' }).code, 'ONBOARDING_BAD_NAME');
  assert.equal(o.validate({ ...GOOD, branches: 'أ, أ' }).code, 'ONBOARDING_BAD_BRANCHES');
  assert.equal(o.validate({ ...GOOD, branches: '' }).code, 'ONBOARDING_BAD_BRANCHES');
  assert.equal(o.validate({ ...GOOD, password: 'short' }).code, 'ONBOARDING_BAD_OWNER');
  const v = o.validate(GOOD);
  assert.equal(v.ok, true); assert.deepEqual([...v.body.branches], ['الرئيسي', 'الثاني']);
}

// 3) Flag ON, backend OFF => local preview: fake data on this device, zero calls, password never stored, soft-disable.
{
  const f = mkFetch(() => ({ status: 200, body: { ok: true } }));
  const { o, ls } = load({ 'novaOnboarding.enabled': 'true' }, {}, f);
  assert.equal(o.mode(), 'local');
  const r = await o.createTenant(GOOD);
  assert.equal(r.ok, true); assert.equal(r.local, true); assert.equal(r.branches, 2); assert.equal(r.nextStep, 'import');
  assert.equal((await o.createTenant(GOOD)).code, 'ONBOARDING_TENANT_EXISTS');
  assert.ok(!String(ls.getItem('novaOnboarding.local')).includes('longpass1'), 'password never stored');
  let s = await o.status('pharm-one');
  assert.equal(s.tenant.status, 'active'); assert.equal(s.steps.find((x) => x.step === 'import').status, 'pending');
  assert.equal((await o.skipImport('pharm-one')).ok, true);
  assert.equal((await o.status('pharm-one')).steps.find((x) => x.step === 'import').status, 'skipped');
  assert.equal((await o.disable('pharm-one')).status, 'disabled');
  s = await o.status('pharm-one');
  assert.equal(s.tenant.status, 'disabled', 'soft-disable keeps the tenant');
  assert.equal((await o.skipImport('pharm-one')).code, 'ONBOARDING_TENANT_DISABLED');
  assert.equal((await o.enable('pharm-one')).status, 'active');
  const sb = await o.createSandbox();
  assert.equal(sb.ok, true); assert.equal(sb.sandbox, true); assert.equal(sb.seeded, 3); assert.match(sb.tenantId, /^demo-[0-9a-f]{8}$/);
  assert.equal(ls.getItem('novaOnboarding.last'), sb.tenantId);
  assert.equal(f.calls.length, 0, 'local mode: zero calls');
}

// 4) Flag ON + backend ON but no session key => still local, zero calls.
{
  const f = mkFetch(() => ({ status: 200, body: { ok: true } }));
  const { o } = load({ 'novaOnboarding.enabled': 'true', 'novaBackend.enabled': 'true' }, {}, f);
  assert.equal(o.mode(), 'local'); await o.createSandbox(); assert.equal(f.calls.length, 0);
}

// 5) Flag ON + backend ON + key => calls the existing N121 routes (mocked), Bearer auth, exact payloads.
{
  const f = mkFetch((url) => {
    if (url.endsWith('/tenants')) return { status: 201, body: { ok: true, tenantId: 'pharm-one', branchIds: ['b1', 'b2'], nextStep: 'import' } };
    if (url.endsWith('/sandbox')) return { status: 201, body: { ok: true, tenantId: 'demo-abc12345', seeded: 3, sandbox: true } };
    if (url.includes('/status?')) return { status: 200, body: { ok: true, tenant: { id: 'pharm-one', status: 'active' }, steps: [] } };
    return { status: 200, body: { ok: true, status: url.endsWith('/disable') ? 'disabled' : 'active' } };
  });
  const { o } = load({ 'novaOnboarding.enabled': 'true', 'novaBackend.enabled': 'true' }, { 'novaBackend.token': 'sess-key' }, f);
  assert.equal(o.mode(), 'api');
  assert.equal((await o.createTenant({ ...GOOD, tenantId: 'bad id' })).code, 'ONBOARDING_BAD_TENANT');
  assert.equal(f.calls.length, 0, 'invalid input never sent');
  assert.equal((await o.createTenant(GOOD)).ok, true);
  assert.equal((await o.createSandbox()).tenantId, 'demo-abc12345');
  await o.status('pharm-one'); await o.skipImport('pharm-one'); await o.disable('pharm-one'); await o.enable('pharm-one');
  assert.deepEqual(f.calls.map((c) => c.o.method + ' ' + c.url), [
    'POST ' + PROD + '/api/v1/onboarding/tenants', 'POST ' + PROD + '/api/v1/onboarding/sandbox',
    'GET ' + PROD + '/api/v1/onboarding/status?tenantId=pharm-one', 'POST ' + PROD + '/api/v1/onboarding/import-step',
    'POST ' + PROD + '/api/v1/onboarding/disable', 'POST ' + PROD + '/api/v1/onboarding/enable']);
  assert.ok(f.calls.every((c) => c.o.headers.Authorization === 'Bearer sess-key'));
  assert.deepEqual(f.calls[0].body, { tenantId: 'pharm-one', name: 'صيدلية النور', branches: ['الرئيسي', 'الثاني'], owner: { username: 'owner1', password: 'longpass1', displayName: null } });
  assert.deepEqual(f.calls[3].body, { tenantId: 'pharm-one', skipped: true });
  assert.deepEqual(f.calls[4].body, { tenantId: 'pharm-one' });
  assert.equal(f.calls[2].o.body, undefined, 'GET has no body');
}

// 6) Server flag OFF (404 ONBOARDING_DISABLED) and network errors => clear Arabic message, no throw.
{
  const { o } = load({ 'novaOnboarding.enabled': 'true', 'novaBackend.enabled': 'true' }, { 'novaBackend.token': 'k' },
    mkFetch(() => ({ status: 404, body: { ok: false, code: 'ONBOARDING_DISABLED', message_ar: 'الميزة غير مفعّلة.' } })));
  const r = await o.createSandbox();
  assert.equal(r.code, 'ONBOARDING_DISABLED'); assert.match(r.message_ar, /مقفولة على السيرفر/);
  const p = load({ 'novaOnboarding.enabled': 'true', 'novaBackend.enabled': 'true' }, { 'novaBackend.token': 'k' },
    mkFetch(() => ({ status: 403, body: { ok: false, code: 'PERMISSION_DENIED', message_ar: 'ليست لديك صلاحية لهذه العملية.' } })));
  assert.equal((await p.o.disable('x')).code, 'PERMISSION_DENIED');
  const n = load({ 'novaOnboarding.enabled': 'true', 'novaBackend.enabled': 'true' }, { 'novaBackend.token': 'k' }, Object.assign(async () => { throw new Error('net'); }, { calls: [] }));
  assert.equal((await n.o.status('x')).code, 'ONBOARDING_NETWORK');
}

// 7) No global enable, no payment code, nothing logged.
for (const file of ['index.html', 'emergency-sales.html', 'purchases.html', 'sticker-studio.html', 'supplier-compare.html'])
  assert.doesNotMatch(readFileSync(file, 'utf8'), /setItem\(\s*['"]novaOnboarding\.enabled['"]\s*,\s*['"]true['"]/, `${file}: no hard-coded enable`);
assert.doesNotMatch(src, /console\./, 'never logs');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
assert.doesNotMatch(code, /stripe|paypal|paymob|fawry|checkout|billing|card[-_ ]?number|price|subscription/i, 'no payment/billing code');
assert.doesNotMatch(code, /\/plans|\/billing|\/quota/i, 'no billing/plan routes called');
assert.doesNotMatch(src, /setItem\([^)]*(password|pw)\b/i, 'password never written to storage');

console.log('backend-onboarding-ui-sale06.check OK');
