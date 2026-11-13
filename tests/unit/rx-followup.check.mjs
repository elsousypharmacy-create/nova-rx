import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createRxStore } = createRequire(import.meta.url)('../../rx-followup.js');

function mem() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, raw: m }; }
const T0 = 1700000000000;
let T = T0;
const mk = (s = mem(), o = {}) => createRxStore(s, 'k', { now: () => T, ...o });
const file = (extra = {}) => ({ customerId: 'c1', visitId: 'V1', name: 'rx.jpg', mime: 'image/jpeg', size: 10, ref: 'local:abc', actor: 'u1', ...extra });
let n = 0;
const t = (name, fn) => { T = T0; fn(); n++; console.log('ok', name); };

t('attach refused without consent; allowed once granted; visit+item link kept', () => {
  const r = mk();
  assert.throws(() => r.attachFile(file()), { code: 'consent-required' });
  r.setConsent('c1', 'granted', 'u1');
  const f = r.attachFile(file({ itemId: 'I7' }));
  assert.equal(f.itemId, 'I7'); assert.equal(f.reminder.enabled, false);
  assert.equal(r.listForVisit('V1', 'u1', 'I7').length, 1);
  assert.equal(r.listForVisit('V1', 'u1', 'I8').length, 0);
});
t('list hides file ref; open requires purpose and is audited', () => {
  const r = mk(); r.setConsent('c1', 'granted', 'u1'); const f = r.attachFile(file());
  assert.equal('ref' in r.listForVisit('V1', 'u1')[0], false);
  assert.throws(() => r.openFile(f.id, 'u2', ''), { code: 'purpose-required' });
  assert.equal(r.openFile(f.id, 'u2', 'dispensing').ref, 'local:abc');
  assert.ok(r.auditLog('u1').some(e => e.action === 'open:dispensing' && e.actor === 'u2' && e.target === f.id));
});
t('permission gate denies and writes nothing', () => {
  const s = mem(), r = mk(s, { canAccess: (a) => a === 'u1' });
  assert.throws(() => r.setConsent('c1', 'granted', 'u9'), { code: 'forbidden' });
  assert.equal(s.raw.k, undefined);
  assert.throws(() => r.openFile('RX1', '', 'x'), { code: 'actor-required' });
});
t('reminders are opt-in, need consent and future date, and only list when due', () => {
  const r = mk(); r.setConsent('c1', 'granted', 'u1'); const f = r.attachFile(file());
  assert.deepEqual(r.dueReminders(T + 1e9), []);
  assert.throws(() => r.setReminder(f.id, true, T - 1, 'u1'), { code: 'bad-due-date' });
  r.setReminder(f.id, true, T + 1000, 'u1');
  assert.equal(r.dueReminders(T).length, 0);
  assert.equal(r.dueReminders(T + 1000).length, 1);
  r.setReminder(f.id, false, null, 'u1');
  assert.equal(r.dueReminders(T + 1e9).length, 0);
});
t('withdrawing consent clears reminders and blocks new attach/reminder', () => {
  const r = mk(); r.setConsent('c1', 'granted', 'u1'); const f = r.attachFile(file());
  r.setReminder(f.id, true, T + 1000, 'u1');
  r.setConsent('c1', 'withdrawn', 'u1');
  assert.equal(r.dueReminders(T + 1e9).length, 0);
  assert.equal(r.consentState('c1'), 'withdrawn');
  assert.throws(() => r.setReminder(f.id, true, T + 1000, 'u1'), { code: 'consent-required' });
  assert.throws(() => r.attachFile(file()), { code: 'consent-required' });
  assert.throws(() => r.setConsent('c1', 'maybe', 'u1'), { code: 'bad-consent-state' });
});
t('persists, rejects corrupt storage without overwriting, and validates input', () => {
  const s = mem(), r = mk(s); r.setConsent('c1', 'granted', 'u1'); r.attachFile(file());
  assert.equal(mk(s).listForVisit('V1', 'u1').length, 1);
  assert.throws(() => r.attachFile(file({ size: -1 })), { code: 'bad-size' });
  assert.throws(() => r.attachFile(file({ ref: '' })), { code: 'ref-required' });
  s.setItem('k', '{bad'); assert.throws(() => mk(s).consentState('c1'), { code: 'rx-corrupt' });
  assert.equal(s.raw.k, '{bad');
});
console.log(`${n} tests passed`);
