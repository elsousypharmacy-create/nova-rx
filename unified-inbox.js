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
    /* UX200: additive, idempotent history import. rows: [{conv, customer?, id, dir:'in'|'out', text, at, status?}] (at = ms).
       A message whose id already exists is skipped; nothing is ever removed or overwritten. Never sends anything. */
    function importHistory(rows) {
      var added = 0, skipped = 0, seen = {};
      state.conversations.forEach(function (c) { c.messages.forEach(function (m) { seen[c.id + '\u0001' + m.id] = 1; }); });
      arr(rows).forEach(function (r) {
        if (!r || r.conv == null || r.id == null || !String(r.text == null ? '' : r.text).length) { skipped++; return; }
        var cid = String(r.conv), k = cid + '\u0001' + String(r.id);
        if (seen[k]) { skipped++; return; }
        var c = state.conversations.filter(function (x) { return x.id === cid; })[0];
        if (!c) { c = { id: cid, customer: String(r.customer || cid), customerId: null, orderId: null, assignee: null, mode: 'bot', messages: [], updatedAt: 0 }; state.conversations.push(c); }
        else if (r.customer && (!c.customer || c.customer === c.id)) c.customer = String(r.customer);
        var m = { id: String(r.id), dir: r.dir === 'out' ? 'out' : 'in', text: String(r.text), at: Number(r.at) || 0, status: r.dir === 'out' ? (STATUS_AR[r.status] ? r.status : 'delivered') : null };
        var i = c.messages.length; while (i > 0 && c.messages[i - 1].at > m.at) i--;
        c.messages.splice(i, 0, m); seen[k] = 1; added++;
        if (m.at > c.updatedAt) c.updatedAt = m.at;
      });
      if (added) save();
      return { added: added, skipped: skipped };
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
    var api = { pullRemote: pullRemote, importHistory: importHistory, load: load, open: open, receive: receive, send: send, setStatus: setStatus, assign: assign, handoff: handoff, link: link, list: list,
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

  /* ---- UX200: WhatsApp Web layout (pure HTML strings, RTL). The composer is a disabled draft unless sendEnabled. ---- */
  var DAY = 86400000;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayStart(t) { var d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
  function timeLabel(t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  var WEEKDAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  function dateLabel(t, now) {
    var diff = Math.round((dayStart(now) - dayStart(t)) / DAY);
    if (diff === 0) return 'اليوم';
    if (diff === 1) return 'أمس';
    var d = new Date(t);
    if (diff >= 2 && diff <= 6) return WEEKDAYS_AR[d.getDay()];
    try { return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()); }
  }
  /* unread = trailing incoming messages after the last outgoing one */
  function unreadCount(c) { var n = 0, m = arr(c && c.messages); for (var i = m.length - 1; i >= 0 && m[i].dir === 'in'; i--) n++; return n; }
  function totalUnread(cs) { return arr(cs).reduce(function (a, c) { return a + (unreadCount(c) > 0 ? 1 : 0); }, 0); }
  function tick(m) {
    if (m.dir !== 'out') return '';
    if (m.status === 'failed') return '<span class="wa-tick failed" data-tick="failed">!</span>';
    if (m.status === 'sent') return '<span class="wa-tick sent" data-tick="sent">✓</span>';
    return '<span class="wa-tick ' + (m.status === 'delivered' ? 'delivered' : 'read') + '" data-tick="' + esc(m.status || 'delivered') + '">✓✓</span>';
  }
  function initial(name) { var s = String(name || '').trim(); return s ? Array.from(s)[0] : '؟'; }
  function bubbles(msgs, now) {
    var out = '', last = null;
    arr(msgs).forEach(function (m) {
      var ds = dayStart(m.at);
      if (ds !== last) { last = ds; out += '<div class="wa-date" data-date-sep><span>' + esc(dateLabel(m.at, now)) + '</span></div>'; }
      out += '<div class="wa-msg wa-' + (m.dir === 'out' ? 'out' : 'in') + '" data-dir="' + esc(m.dir) + '" data-mid="' + esc(m.id) + '"><div class="wa-bubble" dir="auto">' +
        '<span class="wa-text">' + esc(m.text) + '</span><span class="wa-meta"><span class="wa-time">' + timeLabel(m.at) + '</span>' + tick(m) + '</span></div></div>';
    });
    return out;
  }
  var WA_CSS = '.wa-root{direction:rtl;display:flex;height:calc(100vh - 120px);min-height:420px;background:#0d0f12;color:#f2f3f5;border:1px solid #2a313a;font-family:system-ui,"Segoe UI",Tahoma,sans-serif;border-radius:8px;overflow:hidden}' +
    '.wa-side{width:30%;min-width:280px;max-width:420px;background:#14171c;border-inline-start:1px solid #2a313a;display:flex;flex-direction:column}' +
    '.wa-side-head,.wa-head{height:59px;box-sizing:border-box;background:#1a1e24;display:flex;align-items:center;gap:12px;padding:0 16px;font-weight:600}' +
    '.wa-search{padding:8px 12px;background:#14171c;position:relative}.wa-search input::-webkit-search-cancel-button{display:none}.wa-sclear{position:absolute;inset-inline-end:20px;top:50%;transform:translateY(-50%);width:28px;height:28px;border:0;border-radius:50%;background:#26303a;color:#f2f3f5;font-size:18px;line-height:1;cursor:pointer;padding:0}.wa-sclear[hidden]{display:none}.wa-sclear:focus-visible{outline:2px solid #79c9eb}.wa-search input{width:100%;box-sizing:border-box;height:35px;border:0;border-radius:10px;background:#0d0f12;color:#f2f3f5;border:1px solid #2a313a;padding:0 14px;font:inherit;font-size:14px}.wa-search input::placeholder,.wa-composer input::placeholder{color:#9eacb9}' +
    '.wa-list{flex:1;overflow:auto}.wa-chat{display:flex;align-items:center;gap:13px;padding:0 15px;height:72px;cursor:pointer;border-bottom:1px solid #232a32;background:#14171c;width:100%;text-align:start;border-top:0;border-inline:0;font:inherit;color:inherit}' +
    '.wa-chat:hover,.wa-chat.active{background:#1f252c}.wa-avatar{flex:none;width:49px;height:49px;border-radius:50%;background:#26303a;color:#cfd8df;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:600}' +
    '.wa-chat-body{flex:1;min-width:0}.wa-row{display:flex;justify-content:space-between;align-items:center;gap:8px}.wa-name{font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.wa-ctime{font-size:12px;color:#9eacb9;flex:none}.wa-chat.unread .wa-ctime{color:#25d366}.wa-preview{font-size:14px;color:#9eacb9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.wa-badge{flex:none;min-width:20px;height:20px;padding:0 6px;box-sizing:border-box;border-radius:10px;background:#25d366;color:#06210f;font-size:12px;font-weight:700;text-align:center;line-height:20px}' +
    '.wa-main{flex:1;display:flex;flex-direction:column;min-width:0;background:#0f1115;position:relative}' +
    '.wa-older{align-self:center;flex:none;min-height:36px;margin:6px 0;padding:0 16px;border:1px solid #2a313a;border-radius:18px;background:#1a1e24;color:#79c9eb;font:inherit;font-size:13px;cursor:pointer}' +
    '.wa-tolatest{position:absolute;inset-inline-start:16px;bottom:78px;z-index:2;min-height:40px;padding:0 14px;border:1px solid #2a313a;border-radius:20px;background:#0b7a63;color:#fff;font:inherit;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.5)}.wa-tolatest[hidden]{display:none}' +
    '.wa-head{background:#1a1e24;border-bottom:1px solid #2a313a}.wa-back{display:none;border:0;background:none;font-size:22px;cursor:pointer;color:#cfd8df}' +
    '.wa-msgs{flex:1;overflow:auto;padding:12px 7%;display:flex;flex-direction:column;gap:3px}.wa-date{text-align:center;margin:10px 0;position:sticky;top:6px;z-index:2;pointer-events:none}.wa-date span{background:rgba(26,30,36,.72);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:#b5c0ca;font-size:12.5px;padding:5px 12px;border-radius:10px;border:1px solid #2a313a}' +
    '.wa-msg{display:flex}.wa-msg.wa-in{justify-content:flex-start}.wa-msg.wa-out{justify-content:flex-end}' +
    '.wa-bubble{position:relative;max-width:65%;padding:6px 9px 8px;border-radius:10px;font-size:14.2px;line-height:19px;color:#f2f3f5;overflow-wrap:anywhere;white-space:pre-wrap}' +
    '.wa-in .wa-bubble{background:#1f252c;border-top-left-radius:0}.wa-out .wa-bubble{background:#0f4a3c;border-top-right-radius:0}' +
    '.wa-in .wa-bubble:before{content:"";position:absolute;top:0;left:-8px;border:8px solid transparent;border-top-color:#1f252c;border-right-color:#1f252c}' +
    '.wa-out .wa-bubble:before{content:"";position:absolute;top:0;right:-8px;border:8px solid transparent;border-top-color:#0f4a3c;border-left-color:#0f4a3c}' +
    '.wa-meta{float:left;margin:6px 8px -4px 0;font-size:11px;color:#b5c0ca;display:inline-flex;gap:3px;direction:ltr}.wa-tick{color:#b5c0ca}.wa-tick.read{color:#53bdeb}.wa-tick.failed{color:#ff9a9a;font-weight:700}' +
    '.wa-composer{min-height:62px;box-sizing:border-box;background:#1a1e24;border-top:1px solid #2a313a;display:flex;align-items:center;gap:10px;padding:10px 16px}.wa-composer input{flex:1;height:42px;border:1px solid #2a313a;border-radius:10px;padding:0 14px;font:inherit;font-size:15px;background:#0d0f12;color:#f2f3f5}' +
    '.wa-composer input:disabled{background:#14171c;color:#9eacb9;cursor:not-allowed}.wa-send{width:42px;height:42px;border:0;border-radius:50%;background:#0b7a63;color:#fff;font-size:18px;cursor:pointer}.wa-send:disabled{background:#2a313a;color:#9eacb9;cursor:not-allowed}' +
    '.wa-empty{margin:auto;color:#b5c0ca;text-align:center;padding:24px;display:flex;flex-direction:column;align-items:center;gap:12px;font-size:16px}.wa-empty svg{color:#76b8d5;opacity:.9}.wa-note{font-size:12px;color:#9eacb9;text-align:center;padding:4px}' +
    '@media(max-width:700px){.wa-side{width:100%;max-width:none}.wa-root[data-view=chat] .wa-side{display:none}.wa-root[data-view=list] .wa-main{display:none}.wa-back{display:inline-block}.wa-bubble{max-width:85%}.wa-msgs{padding:10px 4%}}';

  /* UX236: Arabic-insensitive search key: tashkeel/tatweel removed, hamza/alef forms, ya/alef-maqsura, ta-marbuta, Arabic-Indic digits folded */
  function normAr(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '')
      .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627').replace(/\u0649/g, '\u064A').replace(/\u0629/g, '\u0647')
      .replace(/\u0624/g, '\u0648').replace(/\u0626/g, '\u064A')
      .replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x660); })
      .replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x6F0); });
  }
  function convHit(c, nq) {
    if (normAr(String(c.customer || '') + ' ' + c.id).indexOf(nq) >= 0) return { found: true, msg: null };
    var ms = arr(c.messages);
    for (var i = ms.length - 1; i >= 0; i--) if (normAr(ms[i].text).indexOf(nq) >= 0) return { found: true, msg: ms[i] };
    return { found: false, msg: null };
  }
  function chatListHtml(convs, selId, q, now) {
    var rawQ = String(q || '').trim(), nq = normAr(rawQ), hits = {};
    var items = arr(convs).filter(function (c) { if (!nq) return true; var h = convHit(c, nq); hits[c.id] = h.msg; return h.found; })
      .sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    if (!items.length) return rawQ ? '<div class="wa-empty" data-wa-noresult>\u0644\u0627 \u0646\u062a\u0627\u0626\u062c \u0644\u0640 \u201c' + esc(rawQ) + '\u201d</div>' : '<div class="wa-empty">\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u062d\u0627\u062f\u062b\u0627\u062a</div>';
    return items.map(function (c) {
      var ms = arr(c.messages), last = ms[ms.length - 1], u = unreadCount(c), name = c.customer || c.id, pv = hits[c.id] || last;
      return '<button type="button" class="wa-chat' + (c.id === selId ? ' active' : '') + (u ? ' unread' : '') + '" data-conv="' + esc(c.id) + '">' +
        '<span class="wa-avatar" aria-hidden="true">' + esc(initial(name)) + '</span><span class="wa-chat-body"><span class="wa-row"><span class="wa-name">' + esc(name) + '</span>' +
        '<span class="wa-ctime">' + (last ? esc(dateLabel(last.at, now) === 'اليوم' ? timeLabel(last.at) : dateLabel(last.at, now)) : '') + '</span></span>' +
        '<span class="wa-row"><span class="wa-preview">' + (pv ? (pv.dir === 'out' ? tick(pv) + ' ' : '') + esc(pv.text) : '') + '</span>' +
        (u ? '<span class="wa-badge" data-unread="' + u + '">' + (u > 99 ? '99+' : u) + '</span>' : '') + '</span></span></button>';
    }).join('');
  }
  /* opts: { selected, query, now, sendEnabled } */
  function renderWa(convs, opts) {
    opts = opts || {}; var now = opts.now || Date.now(), sel = null;
    arr(convs).forEach(function (c) { if (c.id === opts.selected) sel = c; });
    var name = sel ? (sel.customer || sel.id) : '';
    var allMs = sel ? arr(sel.messages) : [], lim = Math.max(1, Number(opts.limit) || 80), hid = Math.max(0, allMs.length - lim);
    var main = sel
      ? '<div class="wa-head"><button type="button" class="wa-back" data-wa-back aria-label="رجوع">›</button><span class="wa-avatar" aria-hidden="true">' + esc(initial(name)) + '</span><span>' + esc(name) + '</span></div>' +
        '<div class="wa-msgs" id="waMsgs">' + (hid ? '<button type="button" class="wa-older" data-wa-older>رسائل أقدم (' + hid + ')</button>' : '') + bubbles(hid ? allMs.slice(hid) : sel.messages, now) + '</div>' +
        '<button type="button" class="wa-tolatest" data-wa-latest hidden aria-label="انزل للأحدث">⌄ انزل للأحدث</button>'
      : '<div class="wa-empty"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg><span>اختر محادثة لعرضها</span></div>';
    var en = !!opts.sendEnabled;
    return '<style>' + WA_CSS + '</style><div class="wa-root" dir="rtl" data-wa-root data-view="' + (sel ? 'chat' : 'list') + '">' +
      '<aside class="wa-side"><div class="wa-side-head">المحادثات</div><div class="wa-search"><input type="search" id="waSearch" placeholder="ابحث أو ابدأ محادثة جديدة" value="' + esc(opts.query || '') + '" autocomplete="off"><button type="button" class="wa-sclear" id="waSearchClear" data-wa-sclear aria-label="\u0645\u0633\u062d \u0627\u0644\u0628\u062d\u062b"' + (opts.query ? '' : ' hidden') + '>\u00d7</button></div>' +
      '<div class="wa-list" id="waList">' + chatListHtml(convs, opts.selected, opts.query, now) + '</div></aside>' +
      '<section class="wa-main">' + main + (sel ? '<form class="wa-composer" id="waComposer"><input type="text" id="waInput" dir="auto" placeholder="' + (en ? 'اكتب رسالة' : 'مسودة فقط — الإرسال متوقف') + '"' + (en ? '' : ' disabled') + '><button type="submit" class="wa-send" aria-label="إرسال"' + (en ? '' : ' disabled') + '>➤</button></form>' : '') + '</section></div>';
  }

  var api = { normAr: normAr, create: create, render: render, renderWa: renderWa, chatListHtml: chatListHtml, bubbles: bubbles, dateLabel: dateLabel, unreadCount: unreadCount, totalUnread: totalUnread, KEY: KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaUnifiedInbox = api;
})(typeof window !== 'undefined' ? window : globalThis);
