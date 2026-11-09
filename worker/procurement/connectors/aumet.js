// Aumet marketplace connector (issue Procurement 03b, epic #53).
// One marketplace, many sellers: each row of GET /api/products is one
// distributor offer, so offers carry sellerId/sellerName.
// The caller injects request(path, params) which carries the pharmacy's own
// login headers; this module never sees or logs credentials, tokens or URLs.
// Dependency-free ES module; runs in Cloudflare Workers and Node 22.

import {
  AuthRequiredError,
  ConnectorError,
  NotAuthorizedError,
  RateLimitedError,
  SchemaDriftError,
  TransientError,
} from '../connector-contract.js';
import { sanitizeName } from '../offer-schema.js';

const SUPPLIER_ID = 'aumet';
const DEFAULT_BASE_URL = 'https://marketplace.aumet.com';
const REQUESTS_PER_MINUTE = 20;
const DEFAULT_RETRY_AFTER_MS = 60000;
const DEFAULT_LOW_STOCK_LIMIT = 100;

// Fields kept in offer.raw (price semantics unconfirmed; see discovery notes).
const RAW_KEPT_FIELDS = [
  'unit_price',
  'best_price',
  'retail_selling_price',
  'vat',
  'discounts',
  'bonuses',
  'stock',
  'delivery_fee',
  'average_distributor_rate',
  'paymentMethod',
];

function round2(value) {
  return Math.round(value * 100) / 100;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMsFrom(headers) {
  const raw = headers?.get?.('Retry-After');
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return DEFAULT_RETRY_AFTER_MS;
}

function clampPageSize(pageSize) {
  const n = Math.trunc(Number(pageSize));
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

// Isolated on purpose: the text parameter name (`spell`) is unconfirmed
// (docs/procurement/discovery/aumet.md "Unknown"); fix here after a live check.
export function buildSearchParams(query, page, pageSize) {
  return {
    page,
    result_per_page: pageSize,
    sort_by: 'price',
    show_comparison: 1,
    in_stock: 1,
    spell: String(query ?? ''),
  };
}

function toBarcode(value) {
  const digits = typeof value === 'string' ? value : value == null ? '' : String(value);
  return /^\d{8,14}$/.test(digits) ? digits : null;
}

function toNonNegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function createAumetConnector({
  request = async () => {
    throw new AuthRequiredError('Aumet: no request function configured');
  },
  baseUrl = DEFAULT_BASE_URL,
  sleep = defaultSleep,
  now = () => Date.now(),
  lowStockLimit = DEFAULT_LOW_STOCK_LIMIT,
} = {}) {
  const minIntervalMs = 60000 / REQUESTS_PER_MINUTE;
  let lastRequestAt = null;

  async function throttle() {
    if (lastRequestAt !== null) {
      const waitMs = minIntervalMs - (now() - lastRequestAt);
      if (waitMs > 0) await sleep(waitMs);
    }
    lastRequestAt = now();
  }

  // Returns the parsed JSON body. Error mapping mirrors pharmaoverseas.js.
  async function call(path, params) {
    await throttle();
    let res;
    try {
      res = await request(`${baseUrl}${path}`, params);
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      throw new TransientError(`Aumet network error: ${err.message}`);
    }

    const { status } = res ?? {};
    if (status === 401) throw new AuthRequiredError('Aumet returned 401');
    if (status === 403) throw new NotAuthorizedError('Aumet returned 403');
    if (status === 429) {
      throw new RateLimitedError('Aumet returned 429', retryAfterMsFrom(res.headers));
    }
    if (typeof status !== 'number' || status < 200 || status >= 300) {
      throw new TransientError(`Aumet returned ${status}`);
    }

    const text = await res.text;
    if (typeof text !== 'string') {
      throw new TransientError('Aumet returned a non-text body');
    }
    if (text.trimStart().startsWith('<')) {
      // The login page (or a challenge page) instead of JSON: stop, do not retry.
      throw new NotAuthorizedError('Aumet returned HTML instead of JSON (login page?)');
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new TransientError('Aumet returned invalid JSON');
    }
  }

  async function search(query, { page = 1, pageSize = 24 } = {}) {
    const size = clampPageSize(pageSize);
    const params = buildSearchParams(query, Math.max(1, Math.trunc(Number(page)) || 1), size);
    const body = await call('/api/products', params);
    const data = Array.isArray(body?.data) ? body.data : [];
    const total = Number(body?.totalResult ?? body?.num_found);
    const totalPages = Math.ceil((Number.isFinite(total) && total >= 0 ? total : data.length) / size);
    return {
      offers: data,
      page: params.page,
      pageSize: size,
      totalPages,
    };
  }

  async function getProduct() {
    throw new ConnectorError('Aumet does not support getProduct', 'NOT_SUPPORTED');
  }

  function toOffer(raw, { fetchedAt } = {}) {
    const missing = [];
    if (!raw || raw.id === undefined || raw.id === null || raw.id === '') {
      missing.push('id');
    }
    if (typeof raw?.unit_price !== 'number' || !Number.isFinite(raw.unit_price)) {
      missing.push('unit_price');
    }
    if (!raw?.product || typeof raw.product !== 'object') {
      missing.push('product');
    }
    if (missing.length > 0) {
      throw new SchemaDriftError(
        `Aumet product missing required fields: ${missing.join(', ')}`,
        { missing },
      );
    }

    const productName = sanitizeName(raw.product?.label?.name ?? raw.product?.label);
    if (productName === '') {
      throw new SchemaDriftError('Aumet product missing required fields: product.label', {
        missing: ['product.label'],
      });
    }

    const stock = Number(raw.stock);
    const availableQuantity = Number.isFinite(stock) ? stock : null;
    let stockStatus = 'unknown';
    if (availableQuantity !== null) {
      if (availableQuantity <= 0) stockStatus = 'out_of_stock';
      else if (availableQuantity < lowStockLimit) stockStatus = 'low';
      else stockStatus = 'in_stock';
    }

    const unitPrice = raw.unit_price;
    const bestPrice = Number(raw.best_price);
    // Price semantics unconfirmed (discovery "Unknown"): net stays null and
    // discountPct derives only from best_price vs unit_price.
    const discountPct =
      raw.best_price && unitPrice ? round2((1 - bestPrice / unitPrice) * 100) : null;

    const sellerName = sanitizeName(raw.entity?.name);

    const kept = {};
    for (const field of RAW_KEPT_FIELDS) {
      kept[field] = raw[field] ?? null;
    }

    return {
      supplierId: SUPPLIER_ID,
      supplierProductId: String(raw.id),
      sellerId: raw.entity_id === undefined || raw.entity_id === null ? null : String(raw.entity_id),
      sellerName: sellerName === '' ? null : sellerName,
      barcode: toBarcode(raw.product?.bar_code),
      productName,
      packSize: null,
      currency: 'EGP',
      unitPrice,
      publicPrice: toNonNegativeNumber(raw.retail_selling_price),
      discountPct,
      netEffectivePrice: null,
      availableQuantity,
      stockStatus,
      minimumOrderQuantity: null,
      lastUpdated: fetchedAt ?? new Date().toISOString(),
      dataSource: 'api',
      syncStatus: 'fresh',
      raw: kept,
    };
  }

  return {
    id: SUPPLIER_ID,
    displayName: 'Aumet',
    authorization: 'owner-account',
    capabilities: { search: true, getProduct: false, listCatalog: false, stock: 'quantity' },
    rateLimit: { requestsPerMinute: REQUESTS_PER_MINUTE },
    search,
    getProduct,
    toOffer,
  };
}

