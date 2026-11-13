/* NOVA Rx — MSG-02 local unified inbox (pure logic + HTML string, frontend/local only, NO real WhatsApp sending).
   Conversations: messages, assignee, human handoff, customer/order links. Message status sent|delivered|failed comes from a
   mock source (setStatus). State persists through an injected storage (localStorage-like) and is restored by load() after refresh.
   Works as <script> (window.NovaUnifiedInbox) and in Node. */
(function (root) {
  'use strict';
  var KEY = 'nova.inbox.v1';
  var STATUS_AR = { sent: 'أُرسلت', delivered: 'وصلت', failed: 'فشلت' };
  var MODE_AR = { bot: 'آلي', human: 'بشري' };

  function arr(a) { return Array.isArray(a) ? a : []; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* remote (optional): { enabled(): bool, baseUrl(): string, fetch, getToken() }. Off/absent => zero network calls. */
  function create(storage, remote) {
    var state = { conversations: [], seq: 0 };
    function save() { if (storage) storage.setItem(KEY, JSON.stringify(state)); }
    function load() {
      try {
        var raw = storage && storage.getItem(KEY), p = raw ? JSON.parse(raw) : null;
        if (p && Array.isArray(p.conversations)) state = { conversations: p.conversations, seq: Number(p.seq) || 0 };
      } catch (e) { /* corrupt storage: keep empty state */ }
      return api;
    }
    function conv(id) {
      for (var i = 0; i < state.conversations.length; i++) if (state.conversations[i].id === id) return state.conversations[i];
      throw new Error('unknown conversation ' + id);
    }
    function open(id, customer, now) {
      if (state.conversations.some(function (c) { return c.id === id; })) return conv(id);
      var c = { id: String(id), customer: String(customer || ''), customerId: null, orderId: null, assignee: null, mode: 'bot', messages: [], updatedAt: now || 0 };
      state.conversations.push(c); save(); return c;
    }
    function add(id, dir, text, now, status) {
      var c = conv(id), m = { id: 'm' + (++state.seq), dir: dir, text: String(text), at: now || 0, status: status || null };
      c.messages.push(m); c.updatedAt = m.at; save(); return m;
    }
    /* incoming message from the mock source; a customer message never auto-resets a human handoff */
    function receive(id, text, now) { return add(id, 'in', text, now, null); }
    /* outbound is only recorded locally as "sent"; the mock source later reports delivered/failed */
    function send(id, text, now) {
      if (!String(text || '').trim()) throw new Error('empty message');
      return add(id, 'out', text, now, 'sent');
    }
    function setStatus(id, msgId, status) {
      if (!STATUS_AR[status]) throw new Error('bad status ' + status);
      var m = conv(id).messages.filter(function (x) { return x.id === msgId && x.dir === 'out'; })[0];
      if (!m) throw new Error('unknown outbound message ' + msgId);
      m.status = status; save(); return m;
    }
    function assign(id, staff) { var c = conv(id); c.assignee = staff ? String(staff) : null; save(); return c; }
    function handoff(id, staff) { var c = conv(id); c.mode = 'human'; if (staff) c.assignee = String(staff); save(); return c; }
    function link(id, links) {
      var c = conv(id); links = links || {};
      if ('customerId' in links) c.customerId = links.customerId == null ? null : String(links.customerId);
      if ('orderId' in links) c.orderId = links.orderId == null ? null : String(links.orderId);
      save(); return c;
    }
    function list(filter) {
      filter = filter || {};
      return clone(state.conversations).filter(function (c) {
        return (!filter.assignee || c.assignee === filter.assignee) && (!filter.mode || c.mode === filter.mode);
      }).sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    }
    /* With the flag on, read conversations from the server API and mirror them locally; any error keeps the local state. */
    function pullRemote() {
      var on = false;
      try { on = !!(remote && remote.enabled() && remote.baseUrl() && typeof remote.fetch === 'function'); } catch (e) { on = false; }
      if (!on) return Promise.resolve({ skipped: true });
      var t = remote.getToken ? remote.getToken() : null, h = { Accept: 'application/json' };
      if (t) h.Authorization = 'Bearer ' + t;
      return Promise.resolve().then(function () { return remote.fetch(String(remote.baseUrl()).replace(/\/+$/, '') + '/api/v1/inbox/conversations', { method: 'GET', headers: h }); })
        .then(function (r) { if (!r.ok) throw new Error('http-' + r.status); return r.json(); })
        .then(function (j) {
          if (!j || !Array.isArray(j.conversations)) throw new Error('bad-response');
          state.conversations = j.conversations; save();
          return { skipped: false, count: j.conversations.length };
        })
        .catch(function (e) { return { skipped: false, error: String((e && e.message) || e) }; });
    }
    var api = { pullRemote: pullRemote, load: load, open: open, receive: receive, send: send, setStatus: setStatus, assign: assign, handoff: handoff, link: link, list: list,
      get: function (id) { return clone(conv(id)); } };
    return api;
  }

  var CSS = '.nova-inbox{direction:rtl;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px}' +
    '.nova-inbox .c{border:1px solid #444;border-radius:8px;padding:8px;min-width:0;overflow-wrap:anywhere}' +
    '.nova-inbox .m{margin:4px 0;padding:4px 8px;border-radius:6px}.nova-inbox .m[data-dir=out]{background:#1d2a1d}.nova-inbox .m[data-status=failed]{border:1px solid #c33}';

  function render(convs) {
    return '<style>' + CSS + '</style><div class="nova-inbox" dir="rtl">' + arr(convs).map(function (c) {
      return '<section class="c" data-conv="' + esc(c.id) + '" data-mode="' + esc(c.mode) + '"><h3>' + esc(c.customer) + '</h3>' +
        '<small>' + (c.assignee ? 'المسؤول: ' + esc(c.assignee) : 'غير معيّن') + ' · ' + MODE_AR[c.mode] +
        (c.customerId ? ' · عميل ' + esc(c.customerId) : '') + (c.orderId ? ' · طلب ' + esc(c.orderId) : '') + '</small>' +
        arr(c.messages).map(function (m) {
          return '<div class="m" data-dir="' + esc(m.dir) + '"' + (m.status ? ' data-status="' + esc(m.status) + '"' : '') + '>' + esc(m.text) +
            (m.status ? ' <small>' + STATUS_AR[m.status] + '</small>' : '') + '</div>';
        }).join('') + '</section>';
    }).join('') + '</div>';
  }

  var api = { create: create, render: render, KEY: KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaUnifiedInbox = api;
})(typeof window !== 'undefined' ? window : globalThis);
