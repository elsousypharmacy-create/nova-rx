import assert from 'node:assert/strict';
import { describeOffer, expiredSessionMessage, filterOffers, distribute } from '../../purchases-core.js';

const now = Date.parse('2026-11-12T12:00:00Z');
const settings = { suppliers: ['aumet', 'pharmaoverseas'], aumetSellers: ['s1'] };

// 1. describeOffer extracts strength, form, packSize, quantity, cost, date from product name and offer fields
{
  const d1 = describeOffer({
    supplierId: 'aumet',
    sellerId: 's1',
    productName: 'Augmentin 1g 14 tablets',
    availableQuantity: 25,
    unitPrice: 164.8,
    publicPrice: 210,
    lastUpdated: '2026-11-12T10:30:00Z',
  });
  assert.equal(d1.strength, '1 g');
  assert.equal(d1.form, 'أقراص');
  assert.equal(d1.packSize, '14 قرص');
  assert.equal(d1.pack, '14 قرص');
  assert.equal(d1.quantity, 25);
  assert.equal(d1.cost, 164.8);
  assert.equal(d1.date, '2026-11-12');

  const d2 = describeOffer({
    supplierId: 'pharmaoverseas',
    productName: 'Amoxicillin 500mg 12 cap',
    availableQuantity: 40,
    unitPrice: 60,
    netEffectivePrice: 48,
    publicPrice: 75,
    lastUpdated: '2026-11-12T09:15:00Z',
  });
  assert.equal(d2.strength, '500 mg');
  assert.equal(d2.form, 'كبسولات');
  assert.equal(d2.packSize, '12 كبسولة');
  assert.equal(d2.quantity, 40);
  assert.equal(d2.cost, 48);
  assert.equal(d2.date, '2026-11-12');

  const explicit = describeOffer({
    productName: 'Custom Drug',
    strength: '٢٥٠ mg',
    form: 'syrup',
    packSize: '120',
    availableQuantity: null,
    unitPrice: 35,
    lastUpdated: null,
  });
  assert.equal(explicit.strength, '250 mg');
  assert.equal(explicit.form, 'شراب');
  assert.equal(explicit.packSize, '120 وحدة');
  assert.equal(explicit.quantity, null);
  assert.equal(explicit.cost, 35);
  assert.equal(explicit.date, null);
}

// 2. filterOffers and distribute preserve strength, form, packSize, quantity, cost, date
{
  const item = { id: '1', name: 'أموكسيسيلين', nameEn: 'Amoxicillin 500mg 20 tabs', qty: 6, selected: true };
  const offers = [
    {
      supplierId: 'aumet',
      sellerId: 's1',
      sellerName: 'مخزن أ',
      supplierProductId: 'a1',
      productName: 'Amoxicillin 500mg 20 tabs',
      availableQuantity: 15,
      unitPrice: 55,
      publicPrice: 100,
      stockStatus: 'in_stock',
      currency: 'EGP',
      lastUpdated: '2026-11-12T10:00:00Z',
    },
  ];
  const filtered = filterOffers(item, offers, settings, now);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].eligible, true);
  assert.equal(filtered[0].strength, '500 mg');
  assert.equal(filtered[0].form, 'أقراص');
  assert.equal(filtered[0].packSize, '20 قرص');
  assert.equal(filtered[0].quantity, 15);
  assert.equal(filtered[0].cost, 55);
  assert.equal(filtered[0].date, '2026-11-12');

  const dist = distribute(item, offers, settings, now);
  assert.equal(dist.allocations.length, 1);
  assert.equal(dist.allocations[0].strength, '500 mg');
  assert.equal(dist.allocations[0].form, 'أقراص');
  assert.equal(dist.allocations[0].packSize, '20 قرص');
  assert.equal(dist.allocations[0].quantity, 15);
  assert.equal(dist.allocations[0].cost, 55);
  assert.equal(dist.allocations[0].date, '2026-11-12');
}

// 3. expiredSessionMessage detects expired supplier sessions clearly without false-flagging generic errors
{
  assert.equal(expiredSessionMessage([{ id: 'aumet', state: 'ok' }, { id: 'pharmaoverseas', state: 'ok' }]), '');
  assert.equal(expiredSessionMessage([{ id: 'aumet', state: 'error', message: 'x' }]), '');
  assert.equal(
    expiredSessionMessage([{ id: 'aumet', state: 'expired' }]),
    'الجلسة منتهية عند أوميت — جدّد جلسة المورد لإكمال المقارنة',
  );
  assert.equal(
    expiredSessionMessage([
      { id: 'aumet', state: 'ok' },
      { id: 'pharmaoverseas', name: 'PharmaOverseas', state: 'error', message: 'الجلسة انتهت، سجّل دخول المورد' },
    ]),
    'الجلسة منتهية عند فارما أوفرسيز — جدّد جلسة المورد لإكمال المقارنة',
  );
}

console.log('PASS BUY-02 unit: strength, form, pack size, quantity, cost, date and expired-session message');
