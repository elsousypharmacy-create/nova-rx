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

const MSG_AUTH = 'الجلسة انتهت، سجّل دخول المورد';
const MSG_RATE = 'كتير طلبات، جرّب بعد شوية';
const MSG_DOWN = 'تعذر الاتصال';

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
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(params ?? {})) qs.set(k, String(v));
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

  async function search(query, { requestedQty = 1 } = {}) {
    const fetchedAt = new Date(now()).toISOString();
    const latin = extractLatin(query);
    const searchText = leadingSearchText(latin);
    const itemName = latin;
    const allOffers = [];

    const suppliers = await Promise.all(
      SUPPLIERS.map(async (s) => {
        const rec = await store.load(s.id);
        if (!rec) return { id: s.id, name: s.name, state: 'off' };
        holders[s.id].current = rec.session;
        const connector = conns[s.id];
        try {
          await withTimeout(
            (async () => {
              const page = await connector.search(searchText, { page: 1, pageSize: 24 });
              let drifted = 0;
              for (const rawRow of page?.offers ?? []) {
                try {
                  allOffers.push(connector.toOffer(rawRow, { fetchedAt }));
                } catch (err) {
                  if (!(err instanceof SchemaDriftError)) throw err;
                  drifted += 1;
                }
              }
              return drifted;
            })(),
            SEARCH_TIMEOUT_MS,
          );
          return { id: s.id, name: s.name, state: 'ok' };
        } catch (err) {
          return { id: s.id, name: s.name, state: 'error', message: errorMessage(err) };
        }
      }),
    );

    let result = compareForItem({ name: itemName }, allOffers, { requestedQty, now: now() });
    if (result.offers.length === 0) {
      // Brand-only matches (score 0.5) show up flagged needsReview.
      result = compareForItem({ name: itemName }, allOffers, {
        requestedQty,
        now: now(),
        minScore: FALLBACK_MIN_SCORE,
      });
    }

    return { fetchedAt, results: [result], suppliers };
  }

  return { status, search };
}
