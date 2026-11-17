/* NOVA Rx — N104 optional backend client. Flag novaBackend.enabled (default OFF) + novaBackend.url setting.
   OFF: zero fetches, nothing changes. ON: pushes the offline outbox (POST /api/v1/sync/push) and pulls the feed
   (GET /api/v1/sync/pull?cursor=). Any error keeps the app local; outbox entries stay queued (backoff by NovaOutbox).
   SALE-01: when ON and no (https) novaBackend.url override is set, the base URL is production nova-rx-api
   (PRODUCTION_URL). The flag is per device (localStorage); the token lives in sessionStorage only and is never logged.
   Works as <script> (window.NovaBackendClient) and in Node (module.exports). */
(function (root) {
  'use strict';
  var K_ENABLED = 'novaBackend.enabled', K_URL = 'novaBackend.url', K_CURSOR = 'novaBackend.cursor', K_FEED = 'novaBackend.feed';
  var K_TOKEN = 'novaBackend.token';
  var PRODUCTION_URL = 'https://nova-rx-api.elsousypharmacy.workers.dev';

  /* Pure resolution of the device flag: OFF => no base URL at all (callers make zero calls). ON => https override or production. */
  function resolveBaseUrl(storage) {
    var on = false, u = '';
    try { on = storage.getItem(K_ENABLED) === 'true'; } catch (e) { on = false; }
    if (!on) return '';
    try { u = String(storage.getItem(K_URL) || '').trim(); } catch (e) { u = ''; }
    if (!/^https:\/\/[^\s/]+/i.test(u)) u = PRODUCTION_URL;
    return u.replace(/\/+$/, '');
  }

  function readJson(storage, k, d) { try { var r = storage.getItem(k); return r ? JSON.parse(r) : d; } catch (e) { return d; } }

  /* deps: { storage, fetch, outbox (NovaOutbox instance), getToken(): string|null } */
  function createBackendClient(deps) {
    var storage = deps.storage, doFetch = deps.fetch, outbox = deps.outbox;
    var getToken = deps.getToken || function () { return null; };

    function enabled() { try { return storage.getItem(K_ENABLED) === 'true'; } catch (e) { return false; } }
    function baseUrl() { return resolveBaseUrl(storage); }
    function active() { return enabled() && !!baseUrl() && typeof doFetch === 'function'; }
    function setEnabled(v) { storage.setItem(K_ENABLED, v ? 'true' : 'false'); }
    function setUrl(u) { storage.setItem(K_URL, String(u || '')); }

    function headers() {
      var h = { 'Content-Type': 'application/json' }, t = getToken();
      if (t) h.Authorization = 'Bearer ' + t;
      return h;
    }

    var endpoint = {
      send: function (req) {
        var op = { key: req.key, payload: req.payload };
        if (req && req.payload && req.payload.op === 'return') { op.kind = 'ledger'; op.entity = 'sale_return'; } // S2-01: never sent as an invoice
        else if (req && req.payload && req.payload.op === 'credit') { op.kind = 'ledger'; op.entity = 'credit_move'; } // S2-05
        else if (req && req.payload && req.payload.op === 'shift') { op.kind = 'ledger'; op.entity = 'shift_close'; } // S2-06
        else if (req && req.payload && req.payload.op === 'receipt') { op.kind = 'ledger'; op.entity = 'stock_receipt'; } // S2-03
        else if (req && req.payload && req.payload.op === 'po') { op.kind = 'ledger'; op.entity = 'purchase_order'; } // S2-04
        return doFetch(baseUrl() + '/api/v1/sync/push', { method: 'POST', headers: headers(), body: JSON.stringify({ ops: [op] }) })
          .then(function (r) { if (!r.ok) return { error: 'http-' + r.status }; return r.json(); })
          .then(function (j) {
            var x = j && j.results && j.results[0];
            if (x && x.status === 'applied') return { ok: true };
            return { error: (x && x.code) || (j && j.error) || 'bad-response' };
          });
      }
    };

    function push() {
      if (!active() || !outbox) return Promise.resolve({ skipped: true });
      return outbox.sync(endpoint).catch(function (e) { return { skipped: false, error: String(e && e.message || e) }; });
    }

    function pull() {
      if (!active()) return Promise.resolve({ skipped: true, items: 0 });
      var cursor = storage.getItem(K_CURSOR) || '';
      // S1-02: the real route is GET /api/v1/sync/pull?cursor= -> { changes:[{seq,entity,id,deleted,data}], nextCursor, hasMore }.
      return doFetch(baseUrl() + '/api/v1/sync/pull?cursor=' + encodeURIComponent(cursor), { method: 'GET', headers: headers() })
        .then(function (r) { if (!r.ok) throw new Error('http-' + r.status); return r.json(); })
        .then(function (j) {
          var items = j && Array.isArray(j.changes) ? j.changes : null;
          if (!items) throw new Error('bad-response');
          var all = readJson(storage, K_FEED, []).concat(items);
          storage.setItem(K_FEED, JSON.stringify(all));
          if (j.nextCursor != null) storage.setItem(K_CURSOR, String(j.nextCursor));
          return { skipped: false, items: items.length, hasMore: !!j.hasMore };
        })
        .catch(function (e) { return { skipped: false, items: 0, error: String(e && e.message || e) }; });
    }

    function syncAll() {
      if (!active()) return Promise.resolve({ skipped: true });
      return push().then(function (p) { return pull().then(function (q) { return { skipped: false, push: p, pull: q }; }); });
    }

    return { endpoint: endpoint, enabled: enabled, baseUrl: baseUrl, setEnabled: setEnabled, setUrl: setUrl, push: push, pull: pull, syncAll: syncAll, feed: function () { return readJson(storage, K_FEED, []); } };
  }

  var api = { createBackendClient: createBackendClient, resolveBaseUrl: resolveBaseUrl, PRODUCTION_URL: PRODUCTION_URL, KEYS: { enabled: K_ENABLED, url: K_URL, token: K_TOKEN } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NovaBackendClient = api;
})(typeof window !== 'undefined' ? window : this);
