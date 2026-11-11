import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  canonicalJson, scrubInlineSecrets, maskSensitiveFields, buildAuditEvent,
  createChainState, appendAuditEvent, verifyAuditChain, GENESIS_HASH,
} from '../../worker/security/audit-log.js';

let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('  ok', name); };
const append = (state, input, key, opts = {}) => appendAuditEvent(state, input, key, { expectedSeq: state.lastSeq + 1, ...opts });
const KEY = 'k'.repeat(32) + 'secret-audit-key-material';
const OTHER_KEY = 'z'.repeat(40);
const base = (over = {}) => ({
  tenantId: 'tenant_1001', branchId: 'branch_east_01',
  actor: { userId: 'usr_901', roles: ['Pharmacist'], deviceId: 'dev_tablet_01', ipAddress: '192.0.2.10' },
  action: 'invoice.void', category: 'FINANCIAL_LEDGER', resource: { type: 'invoice', id: 'inv_5501' },
  outcome: 'ALLOWED', statusCode: 200, requestId: 'req_1', ...over,
});
console.log('security audit-log checks (SEC-04)');

await t('canonicalJson is deterministic: key order, NFC, nested, arrays keep order', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, 1], c: null } }), '{"a":{"c":null,"d":[3,1]},"b":1}');
  assert.notEqual(canonicalJson({ x: 'e\u0301' }), canonicalJson({ x: '\u00e9' }), 'bytes that differ hash differently (no normalisation inside the hash)');
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
  assert.equal(canonicalJson(-0), '0');
});

await t('canonicalJson refuses what cannot be hashed reproducibly', () => {
  for (const bad of [undefined, NaN, Infinity, 10n, () => 1, Symbol('x'), new Date(), new Map(), { a: undefined }, [undefined]]) assert.throws(() => canonicalJson(bad), /canonical-json/);
  const cyc = { a: 1 }; cyc.self = cyc;
  assert.throws(() => canonicalJson(cyc), /canonical-json-cycle/);
});

await t('scrubInlineSecrets: bearer, JWT, PEM, URL credentials, key=value; normal and Arabic text untouched', () => {
  const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c3JfOTAxIn0.c2lnbmF0dXJlMTIzNDU2';
  assert.equal(scrubInlineSecrets('Authorization: Bearer abc.DEF-123_xyz=='), 'Authorization: Bearer [REDACTED]');
  assert.ok(!scrubInlineSecrets(`token ${jwt} end`).includes('eyJ'));
  assert.ok(!scrubInlineSecrets('-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----').includes('MIIEvQ'));
  assert.ok(!scrubInlineSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIEvQ-no-end').includes('MIIEvQ'), 'unterminated block still scrubbed');
  const url = scrubInlineSecrets('postgres://admin:hunter2@db.example.com:5432/nova');
  assert.ok(!url.includes('hunter2') && !url.includes('admin:'), url);
  assert.ok(!scrubInlineSecrets('pin: 1234 and apiKey=abcdef').match(/1234|abcdef/));
  for (const ok of ['تم صرف الدواء للمريض', 'pinned items: 3', 'Panadol Extra 24 tablets', 'token count is high']) assert.equal(scrubInlineSecrets(ok), ok);
  assert.equal(scrubInlineSecrets(42), 42, 'non-strings pass through');
});

await t('maskSensitiveFields: nested, arrays, mixed-case and hyphenated keys; original not mutated', () => {
  const input = { user: 'u1', Password: 'p', nested: { 'X-Nova-Pin': '1234', AccessToken: 'a', refresh_token: 'r', deep: [{ clientSecret: 's', ok: 1 }, { 'Set-Cookie': 'c=1' }] }, cardNumber: '4111111111111111', cvv: '123', iban: 'EG000', otp: '99', authorization: 'Bearer x', apiKey: 'k', privateKey: 'pk' };
  const copy = JSON.parse(JSON.stringify(input));
  const out = maskSensitiveFields(input);
  assert.deepEqual(input, copy, 'input untouched');
  const s = JSON.stringify(out);
  for (const secret of ['"p"', '1234', '"a"', '"r"', '"s"', 'c=1', '4111', '"123"', 'EG000', '"99"', 'Bearer x', '"k"', '"pk"']) assert.ok(!s.includes(secret), `${secret} leaked: ${s}`);
  assert.equal(out.user, 'u1'); assert.equal(out.nested.deep[0].ok, 1);
  assert.equal(out.Password, '[REDACTED]');
});

await t('maskSensitiveFields: phone and national id keep only the last 4 digits; other keys that merely contain "pin" are kept', () => {
  const out = maskSensitiveFields({ phone: '01012341234', Mobile: '+20 100 555 6789', nationalId: '29001011234567', shipping: 'Cairo', mapping: { a: 1 }, spinach: 'x' });
  assert.equal(out.phone, '*******1234'); assert.equal(out.Mobile.slice(-4), '6789'); assert.ok(!out.Mobile.includes('100'));
  assert.equal(out.nationalId, '**********4567');
  assert.equal(out.shipping, 'Cairo'); assert.deepEqual(out.mapping, { a: 1 }); assert.equal(out.spinach, 'x');
});

await t('maskSensitiveFields: prototype pollution payload is dropped and does not pollute', () => {
  const evil = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"p2":1}},"a":1}');
  const out = maskSensitiveFields(evil);
  assert.equal(({}).polluted, undefined); assert.equal(({}).p2, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(out, '__proto__'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'constructor'), false);
  assert.equal(out.a, 1);
});

await t('maskSensitiveFields: free text inside values is scrubbed, depth is capped', () => {
  assert.ok(!JSON.stringify(maskSensitiveFields({ metadata: { reason: 'retry with Bearer abcdef123456' } })).includes('abcdef123456'));
  let deep = { v: 'x' }; for (let i = 0; i < 60; i++) deep = { d: deep };
  assert.doesNotThrow(() => maskSensitiveFields(deep));
  assert.ok(JSON.stringify(maskSensitiveFields(deep)).includes('[TRUNCATED]'));
});

await t('buildAuditEvent: valid input becomes an allowlisted event; unknown fields are dropped; IP is masked', () => {
  const r = buildAuditEvent({ ...base(), password: 'x', extra: { a: 1 }, actor: { ...base().actor, token: 'abc' } });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const e = r.event;
  assert.equal(e.actor.ipAddress, '192.0.2.0');
  assert.equal(e.password, undefined); assert.equal(e.extra, undefined); assert.equal(e.actor.token, undefined);
  assert.deepEqual(Object.keys(e).sort(), ['action', 'actor', 'branchId', 'category', 'changedFields', 'metadata', 'outcome', 'requestId', 'resource', 'statusCode', 'tenantId', 'timestamp']);
  assert.equal(buildAuditEvent(base({ actor: { ...base().actor, ipAddress: '2001:db8:abcd:1234::1' } })).event.actor.ipAddress, '2001:db8:abcd::');
});

await t('buildAuditEvent: ids with separators, bad enums, bad actions and bad time are rejected', () => {
  const bad = (over, code) => { const r = buildAuditEvent(base(over)); assert.equal(r.ok, false, code); assert.ok(r.errors.includes(code), `${code} in ${r.errors}`); };
  bad({ tenantId: 'a:b' }, 'tenantId-invalid');
  bad({ tenantId: '' }, 'tenantId-invalid');
  bad({ branchId: 'x y' }, 'branchId-invalid');
  bad({ actor: { ...base().actor, userId: '' } }, 'actor.userId-invalid');
  bad({ action: 'Invoice Void' }, 'action-invalid');
  bad({ category: 'WHATEVER' }, 'category-invalid');
  bad({ outcome: 'MAYBE' }, 'outcome-invalid');
  bad({ statusCode: 99 }, 'statusCode-invalid');
  bad({ timestamp: 'yesterday' }, 'timestamp-not-allowed');
  bad({ timestamp: '2020-01-01T00:00:00.000Z' }, 'timestamp-not-allowed');
  bad({ timestamp: '2026-02-31T00:00:00Z' }, 'timestamp-not-allowed');
  bad({ requestId: undefined }, 'requestId-invalid');
  bad({ resource: { type: 'Invoice!', id: 'x' } }, 'resource-invalid');
  bad({ metadata: { blob: 'x'.repeat(5000) } }, 'metadata-too-large');
  assert.equal(buildAuditEvent(null).ok, false);
});

await t('buildAuditEvent: changes record field names only; values only for allowlisted fields, and still masked', () => {
  const changes = { before: { status: 'PENDING', customerName: 'Mona', phone: '01012341234' }, after: { status: 'DISPENSED', customerName: 'Mona', phone: '01099999999' } };
  const none = buildAuditEvent(base({ changes })).event;
  assert.deepEqual(none.changedFields, ['phone', 'status']);
  assert.equal(none.changes, undefined, 'no values without an allowlist');
  const some = buildAuditEvent(base({ changes }), { changeAllowlist: { invoice: ['status', 'phone'] } }).event;
  assert.deepEqual(some.changes.before, { status: 'PENDING', phone: '*******1234' });
  assert.deepEqual(some.changes.after, { status: 'DISPENSED', phone: '*******9999' });
  assert.ok(!JSON.stringify(some).includes('Mona'));
});

await t('chain: append builds seq, prevHash and an HMAC; verify accepts the intact chain', async () => {
  let state = createChainState('tenant_1001'); const log = [];
  for (let i = 1; i <= 5; i++) { const r = await append(state, base({ requestId: `req_${i}` }), KEY); assert.equal(r.ok, true, JSON.stringify(r)); state = r.state; log.push(r.entry); }
  assert.deepEqual(log.map(e => e.seq), [1, 2, 3, 4, 5]);
  assert.equal(log[0].prevHash, GENESIS_HASH); assert.equal(log[1].prevHash, log[0].entryHash);
  assert.match(log[0].entryHash, /^[0-9a-f]{64}$/);
  const v = await verifyAuditChain(log, KEY, { tenantId: 'tenant_1001' });
  assert.equal(v.ok, true, JSON.stringify(v)); assert.equal(v.count, 5); assert.equal(v.head.seq, 5); assert.equal(v.head.hash, log[4].entryHash);
  assert.equal((await verifyAuditChain([], KEY, { tenantId: 'tenant_1001' })).ok, true, 'empty chain is valid');
});

const build = async (count = 5, tenantId = 'tenant_1001', key = KEY) => {
  let state = createChainState(tenantId); const log = [];
  for (let i = 1; i <= count; i++) { const r = await append(state, base({ tenantId, requestId: `req_${i}` }), key); state = r.state; log.push(r.entry); }
  return log;
};
const verify = (log, opts = {}) => verifyAuditChain(log, KEY, { tenantId: 'tenant_1001', ...opts });

await t('chain: any edit to a stored entry is detected at its index', async () => {
  for (const mutate of [e => { e.outcome = 'DENIED'; }, e => { e.actor.userId = 'usr_999'; }, e => { e.timestamp = '1999-01-01T00:00:00.000Z'; }, e => { e.resource.id = 'inv_1'; }, e => { e.statusCode = 500; }]) {
    const log = await build(); mutate(log[2]);
    const v = await verify(log); assert.equal(v.ok, false); assert.equal(v.index, 2); assert.equal(v.reason, 'hash-mismatch');
  }
});

await t('chain: deleted, duplicated or reordered entries are detected', async () => {
  const log = await build();
  let v = await verify([log[0], log[1], log[3], log[4]]); assert.equal(v.ok, false); assert.equal(v.index, 2); assert.equal(v.reason, 'seq-gap');
  v = await verify([log[0], log[1], log[1], log[2]]); assert.equal(v.ok, false); assert.equal(v.reason, 'seq-gap');
  v = await verify([log[1], log[0], log[2]]); assert.equal(v.ok, false); assert.equal(v.index, 0);
  v = await verify(log.slice(1)); assert.equal(v.ok, false); assert.equal(v.reason, 'seq-gap', 'a dropped head is not silently accepted');
});

await t('chain: a truncated log verifies only against a known anchor (rotation / retention)', async () => {
  const log = await build(5);
  const v = await verify(log.slice(2), { anchor: { seq: 2, hash: log[1].entryHash } });
  assert.equal(v.ok, true, JSON.stringify(v)); assert.equal(v.head.seq, 5);
  assert.equal((await verify(log.slice(2), { anchor: { seq: 2, hash: 'f'.repeat(64) } })).ok, false);
});

await t('chain: a forked writer (stale state) is refused, and the old state is not mutated', async () => {
  const s0 = createChainState('tenant_1001');
  const a = await append(s0, base(), KEY); assert.equal(a.ok, true);
  assert.equal(s0.lastSeq, 0, 'input state untouched');
  const stale = await append(a.state, base(), KEY, { expectedSeq: 1 });
  assert.equal(stale.ok, false); assert.equal(stale.error, 'chain-fork');
  assert.equal((await append(a.state, base(), KEY, { expectedSeq: 2 })).ok, true);
});

await t('chain: two entries with the same seq and valid hashes (fork in storage) fail verification', async () => {
  const log = await build(3);
  const forkState = { tenantId: 'tenant_1001', lastSeq: 1, lastHash: log[0].entryHash };
  const fork = (await append(forkState, base({ requestId: 'req_fork' }), KEY)).entry;
  const v = await verify([log[0], log[1], fork, log[2]]);
  assert.equal(v.ok, false); assert.equal(v.index, 2);
});

await t('chain: an event of another tenant cannot be appended or slipped into a chain', async () => {
  const state = createChainState('tenant_1001');
  const r = await append(state, base({ tenantId: 'tenant_2002' }), KEY);
  assert.equal(r.ok, false); assert.equal(r.error, 'tenant-mismatch');
  const mine = await build(2); const theirs = await build(2, 'tenant_2002');
  const v = await verify([mine[0], theirs[1]]); assert.equal(v.ok, false); assert.equal(v.index, 1); assert.equal(v.reason, 'tenant-mismatch');
});

await t('chain: wrong key fails; an attacker who recomputes a plain SHA-256 chain cannot forge it', async () => {
  const log = await build(3);
  assert.equal((await verifyAuditChain(log, OTHER_KEY, { tenantId: 'tenant_1001' })).ok, false);
  const { createHash } = await import('node:crypto');
  let prev = GENESIS_HASH; const forged = [];
  for (const e of log) { const { entryHash, ...rest } = e; const rec = { ...rest, outcome: 'ALLOWED', prevHash: prev }; const h = createHash('sha256').update(canonicalJson(rec)).digest('hex'); forged.push({ ...rec, entryHash: h }); prev = h; }
  const v = await verify(forged); assert.equal(v.ok, false); assert.equal(v.index, 0); assert.equal(v.reason, 'hash-mismatch');
});

await t('chain: malformed entries fail closed, never throw', async () => {
  const log = await build(2);
  for (const bad of [null, 'x', {}, { ...log[0], entryHash: 'xyz' }, { ...log[0], entryHash: undefined }, { ...log[0], seq: '1' }]) {
    const v = await verify([bad, log[1]]); assert.equal(v.ok, false, JSON.stringify(bad));
  }
  assert.equal((await verify('not-an-array')).ok, false);
});

await t('key handling: short or missing keys are refused; Uint8Array and CryptoKey work', async () => {
  const s = createChainState('tenant_1001');
  await assert.rejects(() => append(s, base(), 'short'), /audit-key-too-short/);
  await assert.rejects(() => append(s, base(), undefined), /audit-key/);
  const bytes = new TextEncoder().encode(KEY);
  const a = await append(s, base(), bytes);
  const ck = await webcrypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  assert.equal((await verifyAuditChain([a.entry], ck, { tenantId: 'tenant_1001' })).ok, true);
  assert.equal((await verifyAuditChain([a.entry], KEY, { tenantId: 'tenant_1001' })).ok, true, 'string key equals the same bytes');
});

await t('no secret or raw key is ever present in an entry', async () => {
  const log = await build(2);
  assert.ok(!JSON.stringify(log).includes(KEY));
});

await t('review B1: secret-looking keys are redacted by substring, not only by suffix', () => {
  const secretKeys = ['secretKey', 'passwordHash', 'otpCode', 'credentials', 'sessionId', 'authorizationHeader', 'cookieValue', 'privateKeyPem', 'jwt', 'signature', 'pinNumber', 'apiSecretKey', 'tokenValue', 'refreshTokenHash', 'cvv2', 'clientSecretKey', 'secret', 'accessToken', 'api_key', 'X-Api-Key', 'Proxy-Authorization', 'sessionToken'];
  const out = maskSensitiveFields(Object.fromEntries(secretKeys.map(k => [k, 'LEAKVALUE'])));
  for (const k of secretKeys) assert.equal(out[k], '[REDACTED]', k);
  assert.ok(!JSON.stringify(maskSensitiveFields({ nested: { list: [{ passwordHash: 'LEAKVALUE' }] } })).includes('LEAKVALUE'));
  const kept = maskSensitiveFields({ shipping: 1, mapping: 2, spinach: 3, footprint: 4, pinned: 5, status: 'ok', quantity: 6, userId: 'u1' });
  assert.deepEqual(kept, { shipping: 1, mapping: 2, spinach: 3, footprint: 4, pinned: 5, status: 'ok', quantity: 6, userId: 'u1' });
});

await t('review B2: what is hashed is exactly what is stored (no NFC inside the hash); non-NFC text is normalised once at build time', async () => {
  assert.notEqual(canonicalJson({ a: '\u00e9' }), canonicalJson({ a: 'e\u0301' }));
  assert.equal(Object.keys(JSON.parse(canonicalJson({ '\u00e9': 1, 'e\u0301': 2 }))).length, 2, 'two different keys stay two keys');
  const b = buildAuditEvent(base({ metadata: { note: 'caf\u0065\u0301' } }));
  assert.equal(b.ok, true); assert.equal(b.event.metadata.note, 'caf\u00e9', 'normalised before storing and hashing');
  const collide = buildAuditEvent(base({ metadata: { 'caf\u00e9': 1, 'cafe\u0301': 2 } }));
  assert.equal(collide.ok, false); assert.ok(collide.errors.includes('key-collision'));
  // a stored string replaced by its decomposed form must NOT verify
  const st = createChainState('tenant_1001'); const r = await append(st, base({ metadata: { note: 'caf\u00e9' } }), KEY);
  const tampered = { ...r.entry, metadata: { note: 'cafe\u0301' } };
  const v = await verifyAuditChain([tampered], KEY, { tenantId: 'tenant_1001' });
  assert.equal(v.ok, false); assert.equal(v.reason, 'hash-mismatch');
});

await t('review B3: the audit time comes from the server clock only; caller timestamps are refused', async () => {
  const fixed = () => new Date('2026-11-11T10:00:00.000Z');
  const r = buildAuditEvent(base(), { now: fixed });
  assert.equal(r.ok, true); assert.equal(r.event.timestamp, '2026-11-11T10:00:00.000Z');
  const before = Date.now(); const dflt = buildAuditEvent(base()); const after = Date.now();
  const ts = Date.parse(dflt.event.timestamp); assert.ok(ts >= before && ts <= after, 'default is the real clock');
  assert.equal(buildAuditEvent(base({ timestamp: '2026-11-11T10:00:00.000Z' }), { now: fixed }).ok, false, 'even a correct value from the caller is refused');
  assert.equal(buildAuditEvent(base(), { now: () => new Date('garbage') }).ok, false);
  assert.equal(buildAuditEvent(base(), { now: () => '2026-11-11' }).ok, false);
});

await t('review B4: requestId is required so every entry can be correlated', () => {
  const r = buildAuditEvent(base({ requestId: undefined })); assert.equal(r.ok, false); assert.ok(r.errors.includes('requestId-invalid'));
  assert.equal(buildAuditEvent(base({ requestId: '' })).ok, false);
  assert.equal(buildAuditEvent(base({ requestId: 'req 1' })).ok, false);
});

await t('review: an unusual IP format keeps the event and drops only the IP; IPv4-mapped IPv6 is masked as IPv4', () => {
  const mapped = buildAuditEvent(base({ actor: { ...base().actor, ipAddress: '::ffff:192.168.1.5' } }));
  assert.equal(mapped.ok, true); assert.equal(mapped.event.actor.ipAddress, '192.168.1.0');
  const junk = buildAuditEvent(base({ actor: { ...base().actor, ipAddress: 'not-an-ip' } }));
  assert.equal(junk.ok, true); assert.equal(junk.event.actor.ipAddress, undefined);
  assert.equal(buildAuditEvent(base({ actor: { ...base().actor, ipAddress: 12345 } })).ok, true);
});

await t('review: expectedSeq is required, so a stale writer can never fork silently', async () => {
  const s = createChainState('tenant_1001');
  const r = await appendAuditEvent(s, base(), KEY);
  assert.equal(r.ok, false); assert.equal(r.error, 'expectedSeq-required');
  const a = await appendAuditEvent(s, base(), KEY, { expectedSeq: 1 });
  assert.equal(a.ok, true);
  const b = await appendAuditEvent(s, base(), KEY, { expectedSeq: 1 }); // same stale state again
  assert.equal(b.ok, true, 'the pure function cannot know; the store must serialise (documented)');
  const stale = await appendAuditEvent(a.state, base(), KEY, { expectedSeq: 1 });
  assert.equal(stale.ok, false); assert.equal(stale.error, 'chain-fork');
});

await t('review: verify can compare against a stored head, so tail truncation is detected', async () => {
  const log = await build(5);
  const head = { seq: 5, hash: log[4].entryHash };
  assert.equal((await verify(log, { expectedHead: head })).ok, true);
  const cut = await verify(log.slice(0, 4), { expectedHead: head });
  assert.equal(cut.ok, false); assert.equal(cut.reason, 'head-mismatch');
  assert.equal((await verify([], { expectedHead: head })).ok, false);
  assert.equal((await verify(log, { expectedHead: { seq: 5, hash: 'f'.repeat(64) } })).reason, 'head-mismatch');
});

await t('review: canonicalJson caps depth; Map and undefined in metadata are handled explicitly', () => {
  let deep = { v: 1 }; for (let i = 0; i < 100; i++) deep = { d: deep };
  assert.throws(() => canonicalJson(deep), /canonical-json-depth/);
  const out = maskSensitiveFields({ m: new Map([['a', 1]]), s: new Set([1]), u: undefined, ok: 1, list: [undefined, 2] });
  assert.equal(out.m, '[UNSUPPORTED]'); assert.equal(out.s, '[UNSUPPORTED]');
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'u'), false);
  assert.deepEqual(out.list, [null, 2]);
});

await t('review: more free-text secret shapes are scrubbed (unsigned JWT, quoted values, @ in passwords, provider keys)', () => {
  const clean = x => scrubInlineSecrets(x);
  assert.ok(!clean('eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c3JfOTAxIn0.').includes('eyJ'));
  const q = clean('password = "hunter 2 extra" next'); assert.ok(!q.includes('hunter') && !q.includes('extra'), q);
  assert.ok(!clean("token: 'a b c' x").includes('a b c'));
  const u = clean('postgres://user:p@ss@host.example.com/db'); assert.ok(!u.includes('p@ss') && !u.includes('ss@host'), u);
  assert.equal(clean('see https://example.com/a@b for details'), 'see https://example.com/a@b for details', 'a path with @ is not a credential');
  assert.ok(!clean('key sk-live-abcdefgh12345678 here').includes('abcdefgh'));
  assert.ok(!clean('id AKIAIOSFODNN7EXAMPLE x').includes('AKIAIOSFODNN7EXAMPLE'));
});

await t('review: dangerous field names never appear in changedFields', () => {
  const changes = JSON.parse('{"before":{"__proto__":{"x":1},"constructor":1,"status":"A"},"after":{"__proto__":{"x":2},"constructor":2,"status":"B"}}');
  const r = buildAuditEvent(base({ changes }));
  assert.equal(r.ok, true); assert.deepEqual(r.event.changedFields, ['status']);
});

console.log(`PASS security audit-log checks (SEC-04): ${n} cases`);
