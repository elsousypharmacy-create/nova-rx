/* NOVA Rx — N104 optional backend client. Flag novaBackend.enabled (default OFF) + novaBackend.url setting.
   OFF: zero fetches, nothing changes. ON: pushes the offline outbox (POST /api/v1/sync/push) and pulls the feed
   (GET /api/v1/sync/feed?since=). Any error keeps the app local; outbox entries stay queued (backoff by NovaOutbox).
   Not wired to any screen. Works as <script> (window.NovaBackendClient) and in Node (module.exports). */
(function (root) {
  'use strict';
  var K_ENABLED = 'novaBackend.enabled', K_URL = 'novaBackend.url', K_CURSOR = 'novaBackend.cursor', K_FEED = 'novaBackend.feed';

  function readJson(storage, k, d) { try { var r = storage.getItem(k); return r ? JSON.parse(r) : d; } catch (e) { return d; } }

  /* deps: { storage, fetch, outbox (NovaOutbox instance), getToken(): string|null } */
  function createBackendClient(deps) {
    var storage = deps.storage, doFetch = deps.fetch, outbox = deps.outbox;
    var getToken = deps.getToken || function () { return null; };

    function enabled() { try { return storage.getItem(K_ENABLED) === 'true'; } catch (e) { return false; } }
    function baseUrl() { try { var u = storage.getItem(K_URL); return u ? String(u).replace(/\/+$/, '') : ''; } catch (e) { return ''; } }
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
        return doFetch(baseUrl() + '/api/v1/sync/push', { method: 'POST', headers: headers(), body: JSON.stringify({ ops: [{ key: req.key, payload: req.payload }] }) })
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
      return doFetch(baseUrl() + '/api/v1/sync/feed?since=' + encodeURIComponent(cursor), { method: 'GET', headers: headers() })
        .then(function (r) { if (!r.ok) throw new Error('http-' + r.status); return r.json(); })
        .then(function (j) {
          var items = j && Array.isArray(j.items) ? j.items : null;
          if (!items) throw new Error('bad-response');
          var all = readJson(storage, K_FEED, []).concat(items);
          storage.setItem(K_FEED, JSON.stringify(all));
          if (j.cursor != null) storage.setItem(K_CURSOR, String(j.cursor));
          return { skipped: false, items: items.length };
        })
        .catch(function (e) { return { skipped: false, items: 0, error: String(e && e.message || e) }; });
    }

    function syncAll() {
      if (!active()) return Promise.resolve({ skipped: true });
      return push().then(function (p) { return pull().then(function (q) { return { skipped: false, push: p, pull: q }; }); });
    }

    return { enabled: enabled, baseUrl: baseUrl, setEnabled: setEnabled, setUrl: setUrl, push: push, pull: pull, syncAll: syncAll, feed: function () { return readJson(storage, K_FEED, []); } };
  }

  var api = { createBackendClient: createBackendClient, KEYS: { enabled: K_ENABLED, url: K_URL } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NovaBackendClient = api;
})(typeof window !== 'undefined' ? window : this);
