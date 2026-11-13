/* NOVA Rx — N105 local data export to a versioned JSON bundle (no DOM, no network). Pure: takes plain collections.
   Bundle shape matches backend/src/import.js. Works as <script> (window.NovaDataExport) and in Node. */
(function (root) {
  'use strict';
  var FORMAT = 'nova-rx-export', VERSION = 1;
  // spec: {master:{entity:[records]}, ledger:{entity:[records]}}; records without a string id get a stable index id.
  function build(spec, now) {
    var out = { format: FORMAT, version: VERSION, exportedAt: new Date(now || Date.now()).toISOString(), master: {}, ledger: {} };
    ['master', 'ledger'].forEach(function (kind) {
      var sec = (spec && spec[kind]) || {};
      Object.keys(sec).forEach(function (entity) {
        var rows = Array.isArray(sec[entity]) ? sec[entity] : [];
        out[kind][entity] = rows.filter(function (r) { return r && typeof r === 'object' && !Array.isArray(r); }).map(function (r, i) {
          var c = JSON.parse(JSON.stringify(r));
          if (typeof c.id !== 'string' || !c.id) c.id = entity + '-' + (c.id != null ? String(c.id) : i + 1);
          return c;
        });
      });
    });
    return out;
  }
  function serialize(bundle) { return JSON.stringify(bundle, null, 2); }
  var api = { FORMAT: FORMAT, VERSION: VERSION, build: build, serialize: serialize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NovaDataExport = api;
})(typeof window !== 'undefined' ? window : globalThis);
