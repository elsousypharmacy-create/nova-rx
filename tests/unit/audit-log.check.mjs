// SEC-04 audit log core: unit checks. No network, no files, no secrets (the key below is a test constant).
import assert from 'node:assert/strict';
import {
  canonicalJson, maskSensitiveFields, scrubInlineSecrets, prepareEvent, buildEntry,
  createMemoryAuditStore, appendAuditEvent, verifyAuditChain, AUDIT_CATEGORIES,
} from '../../worker/security/audit-log.js';

const KEY = 'test-only-key-0123456789-0123456789-abcdef';
const OTHER = 'another-test-key-0123456789-0123456789-xyz';
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('  ok', name); };
const ev = (o = {}) => ({
  tenantId: 'tenant_1', branchId: 'branch_a', action: 'inventory.writeoff', category: 'INVENTORY_SENSITIVE', outcome: 'ALLOWED',
  requestId: 'req_1', actor: { userId: 'usr_1', roles: ['Pharmacist'], deviceId: 'dev_1', ipAddress: '192.0.2.10' },
  resource: { type: 'batch', id: 'b_1' }, changes: { before: { qty: 5 }, after: { qty: 4 } }, ...o,
});
const fill = async (store, count, tenantId = 'tenant_1') => {
  const out = [];
  for (let i = 0; i < count; i++) { const r = await appendAuditEvent({ store, key: KEY, event: ev({ tenantId, requestId: 'req_' + i }) }); assert.ok(r.ok, r.error); out.push(r.entry); }
  return out;
};
const fails = async (p, error) => { const r = await p; assert.equal(r.ok, false); assert.equal(r.error, error); return r; };

console.log('Running audit-log unit checks (SEC-04)...');

await t('canonicalJson is key-order independent and stable for Arabic text', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, 'x'], c: null } }), canonicalJson({ a: { c: null, d: [1, 'x'] }, b: 1 }));
  assert.equal(canonicalJson({ n: 'سرنجة' }), '{"n":"سرنجة"}');
  assert.equal(canonicalJson({ z: -0 }), '{"z":0}');
});

await t('canonicalJson refuses ambiguous values instead of guessing', () => {
  for (const bad of [undefined, NaN, Infinity, 10n, () => 1, Symbol('x'), new Date(), new Map(), new (class A {})(), { a: undefined }]) {
    assert.throws(() => canonicalJson(bad), /canonical/, String(bad));
  }
  const cyc = {}; cyc.self = cyc;
  assert.throws(() => canonicalJson(cyc), /too-deep/);
});

await t('masking: secret keys at any depth, any case/separator, inside arrays', () => {
  const m = maskSensitiveFields({
    Authorization: 'Bearer abcdefghijkl', 'X-Api-Key': 'k', refresh_token: 't', PIN: '1234', adminPin: '9', password: 'p', cookie: 'c', 'set-cookie': 's',
    otp: '1', IBAN: 'EG..', client_secret: 'x', nested: { deep: [{ accessToken: 'a', ok: 1 }] }, list: [{ cardNumber: '4111111111111111' }],
  });
  const j = JSON.stringify(m);
  for (const secret of ['abcdefghijkl', '"k"', '"t"', '1234', '"p"', '4111111111111111', '"a"']) assert.ok(!j.includes(secret), secret);
  assert.equal(m.nested.deep[0].accessToken, '[REDACTED]');
  assert.equal(m.nested.deep[0].ok, 1);
  assert.equal(m.PIN, '[REDACTED]');
});

await t('masking: phone and national id keep the last 4 only; ordinary data is untouched', () => {
  const m = maskSensitiveFields({ phone: '01012345678', mobile: 1012345678, nationalId: '29001011234567', name: 'سرنجة 3سم', qty: 5, shipping: 'x' });
  assert.equal(m.phone, '*******5678');
  assert.equal(m.mobile, '******5678');
  assert.equal(m.nationalId, '**********4567');
  assert.equal(m.name, 'سرنجة 3سم');
  assert.equal(m.qty, 5);
  assert.equal(m.shipping, 'x');
});

await t('masking: secrets inside free text are scrubbed', () => {
  const text = [
    'call failed with Bearer abcdef1234567890xyz', 'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig_value-1',
    'db postgres://admin:hunter2pass@db.example.com:5432/app', '-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----', 'password=hunter2 and pin: 4321',
  ].join(' | ');
  const out = scrubInlineSecrets(text);
  for (const leak of ['abcdef1234567890xyz', 'eyJhbGci', 'hunter2', 'MIIEvQ', '4321']) assert.ok(!out.includes(leak), leak);
  assert.ok(out.includes('[REDACTED]'));
  assert.equal(scrubInlineSecrets('Verified prescription RX-992'), 'Verified prescription RX-992');
});

await t('masking: input is never modified, "__proto__" key is safe, odd values do not throw', () => {
  const input = JSON.parse('{"__proto__":{"polluted":1},"token":"t","when":null}');
  const before = JSON.stringify(input);
  const m = maskSensitiveFields(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(m), Object.prototype);
  assert.equal(m.token, '[REDACTED]');
  const weird = maskSensitiveFields({ d: new Date('2026-11-11T00:00:00Z'), m: new Map(), f() {}, big: 5n, nan: NaN, u: undefined });
  assert.deepEqual(weird, { d: '2026-11-11T00:00:00.000Z', m: '[UNSUPPORTED]', big: '5', nan: null });
  let deep = {}; const root = deep; for (let i = 0; i < 100; i++) { deep.x = {}; deep = deep.x; }
  assert.ok(canonicalJson(maskSensitiveFields(root)).includes('[TRUNCATED]'));
});

await t('event validation rejects bad input with a reason (nothing is defaulted)', async () => {
  const bad = (patch, error) => fails(prepareEvent(ev(patch), KEY), error);
  await bad({ tenantId: 'a:b' }, 'tenantId-invalid');
  await bad({ tenantId: '' }, 'tenantId-invalid');
  await bad({ branchId: 'x y' }, 'branchId-invalid');
  await bad({ action: 'Bad Action' }, 'action-invalid');
  await bad({ category: 'NOPE' }, 'category-invalid');
  await bad({ outcome: 'maybe' }, 'outcome-invalid');
  await bad({ requestId: '  ' }, 'requestId-missing');
  await bad({ actor: {} }, 'actor-missing');
  await bad({ resource: { type: 'batch' } }, 'resource-missing');
  await bad({ timestamp: '2026-13-40T00:00:00Z' }, 'timestamp-invalid');
  await bad({ timestamp: 'yesterday' }, 'timestamp-invalid');
  await bad({ statusCode: 99 }, 'statusCode-invalid');
  await fails(prepareEvent(null, KEY), 'tenantId-invalid');
  assert.ok(AUDIT_CATEGORIES.includes('ACCESS_CONTROL'));
});

await t('the raw IP address and planted secrets never reach the stored entry', async () => {
  const store = createMemoryAuditStore();
  const r = await appendAuditEvent({ store, key: KEY, event: ev({ metadata: { reason: 'retry with Bearer zzzzzzzzzzzz1234', token: 'planted-secret-value' }, changes: { before: { pin: '5555' }, after: {} } }) });
  assert.ok(r.ok);
  const j = JSON.stringify(r.entry);
  for (const leak of ['192.0.2.10', 'planted-secret-value', 'zzzzzzzzzzzz1234', '5555']) assert.ok(!j.includes(leak), leak);
  assert.match(r.entry.actor.ipHash, /^[0-9a-f]{16}$/);
  const r2 = await appendAuditEvent({ store, key: KEY, event: ev({ requestId: 'req_2' }) });
  assert.equal(r2.entry.actor.ipHash, r.entry.actor.ipHash, 'same source -> same hash');
});

await t('chain: sequence starts at 1 from the genesis hash, links by hash, entries are frozen', async () => {
  const store = createMemoryAuditStore();
  const [a, b, c] = await fill(store, 3);
  assert.equal(a.seq, 1); assert.equal(b.seq, 2); assert.equal(c.seq, 3);
  assert.match(a.prevHash, /^hmac-sha256:0{64}$/);
  assert.equal(b.prevHash, a.entryHash); assert.equal(c.prevHash, b.entryHash);
  assert.ok(Object.isFrozen(a) && Object.isFrozen(a.actor) && Object.isFrozen(a.changes.after));
  assert.throws(() => { 'use strict'; a.action = 'x'; });
  const v = await verifyAuditChain(await store.list('tenant_1'), KEY, { tenantId: 'tenant_1', expectedHead: { seq: 3, hash: c.entryHash } });
  assert.deepEqual({ ok: v.ok, count: v.count }, { ok: true, count: 3 });
  assert.equal(Object.keys(store).some(k => /update|delete|remove/i.test(k)), false);
});

await t('tamper: editing any field of any entry is detected, even if the attacker fixes the links', async () => {
  const store = createMemoryAuditStore();
  await fill(store, 4);
  const clean = await store.list('tenant_1');
  for (const mutate of [e => ({ ...e, outcome: 'DENIED' }), e => ({ ...e, actor: { ...e.actor, userId: 'usr_evil' } }), e => ({ ...e, changes: { before: { qty: 5 }, after: { qty: 400 } } }), e => ({ ...e, timestamp: '2020-01-01T00:00:00.000Z' })]) {
    const copy = clean.map(e => ({ ...e })); copy[1] = mutate(copy[1]);
    const r = await verifyAuditChain(copy, KEY, { tenantId: 'tenant_1' });
    assert.deepEqual([r.ok, r.error, r.index], [false, 'entry-hash-mismatch', 1]);
  }
});

await t('tamper: an attacker without the key cannot re-hash the chain (unkeyed SHA-256 does not verify)', async () => {
  const store = createMemoryAuditStore();
  await fill(store, 3);
  const clean = await store.list('tenant_1');
  const sha = async text => 'hmac-sha256:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const forged = []; let prev = clean[0].prevHash;
  for (const e of clean) { const { entryHash, ...body } = e; body.prevHash = prev; if (body.seq === 2) body.outcome = 'DENIED'; const h = await sha(canonicalJson(body)); forged.push({ ...body, entryHash: h }); prev = h; }
  const r = await verifyAuditChain(forged, KEY, { tenantId: 'tenant_1' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'entry-hash-mismatch');
});

await t('tamper: delete, reorder, duplicate, truncate, wrong key, splice from another tenant', async () => {
  const store = createMemoryAuditStore();
  const entries = await fill(store, 5);
  const head = { seq: 5, hash: entries[4].entryHash };
  const check = (list, opts = {}) => verifyAuditChain(list, KEY, { tenantId: 'tenant_1', ...opts });
  assert.equal((await check([entries[0], entries[1], entries[3], entries[4]])).error, 'seq-gap');
  assert.equal((await check([entries[0], entries[2], entries[1], entries[3], entries[4]])).error, 'seq-gap');
  assert.equal((await check([entries[0], entries[1], entries[1], entries[2]])).error, 'seq-gap');
  assert.equal((await check(entries.slice(1))).error, 'seq-gap');
  assert.equal((await check(entries.slice(0, 3))).ok, true, 'a prefix alone cannot be detected without the expected head');
  assert.equal((await check(entries.slice(0, 3), { expectedHead: head })).error, 'truncated-or-head-mismatch');
  assert.equal((await check([], { expectedHead: head })).error, 'truncated-or-head-mismatch');
  assert.equal((await verifyAuditChain(entries, OTHER, { tenantId: 'tenant_1' })).error, 'entry-hash-mismatch');
  const other = createMemoryAuditStore(); const foreign = await fill(other, 5, 'tenant_2');
  assert.equal((await check([entries[0], entries[1], foreign[2]])).error, 'tenant-mismatch');
  assert.equal((await verifyAuditChain(foreign, KEY, { tenantId: 'tenant_1' })).error, 'tenant-mismatch');
  assert.equal((await check(entries.slice(2), { startAfter: { seq: 2, hash: entries[1].entryHash }, expectedHead: head })).ok, true, 'verified slice');
  assert.equal((await check(entries.slice(2), { startAfter: { seq: 2, hash: 'hmac-sha256:' + 'a'.repeat(64) } })).error, 'prev-hash-mismatch');
});

await t('a shortened or lengthened entryHash never verifies (no prefix match)', async () => {
  const store = createMemoryAuditStore();
  const [e] = await fill(store, 1);
  for (const h of [e.entryHash.slice(0, -1), e.entryHash.slice(0, 20), e.entryHash + '0', '']) {
    const r = await verifyAuditChain([{ ...e, entryHash: h }], KEY, { tenantId: 'tenant_1' });
    assert.equal(r.error, 'entry-hash-mismatch', JSON.stringify(h));
  }
  const bad = await verifyAuditChain([e], KEY, { tenantId: 'tenant_1', expectedHead: { seq: 1, hash: e.entryHash.slice(0, 20) } });
  assert.equal(bad.error, 'truncated-or-head-mismatch');
});

await t('tenants have independent chains', async () => {
  const store = createMemoryAuditStore();
  await fill(store, 2, 'tenant_1'); await fill(store, 3, 'tenant_2');
  assert.equal((await store.head('tenant_1')).seq, 2);
  assert.equal((await store.head('tenant_2')).seq, 3);
  assert.equal((await verifyAuditChain(await store.list('tenant_2'), KEY, { tenantId: 'tenant_2' })).ok, true);
});

await t('compare-and-swap: a stale head is refused (no fork) and a retry gives one linear chain', async () => {
  const store = createMemoryAuditStore();
  const p = await prepareEvent(ev(), KEY);
  const head0 = await store.head('tenant_1');
  const e1 = await buildEntry(p.event, head0, KEY);
  const e1b = await buildEntry(p.event, head0, KEY);
  assert.deepEqual(await store.append(e1), { ok: true });
  assert.deepEqual(await store.append(e1b), { ok: false, error: 'stale-head' });
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => appendAuditEvent({ store, key: KEY, event: ev({ requestId: 'c_' + i }) })));
  assert.ok(results.every(r => r.ok));
  const list = await store.list('tenant_1');
  assert.deepEqual(list.map(e => e.seq), Array.from({ length: 21 }, (_, i) => i + 1));
  assert.equal(new Set(list.map(e => e.entryHash)).size, 21);
  assert.equal((await verifyAuditChain(list, KEY, { tenantId: 'tenant_1' })).ok, true);
});

await t('contention is reported, never silently dropped', async () => {
  const stuck = { head: async () => ({ seq: 0, hash: 'hmac-sha256:' + '0'.repeat(64) }), append: async () => ({ ok: false, error: 'stale-head' }) };
  await fails(appendAuditEvent({ store: stuck, key: KEY, event: ev(), maxRetries: 2 }), 'contention');
  const broken = { head: async () => ({ seq: 0, hash: 'x' }), append: async () => ({ ok: false, error: 'disk-full' }) };
  await fails(appendAuditEvent({ store: broken, key: KEY, event: ev() }), 'disk-full');
});

await t('a weak key is refused', async () => {
  await assert.rejects(appendAuditEvent({ store: createMemoryAuditStore(), key: 'short', event: ev() }), /key-too-short/);
  await assert.rejects(appendAuditEvent({ store: createMemoryAuditStore(), key: undefined, event: ev() }), /key-too-short/);
});

await t('same input and same clock give the same hash (deterministic)', async () => {
  const opts = { now: () => '2026-11-11T00:00:00.000Z', newId: () => 'aud_fixed' };
  const a = await appendAuditEvent({ store: createMemoryAuditStore(), key: KEY, event: ev(), ...opts });
  const b = await appendAuditEvent({ store: createMemoryAuditStore(), key: KEY, event: ev(), ...opts });
  assert.equal(a.entry.entryHash, b.entry.entryHash);
  const c = await appendAuditEvent({ store: createMemoryAuditStore(), key: KEY, event: ev({ outcome: 'DENIED' }), ...opts });
  assert.notEqual(a.entry.entryHash, c.entry.entryHash);
});

console.log(`PASS audit-log unit checks (SEC-04): ${n} cases`);
