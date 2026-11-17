// S3-01: invoice print through a MOCK device gateway (no physical printer): browser fallback, one print per click, reprint on purpose,
// failure keeps the sale and gives an Arabic message, retry after recovery prints once. Run: node tests/unit/device-print.check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const NovaDevices = require('../../device-gateway.js');
const { create, ERRORS_AR } = require('../../device-print-wire.js');

function makeStorage() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); }
  };
}

let currentGateway = null;
let sends = 0;
let shouldFail = false;

const wire = create({
  devices: NovaDevices,
  storage: makeStorage(),
  getGateway: () => currentGateway
});

// 1. No gateway -> resolves { ok: true, via: 'browser' }
const rBrowser = await wire.printInvoice({ id: 'S-1', number: 101, total: 50, lines: [] }, 0);
assert.deepEqual(rBrowser, { ok: true, via: 'browser' });

// 2. setPrinter validation
assert.equal(wire.setPrinter('printer-label'), false);
assert.equal(wire.setPrinter('printer-thermal-80'), true);
assert.equal(wire.selectedPrinter(), 'printer-thermal-80');

// 3. Mock gateway counting sends
currentGateway = {
  send: async () => {
    if (shouldFail) return { ok: false, error: 'io-error' };
    sends += 1;
    return { ok: true };
  }
};

const sampleSale = {
  id: 'S-100',
  number: 2026001,
  total: 125.5,
  lines: [{ name: 'Paracetamol 500mg', qty: 2, price: 15 }]
};
const saleSnapshot = structuredClone(sampleSale);

const r1 = await wire.printInvoice(sampleSale, 0);
assert.deepEqual(r1, { ok: true, via: 'device' });
assert.equal(sends, 1);

const rDup = await wire.printInvoice(sampleSale, 0);
assert.equal(rDup.ok, true);
assert.equal(rDup.via, 'device');
assert.equal(rDup.duplicate, true);
assert.equal(sends, 1);

const rReprint = await wire.printInvoice(sampleSale, 1);
assert.deepEqual(rReprint, { ok: true, via: 'device' });
assert.equal(sends, 2);

// 4. Failing gateway -> device-failed Arabic message, sale object untouched
shouldFail = true;
const sale2 = {
  id: 'S-200',
  number: 2026002,
  total: 80,
  lines: [{ name: 'Vitamin C', qty: 1, price: 80 }]
};
const sale2Clone = structuredClone(sale2);

const rFail = await wire.printInvoice(sale2, 0);
assert.equal(rFail.ok, false);
assert.equal(rFail.message_ar, ERRORS_AR['device-failed']);
assert.deepEqual(sale2, sale2Clone);
assert.equal(sends, 2);

// 5. Retry after gateway recovers prints once
shouldFail = false;
const rRecovered = await wire.printInvoice(sale2, 0);
assert.deepEqual(rRecovered, { ok: true, via: 'device' });
assert.equal(sends, 3);

// 6. devicesHtml contains 'novaInvoicePrinter' and every SUPPORTED name
const html = wire.devicesHtml();
assert.ok(html.includes('novaInvoicePrinter'));
for (const item of NovaDevices.list()) {
  assert.ok(html.includes(item.name), `Missing device name: ${item.name}`);
}

// 7. Sale object passed in was never mutated across all operations
assert.deepEqual(sampleSale, saleSnapshot);

// 8. an auth module present but no signed-in user -> not permitted (never prints as an anonymous owner)
const noUser = create({ devices: NovaDevices, storage: makeStorage(), getGateway: () => currentGateway, getUser: () => null });
noUser.setPrinter('printer-a4');
const rNo = await noUser.printInvoice({ id: 'S-300', lines: [] }, 0);
assert.equal(rNo.ok, false); assert.equal(rNo.message_ar, ERRORS_AR['not-permitted']);

// 9. index.html: the print path uses the wire with the browser fallback, and the settings card is mounted
const page = readFileSync('index.html', 'utf8');
assert.ok(page.includes('window.novaDevicePrint.printInvoice(currentSale, currentCopy ? currentCopyNo : 0)'), 'printNow uses the device wire');
assert.ok(page.includes('id="novaDevicesCard"'), 'devices card in settings');

console.log('device-print OK');
