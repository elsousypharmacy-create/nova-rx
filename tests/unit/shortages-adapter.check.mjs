import assert from 'node:assert';
import {
  stripSecrets,
  sanitizeShortageText,
  parsePositiveNumber,
  normalizeOrdersPageShortages,
  filterEligibleOffersForNeed,
  buildShortagesProcurementPlan,
  computeDraftSignature,
  verifyOwnerConfirmationGate
} from '../../worker/procurement/shortages-adapter.js';

console.log('Running shortages-adapter.check.mjs unit tests...');

// 1. Strip secrets, sanitize text, and Arabic numbers parsing
{
  assert.strictEqual(parsePositiveNumber('٥'), 5);
  assert.strictEqual(parsePositiveNumber('١٠.٥'), 10.5);
  assert.strictEqual(parsePositiveNumber('0'), 0);
  assert.strictEqual(parsePositiveNumber('-2'), 0);

  assert.strictEqual(sanitizeShortageText('  Panadol  Extra\n'), 'Panadol Extra');

  const rawData = {
    user: 'pharmacy_admin',
    apiKey: 'secret_key_9999',
    token: 'Bearer sample_token_abc',
    nested: { secretField: 'top_secret' }
  };
  const cleanData = stripSecrets(rawData);
  assert.strictEqual(cleanData.apiKey, '[REDACTED]');
  assert.strictEqual(cleanData.token, '[REDACTED]');
  assert.strictEqual(cleanData.nested.secretField, '[REDACTED]');
  assert.strictEqual(cleanData.user, 'pharmacy_admin');
}

// 2. Merging duplicate shortages between zero and low lists
{
  const ordersData = {
    zero: [
      { co: 'Novartis', n: 'Cataflam 50mg', q: '٥', c: '6221001', s: 'Aumet', h: 'omet-wh-1', mk: false }
    ],
    low: [
      { co: 'Novartis', n: 'Cataflam 50mg', q: '٣', c: '6221001', s: 'Aumet', h: 'omet-wh-1', mk: true }
    ]
  };

  const normalized = normalizeOrdersPageShortages(ordersData);
  assert.strictEqual(normalized.length, 1);
  assert.strictEqual(normalized[0].q, 8); // 5 + 3
  assert.strictEqual(normalized[0].c, '6221001');
  assert.strictEqual(normalized[0].mk, true);
  assert.deepStrictEqual(normalized[0].sources.sort(), ['low', 'zero']);
}

// 3. Enforcing selected Omet warehouses in auto mode & Owner Confirmation Gate transition
{
  const offers = [
    { code: '6221001', supplierId: 'sup-aumet', warehouseId: 'omet-wh-1', price: '25' },
    { code: '6221001', supplierId: 'sup-aumet', warehouseId: 'unselected-wh-2', price: '20' }
  ];

  const autoOffers = filterEligibleOffersForNeed(offers, {
    mode: 'auto',
    selectedSupplierId: 'sup-aumet',
    selectedOmetWarehouses: ['omet-wh-1']
  });

  assert.strictEqual(autoOffers.length, 1);
  assert.strictEqual(autoOffers[0].warehouseId, 'omet-wh-1');

  const ordersData = {
    zero: [{ co: 'Novartis', n: 'Cataflam 50mg', q: '5', c: '6221001', mk: false }]
  };

  const draftPlan = buildShortagesProcurementPlan({
    ordersData,
    offers,
    mode: 'auto',
    selectedSupplierId: 'sup-aumet',
    selectedOmetWarehouses: ['omet-wh-1']
  });

  assert.strictEqual(draftPlan.status, 'draft-preview-only');
  assert.strictEqual(draftPlan.items.length, 1);
  assert.ok(draftPlan.signature);

  // Gate verification: unconfirmed owner blocks
  const unconfirmedGate = verifyOwnerConfirmationGate(draftPlan, { ownerConfirmed: false });
  assert.strictEqual(unconfirmedGate.valid, false);
  assert.strictEqual(unconfirmedGate.status, 'draft-preview-only');

  // Gate verification: owner confirmed -> transition to owner-confirmed-preview-ready
  const confirmedGate = verifyOwnerConfirmationGate(draftPlan, { ownerConfirmed: true });
  assert.strictEqual(confirmedGate.valid, true);
  assert.strictEqual(confirmedGate.status, 'owner-confirmed-preview-ready');
}

// 4. Manual mode, saved prep flags (it.mk), rejecting unselected warehouses, and signature tamper checks
{
  const offers = [
    { code: 'ITEM-MK-OFF', supplierId: 'sup-1', warehouseId: 'unselected-wh', mk: false },
    { code: 'ITEM-MK-ON', supplierId: 'sup-1', warehouseId: 'unselected-wh', mk: true }
  ];

  const manualOffers = filterEligibleOffersForNeed(offers, {
    mode: 'manual',
    selectedSupplierId: 'sup-1',
    selectedOmetWarehouses: ['omet-wh-1']
  });

  // Rejects unselected warehouse without prep flag, allows with prep flag
  assert.strictEqual(manualOffers.length, 1);
  assert.strictEqual(manualOffers[0].code, 'ITEM-MK-ON');

  const ordersData = {
    zero: [{ co: 'Co', n: 'Item MK', q: '2', c: 'ITEM-MK-ON', mk: true }]
  };

  const plan = buildShortagesProcurementPlan({
    ordersData,
    offers,
    mode: 'manual',
    selectedSupplierId: 'sup-1',
    selectedOmetWarehouses: ['omet-wh-1']
  });

  // External tamper attempt
  const tampered = { ...plan, totalCost: 0 };
  const tamperedGate = verifyOwnerConfirmationGate(tampered, { ownerConfirmed: true });
  assert.strictEqual(tamperedGate.valid, false);
  assert.strictEqual(tamperedGate.reason.includes('Signature verification failed'), true);
}

console.log('PASS');
