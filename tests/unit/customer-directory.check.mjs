import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createCustomerDirectory,
  normalizePhone,
  normalizeName
} = require('../../customer-directory.js');
const { createCreditLedger } = require('../../credit-ledger.js');
const NovaPerms = require('../../auth-permissions.js');

const T0 = 1700000000000;
function mem() {
  const m = {};
  return {
    getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = v; },
    removeItem: k => { delete m[k]; },
    raw: m
  };
}

let T = T0;
const mk = (s = mem(), opts = {}) => createCustomerDirectory(s, 'nova.customers', { now: () => T, ...opts });
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('normalizePhone unifies Egyptian mobile/landline, Arabic/Persian digits, formatting, and E.164', () => {
  assert.equal(normalizePhone('01012345678'), '+201012345678');
  assert.equal(normalizePhone('٠١٠١٢٣٤٥٦٧٨'), '+201012345678');
  assert.equal(normalizePhone('۰۱۱ ۹۸۷۶ ۵۴۳۲'), '+201198765432');
  assert.equal(normalizePhone('+20 (12) 3456-7890'), '+201234567890');
  assert.equal(normalizePhone('0020 15 1122 3344'), '+201511223344');
  assert.equal(normalizePhone('+2001012345678'), '+201012345678');
  assert.equal(normalizePhone('1012345678'), '+201012345678');
  assert.equal(normalizePhone('02-2345-6789'), '+20223456789');
  assert.equal(normalizePhone('+966 50 123 4567'), '+966501234567');

  for (const bad of ['', '   ', '01312345678', '+201312345678', '0101234', 'abc', null, 1012345678]) {
    assert.throws(() => normalizePhone(bad), { code: 'bad-phone' });
  }
});

t('create normalizes phone, persists across reload, blocks accidental duplicate phone, and fails closed on corrupt storage', () => {
  const s = mem(), dir = mk(s);
  const c1 = dir.create({
    id: 'c1',
    name: 'أحمد محمد علي',
    phone: '٠١٠١٢٣٤٥٦٧٨',
    altPhones: ['011-2233-4455', '01012345678']
  });
  assert.equal(c1.phone, '+201012345678');
  assert.deepEqual(c1.altPhones, ['+201122334455']);
  assert.equal(mk(s).get('c1').phone, '+201012345678');

  assert.throws(() => dir.create({ name: 'آخر', phone: '+20 10 1234 5678' }), { code: 'duplicate-phone' });
  assert.throws(() => dir.create({ name: 'آخر', phone: '01122334455' }), { code: 'duplicate-phone' });
  assert.throws(() => dir.create({ name: '   ', phone: '01211112222' }), { code: 'missing-name' });

  s.setItem('nova.customers', '{corrupt');
  assert.throws(() => dir.list(), { code: 'directory-corrupt' });
  assert.equal(s.raw['nova.customers'], '{corrupt');
});

t('write failure throws directory-write-failed and leaves stored state untouched', () => {
  const s = mem(), dir = mk(s);
  dir.create({ id: 'c1', name: 'سارة حسن', phone: '01011112222' });
  s.setItem = () => { throw new Error('quota'); };
  assert.throws(() => dir.create({ id: 'c2', name: 'منى', phone: '01033334444' }), { code: 'directory-write-failed' });
  assert.equal(dir.list().length, 1);
});

t('contact consent defaults to opt-out, records history on change, and gates effectiveContactChannel', () => {
  const dir = mk();
  const c = dir.create({
    id: 'c1',
    name: 'محمود إبراهيم',
    phone: '01099887766',
    preferences: { preferredChannel: 'whatsapp', language: 'ar', receiptFormat: 'whatsapp', deliveryAddress: 'المعادي' }
  });
  assert.equal(c.consent.whatsapp, false);
  assert.equal(c.consent.sms, false);
  assert.equal(c.consent.call, false);
  assert.equal(c.consent.marketing, false);
  assert.equal(dir.canContact('c1', 'whatsapp'), false);
  assert.equal(dir.effectiveContactChannel('c1'), 'none', 'preferredChannel cannot bypass missing consent');

  T = T0 + 1000;
  dir.setConsent('c1', { whatsapp: true, sms: false }, { by: 'ph-ahmed', source: 'pos-counter', note: 'signed slip' });
  assert.equal(dir.canContact('c1', 'whatsapp'), true);
  assert.equal(dir.effectiveContactChannel('c1'), 'whatsapp');

  T = T0 + 2000;
  const updated = dir.setConsent('c1', { whatsapp: false }, { by: 'customer-request', source: 'whatsapp-stop' });
  assert.equal(dir.canContact('c1', 'whatsapp'), false);
  assert.equal(dir.effectiveContactChannel('c1'), 'none');
  assert.equal(updated.consentHistory.length, 3);
  assert.equal(updated.consentHistory[2].allowed, false);
  assert.equal(updated.consentHistory[2].by, 'customer-request');

  assert.throws(() => dir.setConsent('c1', { telegram: true }), { code: 'bad-consent-channel' });
  assert.throws(() => dir.setConsent('c1', { sms: 'yes' }), { code: 'bad-consent-value' });
  assert.throws(() => dir.canContact('c1', 'email'), { code: 'bad-consent-channel' });
});

t('preferences are validated and preserved across updates', () => {
  const dir = mk();
  dir.create({ id: 'c1', name: 'هدى سالم', phone: '01223344556' });
  const updated = dir.setPreferences('c1', {
    language: 'en',
    preferredChannel: 'sms',
    receiptFormat: 'sms',
    deliveryAddress: '  15 التحرير  ',
    deliveryNotes: 'الدور الثالث',
    chronicRefillReminder: true
  });
  assert.equal(updated.preferences.language, 'en');
  assert.equal(updated.preferences.preferredChannel, 'sms');
  assert.equal(updated.preferences.receiptFormat, 'sms');
  assert.equal(updated.preferences.deliveryAddress, '15 التحرير');
  assert.equal(updated.preferences.chronicRefillReminder, true);

  assert.throws(() => dir.setPreferences('c1', { language: 'fr' }), { code: 'bad-preference' });
  assert.throws(() => dir.setPreferences('c1', { preferredChannel: 'pigeon' }), { code: 'bad-preference' });
  assert.throws(() => dir.setPreferences('c1', { receiptFormat: 'fax' }), { code: 'bad-preference' });
  assert.throws(() => dir.setPreferences('c1', { unknownKey: 1 }), { code: 'bad-preference' });
});

t('search and findByPhone match Arabic name variants and Arabic/ASCII phone digits', () => {
  const dir = mk();
  dir.create({ id: 'c1', name: 'أَبو بَكر الصِّدّيق فؤاد', phone: '01011223344' });
  dir.create({ id: 'c2', name: 'فاطمة الزهراء على', phone: '01155667788' });
  assert.equal(normalizeName('أبو بكر الصديق فؤاد'), normalizeName('ابو بكر الصديق فواد'));
  assert.equal(dir.findByPhone('٠١٠١١٢٢٣٣٤٤').id, 'c1');
  assert.equal(dir.search('فاطمه الزهراء علي').length, 1);
  assert.equal(dir.search('٥٥٦٦').length, 1);
  assert.equal(dir.search('٥٥٦٦')[0].id, 'c2');
});

t('detectDuplicates and reviewed merge: requires reviewer, merges phones/consent/preferences, keeps alias and immutable mergeLog', () => {
  const dir = mk();
  T = T0 + 100;
  dir.create({
    id: 'c1',
    name: 'إبراهيم السيد',
    phone: '01010002000',
    consent: { whatsapp: true, marketing: true },
    preferences: { preferredChannel: 'whatsapp', deliveryAddress: '' },
    tags: ['chronic']
  });
  T = T0 + 200;
  dir.create({
    id: 'c2',
    name: 'ابراهيم السيّد',
    phone: '01190008000',
    consent: { marketing: false },
    preferences: { preferredChannel: 'sms', deliveryAddress: 'مدينة نصر', notes: 'عميل دائم' },
    tags: ['vip']
  });
  dir.create({
    id: 'c3',
    name: 'عمرو خالد',
    phone: '01270006000'
  });

  const dups = dir.detectDuplicates();
  assert.equal(dups.length, 1);
  assert.equal(dups[0].reason, 'name');
  assert.deepEqual(dups[0].ids, ['c1', 'c2']);

  assert.throws(() => dir.merge('c1', 'c2', {}), { code: 'reviewer-required' });
  assert.throws(() => dir.merge('c1', 'c2', { reviewedBy: '   ' }), { code: 'reviewer-required' });
  assert.throws(() => dir.merge('c1', 'c3', { reviewedBy: 'Dr Ahmed' }), { code: 'not-duplicate-candidate' });
  assert.throws(() => dir.merge('c1', 'c1', { reviewedBy: 'Dr Ahmed' }), { code: 'same-customer' });

  T = T0 + 300;
  const res = dir.merge('c1', 'c2', { reviewedBy: 'Dr Ahmed', reason: 'confirmed same patient at counter' });
  assert.equal(res.ok, true);
  assert.equal(dir.list().length, 2);
  assert.equal(dir.resolveId('c2'), 'c1');
  assert.equal(dir.get('c2').id, 'c1');
  assert.equal(dir.findByPhone('01190008000').id, 'c1');
  assert.deepEqual(res.customer.altPhones, ['+201190008000']);
  assert.deepEqual(res.customer.tags.sort(), ['chronic', 'vip']);
  assert.equal(res.customer.consent.whatsapp, true, 'c1 opted in and c2 never touched whatsapp');
  assert.equal(res.customer.consent.marketing, false, 'c2 later opt-out overrides c1 earlier opt-in');
  assert.equal(res.customer.preferences.deliveryAddress, 'مدينة نصر', 'blank deliveryAddress filled from dropped');
  assert.equal(res.customer.preferences.preferredChannel, 'whatsapp', 'kept preference wins when non-empty');
  assert.equal(dir.detectDuplicates().length, 0);

  assert.equal(dir.mergeLog.length, 1);
  assert.equal(dir.mergeLog[0].keptId, 'c1');
  assert.equal(dir.mergeLog[0].droppedId, 'c2');
  assert.equal(dir.mergeLog[0].reviewedBy, 'Dr Ahmed');
  assert.equal(dir.mergeLog[0].discarded.phone, '+201190008000');
  assert.deepEqual(dir.mergeLog[0].discarded.preferences, { preferredChannel: 'sms' });

  assert.throws(() => { dir.mergeLog.length = 0; }, TypeError);
  assert.throws(() => { dir.mergeLog[0].reviewedBy = 'tampered'; }, TypeError);
  assert.equal(dir.mergeLog[0].reviewedBy, 'Dr Ahmed');
});

t('customer statement is strictly blocked without permission and aggregates across merged aliases when authorized', () => {
  const s = mem();
  const credit = createCreditLedger(s, 'nova.credit', { now: () => T });
  let activeSession = null;
  const perms = NovaPerms.create({
    storage: s,
    current: () => activeSession,
    hasAccounts: () => true,
    now: () => T
  });

  const sales = [
    { id: 'S-1', customerId: 'c1', credit: 120, total: 120 },
    { id: 'S-2', customerId: 'c2', credit: 80, total: 80 }
  ];
  const dir = mk(s, {
    creditLedger: credit,
    salesLedger: () => sales,
    perms,
    currentUser: () => activeSession
  });

  dir.create({ id: 'c1', name: 'خالد محمود', phone: '01050001111' });
  dir.create({ id: 'c2', name: 'خالد محمود', phone: '01050002222' });
  credit.setLimit('c1', 500);
  credit.charge({ id: 'S-1', customerId: 'c1', amount: 120 });
  credit.charge({ id: 'S-2', customerId: 'c2', amount: 80 });
  dir.merge('c1', 'c2', { reviewedBy: 'Dr Ahmed' });

  // 1. Signed-out user -> denied
  assert.throws(() => dir.statement('c1'), { code: 'permission-denied' });

  // 2. Cashier (even if caller attempts to spoof role: 'owner' in argument) -> denied
  activeSession = { name: 'cashier-ali', role: 'cashier' };
  assert.throws(() => dir.statement('c1', { role: 'owner', user: { name: 'spoof', role: 'owner' } }), { code: 'permission-denied' });

  // 3. Delivery role -> denied
  activeSession = { name: 'driver-1', role: 'delivery' };
  assert.throws(() => dir.statement('c1'), { code: 'permission-denied' });

  // 4. Authorized pharmacist / manager / owner -> allowed, resolves alias 'c2' -> 'c1', combines movements & balance
  activeSession = { name: 'Dr Ahmed', role: 'owner' };
  const st = dir.statement('c2');
  assert.equal(st.customer.id, 'c1');
  assert.deepEqual(st.aliases, ['c2']);
  assert.equal(st.balance, 200);
  assert.equal(st.creditLimit, 500);
  assert.equal(st.movements.length, 2);
  assert.equal(st.sales.length, 2);
  assert.deepEqual(st.accessedBy, { actor: 'Dr Ahmed', role: 'owner' });

  const log = dir.statementAccessLog();
  assert.equal(log.length, 4);
  assert.equal(log[0].allowed, false);
  assert.equal(log[1].allowed, false);
  assert.equal(log[1].role, 'cashier');
  assert.equal(log[2].allowed, false);
  assert.equal(log[3].allowed, true);
  assert.equal(log[3].actor, 'Dr Ahmed');
  assert.throws(() => { log.length = 0; }, TypeError);
});

console.log(n, 'passed');
