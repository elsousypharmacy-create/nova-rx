// Dependency-free checks for worker/procurement/provider/ (issue Procurement 10:
// encrypted session store, supplier hub, HTTP API). Fakes only, no network.
// Run: node tests/unit/procurement-hub.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSessionStore } from '../../worker/procurement/provider/session-store.js';
import { createSupplierHub } from '../../worker/procurement/provider/hub.js';
import { createSupplierApi } from '../../worker/procurement/provider/http.js';
import { AuthRequiredError, SchemaDriftError } from '../../worker/procurement/connector-contract.js';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const HOUR = 3600 * 1000;
const SECRET = 'unit-test-secret';
const PIN = 'pin-123';
const INGEST = 'ingest-123';

function fakeKv() {
  const map = new Map();
  return {
    map,
    get: async (k) => (map.has(k) ? map.get(k) : null),
    put: async (k, v) => {
      map.set(k, v);
    },
    delete: async (k) => {
      map.delete(k);
    },
  };
}

function offer(over) {
  return {
    supplierId: 'pharmaoverseas',
    supplierProductId: 'x1',
    productName: 'AUGMENTIN 1G 14 TAB',
    packSize: null,
    currency: 'EGP',
    unitPrice: 100,
    publicPrice: null,
    discountPct: null,
    netEffectivePrice: null,
    availableQuantity: null,
    stockStatus: 'in_stock',
    minimumOrderQuantity: null,
    lastUpdated: new Date(NOW).toISOString(),
    dataSource: 'api',
    syncStatus: 'fresh',
    raw: {},
    ...over,
  };
}

function fakeConnector(id, { rows = [], offersByRaw = new Map(), throwErr = null, searches = [] }) {
  return {
    id,
    searches,
    async search(text, opts) {
      searches.push({ text, opts });
      if (throwErr) throw throwErr;
      return { offers: rows, page: 1, pageSize: 24, totalPages: 1 };
    },
    toOffer(raw) {
      const mapped = offersByRaw.get(raw);
      if (mapped instanceof Error) throw mapped;
      if (mapped) return { ...mapped, supplierId: id };
      throw new SchemaDriftError('unmapped fake row', { missing: ['fake'] });
    },
  };
}

async function saveSession(store, id, session, ttlMs = 10 * HOUR) {
  await store.save(id, session, new Date(NOW + ttlMs).toISOString());
}

// --- 1. Session store round trip --------------------------------------------
{
  const kv = fakeKv();
  const store = createSessionStore({ kv, secret: SECRET, now: () => NOW });
  const session = { accessToken: 'tok-abc-123', cookie: 'c=secret' };
  await saveSession(store, 'pharmaoverseas', session);

  const loaded = await store.load('pharmaoverseas');
  assert.deepEqual(loaded.session, session);
  assert.equal(loaded.expiresAt, new Date(NOW + 10 * HOUR).toISOString());
  assert.equal(loaded.savedAt, new Date(NOW).toISOString());

  const raw = kv.map.get('supplier-session:pharmaoverseas');
  assert.equal(typeof raw, 'string');
  assert.ok(!raw.includes('tok-abc-123'), 'raw KV value must not contain session text');
  assert.ok(!raw.includes('c=secret'), 'raw KV value must not contain session text');

  const wrong = createSessionStore({ kv, secret: 'other-secret', now: () => NOW });
  assert.equal(await wrong.load('pharmaoverseas'), null, 'wrong secret must not decrypt');

  assert.equal(await store.load('aumet'), null, 'missing session -> null');

  const later = NOW + 11 * HOUR;
  const expiredStore = createSessionStore({ kv, secret: SECRET, now: () => later });
  assert.equal(await expiredStore.load('pharmaoverseas'), null, 'expired session -> null');
  const peeked = await expiredStore.load('pharmaoverseas', { ignoreExpiry: true });
  assert.equal(peeked.session.accessToken, 'tok-abc-123');

  await assert.rejects(() => store.save('evil', {}, null), /unknown supplier/);
  await assert.rejects(() => store.load('evil'), /unknown supplier/);
  await assert.rejects(() => store.remove('evil'), /unknown supplier/);

  await store.remove('pharmaoverseas');
  assert.equal(await store.load('pharmaoverseas'), null, 'removed session -> null');

  kv.map.set('supplier-session:aumet', 'not-json');
  assert.equal(await store.load('aumet'), null, 'garbage KV value -> null');
}

// --- 2. Hub search: shape, ranking, query extraction, drift skip ------------
{
  const kv = fakeKv();
  const store = createSessionStore({ kv, secret: SECRET, now: () => NOW });
  await saveSession(store, 'pharmaoverseas', { accessToken: 'tok-abc-123' });
  await saveSession(store, 'aumet', { authorization: 'Bearer a', cookie: 'c=1', xsrf: 'x' });

  const poRawGood = { code: 'P1' };
  const poRawBad = { code: 'P-BAD' };
  const aumetRaw = { id: 'A1' };
  const po = fakeConnector('pharmaoverseas', {
    rows: [poRawBad, poRawGood],
    offersByRaw: new Map([
      [poRawBad, new SchemaDriftError('drifted row', { missing: ['price'] })],
      [poRawGood, offer({ supplierProductId: 'P1', unitPrice: 100 })],
    ]),
  });
  const aumet = fakeConnector('aumet', {
    rows: [aumetRaw],
    offersByRaw: new Map([
      [aumetRaw, offer({ supplierId: 'aumet', supplierProductId: 'A1', unitPrice: 84 })],
    ]),
  });
  const hub = createSupplierHub({ store, now: () => NOW, connectors: { pharmaoverseas: po, aumet } });

  const res = await hub.search('أوجمنتين 1 جم (Augmentin 1g)', { requestedQty: 2 });
  assert.equal(res.fetchedAt, new Date(NOW).toISOString());
  assert.ok(Array.isArray(res.results) && res.results.length === 1);
  assert.ok(Array.isArray(res.suppliers) && res.suppliers.length === 2);

  // Latin text inside parentheses drives the supplier query.
  assert.equal(po.searches[0].text, 'Augmentin');
  assert.equal(aumet.searches[0].text, 'Augmentin');
  assert.deepEqual(po.searches[0].opts, { page: 1, pageSize: 24 });

  assert.deepEqual(
    res.suppliers.map((s) => s.state).sort(),
    ['ok', 'ok'],
  );
  const result = res.results[0];
  assert.equal(result.item.name, 'Augmentin 1g');
  assert.equal(result.offers.length, 2, 'drifted row skipped, both good offers kept');
  assert.equal(result.best.supplierId, 'aumet', 'cheapest comparable unit price wins');
  assert.equal(result.offers[0].offer.supplierProductId, 'A1');

  // AuthRequiredError -> error state with the Arabic auth message.
  const aumetDown = fakeConnector('aumet', { throwErr: new AuthRequiredError('expired') });
  const hub2 = createSupplierHub({
    store,
    now: () => NOW,
    connectors: { pharmaoverseas: po, aumet: aumetDown },
  });
  const res2 = await hub2.search('Augmentin 1g');
  const aumetState = res2.suppliers.find((s) => s.id === 'aumet');
  assert.equal(aumetState.state, 'error');
  assert.equal(aumetState.message, 'الجلسة انتهت، سجّل دخول المورد');
  assert.equal(res2.suppliers.find((s) => s.id === 'pharmaoverseas').state, 'ok');

  // Supplier without a session stays off and is never searched.
  const kv3 = fakeKv();
  const store3 = createSessionStore({ kv: kv3, secret: SECRET, now: () => NOW });
  await saveSession(store3, 'pharmaoverseas', { accessToken: 'tok-abc-123' });
  const aumet3 = fakeConnector('aumet', { rows: [] });
  const hub3 = createSupplierHub({
    store: store3,
    now: () => NOW,
    connectors: { pharmaoverseas: po, aumet: aumet3 },
  });
  const res3 = await hub3.search('Augmentin 1g');
  assert.equal(res3.suppliers.find((s) => s.id === 'aumet').state, 'off');
  assert.equal(aumet3.searches.length, 0, 'no session -> connector not called');

  // status(): ok / expired / off, no session fields leak.
  const st = await hub3.status();
  assert.equal(st.find((s) => s.id === 'pharmaoverseas').state, 'ok');
  assert.equal(st.find((s) => s.id === 'aumet').state, 'off');
  const stExpired = createSupplierHub({
    store: store3,
    now: () => NOW + 11 * HOUR,
    connectors: { pharmaoverseas: po, aumet: aumet3 },
  });
  assert.equal((await stExpired.status()).find((s) => s.id === 'pharmaoverseas').state, 'expired');
  assert.ok(!JSON.stringify(st).includes('tok-abc-123'));
}

// --- 3. Brand-only fallback: minScore 0.5 rows flagged needsReview -----------
{
  const kv = fakeKv();
  const store = createSessionStore({ kv, secret: SECRET, now: () => NOW });
  await saveSession(store, 'pharmaoverseas', { accessToken: 'tok-abc-123' });
  const rawRow = { code: 'P-600' };
  const po = fakeConnector('pharmaoverseas', {
    rows: [rawRow],
    offersByRaw: new Map([
      [rawRow, offer({ supplierProductId: 'P-600', productName: 'AUGMENTIN 600MG 12 TAB' })],
    ]),
  });
  const aumet = fakeConnector('aumet', { rows: [] });
  const hub = createSupplierHub({ store, now: () => NOW, connectors: { pharmaoverseas: po, aumet } });
  const res = await hub.search('Augmentin 1g');
  const result = res.results[0];
  assert.equal(result.offers.length, 1, 'brand-only 0.5 row appears via fallback');
  assert.equal(result.needsReview, true);
  assert.equal(result.best.unitPrice, 100);
}

// --- 4. HTTP API -------------------------------------------------------------
{
  const kv = fakeKv();
  const store = createSessionStore({ kv, secret: SECRET, now: () => NOW });
  await saveSession(store, 'pharmaoverseas', { accessToken: 'tok-abc-123' });
  const rawRow = { code: 'P1' };
  const po = fakeConnector('pharmaoverseas', {
    rows: [rawRow],
    offersByRaw: new Map([[rawRow, offer({})]]),
  });
  const hub = createSupplierHub({
    store,
    now: () => NOW,
    connectors: { pharmaoverseas: po, aumet: fakeConnector('aumet', { rows: [] }) },
  });
  const env = { NOVA_API_PIN: PIN, NOVA_INGEST_SECRET: INGEST };
  const api = createSupplierApi({ hub, store, env });
  const req = (path, opts = {}) => new Request(`https://worker.test${path}`, opts);

  assert.equal(await api(req('/api/other')), null, 'foreign path -> null');

  // 401s.
  assert.equal((await api(req('/api/suppliers/status'))).status, 401);
  assert.equal(
    (await api(req('/api/suppliers/status', { headers: { 'X-Nova-Pin': 'wrong' } }))).status,
    401,
  );
  assert.equal((await api(req('/api/suppliers/search', { method: 'POST' }))).status, 401);
  assert.equal(
    (await api(req('/api/suppliers/session', { method: 'POST' }))).status,
    401,
    'no ingest secret -> 401',
  );

  // 503 when env vars are missing (never open by default).
  const openApi = createSupplierApi({ hub, store, env: {} });
  const r503a = await openApi(req('/api/suppliers/status', { headers: { 'X-Nova-Pin': PIN } }));
  assert.equal(r503a.status, 503);
  assert.equal((await r503a.json()).error, 'not-configured');
  const r503b = await openApi(req('/api/suppliers/session', { method: 'POST' }));
  assert.equal(r503b.status, 503);

  // Session ingest: bad body / unknown supplier -> 400; good -> 200 and stored.
  const badIngest = await api(
    req('/api/suppliers/session', {
      method: 'POST',
      headers: { 'X-Ingest-Secret': INGEST },
      body: JSON.stringify({ supplierId: 'evil', session: {}, expiresAt: new Date(NOW + HOUR).toISOString() }),
    }),
  );
  assert.equal(badIngest.status, 400);
  const malformed = await api(
    req('/api/suppliers/session', {
      method: 'POST',
      headers: { 'X-Ingest-Secret': INGEST },
      body: 'not json',
    }),
  );
  assert.equal(malformed.status, 400);
  const goodIngest = await api(
    req('/api/suppliers/session', {
      method: 'POST',
      headers: { 'X-Ingest-Secret': INGEST },
      body: JSON.stringify({
        supplierId: 'aumet',
        session: { authorization: 'Bearer a', cookie: 'c=secret', xsrf: 'x' },
        expiresAt: new Date(NOW + HOUR).toISOString(),
      }),
    }),
  );
  assert.equal(goodIngest.status, 200);
  assert.equal((await store.load('aumet')).session.cookie, 'c=secret');

  // Status + list with the right pin.
  const rStatus = await api(req('/api/suppliers/status', { headers: { 'X-Nova-Pin': PIN } }));
  assert.equal(rStatus.status, 200);
  assert.equal(rStatus.headers.get('Cache-Control'), 'no-store');
  const statusBody = await rStatus.json();
  assert.equal(statusBody.suppliers.length, 2);
  const rList = await api(req('/api/suppliers/list', { headers: { 'X-Nova-Pin': PIN } }));
  assert.deepEqual(
    (await rList.json()).suppliers.map((s) => s.id).sort(),
    ['aumet', 'pharmaoverseas'],
  );

  // Empty query -> 400 (checked before the rate-limit loop burns the window).
  const badSearch = await api(
    req('/api/suppliers/search', {
      method: 'POST',
      headers: { 'X-Nova-Pin': PIN },
      body: JSON.stringify({ query: '' }),
    }),
  );
  assert.equal(badSearch.status, 400);

  // Search happy path, then 40/minute rate limit -> 429 with Retry-After.
  const searchReq = () =>
    req('/api/suppliers/search', {
      method: 'POST',
      headers: { 'X-Nova-Pin': PIN },
      body: JSON.stringify({ query: 'Augmentin 1g', requestedQty: 3 }),
    });
  let lastBody = null;
  for (let i = 0; i < 40; i++) {
    const r = await api(searchReq());
    assert.equal(r.status, 200, `search #${i + 1} should pass`);
    lastBody = await r.text();
  }
  const r429 = await api(searchReq());
  assert.equal(r429.status, 429);
  assert.ok(Number(r429.headers.get('Retry-After')) >= 1);

  // Responses never contain session fields.
  assert.ok(!lastBody.includes('tok-abc-123'), 'search response leaks a token');
  assert.ok(!lastBody.includes('c=secret'), 'search response leaks a cookie');
  const rStatus2 = await api(req('/api/suppliers/status', { headers: { 'X-Nova-Pin': PIN } }));
  assert.ok(!(await rStatus2.text()).includes('c=secret'), 'status response leaks a cookie');
}

// --- 5. Static: no forbidden patterns in the new provider modules ------------
{
  const files = [
    'worker/procurement/provider/session-store.js',
    'worker/procurement/provider/hub.js',
    'worker/procurement/provider/http.js',
  ];
  const forbidden = ['con' + 'sole.', 'ev' + 'al(', 'pass' + 'word', 'user' + 'name'];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const bad of forbidden) {
      assert.ok(!src.includes(bad), `${f} contains forbidden pattern ${JSON.stringify(bad)}`);
    }
  }
}

process.stdout.write('procurement-hub checks passed\n');
