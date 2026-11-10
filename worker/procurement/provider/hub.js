// Supplier hub (issue Procurement 10, epic #53).
// Loads encrypted sessions from the session store, fans a search out to the
// supplier connectors in parallel (8 s timeout each), converts rows to offers
// and ranks them with compareForItem. Never logs sessions, tokens or headers.
// Dependency-free ES module; runs in Cloudflare Workers and Node 22.

import {
  AuthRequiredError,
  RateLimitedError,
  SchemaDriftError,
  TransientError,
} from '../connector-contract.js';
import { createPharmaOverseasConnector } from '../connectors/pharmaoverseas.js';
import { createAumetConnector } from '../connectors/aumet.js';
import { compareForItem } from '../compare.js';
import { resolveSellerId } from './seller-id.js';

const SUPPLIERS = [
  { id: 'pharmaoverseas', name: 'PharmaOverseas' },
  { id: 'aumet', name: 'Aumet' },
];
const SEARCH_TIMEOUT_MS = 8000;
const FALLBACK_MIN_SCORE = 0.5;
const AUMET_MAX_PAGES = 12;
const AUMET_SEARCH_TIMEOUT_MS = 45000; // Safety bound; never silently claim full seller coverage.

const MSG_AUTH = 'الجلسة انتهت، سجّل دخول المورد';
const MSG_RATE = 'كتير طلبات، جرّب بعد شوية';
const MSG_DOWN = 'تعذر الاتصال';
const MSG_SCHEMA = 'شكل بيانات المورد اتغيّر؛ لا نعرض نتيجة ناقصة';
const MSG_INCOMPLETE = 'البحث في المخازن المختارة لم يكتمل؛ أخفينا النتائج بدل عرض نتيجة ناقصة';
class IncompleteSearchError extends TransientError {}

// Text inside parentheses wins when it holds Latin letters, else the query.
function extractLatin(query) {
  const q = String(query ?? '');
  const m = q.match(/\(([^()]*[A-Za-z][^()]*)\)/);
  return (m ? m[1] : q).trim();
}

// Leading letters of the first word (e.g. "Augmentin 1g" -> "Augmentin").
function leadingSearchText(latin) {
  const first = latin.split(/\s+/).find(Boolean) ?? '';
  const letters = first.replace(/[^A-Za-z]/g, '');
  return letters || latin;
}

function errorMessage(err) {
  if (err instanceof AuthRequiredError) return MSG_AUTH;
  if (err instanceof RateLimitedError) return MSG_RATE;
  if (err instanceof IncompleteSearchError) return MSG_INCOMPLETE;
  return MSG_DOWN;
}

// The timeout only stops WAITING; the work keeps running unless it checks `onTimeout`'s flag.
// Callers that page through results use it to stop issuing further upstream requests.
async function withTimeout(promise, ms, { onTimeout, makeError } = {}) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          if (onTimeout) onTimeout();
          reject(makeError ? makeError() : new TransientError('supplier search timed out'));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Default connectors bound to per-supplier session holders: the hub refreshes
// holder.current from the store right before each search.
function buildDefaultConnectors(fetchImpl, holders) {
  return {
    pharmaoverseas: createPharmaOverseasConnector({
      fetch: fetchImpl,
      getAccessToken: async () => {
        const token = holders.pharmaoverseas.current?.accessToken;
        if (!token) throw new AuthRequiredError('PharmaOverseas session has no access token');
        return token;
      },
    }),
    aumet: createAumetConnector({
      request: async (url, params) => {
        const s = holders.aumet.current ?? {};
        if (!s.searchParams || typeof s.searchTaskTemplate !== 'string' ||
            !s.searchTaskTemplate.includes('__NOVA_QUERY__')) {
          throw new AuthRequiredError('Aumet session needs search context');
        }
        const query = String(params?.spell ?? '');
        const escapedQuery = JSON.stringify(query).slice(1, -1);
        const qs = new URLSearchParams(s.searchParams);
        qs.delete('spell');
        qs.set('task', s.searchTaskTemplate.replaceAll('__NOVA_QUERY__', escapedQuery));
        qs.set('page', String(params?.page ?? 1));
        qs.set('result_per_page', String(params?.result_per_page ?? 24));
        const res = await fetchImpl(`${url}?${qs.toString()}`, {
          headers: {
            Accept: 'application/json',
            Authorization: s.authorization ?? '',
            Cookie: s.cookie ?? '',
            'X-XSRF-TOKEN': s.xsrf ?? '',
            'X-Requested-With': 'XMLHttpRequest',
            'x-user-lang': 'ar',
          },
        });
        return { status: res.status, headers: res.headers, text: res.text() };
      },
    }),
  };
}

export function createSupplierHub({
  store,
  now = () => Date.now(),
  fetch: fetchImpl = globalThis.fetch,
  connectors,
  aumetSearchTimeoutMs = AUMET_SEARCH_TIMEOUT_MS,
} = {}) {
  const holders = Object.fromEntries(SUPPLIERS.map((s) => [s.id, { current: null }]));
  const conns = connectors ?? buildDefaultConnectors(fetchImpl, holders);

  async function status() {
    const out = [];
    for (const s of SUPPLIERS) {
      const rec = await store.load(s.id, { ignoreExpiry: true });
      if (!rec) {
        out.push({ id: s.id, name: s.name, state: 'off', expiresAt: null, savedAt: null });
        continue;
      }
      const expMs = Date.parse(rec.expiresAt ?? '');
      const expired = Number.isFinite(expMs) && expMs <= now();
      out.push({
        id: s.id,
        name: s.name,
        state: expired ? 'expired' : 'ok',
        expiresAt: rec.expiresAt,
        savedAt: rec.savedAt,
      });
    }
    return out;
  }

  // aumetSellerIds: `undefined` means UNSCOPED and is only for server-internal callers keyed by a
  // signed plan (the cart adapters). Every client entry point goes through http.js, which turns a
  // missing or malformed selection into [] so it can never widen the search to all warehouses.
  async function search(query, { requestedQty = 1, supplierIds, aumetSellerIds } = {}) {
    const fetchedAt = new Date(now()).toISOString();
    const latin = extractLatin(query);
    const searchText = leadingSearchText(latin);
    const itemName = latin;
    const allOffers = [];

    const suppliers = await Promise.all(
      SUPPLIERS.filter(s => !Array.isArray(supplierIds) || supplierIds.includes(s.id)).map(async (s) => {
        const rec = await store.load(s.id);
        if (!rec) return { id: s.id, name: s.name, state: 'off' };
        holders[s.id].current = rec.session;
        const connector = conns[s.id];
        const knownSellers = (rec.session?.sellers || []).map((x) => String(x.id));
        const run = { cancelled: false };
        const scopedAumet = s.id === 'aumet' && Array.isArray(aumetSellerIds) && aumetSellerIds.length > 0;
        try {
          // Counts (numbers only) make a silent empty result diagnosable: rows read from the supplier,
          // rows that parsed, rows dropped as unreadable, and rows that survived the warehouse selection.
          const stat = await withTimeout(
            (async () => {
              let drifted = 0, rows = 0, readable = 0, matched = 0, noSeller = 0;
              const sellerSample = new Map();
              const supplierOffers = [];
              let pageNumber = 1;
              let totalPages = 1;
              do {
                // After a timeout nobody is waiting for this scan: stop spending upstream requests.
                if (run.cancelled) throw new IncompleteSearchError('Aumet seller search cancelled after timeout');
                const page = await connector.search(searchText, { page: pageNumber, pageSize: 24 });
                totalPages = Number.isFinite(page?.totalPages) ? page.totalPages : 1;
                for (const rawRow of page?.offers ?? []) {
                  rows += 1;
                  try {
                    const offer = connector.toOffer(rawRow, { fetchedAt });
                    // Rows carry the warehouse id plus a suffix; use the id the account lists (see seller-id.js).
                    if (s.id === 'aumet') offer.sellerId = resolveSellerId(offer.sellerId, knownSellers);
                    readable += 1;
                    // Diagnostic only (ids and public distributor names): what id do the rows really carry?
                    if (offer.sellerId == null) noSeller += 1;
                    else if (sellerSample.size < 6 && !sellerSample.has(String(offer.sellerId))) sellerSample.set(String(offer.sellerId), offer.sellerName ?? null);
                    // Filter before storing: excluded distributors must never appear.
                    if (s.id !== 'aumet' || !Array.isArray(aumetSellerIds) ||
                        aumetSellerIds.includes(String(offer.sellerId))) {
                      supplierOffers.push(offer);
                      matched += 1;
                    }
                  } catch (err) {
                    if (!(err instanceof SchemaDriftError)) throw err;
                    drifted += 1;
                  }
                }
                pageNumber++;
              } while (s.id === 'aumet' && Array.isArray(aumetSellerIds) &&
                       aumetSellerIds.length > 0 && pageNumber <= totalPages &&
                       pageNumber <= AUMET_MAX_PAGES);
              if (s.id === 'aumet' && Array.isArray(aumetSellerIds) &&
                  aumetSellerIds.length > 0 && pageNumber <= totalPages) {
                throw new IncompleteSearchError('Aumet seller search incomplete; pagination safety limit reached');
              }
              allOffers.push(...supplierOffers);
              return { drifted, rows, readable, matched, noSeller, sellerSample: [...sellerSample].map(([id, name]) => ({ id, name })) };
            })(),
            scopedAumet ? aumetSearchTimeoutMs : SEARCH_TIMEOUT_MS,
            scopedAumet
              ? { onTimeout: () => { run.cancelled = true; }, makeError: () => new IncompleteSearchError('Aumet seller search timed out') }
              : undefined,
          );
          const entry = { id: s.id, name: s.name, state: 'ok', rows: stat.rows, readable: stat.readable, drifted: stat.drifted, selected: stat.matched, noSeller: stat.noSeller, sellerSample: stat.sellerSample };
          // Every row unreadable is not "no offers": the supplier's data shape changed. Say so.
          if (stat.rows > 0 && stat.readable === 0) { entry.state = 'error'; entry.message = MSG_SCHEMA; }
          return entry;
        } catch (err) {
          return { id: s.id, name: s.name, state: 'error', message: errorMessage(err) };
        }
      }),
    );

    const allowedOffers=allOffers.filter(o=>o.supplierId!=='aumet'||!Array.isArray(aumetSellerIds)||aumetSellerIds.includes(String(o.sellerId)));
    let result = compareForItem({ name: itemName }, allowedOffers, { requestedQty, now: now() });
    if (result.offers.length === 0) {
      // Brand-only matches (score 0.5) show up flagged needsReview.
      result = compareForItem({ name: itemName }, allowedOffers, {
        requestedQty,
        now: now(),
        minScore: FALLBACK_MIN_SCORE,
      });
    }

    const shownBy = {};
    for (const r of result.offers) { const id = (r.offer || r).supplierId; shownBy[id] = (shownBy[id] || 0) + 1; }
    for (const sup of suppliers) if (sup.rows !== undefined) sup.shown = shownBy[sup.id] || 0;
    return { fetchedAt, results: [result], suppliers };
  }

  async function sellers() {
    const rec = await store.load('aumet');
    if (!rec) return [];
    return (rec.session.sellers || []).filter(s => s && s.id != null && typeof s.name === 'string').map(s => ({ id: String(s.id), name: s.name.slice(0, 150), locked: !!s.locked }));
  }
  return { status, search, sellers };
}

