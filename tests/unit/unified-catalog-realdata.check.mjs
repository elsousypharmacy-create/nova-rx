import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createUnifiedCatalog } from '../../worker/catalog/unified-catalog.js';

// Read-only: data/emergency-stock.json is a STOCK LIVE export. Nothing here writes to it or to the live sheet.
const file = new URL('../../data/emergency-stock.json', import.meta.url);
const items = JSON.parse(fs.readFileSync(file, 'utf8')).items;
const t0 = performance.now();
const c = createUnifiedCatalog(items);
const buildMs = performance.now() - t0;
const groups = c.detectDuplicates();

assert.equal(c.getAll().length + c.rejected.length, items.length, 'every row loaded or reported');
assert.equal(new Set(c.getAll().map(p => p.id)).size, c.getAll().length, 'ids unique');
assert.equal(c.mergeLog.length, 0, 'nothing merged automatically');
assert.ok(c.getAll().every(p => p.nameAr || p.nameEn));
assert.ok(c.getAll().every(p => p.price === null || (Number.isFinite(p.price) && p.price >= 0)));
const sample = items.find(i => i.nameen && /GAVISCON/i.test(i.nameen));
assert.ok(c.search('gaviscon').length > 0, 'Latin search works');
assert.ok(c.search('جافيسكون').length > 0, 'Arabic search works');
assert.equal(c.findById(sample.code).id, sample.code);
for (const g of groups) assert.ok(g.ids.length >= 2 && g.key && g.reason);

console.log(`PASS unified-catalog real-data check (CAT-01): rows=${items.length} loaded=${c.getAll().length} rejected=${c.rejected.length} duplicateGroups=${groups.length} buildMs=${buildMs.toFixed(0)}`);
