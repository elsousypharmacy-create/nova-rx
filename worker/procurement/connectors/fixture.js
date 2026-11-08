// Reference connector over synthetic data (docs/procurement/ARCHITECTURE.md
// sections 3-4). One fictional supplier, no network, no credentials.
// Dependency-free ES module; runs in Cloudflare Workers and Node 22.

import { sanitizeName } from '../offer-schema.js';

const SUPPLIER_ID = 'fixture';

const RAW_RECORDS = [
  {
    supplierProductId: 'FX-001',
    name: 'Panadol Extra 24 Tab',
    barcode: '6223001234567',
    packSize: { count: 24, unit: 'tab', raw: '24 Tab' },
    currency: 'EGP',
    unitPrice: 45,
    publicPrice: 54,
    discountPct: 10,
    availableQuantity: 120,
    stockStatus: 'in_stock',
    minimumOrderQuantity: 1,
  },
  {
    supplierProductId: 'FX-002',
    name: 'Augmentin <b>1g</b> 14&nbsp;Tab',
    barcode: '6223002345678',
    packSize: { count: 14, unit: 'tab', raw: '14 Tab' },
    currency: 'EGP',
    unitPrice: 120,
    publicPrice: 145,
    discountPct: 5,
    availableQuantity: 40,
    stockStatus: 'in_stock',
    minimumOrderQuantity: 1,
  },
  {
    supplierProductId: 'FX-003',
    name: 'Cataflam 50mg 20 Tab',
    barcode: '6223003456789',
    packSize: { count: 20, unit: 'tab', raw: '20 Tab' },
    currency: 'EGP',
    unitPrice: 38.5,
    publicPrice: null,
    discountPct: null,
    availableQuantity: 60,
    stockStatus: 'in_stock',
    minimumOrderQuantity: 1,
  },
  {
    supplierProductId: 'FX-004',
    name: 'Voltaren Gel 50g',
    barcode: '6223004567890',
    packSize: { count: 50, unit: 'g', raw: '50 g' },
    currency: 'EGP',
    unitPrice: 72,
    publicPrice: 85,
    discountPct: 0,
    availableQuantity: 0,
    stockStatus: 'out_of_stock',
    minimumOrderQuantity: 1,
  },
  {
    supplierProductId: 'FX-005',
    name: 'Nexium 40mg 14 Tab',
    barcode: null,
    packSize: { count: 14, unit: 'tab', raw: '14 Tab' },
    currency: 'EGP',
    unitPrice: 210,
    publicPrice: 240,
    discountPct: 15,
    availableQuantity: 25,
    stockStatus: 'in_stock',
    minimumOrderQuantity: 1,
  },
  {
    supplierProductId: 'FX-006',
    name: 'Amoxil 500mg 16 Cap',
    barcode: '6223005678901',
    packSize: { count: 16, unit: 'cap', raw: '16 Cap' },
    currency: 'EGP',
    unitPrice: 55,
    publicPrice: 66,
    discountPct: 7.5,
    availableQuantity: 8,
    stockStatus: 'low',
    minimumOrderQuantity: 1,
  },
  {
    supplierProductId: 'FX-007',
    name: 'Brufen 400mg 30 Tab',
    barcode: '6223006789012',
    packSize: { count: 30, unit: 'tab', raw: '30 Tab' },
    currency: 'EGP',
    unitPrice: 60,
    publicPrice: 72,
    discountPct: 12,
    availableQuantity: 100,
    stockStatus: 'in_stock',
    minimumOrderQuantity: 5,
  },
  {
    supplierProductId: 'FX-008',
    name: 'Zyrtec 10mg 10 Tab',
    barcode: '6223007890123',
    packSize: { count: 10, unit: 'tab', raw: '10 Tab' },
    currency: 'EGP',
    unitPrice: 33.25,
    publicPrice: 39,
    discountPct: 20,
    availableQuantity: 55,
    stockStatus: 'in_stock',
    minimumOrderQuantity: 2,
  },
];

function round2(value) {
  return Math.round(value * 100) / 100;
}

function toOffer(raw, { fetchedAt } = {}) {
  const unitPrice = raw.unitPrice ?? null;
  const discountPct = raw.discountPct ?? null;
  const netEffectivePrice =
    unitPrice !== null && discountPct !== null
      ? round2(unitPrice * (1 - discountPct / 100))
      : null;
  return {
    supplierId: SUPPLIER_ID,
    supplierProductId: raw.supplierProductId,
    barcode: raw.barcode ?? null,
    productName: sanitizeName(raw.name),
    packSize: raw.packSize ?? null,
    currency: raw.currency ?? 'EGP',
    unitPrice,
    publicPrice: raw.publicPrice ?? null,
    discountPct,
    netEffectivePrice,
    availableQuantity: raw.availableQuantity ?? null,
    stockStatus: raw.stockStatus ?? 'unknown',
    minimumOrderQuantity: raw.minimumOrderQuantity ?? null,
    lastUpdated: fetchedAt ?? new Date().toISOString(),
    dataSource: 'fixture',
    syncStatus: 'fresh',
    raw: {
      name: raw.name,
      currency: raw.currency ?? 'EGP',
      unitPrice: raw.unitPrice ?? null,
      publicPrice: raw.publicPrice ?? null,
      discountPct: raw.discountPct ?? null,
      availableQuantity: raw.availableQuantity ?? null,
      stockStatus: raw.stockStatus ?? 'unknown',
    },
  };
}

async function search(query, { page = 1, pageSize = 5 } = {}) {
  const needle = String(query ?? '').trim().toLowerCase();
  const matches = needle
    ? RAW_RECORDS.filter((r) => r.name.toLowerCase().includes(needle))
    : RAW_RECORDS.slice();
  const totalPages = Math.ceil(matches.length / pageSize);
  const start = (page - 1) * pageSize;
  return {
    offers: matches.slice(start, start + pageSize),
    page,
    pageSize,
    totalPages,
  };
}

async function getProduct(supplierProductId) {
  return RAW_RECORDS.find((r) => r.supplierProductId === supplierProductId) ?? null;
}

export const fixtureConnector = {
  id: SUPPLIER_ID,
  displayName: 'Fixture Supplier',
  authorization: 'fixture',
  capabilities: { search: true, getProduct: true, listCatalog: false, stock: 'level' },
  rateLimit: { requestsPerMinute: 60 },
  search,
  getProduct,
  toOffer,
};
