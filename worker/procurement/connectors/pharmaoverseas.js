// PharmaOverseas connector (issue Procurement 03, epic #53).
// Talks to the supplier storefront API with the pharmacy's own account
// (OAuth token injected via getAccessToken; token acquisition is out of scope).
// Dependency-free ES module; runs in Cloudflare Workers and Node 22.
// Never logs headers, tokens or URLs.

import {
  AuthRequiredError,
  NotAuthorizedError,
  RateLimitedError,
  SchemaDriftError,
  TransientError,
} from '../connector-contract.js';
import { sanitizeName } from '../offer-schema.js';

const SUPPLIER_ID = 'pharmaoverseas';
const DEFAULT_BASE_URL = 'https://api.pharmaemarket.com/occ/v2/pharma';
const REQUESTS_PER_MINUTE = 20;
const DEFAULT_RETRY_AFTER_MS = 60000;

const STOCK_STATUS_MAP = {
  inStock: 'in_stock',
  outOfStock: 'out_of_stock',
  lowStock: 'low',
};

function round2(value) {
  return Math.round(value * 100) / 100;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampPageSize(pageSize) {
  const n = Math.trunc(Number(pageSize));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(48, n);
}

function retryAfterMsFrom(headers) {
  const raw = headers?.get?.('Retry-After');
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return DEFAULT_RETRY_AFTER_MS;
}

export function createPharmaOverseasConnector({
  fetch: fetchImpl = globalThis.fetch,
  getAccessToken = async () => {
    throw new AuthRequiredError('PharmaOverseas: no access token provider configured');
  },
  baseUrl = DEFAULT_BASE_URL,
  sleep = defaultSleep,
  now = () => Date.now(),
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

  // Returns the parsed JSON body, or null on 404 (caller decides the meaning).
  async function request(path, params) {
    await throttle();
    const token = await getAccessToken();
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    let response;
    try {
      response = await fetchImpl(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
    } catch (err) {
      throw new TransientError(`PharmaOverseas network error: ${err.message}`);
    }

    const { status } = response;
    if (status === 401) throw new AuthRequiredError('PharmaOverseas returned 401');
    if (status === 403) throw new NotAuthorizedError('PharmaOverseas returned 403');
    if (status === 429) {
      throw new RateLimitedError(
        'PharmaOverseas returned 429',
        retryAfterMsFrom(response.headers),
      );
    }
    if (status === 404) return null;
    if (status >= 500) throw new TransientError(`PharmaOverseas returned ${status}`);
    if (!response.ok) throw new TransientError(`PharmaOverseas returned ${status}`);

    const text = await response.text();
    if (text.trimStart().startsWith('<')) {
      // A CAPTCHA or login page instead of JSON: stop, do not retry.
      throw new NotAuthorizedError('PharmaOverseas returned unexpected HTML');
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new TransientError('PharmaOverseas returned invalid JSON');
    }
  }

  async function search(query, { page = 1, pageSize = 24 } = {}) {
    const size = clampPageSize(pageSize);
    const body = await request('/products/search', {
      query: String(query ?? ''),
      currentPage: Math.max(0, Math.trunc(page) - 1),
      pageSize: size,
      fields: 'FULL',
      lang: 'en',
      curr: 'EGP',
    });
    if (body === null) throw new TransientError('PharmaOverseas search returned 404');
    return {
      offers: Array.isArray(body.products) ? body.products : [],
      page,
      pageSize: size,
      totalPages: body.pagination?.totalPages ?? 1,
    };
  }

  async function getProduct(code) {
    const body = await request(`/products/${encodeURIComponent(code)}`, {
      fields: 'FULL',
      lang: 'en',
      curr: 'EGP',
    });
    return body;
  }

  function toOffer(raw, { fetchedAt } = {}) {
    const missing = [];
    if (!raw || raw.code === undefined || raw.code === null || raw.code === '') {
      missing.push('code');
    }
    if (!raw?.price || typeof raw.price.value !== 'number') {
      missing.push('price');
    }
    if (missing.length > 0) {
      throw new SchemaDriftError(
        `PharmaOverseas product missing required fields: ${missing.join(', ')}`,
        { missing },
      );
    }

    const unitPrice = raw.price.value;
    const publicPrice = raw.publicPrice?.value ?? null;
    let discountPct = null;
    if (publicPrice) {
      const pct = round2((1 - unitPrice / publicPrice) * 100);
      discountPct = pct >= 0 ? pct : null;
    }

    return {
      supplierId: SUPPLIER_ID,
      supplierProductId: raw.code,
      barcode: null,
      productName: sanitizeName(raw.name),
      packSize: null,
      currency: raw.price.currencyIso ?? 'EGP',
      unitPrice,
      publicPrice,
      discountPct,
      netEffectivePrice: unitPrice,
      availableQuantity: null,
      stockStatus: STOCK_STATUS_MAP[raw.stock?.stockLevelStatus] ?? 'unknown',
      minimumOrderQuantity: null,
      lastUpdated: fetchedAt ?? new Date().toISOString(),
      dataSource: 'api',
      syncStatus: 'fresh',
      raw: {
        price: raw.price,
        publicPrice: raw.publicPrice ?? null,
        pharmacyDiscount: raw.pharmacyDiscount ?? null,
        stock: raw.stock ?? null,
        purchasable: raw.purchasable ?? null,
      },
    };
  }

  return {
    id: SUPPLIER_ID,
    displayName: 'PharmaOverseas',
    authorization: 'owner-account',
    capabilities: { search: true, getProduct: true, listCatalog: false, stock: 'level' },
    rateLimit: { requestsPerMinute: REQUESTS_PER_MINUTE },
    search,
    getProduct,
    toOffer,
  };
}
