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

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new TransientError('supplier search timed out')), ms);
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
        try {
          await withTimeout(
            (async () => {
              let drifted = 0;
              const supplierOffers = [];
              let pageNumber = 1;
              let totalPages = 1;
              do {
                const page = await connector.search(searchText, { page: pageNumber, pageSize: 24 });
                totalPages = Number.isFinite(page?.totalPages) ? page.totalPages : 1;
                for (const rawRow of page?.offers ?? []) {
                  try {
                    const offer = connector.toOffer(rawRow, { fetchedAt });
                    // Filter before storing: excluded distributors must never appear.
                    if (s.id !== 'aumet' || !Array.isArray(aumetSellerIds) ||
                        aumetSellerIds.includes(String(offer.sellerId))) {
                      supplierOffers.push(offer);
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
              return drifted;
            })(),
            s.id === 'aumet' && Array.isArray(aumetSellerIds) && aumetSellerIds.length > 0
              ? AUMET_SEARCH_TIMEOUT_MS : SEARCH_TIMEOUT_MS,
          );
          return { id: s.id, name: s.name, state: 'ok' };
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

    return { fetchedAt, results: [result], suppliers };
  }

  async function sellers() {
    const rec = await store.load('aumet');
    if (!rec) return [];
    return (rec.session.sellers || []).filter(s => s && s.id != null && typeof s.name === 'string').map(s => ({ id: String(s.id), name: s.name.slice(0, 150), locked: !!s.locked }));
  }
  return { status, search, sellers };
}

