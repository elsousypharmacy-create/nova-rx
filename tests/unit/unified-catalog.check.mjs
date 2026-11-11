import assert from 'node:assert';
import { sanitizeCatalogText, normalizeArabicSearchKey, normalizeBarcode, normalizeProductRecord, createUnifiedCatalog } from '../../worker/catalog/unified-catalog.js';

console.log('Running unified-catalog unit checks...');

assert.strictEqual(sanitizeCatalogText('  Panadol   Extra '), 'Panadol Extra');
assert.strictEqual(normalizeBarcode(' 12345-678 '), '12345678');

const catalog = createUnifiedCatalog();
const item = catalog.add({ name: 'Panadol Extra', barcode: '12345678' });
assert.ok(item.id);
assert.strictEqual(catalog.findByBarcode('12345678').name, 'Panadol Extra');

console.log('PASS unified-catalog unit checks (CAT-01)');
