import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const B = createRequire(import.meta.url)('../../backup-schedule.js');
const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; }, raw: m }; };
let T = 1e6, n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const payload = JSON.stringify({ format: 'nova-rx-sales-backup', version: 1, sales: [{ id: 's1' }], returns: [] });
const mk = (extra = {}) => B.createScheduler(Object.assign({ storage: mem(), now: () => T, passphrase: () => 'correct horse', exportText: () => payload,
  parse: x => { const d = JSON.parse(x); return d.format === 'nova-rx-sales-backup' ? { ok: true, newSales: d.sales, skippedSales: 0 } : { ok: false }; } }, extra));

await t('encrypt/decrypt round trip; wrong passphrase and tamper fail', async () => {
  const env = await B.encrypt('مرحبا ١٢٣', 'correct horse', 1000);
  assert.ok(!JSON.stringify(env).includes('مرحبا'));
  assert.equal(await B.decrypt(env, 'correct horse'), 'مرحبا ١٢٣');
  await assert.rejects(B.decrypt(env, 'wrong pass!!'), { code: 'bad-passphrase-or-tampered' });
  await assert.rejects(B.decrypt({ ...env, data: env.data.slice(0, -4) + 'AAAA' }, 'correct horse'), { code: 'bad-passphrase-or-tampered' });
  await assert.rejects(B.encrypt('x', 'short'), { code: 'weak-passphrase' });
});
await t('schedule: due only after interval, keeps newest 5, interval must satisfy RPO', async () => {
  assert.throws(() => mk({ intervalMs: 16 * 60000 }), { code: 'interval-exceeds-rpo' });
  const s = mk(); assert.ok(s.due()); assert.ok(await s.tick()); assert.ok(!s.due()); assert.equal(await s.tick(), null);
  for (let i = 0; i < 7; i++) { T += 600000; assert.ok(await s.tick()); }
  assert.equal(s.list().length, 5);
});
await t('restore drill measures RPO/RTO against the targets and never touches live data', async () => {
  const s = mk(); assert.deepEqual(await s.drill(), { ok: false, error: 'no-backup' });
  await s.runBackup(); T += 5 * 60000;
  const r = await s.drill(); assert.ok(r.ok && r.rpoOk && r.rtoOk && r.rpoMs === 300000 && r.sales === 1);
  T += 20 * 60000; assert.equal((await s.drill()).rpoOk, false);
  const s2 = mk(); await s2.runBackup(); const s3 = B.createScheduler({ storage: { getItem: () => JSON.stringify(s2.list()), setItem() {} }, now: () => T, passphrase: () => 'not the one!!', exportText: () => '', parse: () => ({ ok: true }) });
  assert.equal((await s3.drill()).error, 'bad-passphrase-or-tampered');
});
await t('download is gated by permission and re-auth', async () => {
  const s = mk(); await s.runBackup();
  assert.throws(() => s.download({ allow: () => false, reauthed: () => true }), { code: 'permission' });
  assert.throws(() => s.download({ allow: () => true, reauthed: () => false }), { code: 'reauth-required' });
  assert.throws(() => s.download(), { code: 'permission' });
  assert.equal(JSON.parse(s.download({ allow: a => a === 'data.export', reauthed: () => true })).format, 'nova-rx-encrypted-backup');
});
console.log(n + ' backup-schedule checks passed');
