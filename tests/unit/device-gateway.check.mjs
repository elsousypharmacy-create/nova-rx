import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const d = createRequire(import.meta.url)('../../device-gateway.js');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const cashier = { role: 'cashier', permissions: ['devices.print.invoice'] };

await t('supported list has barcode, invoice and sticker devices', () => {
  const l = d.list();
  assert.ok(l.some(x => x.kind === 'barcode'));
  assert.ok(l.some(x => x.outputs && x.outputs.includes('invoice')));
  assert.ok(l.some(x => x.outputs && x.outputs.includes('sticker')));
});
await t('barcode validation', () => {
  assert.equal(d.validBarcode('12345'), false);
  assert.equal(d.validBarcode('4006381333931'), true);
  assert.equal(d.validBarcode('4006381333932'), false);
  assert.equal(d.validBarcode('96385074'), true);
  assert.equal(d.validBarcode('ABC-123'), true);
  assert.equal(d.validBarcode(''), false);
});
await t('permissions', () => {
  assert.equal(d.can(cashier, 'invoice'), true);
  assert.equal(d.can(cashier, 'sticker'), false);
  assert.equal(d.can({ role: 'owner' }, 'sticker'), true);
  assert.equal(d.can(null, 'invoice'), false);
});
await t('print rejects unpermitted / wrong device / missing job id', async () => {
  const d1 = d.createDispatcher({ send: async () => ({ ok: true }) });
  assert.equal((await d1.print(cashier, 'sticker', 'printer-label', 'j1', {})).error, 'not-permitted');
  assert.equal((await d1.print(cashier, 'invoice', 'printer-label', 'j1', {})).error, 'unsupported-device');
  assert.equal((await d1.print(cashier, 'invoice', 'printer-a4', '', {})).error, 'job-id-required');
});
await t('device failure is reported, retry prints once, duplicates never reprint', async () => {
  let calls = 0, fail = true;
  const d1 = d.createDispatcher({ send: async () => { calls++; if (fail) throw new Error('offline'); return { ok: true }; } });
  assert.deepEqual(await d1.print(cashier, 'invoice', 'printer-a4', 'sale-1', {}), { ok: false, error: 'device-failed' });
  fail = false;
  assert.deepEqual(await d1.print(cashier, 'invoice', 'printer-a4', 'sale-1', {}), { ok: true });
  assert.equal((await d1.print(cashier, 'invoice', 'printer-a4', 'sale-1', {})).duplicate, true);
  assert.equal(calls, 2);
});
await t('concurrent same job is sent once', async () => {
  let calls = 0;
  const d1 = d.createDispatcher({ send: () => { calls++; return new Promise(r => setTimeout(() => r({ ok: true }), 10)); } });
  const [a, b] = await Promise.all([d1.print(cashier, 'invoice', 'printer-a4', 's2', {}), d1.print(cashier, 'invoice', 'printer-a4', 's2', {})]);
  assert.equal(calls, 1); assert.equal([a, b].filter(x => x.ok).length, 1);
});
console.log(n + ' passed');
