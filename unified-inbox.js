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
  function unreadCount(c) { if (c && c.history) return 0; var n = 0, m = arr(c && c.messages); for (var i = m.length - 1; i >= 0 && m[i].dir === 'in'; i--) n++; return n; }
  function totalUnread(cs) { return arr(cs).reduce(function (a, c) { return a + (unreadCount(c) > 0 ? 1 : 0); }, 0); }
  function tick(m) {
    if (m.dir !== 'out') return '';
    if (m.status === 'failed') return '<span class="wa-tick failed" data-tick="failed">!</span>';
    if (m.status === 'sending') return '<span class="wa-tick sending" data-tick="sending" aria-label="جاري الإرسال">🕓</span>';
    if (m.status === 'sent') return '<span class="wa-tick sent" data-tick="sent">✓</span>';
    return '<span class="wa-tick ' + (m.status === 'delivered' ? 'delivered' : 'read') + '" data-tick="' + esc(m.status || 'delivered') + '">✓✓</span>';
  }
  function initial(name) { var s = String(name || '').trim(); return s ? Array.from(s)[0] : '؟'; }
  /* UX404: WhatsApp bubble anatomy. The first bubble of a same-direction run gets a tail (wa-first). The time + ticks sit in an
     absolutely placed end slot (wa-meta) and an invisible inline spacer (wa-gap) reserves that room at the end of the last text
     line, so the time never covers glyphs (Arabic, LTR "Bottest off", mixed). The DOM is windowed by the caller (latest 80,
     older batches on scroll-up); rows are layout-contained so a new bubble never relayouts the rest of the thread. */
  /* UX405: incoming WhatsApp media like WhatsApp. mopts = { url(id) -> media URL or '', fail: { <message id>: 1 } }.
     image/sticker -> thumbnail (tap = fullscreen lightbox), audio/video -> native players, document -> chip (open/download).
     Without cached bytes (too_large / fetch_failed / KV miss / load error) a clear Arabic fallback replaces the media. */
  var MT_AR = { image: 'صورة', sticker: 'ملصق', audio: 'رسالة صوتية', video: 'فيديو', document: 'مستند' };
  var MISS_AR = { too_large: 'الملف أكبر من 5 ميجا ومش متاح هنا — افتحه من واتساب على الموبايل', fetch_failed: 'تعذّر تحميل الملف من واتساب — افتحه من واتساب على الموبايل' };
  var IC_M = {
    image: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/></svg>',
    audio: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    video: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/></svg>',
    document: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>'
  };
  IC_M.sticker = IC_M.image;
  function fmtSize(n) { n = Number(n); if (!(n > 0)) return ''; return n >= 1048576 ? (Math.round(n / 104857.6) / 10) + ' ميجا' : Math.max(1, Math.round(n / 1024)) + ' ك.ب'; }
  function mediaMiss(type, reason, filename) {
    var t = MT_AR[type] ? type : 'document';
    return '<div class="wa-media wa-mmiss" data-wa-media="' + t + '" data-wa-media-miss data-reason="' + esc(reason || 'missing') + '" role="note">' +
      '<span class="wa-mic">' + IC_M[t] + '</span><span class="wa-mmiss-t"><b>' + esc(t === 'document' && filename ? filename : MT_AR[t]) + '</b><span>' + esc(MISS_AR[reason] || 'الملف مش متاح هنا دلوقتي — افتحه من واتساب على الموبايل') + '</span></span></div>';
  }
  function mediaHtml(m, mopts) {
    var md = m && m.media, t = md && MT_AR[md.type] ? md.type : null;
    if (!t) return '';
    var src = md.cached && !md.skipped && mopts && typeof mopts.url === 'function' && !(mopts.fail && mopts.fail[m.id]) ? String(mopts.url(m.id) || '') : '';
    if (!src) return mediaMiss(t, md.skipped || (md.cached ? 'error' : 'missing'), md.filename);
    var a = ' data-wa-mid="' + esc(m.id) + '"';
    if (t === 'image' || t === 'sticker') return '<button type="button" class="wa-media wa-m-' + t + '" data-wa-media="' + t + '" data-wa-media-open="' + esc(src) + '"' + a + ' aria-label="عرض ال' + MT_AR[t] + ' بالحجم الكامل"><img class="wa-mimg" data-wa-mimg' + a + ' src="' + esc(src) + '" alt="' + MT_AR[t] + ' من العميل" loading="lazy" decoding="async"></button>';
    if (t === 'audio') return '<div class="wa-media wa-m-audio" data-wa-media="audio"><span class="wa-mic">' + IC_M.audio + '</span><audio class="wa-maudio" data-wa-mplay' + a + ' controls preload="none" src="' + esc(src) + '" aria-label="رسالة صوتية من العميل"></audio></div>';
    if (t === 'video') return '<div class="wa-media wa-m-video" data-wa-media="video"><video class="wa-mvideo" data-wa-mplay' + a + ' controls playsinline preload="metadata" src="' + esc(src) + '" aria-label="فيديو من العميل"></video></div>';
    var fn = md.filename || 'مستند', sz = fmtSize(md.size);
    return '<a class="wa-media wa-mdoc" data-wa-media="document" href="' + esc(src) + '" target="_blank" rel="noopener noreferrer" download="' + esc(fn) + '" aria-label="فتح المستند ' + esc(fn) + '"><span class="wa-mic">' + IC_M.document + '</span><span class="wa-mdoc-t"><b dir="auto">' + esc(fn) + '</b><span>' + esc([sz, 'اضغط للفتح أو التحميل'].filter(Boolean).join(' · ')) + '</span></span></a>';
  }
  /* list preview: "صورة · caption" instead of the raw "[صورة] caption" placeholder */
  function previewText(m) {
    var md = m && m.media;
    if (!md || !MT_AR[md.type]) return m ? m.text : '';
    var cap = md.caption || (md.type === 'document' ? md.filename : '');
    return MT_AR[md.type] + (cap ? ' · ' + cap : '');
  }
  function bubbles(msgs, now, mopts) {
    var out = '', last = null, prev = null;
    arr(msgs).forEach(function (m) {
      var ds = dayStart(m.at);
      if (ds !== last) { last = ds; prev = null; out += '<div class="wa-date" data-date-sep><span>' + esc(dateLabel(m.at, now)) + '</span></div>'; }
      if (m.kind === 'sys') { prev = null; out += '<div class="wa-sys" data-mid="' + esc(m.id) + '" data-kind="sys"><span dir="auto">' + esc(m.text) + ' · ' + timeLabel(m.at) + '</span></div>'; return; }
      var who = m.kind === 'bot' ? '<span class="wa-who wa-who-bot">البوت</span>' : m.kind === 'pharm' ? '<span class="wa-who wa-who-ph">الصيدلي</span>' : '';
      var d = m.dir === 'out' ? 'out' : 'in', first = prev !== d; prev = d;
      var mh = mediaHtml(m, mopts), txt = mh ? (m.media.caption || '') : m.text;
      out += '<div class="wa-msg wa-' + d + (first ? ' wa-first' : '') + '" data-dir="' + esc(m.dir) + '" data-mid="' + esc(m.id) + '"' + (m.kind ? ' data-kind="' + esc(m.kind) + '"' : '') + (m.status ? ' data-status="' + esc(m.status) + '"' : '') + (mh ? ' data-media="' + esc(m.media.type) + '"' : '') + '><div class="wa-bubble' + (mh ? ' wa-has-media' + (txt ? '' : ' wa-media-only' + (/class="wa-media wa-m-(image|sticker|video)"/.test(mh) ? ' wa-mo-ov' : '')) : '') + '" dir="auto">' + who + mh +
        (mh && !txt ? '' : (mh ? '<span class="wa-cap">' : '') + '<span class="wa-text">' + esc(txt) + '</span><span class="wa-gap" aria-hidden="true"></span>' + (mh ? '</span>' : '')) + '<span class="wa-meta"><span class="wa-time">' + timeLabel(m.at) + '</span>' + tick(m) + '</span></div></div>';
    });
    return out;
  }
  /* UX405: fullscreen viewer (tap image/sticker). Close: X, Esc, tap the backdrop, or swipe down. Zoom: pinch (touch-action),
     double-tap / double-click toggles 2.5x, wheel zooms. Focus moves to the close button and returns to the thumbnail. */
  function openLightbox(doc, src, back) {
    if (!doc || !src) return null;
    var old = doc.querySelector('[data-wa-lightbox]'); if (old && old.parentNode) old.parentNode.removeChild(old);
    var lb = doc.createElement('div');
    lb.className = 'wa-lb'; lb.setAttribute('data-wa-lightbox', ''); lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true'); lb.setAttribute('aria-label', 'عرض الصورة'); lb.dir = 'rtl';
    lb.innerHTML = '<style>' + LB_CSS + '</style><div class="wa-lb-bar"><button type="button" class="wa-lb-x" data-wa-lb-close aria-label="إغلاق">' +
      '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '<a class="wa-lb-dl" data-wa-lb-dl href="' + esc(src) + '" target="_blank" rel="noopener noreferrer" download aria-label="تحميل الصورة"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg></a></div>' +
      '<div class="wa-lb-stage" data-wa-lb-stage><img class="wa-lb-img" data-wa-lb-img src="' + esc(src) + '" alt="صورة من العميل بالحجم الكامل"></div>';
    (doc.body || doc.documentElement).appendChild(lb);
    var img = lb.querySelector('[data-wa-lb-img]'), z = 1, y0 = null, dy = 0, lastTap = 0;
    function setZ(v) { z = v; img.style.transform = z > 1 ? 'scale(' + z + ')' : ''; lb.dataset.zoom = z > 1 ? '1' : '0'; }
    function close() { if (!lb.parentNode) return; lb.parentNode.removeChild(lb); doc.removeEventListener('keydown', key, true); if (back && back.focus) try { back.focus(); } catch (e) {} }
    function key(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'Tab') { e.preventDefault(); var f = lb.querySelectorAll('button,a'), i = Array.prototype.indexOf.call(f, doc.activeElement); f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus(); } }
    doc.addEventListener('keydown', key, true);
    lb.addEventListener('click', function (e) { if (e.target.closest('[data-wa-lb-close]') || (e.target === lb.querySelector('[data-wa-lb-stage]') && z === 1)) close(); });
    img.addEventListener('dblclick', function () { setZ(z > 1 ? 1 : 2.5); });
    lb.addEventListener('wheel', function (e) { e.preventDefault(); setZ(Math.min(4, Math.max(1, z * (e.deltaY < 0 ? 1.2 : 1 / 1.2)))); }, { passive: false });
    lb.addEventListener('touchstart', function (e) { if (e.touches.length === 1) { var t = Date.now(); if (t - lastTap < 300) { setZ(z > 1 ? 1 : 2.5); lastTap = 0; } else lastTap = t; y0 = z === 1 ? e.touches[0].clientY : null; dy = 0; } else y0 = null; }, { passive: true });
    lb.addEventListener('touchmove', function (e) { if (y0 === null || e.touches.length !== 1) return; dy = Math.max(0, e.touches[0].clientY - y0); img.style.transform = 'translateY(' + dy + 'px)'; lb.style.opacity = String(Math.max(0.4, 1 - dy / 400)); }, { passive: true });
    lb.addEventListener('touchend', function () { if (y0 === null) return; y0 = null; if (dy > 90) close(); else { img.style.transform = ''; lb.style.opacity = ''; } dy = 0; });
    var x = lb.querySelector('[data-wa-lb-close]'); if (x) x.focus();
    return { el: lb, close: close };
  }
  /* UX400b: chat wallpaper = faint pharmacy doodle tile (inline SVG, no network), like the WhatsApp Web dark wallpaper */
  var WP_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><g fill="none" stroke="#c8d3dc" stroke-opacity=".045" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="14" y="20" width="40" height="16" rx="8" transform="rotate(-30 34 28)"/><path d="M34 20v16" transform="rotate(-30 34 28)"/><path d="M126 18v20M116 28h20"/>' +
    '<path d="M150 112a16 16 0 1 1-7.5-13.6L152 96l-2.2 8.2z"/><circle cx="44" cy="128" r="7"/><circle cx="58" cy="142" r="3"/><path d="M82 74l10 10m0-10l-10 10"/>' +
    '<rect x="96" y="146" width="24" height="18" rx="4"/><path d="M100 146v-4h16v4"/><path d="M20 80c6-8 14-8 20 0s14 8 20 0"/></g></svg>';
  var WP = 'url("data:image/svg+xml,' + encodeURIComponent(WP_SVG) + '")';
  var WA_CSS = '.wa-chat-loading{display:flex;flex-direction:column;gap:8px;padding:8px 4px;min-height:200px}.wa-chat-loading-txt{color:#9aa4b0;font-size:14px;text-align:center}.wa-sk{display:block;height:36px;width:55%;border-radius:10px;background:#1b2027;animation:waSk 1.2s ease-in-out infinite}.wa-sk-in{align-self:flex-start}.wa-sk-out{align-self:flex-end;width:45%}.wa-sk.w2{width:35%}@keyframes waSk{50%{opacity:.4}}@media(prefers-reduced-motion:reduce){.wa-sk{animation:none}}.wa-chat-err{display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;margin:8px;padding:10px;border:1px solid #b91c1c;border-radius:8px;color:#f2f3f5}.wa-chat-err button{min-height:44px;padding:0 14px;border-radius:8px;border:1px solid #2a313a;background:#161a20;color:#f2f3f5;cursor:pointer}' +
    '#novaInboxView{display:flex;flex-direction:column}#novaInboxView[hidden]{display:none}#novaInboxView>*{flex:0 0 auto}#novaInboxView>.wa-root{flex:1 1 auto}.wa-root{direction:rtl;display:flex;height:auto;min-height:min(420px,70dvh);background:#0d0f12;color:#f2f3f5;border:1px solid #2a313a;font-family:system-ui,"Segoe UI",Tahoma,sans-serif;border-radius:8px;overflow:hidden}' +
    '.wa-side{width:30%;min-width:280px;max-width:420px;background:#14171c;border-inline-start:1px solid #2a313a;display:flex;flex-direction:column}' +
    '.wa-side-head{margin:0;font-size:inherit}.wa-msgs:focus-visible,.wa-chat:focus-visible,.wa-back:focus-visible{outline:2px solid #79c9eb;outline-offset:-2px}.wa-side-head,.wa-head{height:59px;box-sizing:border-box;background:#1a1e24;display:flex;align-items:center;gap:12px;padding:0 16px;font-weight:600}' +
    '.wa-search{padding:8px 12px;background:#14171c;position:relative}.wa-search input::-webkit-search-cancel-button{display:none}.wa-sclear{position:absolute;inset-inline-end:20px;top:50%;transform:translateY(-50%);width:28px;height:28px;border:0;border-radius:50%;background:#26303a;color:#f2f3f5;font-size:18px;line-height:1;cursor:pointer;padding:0}.wa-sclear[hidden]{display:none}.wa-sclear:focus-visible{outline:2px solid #79c9eb}.wa-search input{width:100%;box-sizing:border-box;height:35px;border:0;border-radius:10px;background:#0d0f12;color:#f2f3f5;border:1px solid #2a313a;padding:0 14px;font:inherit;font-size:14px}.wa-search input::placeholder,.wa-composer input::placeholder{color:#9eacb9}' +
    '.wa-list{flex:1;overflow:auto}.wa-chat{display:flex;align-items:center;gap:13px;padding:0 15px;height:72px;cursor:pointer;border-bottom:1px solid #232a32;background:#14171c;width:100%;text-align:start;border-top:0;border-inline:0;font:inherit;color:inherit}' +
    '.wa-chat:hover,.wa-chat.active{background:#1f252c}.wa-avatar{flex:none;width:49px;height:49px;border-radius:50%;background:#26303a;color:#cfd8df;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:600}' +
    '.wa-chat-body{flex:1;min-width:0}.wa-row{display:flex;justify-content:space-between;align-items:center;gap:8px}.wa-name{font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.wa-ctime{font-size:12px;color:#9eacb9;flex:none}.wa-chat.unread .wa-ctime{color:#25d366}.wa-preview{font-size:14px;color:#9eacb9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.wa-badge{flex:none;min-width:20px;height:20px;padding:0 6px;box-sizing:border-box;border-radius:10px;background:#25d366;color:#06210f;font-size:12px;font-weight:700;text-align:center;line-height:20px}' +
    '.wa-main{flex:1;display:flex;flex-direction:column;min-width:0;background:#0f1115;position:relative}' +
    '.wa-older{align-self:center;flex:none;min-height:36px;margin:6px 0;padding:0 16px;border:1px solid #2a313a;border-radius:18px;background:#1a1e24;color:#79c9eb;font:inherit;font-size:13px;cursor:pointer}' +
    '.wa-tolatest{position:absolute;inset-inline-start:14px;bottom:76px;z-index:3;width:42px;height:42px;padding:0;border:1px solid #2a313a;border-radius:50%;background:#1f252c;color:#cfd8df;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.5);transition:transform .15s ease-out,opacity .15s}.wa-tolatest svg{width:24px;height:24px}.wa-tolatest[hidden]{display:none}.wa-fab-n{position:absolute;top:-7px;inset-inline-end:-4px;min-width:20px;height:20px;padding:0 5px;box-sizing:border-box;border-radius:10px;background:#25d366;color:#06210f;font-size:11.5px;font-weight:700;line-height:20px;text-align:center}.wa-fab-n[hidden]{display:none}' +
    '.wa-head{background:#1a1e24;border-bottom:1px solid #2a313a}.wa-back{border:0;background:none;cursor:pointer;color:#cfd8df;align-items:center;justify-content:center;padding:0;flex:none;border-radius:50%}.wa-back{display:none;width:44px;height:44px}.wa-back:focus-visible{outline:2px solid #79c9eb}.wa-head-txt{display:flex;flex-direction:column;min-width:0;flex:1}.wa-head-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wa-sub{font-size:12px;font-weight:400;color:#9eacb9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.wa-msgs{flex:1;overflow:auto;padding:12px 7%;display:flex;flex-direction:column;gap:3px}.wa-date{text-align:center;margin:10px 0;position:sticky;top:6px;z-index:2;pointer-events:none}.wa-date span{background:rgba(26,30,36,.72);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:#b5c0ca;font-size:12.5px;padding:5px 12px;border-radius:10px;border:1px solid #2a313a}' +
    '.wa-msg{display:flex}.wa-msg.wa-in{justify-content:flex-start}.wa-msg.wa-out{justify-content:flex-end}' +
    '.wa-bubble{position:relative;max-width:65%;padding:6px 9px 8px;border-radius:10px;font-size:14.2px;line-height:19px;color:#f2f3f5;overflow-wrap:anywhere;white-space:pre-wrap}' +
    /* UX404: tails on the screen-edge side (root is RTL: incoming right, outgoing left), only on the first bubble of a run */
    '.wa-in .wa-bubble{background:#1f252c}.wa-out .wa-bubble{background:#0f4a3c}.wa-msg.wa-first{margin-top:6px}.wa-in.wa-first .wa-bubble{border-top-right-radius:0}.wa-out.wa-first .wa-bubble{border-top-left-radius:0}' +
    '.wa-first .wa-bubble:before{content:"";position:absolute;top:0;width:8px;height:13px}.wa-in.wa-first .wa-bubble:before{right:-8px;background:#1f252c;-webkit-clip-path:polygon(0 0,100% 0,0 100%);clip-path:polygon(0 0,100% 0,0 100%)}.wa-out.wa-first .wa-bubble:before{left:-8px;background:#0f4a3c;-webkit-clip-path:polygon(0 0,100% 0,100% 100%);clip-path:polygon(0 0,100% 0,100% 100%)}' +
    '.wa-gap{display:inline-block;width:44px;height:1px;vertical-align:baseline}.wa-out .wa-gap{width:64px}.wa-meta{position:absolute;bottom:3px;inset-inline-end:8px;font-size:11px;line-height:15px;color:#b5c0ca;display:inline-flex;align-items:center;gap:3px;white-space:nowrap;pointer-events:none}.wa-meta>*{direction:ltr;unicode-bidi:isolate}.wa-tick{color:#b5c0ca}.wa-tick.read{color:#53bdeb}.wa-tick.failed{color:#ff9a9a;font-weight:700}.wa-msg[data-status=failed] .wa-bubble{box-shadow:inset 0 0 0 1px #b91c1c}' +
    /* UX404: smooth scrolling: contained scroller, isolated rows, native scroll anchoring, no scroll chaining */
    '.wa-msgs{overscroll-behavior:contain;-webkit-overflow-scrolling:touch;contain:layout paint}.wa-msg{flex:none;contain:layout style}.wa-list{overscroll-behavior:contain}' +
    '.wa-composer{min-height:62px;box-sizing:border-box;background:#1a1e24;border-top:1px solid #2a313a;display:flex;align-items:center;gap:10px;padding:10px 16px}.wa-composer input{flex:1;height:42px;border:1px solid #2a313a;border-radius:10px;padding:0 14px;font:inherit;font-size:15px;background:#0d0f12;color:#f2f3f5}' +
    '.wa-window-note{margin:0;padding:8px 14px;font-size:13px;line-height:1.6;color:#b0bbc7;background:#141a21;border-top:1px solid #29323d;text-align:center}.wa-send-err{background:#3a1416;color:#ffd5d5;border-top:1px solid #7f1d1d;padding:8px 16px;font-size:13.5px;line-height:1.6}.wa-tick.sending{font-size:10px}' +
    '.wa-composer input:disabled{background:#14171c;color:#9eacb9;cursor:not-allowed}.wa-send{width:42px;height:42px;border:0;border-radius:50%;background:#0b7a63;color:#fff;font-size:18px;cursor:pointer}.wa-send:disabled{background:#2a313a;color:#9eacb9;cursor:not-allowed}' +
    /* UX404: WhatsApp composer shell: pill [emoji][input][attach][mic] + round send; safe-area bottom; slide open/back; safe-area top while inbox is open */
    '.wa-pill{flex:1;min-width:0;display:flex;align-items:center;gap:2px;background:#0d0f12;border:1px solid #2a313a;border-radius:24px;padding:0 4px}.wa-pill input{flex:1;min-width:0;border:0!important;background:transparent!important;border-radius:0!important;padding:0 6px!important;outline:none}.wa-pill:focus-within{border-color:#3d6f63}' +
    '.wa-cbtn{flex:none;width:40px;height:40px;padding:0;border:0;border-radius:50%;background:transparent;color:#9eacb9;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}.wa-cbtn svg{width:22px;height:22px}.wa-cbtn:hover{color:#f2f3f5}.wa-cbtn:focus-visible{outline:2px solid #79c9eb}.wa-cbtn[aria-disabled=true]{cursor:default}' +
    '.wa-composer{gap:8px;padding:8px 10px calc(8px + env(safe-area-inset-bottom,0px))}.wa-send{flex:none;display:inline-flex;align-items:center;justify-content:center}.wa-send svg{width:22px;height:22px;transform:scaleX(-1)}' +
    '@keyframes waOpen{from{transform:translate3d(-100%,0,0)}to{transform:none}}@keyframes waBack{from{transform:translate3d(28%,0,0);opacity:.6}to{transform:none;opacity:1}}' +
    '@media(max-width:700px){.wa-root[data-anim=open] .wa-main{animation:waOpen .2s cubic-bezier(.2,.8,.2,1) var(--wa-ad,0s) both}.wa-root[data-anim=back] .wa-side{animation:waBack .2s cubic-bezier(.2,.8,.2,1) var(--wa-ad,0s) both}.wa-root{border-radius:0;border-inline:0}}' +
    '@media(prefers-reduced-motion:reduce){.wa-root[data-anim] .wa-main,.wa-root[data-anim] .wa-side{animation:none}.wa-tolatest{transition:none}}' +
    'body[data-active-page=inbox] .nova-nav-row{box-sizing:content-box;padding-top:var(--wa-sat,env(safe-area-inset-top,0px))}body[data-active-page=inbox] #novaInboxView{padding-inline:env(safe-area-inset-left,0px) env(safe-area-inset-right,0px)}@media(max-width:700px){body[data-active-page=inbox] #novaInboxView{padding-block:0}}' +
    '.wa-empty{margin:auto;color:#b5c0ca;text-align:center;padding:24px;display:flex;flex-direction:column;align-items:center;gap:12px;font-size:16px}.wa-empty svg{color:#76b8d5;opacity:.9}.wa-note{font-size:12px;color:#9eacb9;text-align:center;padding:4px}' +
    '.wa-sys{text-align:center;margin:6px 0}.wa-sys span{display:inline-block;max-width:80%;background:#1a1e24;color:#d7c27a;font-size:12.5px;line-height:18px;padding:5px 12px;border-radius:8px;border:1px solid #2a313a;white-space:pre-wrap;overflow-wrap:anywhere}' +
    '.wa-who{display:block;font-size:12px;font-weight:600;margin-bottom:2px}.wa-who-bot{color:#7fd1b9}.wa-who-ph{color:#79c9eb}' +
    '.wa-side-head{justify-content:space-between}.wa-histst{display:flex;align-items:center;gap:6px;margin-inline-start:auto;font-size:12px;font-weight:500;color:#9fb0bf;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    /* UX400b: WhatsApp Web frame: row menu (pin/archive), archived row, pinned icon, chat wallpaper, intro pane, composer shell */
    '.wa-item{position:relative}.wa-item .wa-row+.wa-row{padding-inline-end:30px}.wa-pinic{flex:none;display:inline-flex;color:#9eacb9}.wa-pinic svg{width:15px;height:15px}' +
    '.wa-rowmenu{position:absolute;inset-inline-end:12px;bottom:12px;width:26px;height:26px;padding:0;border:0;border-radius:50%;background:transparent;color:#9eacb9;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:opacity .12s}.wa-rowmenu svg{width:18px;height:18px}.wa-rowmenu:hover,.wa-rowmenu[aria-expanded=true]{background:#2a313a;color:#f2f3f5}.wa-rowmenu:focus-visible{outline:2px solid #79c9eb;opacity:1}' +
    '@media(hover:hover) and (pointer:fine){.wa-rowmenu{opacity:0}.wa-item:hover .wa-rowmenu,.wa-item:focus-within .wa-rowmenu,.wa-rowmenu[aria-expanded=true]{opacity:1}}' +
    '.wa-menu{position:absolute;inset-inline-end:12px;top:60px;z-index:5;min-width:190px;padding:6px 0;background:#1f252c;border:1px solid #2a313a;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.55);display:flex;flex-direction:column}.wa-item:nth-child(n+4):nth-last-child(-n+2) .wa-menu{top:auto;bottom:44px}.wa-menu button{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 16px;border:0;background:none;color:#f2f3f5;font:inherit;font-size:14.5px;text-align:start;cursor:pointer}.wa-menu button:hover,.wa-menu button:focus-visible{background:#2a313a;outline:none}.wa-menu svg{width:18px;height:18px;color:#9eacb9;flex:none}' +
    '.wa-archrow,.wa-archhead{display:flex;align-items:center;gap:13px;width:100%;min-height:49px;padding:0 15px;border:0;border-bottom:1px solid #232a32;background:#14171c;color:#f2f3f5;font:inherit;font-size:15px;text-align:start;cursor:pointer}.wa-archrow:hover,.wa-archhead:hover{background:#1f252c}.wa-archrow:focus-visible,.wa-archhead:focus-visible{outline:2px solid #79c9eb;outline-offset:-2px}.wa-archrow svg,.wa-archhead svg{width:20px;height:20px;flex:none;color:#25d366}.wa-archrow-t{flex:1}.wa-archrow-n{font-size:12px;color:#25d366;font-weight:600}.wa-archhead{font-weight:600;background:#1a1e24}.wa-archhead svg{color:#cfd8df}' +
    '.wa-msgs{background-color:#0b0d10;background-image:' + WP + ';background-size:180px 180px}.wa-head{flex:none}.wa-composer{flex:none}.wa-composer input{border-radius:8px}' +
    '.wa-intro{margin:auto;max-width:460px;padding:32px 24px;gap:14px}.wa-intro svg{width:72px;height:72px}.wa-intro h2{margin:0;font-size:22px;font-weight:500;color:#e7edf2}.wa-intro p{margin:0;font-size:14px;line-height:1.7;color:#9eacb9}.wa-main.wa-noselect{border-bottom:6px solid #0b7a63;box-sizing:border-box}' +
    '@media(max-width:700px){.wa-side{width:100%;max-width:none}.wa-root[data-view=chat] .wa-side{display:none}.wa-root[data-view=list] .wa-main{display:none}.wa-back{display:inline-flex}.wa-head{padding:0 8px}.wa-bubble{max-width:85%}.wa-msgs{padding:10px 4%}.wa-side{min-width:0;border-inline-start:0}}' +
    '@media(pointer:coarse),(max-width:700px){.wa-item .wa-chat{padding-inline-end:56px}.wa-item .wa-row+.wa-row{padding-inline-end:0}.wa-rowmenu{width:44px;height:44px;bottom:auto;top:14px;inset-inline-end:6px;opacity:1}.wa-menu{top:58px}.wa-archrow,.wa-archhead{min-height:52px}}';

  /* UX400: no PIN on staging/preview; while the first list loads the empty list says so (no lock state). */
  var LIST_LOADING = '<div class="wa-empty" data-wa-list-loading role="status"><span>جاري تحميل المحادثات…</span></div>';
  /* UX236: Arabic-insensitive search key: tashkeel/tatweel removed, hamza/alef forms, ya/alef-maqsura, ta-marbuta, Arabic-Indic digits folded */
  /* UX405: media bubbles (Black Edition) */
  WA_CSS += '.wa-has-media{padding:3px 3px 6px}.wa-cap{display:block;padding:5px 6px 0}.wa-media-only{padding:3px 3px 20px}.wa-mo-ov{padding:3px}.wa-mo-ov .wa-meta{bottom:7px;inset-inline-end:10px;padding:1px 6px;border-radius:8px;background:rgba(0,0,0,.45);color:#f2f3f5}' +
    '.wa-media{display:block;box-sizing:border-box;border-radius:8px;overflow:hidden;color:#f2f3f5;font:inherit;text-decoration:none}button.wa-media{padding:0;border:0;background:#0d0f12;cursor:zoom-in}.wa-media:focus-visible{outline:2px solid #79c9eb;outline-offset:2px}' +
    '.wa-m-image,.wa-m-image .wa-mimg{display:block;width:min(260px,62vw);height:min(260px,62vw);max-height:300px}.wa-mimg{object-fit:cover;background:#0d0f12;color:transparent}' +
    'button.wa-m-sticker{background:none;width:150px;height:150px}.wa-m-sticker .wa-mimg{display:block;width:150px;height:150px;object-fit:contain}.wa-bubble.wa-mo-ov:has(.wa-m-sticker){background:none!important;box-shadow:none}.wa-bubble.wa-mo-ov:has(.wa-m-sticker):before{display:none}' +
    '.wa-m-audio{display:flex;align-items:center;gap:8px;padding:6px 8px;width:min(300px,66vw);background:rgba(0,0,0,.18)}.wa-maudio{flex:1;min-width:0;height:40px;color-scheme:dark}.wa-mic{flex:none;display:inline-flex;width:40px;height:40px;border-radius:50%;align-items:center;justify-content:center;background:#2a313a;color:#cfd8df}' +
    '.wa-m-video{width:min(280px,64vw);background:#000}.wa-mvideo{display:block;width:100%;max-height:320px;background:#000}' +
    '.wa-mdoc{display:flex;align-items:center;gap:10px;min-height:56px;padding:8px 10px;width:min(280px,64vw);background:rgba(0,0,0,.22);cursor:pointer}.wa-mdoc:hover{background:rgba(0,0,0,.32)}.wa-mdoc-t,.wa-mmiss-t{display:flex;flex-direction:column;min-width:0;gap:2px}.wa-mdoc-t b,.wa-mmiss-t b{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wa-mdoc-t span,.wa-mmiss-t span{font-size:12px;color:#b5c0ca;line-height:1.5;white-space:normal}' +
    '.wa-mmiss{display:flex;align-items:center;gap:10px;padding:8px 10px;width:min(280px,64vw);background:rgba(0,0,0,.22);border:1px dashed #3a4450}.wa-mmiss .wa-mic{color:#d7c27a}';
  var LB_CSS = '.wa-lb{position:fixed;inset:0;z-index:2147483000;background:rgba(5,6,8,.96);display:flex;flex-direction:column;touch-action:none;transition:opacity .15s}' +
    '.wa-lb-bar{flex:none;display:flex;justify-content:space-between;align-items:center;padding:calc(env(safe-area-inset-top,0px) + 6px) 10px 6px;gap:8px}' +
    '.wa-lb-x,.wa-lb-dl{width:48px;height:48px;border-radius:50%;border:0;background:rgba(255,255,255,.08);color:#f2f3f5;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}.wa-lb-x:focus-visible,.wa-lb-dl:focus-visible{outline:2px solid #79c9eb;outline-offset:2px}' +
    '.wa-lb-stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:auto;padding:0 0 env(safe-area-inset-bottom,0px)}.wa-lb[data-zoom="1"] .wa-lb-stage{touch-action:pan-x pan-y pinch-zoom}' +
    '.wa-lb-img{max-width:100%;max-height:100%;object-fit:contain;transition:transform .15s ease-out;transform-origin:center;touch-action:pinch-zoom;user-select:none;-webkit-user-select:none}@media(prefers-reduced-motion:reduce){.wa-lb,.wa-lb-img{transition:none}}';
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
  /* UX400b: WhatsApp Web list chrome. meta (optional): { pinned:{id:1}, archived:{id:1}, showArchived:bool, menu:id|null }.
     Pinned chats sort first (pin icon); archived chats leave the main list into one «المؤرشفة» row; a search looks across every chat.
     Each row = the chat button (data-conv) + a sibling options button (data-wa-menu) whose menu toggles pin/archive. */
  var SVGA = ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  var IC_PIN = '<svg' + SVGA + '><path d="M12 17v5"/><path d="M9 10.8V5h6v5.8l2.6 3.2H6.4z"/><path d="M8 5h8"/></svg>';
  var IC_ARCH = '<svg' + SVGA + '><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/></svg>';
  var IC_DOWN = '<svg' + SVGA + '><polyline points="6 9 12 15 18 9"/></svg>';
  var IC_BACK = '<svg' + SVGA + '><polyline points="9 6 15 12 9 18"/></svg>';
  function chatListHtml(convs, selId, q, now, loading, meta) {
    meta = meta || {}; var pin = meta.pinned || {}, ar = meta.archived || {}, showA = !!meta.showArchived;
    var rawQ = String(q || '').trim(), nq = normAr(rawQ), hits = {}, all = arr(convs);
    var nArch = all.filter(function (c) { return ar[c.id]; }).length;
    if (!nArch) showA = false;
    var items = all.filter(function (c) { if (!nq) return showA ? !!ar[c.id] : !ar[c.id]; var h = convHit(c, nq); hits[c.id] = h.msg; return h.found; })
      .sort(function (a, b) { return (pin[b.id] ? 1 : 0) - (pin[a.id] ? 1 : 0) || b.updatedAt - a.updatedAt; });
    var head = nq ? '' : showA ? '<button type="button" class="wa-archhead" data-wa-arch-close aria-label="رجوع إلى كل المحادثات">' + IC_BACK + '<span>المؤرشفة</span></button>'
      : nArch ? '<button type="button" class="wa-archrow" data-wa-arch-open>' + IC_ARCH + '<span class="wa-archrow-t">المؤرشفة</span><span class="wa-archrow-n" data-arch-count="' + nArch + '">' + nArch + '</span></button>' : '';
    if (!items.length) return head + (loading && !rawQ ? LIST_LOADING : rawQ ? '<div class="wa-empty" data-wa-noresult>لا نتائج لـ “' + esc(rawQ) + '”</div>' : '<div class="wa-empty">لا توجد محادثات</div>');
    return head + items.map(function (c) {
      var ms = arr(c.messages), last = ms[ms.length - 1], u = typeof meta.unread === 'function' ? meta.unread(c) : unreadCount(c), name = c.customer || c.id, pv = hits[c.id] || last, isP = !!pin[c.id], isA = !!ar[c.id], open = meta.menu === c.id;
      return '<div class="wa-item' + (isP ? ' pinned' : '') + (isA ? ' archived' : '') + '" data-wa-item' + (isP ? ' data-pinned' : '') + (isA ? ' data-archived' : '') + '>' +
        '<button type="button" class="wa-chat' + (c.id === selId ? ' active' : '') + (u ? ' unread' : '') + '" data-conv="' + esc(c.id) + '"' + (c.id === selId ? ' aria-current="true"' : '') + '>' +
        '<span class="wa-avatar" aria-hidden="true">' + esc(initial(name)) + '</span><span class="wa-chat-body"><span class="wa-row"><span class="wa-name">' + esc(name) + '</span>' +
        '<span class="wa-ctime">' + (last ? esc(dateLabel(last.at, now) === 'اليوم' ? timeLabel(last.at) : dateLabel(last.at, now)) : '') + '</span></span>' +
        '<span class="wa-row"><span class="wa-preview">' + (pv ? (pv.dir === 'out' ? tick(pv) + ' ' : '') + esc(previewText(pv)) : '') + '</span>' +
        (isP ? '<span class="wa-pinic" data-wa-pinned title="مثبتة">' + IC_PIN + '</span>' : '') +
        (u ? '<span class="wa-badge" data-unread="' + u + '">' + (u > 99 ? '99+' : u) + '</span>' : '') + '</span></span></button>' +
        '<button type="button" class="wa-rowmenu" data-wa-menu="' + esc(c.id) + '" aria-haspopup="menu" aria-expanded="' + (open ? 'true' : 'false') + '" aria-label="خيارات المحادثة مع ' + esc(name) + '">' + IC_DOWN + '</button>' +
        (open ? '<div class="wa-menu" role="menu" data-wa-menu-for="' + esc(c.id) + '"><button type="button" role="menuitem" data-wa-pin="' + esc(c.id) + '">' + IC_PIN + '<span>' + (isP ? 'إلغاء تثبيت المحادثة' : 'تثبيت المحادثة') + '</span></button>' +
          '<button type="button" role="menuitem" data-wa-arch="' + esc(c.id) + '">' + IC_ARCH + '<span>' + (isA ? 'إلغاء أرشفة المحادثة' : 'أرشفة المحادثة') + '</span></button></div>' : '') + '</div>';
    }).join('');
  }
  /* UX404: composer affordances like WhatsApp. Emoji/attach/voice behaviour belongs to UX401: the buttons are visible but inert
     (aria-disabled, «قريباً»), never send anything and never open a picker. */
  var IC_EMOJI = '<svg' + SVGA + '><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/></svg>';
  var IC_CLIP = '<svg' + SVGA + '><path d="M20.5 11.5l-8.3 8.3a5 5 0 0 1-7-7l8.3-8.3a3.3 3.3 0 0 1 4.7 4.7l-8.4 8.3a1.7 1.7 0 0 1-2.3-2.3l7.7-7.7"/></svg>';
  var IC_MIC = '<svg' + SVGA + '><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>';
  var IC_SEND = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4l17.4-7.5a1 1 0 0 0 0-1.8L3.4 3.6a.9.9 0 0 0-1.3 1l1.9 6.4 9 1-9 1-1.9 6.4a.9.9 0 0 0 1.3 1z"/></svg>';
  function cBtn(k, label, ic) { return '<button type="button" class="wa-cbtn wa-c-' + k + '" data-wa-' + k + ' aria-label="' + label + ' (قريباً)" title="قريباً" aria-disabled="true">' + ic + '</button>'; }
  /* opts: { selected, query, now, sendEnabled, newCount (UX404 FAB badge), anim ('open'|'back', UX404 slide) } */
  var CHAT_LOADING = '<div class="wa-chat-loading" data-chat-loading role="status"><span class="wa-chat-loading-txt">جاري تحميل المحادثة…</span><span class="wa-sk wa-sk-in"></span><span class="wa-sk wa-sk-out"></span><span class="wa-sk wa-sk-in w2"></span></div>';
  function renderWa(convs, opts) {
    opts = opts || {}; var now = opts.now || Date.now(), sel = null;
    arr(convs).forEach(function (c) { if (c.id === opts.selected) sel = c; });
    var name = sel ? (sel.customer || sel.id) : '';
    var subtitle = '';
    if (sel) {
      var ms0 = arr(sel.messages), cnt = Math.max(Number(sel.count) || 0, ms0.length), lastM = ms0[ms0.length - 1], parts = [cnt + ' رسالة'];
      var lastAt = lastM ? lastM.at : sel.updatedAt;
      if (lastAt) parts.push('آخر نشاط ' + (dateLabel(lastAt, now) === 'اليوم' ? timeLabel(lastAt) : dateLabel(lastAt, now)));
      if (!opts.sendEnabled) parts.push('أرشيف للقراءة فقط');
      subtitle = parts.join(' · ');
    }
    var allMs = sel ? arr(sel.messages) : [], lim = Math.max(1, Number(opts.limit) || 80), hid = Math.max(0, allMs.length - lim);
    var main = sel
      ? '<div class="wa-head"><button type="button" class="wa-back" data-wa-back aria-label="رجوع إلى المحادثات"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg></button><span class="wa-avatar" aria-hidden="true">' + esc(initial(name)) + '</span><span class="wa-head-txt"><span class="wa-head-name">' + esc(name) + '</span><span class="wa-sub" data-wa-sub>' + esc(subtitle) + '</span></span>' +
        '</div>' +
        '<div class="wa-msgs" id="waMsgs" data-wa-wallpaper role="log" aria-live="polite"' + (opts.chatLoading ? ' aria-busy="true"' : '') + ' aria-label="رسائل المحادثة مع ' + esc(name) + '" tabindex="-1">' + (opts.chatLoading ? CHAT_LOADING : '') + (opts.chatError ? '<div class="wa-chat-err" role="alert" data-chat-error><span>' + esc(opts.chatError) + '</span><button type="button" data-wa-reload>إعادة المحاولة</button></div>' : '') + (hid ? '<button type="button" class="wa-older" data-wa-older>رسائل أقدم (' + hid + ')</button>' : '') + (opts.chatLoading ? '' : bubbles(hid ? allMs.slice(hid) : sel.messages, now, { url: opts.mediaUrl, fail: opts.mediaFail })) + '</div>' +
        '<button type="button" class="wa-tolatest" data-wa-latest' + (opts.newCount ? '' : ' hidden') + ' aria-label="انزل للأحدث' + (opts.newCount ? ' (' + Number(opts.newCount) + ' رسالة جديدة)' : '') + '">' + IC_DOWN + '<span class="wa-fab-n" data-wa-fab-n' + (opts.newCount ? '>' + (opts.newCount > 99 ? '99+' : Number(opts.newCount)) : ' hidden>') + '</span></button>'
      : opts.loading && !arr(convs).length ? LIST_LOADING
      : '<div class="wa-empty wa-intro" data-wa-intro><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg><h2>محادثات واتساب الصيدلية</h2><span>اختر محادثة لعرضها</span><p>الرسائل بتظهر هنا زي واتساب ويب. ابحث بالاسم أو الرقم أو نص الرسالة.</p></div>';
    var en = !!opts.sendEnabled;
    return '<style>' + WA_CSS + (opts.notifHead ? NOTIF_CSS : '') + '</style><div class="wa-root" dir="rtl" data-wa-root data-wa-inbox-open data-view="' + (sel ? 'chat' : 'list') + '"' + (opts.anim === 'open' || opts.anim === 'back' ? ' data-anim="' + opts.anim + '"' : '') + '>' +
      '<aside class="wa-side"><div class="wa-side-head"><h1 style="font:inherit;margin:0">المحادثات</h1>'+(opts.histHead||'')+'</div>'+(opts.notifHead?'<div class="wa-notifbar" data-wa-notifbar>'+opts.notifHead+'</div>':'')+(opts.histPanel||'')+'<div class="wa-search"><input type="search" id="waSearch" aria-label="ابحث في المحادثات أو ابدأ محادثة جديدة" placeholder="ابحث أو ابدأ محادثة جديدة" value="' + esc(opts.query || '') + '" autocomplete="off"><button type="button" class="wa-sclear" id="waSearchClear" data-wa-sclear aria-label="\u0645\u0633\u062d \u0627\u0644\u0628\u062d\u062b"' + (opts.query ? '' : ' hidden') + '>\u00d7</button></div>' +
      '<div class="wa-list" id="waList" role="group" aria-label="قائمة المحادثات">' + chatListHtml(convs, opts.selected, opts.query, now, opts.loading, opts.list) + '</div></aside>' +
      '<section class="wa-main' + (sel ? '' : ' wa-noselect') + '">' + main + (sel ? (opts.sendErr ? '<div class="wa-send-err" role="alert" data-send-err>' + esc(opts.sendErr) + '</div>' : '') + (opts.windowClosed ? '<div class="wa-window-note" data-wa-window role="status">عدّى أكتر من 24 ساعة على آخر رسالة من العميل. واتساب مش بيسمح بالرد لحد ما يبعت هو رسالة جديدة، وهتفتح الكتابة تلقائياً أول ما توصل.</div>' : '') + '<form class="wa-composer" id="waComposer" data-wa-composer' + (opts.windowClosed ? ' data-window="closed"' : '') + '><div class="wa-pill">' + cBtn('emoji', 'الرموز التعبيرية', IC_EMOJI) + '<input type="text" id="waInput" dir="auto" maxlength="1000" enterkeyhint="send" autocomplete="off" aria-label="اكتب رسالة للعميل" placeholder="' + (opts.windowClosed ? 'الرد متوقف: لازم العميل يبعت الأول' : en ? 'اكتب رسالة' : (opts.sendHint || 'الإرسال متوقف')) + '"' + (en ? '' : ' disabled') + '>' + cBtn('attach', 'إرفاق ملف', IC_CLIP) + cBtn('mic', 'رسالة صوتية', IC_MIC) + '</div><button type="submit" class="wa-send" aria-label="إرسال"' + (en ? '' : ' disabled') + '>' + IC_SEND + '</button></form>' : '') + '</section></div>';
  }

  /* UX406: new-message notifications. Unread tracker (per chat + total), document.title count, permission/mute controls.
     Seen times are persisted under nova.wa.seen.v1 keyed by a short FNV hash of the chat id (never the id/phone itself, FIX46 rule).
     base = first time this device opened the conversations screen: older messages never count as unread.
     Hooks for UX402 (live insert): observe(convs) after any refresh -> { fresh: [...] }; bump(id) on a push; markSeen(id). */
  var SEEN_KEY = 'nova.wa.seen.v1', SEEN_MAX = 500;
  function hashId(s) { s = String(s); var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  function isInbound(m) { return !!m && m.dir === 'in' && (!m.kind || m.kind === 'in'); }
  function createUnread(storage, now0) {
    var st = { base: 0, seen: {} }, acc = {}, prevAt = {}, ready = false;
    try { var p = JSON.parse((storage && storage.getItem(SEEN_KEY)) || 'null'); if (p && Number(p.base) > 0) st = { base: Number(p.base), seen: p.seen && typeof p.seen === 'object' ? p.seen : {} }; } catch (e) { /* corrupt: start fresh */ }
    function save() {
      var ks = Object.keys(st.seen);
      if (ks.length > SEEN_MAX) ks.sort(function (a, b) { return st.seen[a] - st.seen[b]; }).slice(0, ks.length - SEEN_MAX).forEach(function (k) { delete st.seen[k]; });
      try { if (storage) storage.setItem(SEEN_KEY, JSON.stringify(st)); } catch (e) { /* quota: memory only */ }
    }
    if (!st.base) { st.base = Number(now0) || Date.now(); save(); }
    function seenAt(id) { return Math.max(st.base, Number(st.seen[hashId(id)]) || 0); }
    function lastInAt(c) { var a = 0, ms = arr(c && c.messages); for (var i = 0; i < ms.length; i++) if (isInbound(ms[i]) && Number(ms[i].at) > a) a = Number(ms[i].at); return a; }
    function count(c) {
      if (!c) return 0; var s = seenAt(c.id), ms = arr(c.messages), n = 0, i;
      /* local (non-history) chat: old MSG-02 rule (trailing inbound run), minus what was opened on this device */
      if (!c.history) { var ls = Number(st.seen[hashId(c.id)]) || 0; for (i = ms.length - 1; i >= 0 && ms[i].dir === 'in'; i--) if (Number(ms[i].at) > ls) n++; return Math.max(n, acc[c.id] || 0); }
      for (i = 0; i < ms.length; i++) if (isInbound(ms[i]) && Number(ms[i].at) > s) n++;
      return Math.max(n, acc[c.id] || 0);
    }
    function chats(convs) { var ids = {}, n = 0; arr(convs).forEach(function (c) { ids[c.id] = 1; if (count(c) > 0) n++; }); Object.keys(acc).forEach(function (k) { if (acc[k] > 0 && !ids[k]) n++; }); return n; }
    function messages(convs) { var ids = {}, n = 0; arr(convs).forEach(function (c) { ids[c.id] = 1; n += count(c); }); Object.keys(acc).forEach(function (k) { if (!ids[k]) n += acc[k] || 0; }); return n; }
    /* Call after each data refresh. The first call only records a baseline (no sound for what is already on screen). */
    function observe(convs) {
      var fresh = [];
      arr(convs).forEach(function (c) {
        var a = lastInAt(c), had = Object.prototype.hasOwnProperty.call(prevAt, c.id), was = prevAt[c.id] || 0;
        if (ready && a > was && a > seenAt(c.id) && (had || a > st.base)) {
          var ms = arr(c.messages), m = null; for (var i = ms.length - 1; i >= 0; i--) if (isInbound(ms[i])) { m = ms[i]; break; }
          if (c.history && Number(c.count) > ms.length && had) acc[c.id] = (acc[c.id] || 0) + 1; // partial chat (only last loaded): count each new arrival
          fresh.push({ id: c.id, customer: c.customer || c.id, text: m ? previewText(m) : '', at: a });
        }
        prevAt[c.id] = Math.max(was, a);
      });
      ready = true; return { fresh: fresh };
    }
    function markSeen(id, t) { if (id == null) return; st.seen[hashId(id)] = Math.max(Number(t) || Date.now(), seenAt(id)); delete acc[id]; save(); }
    function bump(id, k) { if (id == null) return; acc[id] = (acc[id] || 0) + (Number(k) > 0 ? Number(k) : 1); }
    return { count: count, chats: chats, messages: messages, observe: observe, markSeen: markSeen, bump: bump, seenAt: seenAt, base: function () { return st.base; } };
  }
  /* «(3) NOVA Rx» while there is unread; the original title otherwise. Idempotent (an old prefix is replaced). */
  function titleBadge(title, n) { var t = String(title || '').replace(/^\(\d+\+?\)\s/, ''); n = Number(n) || 0; return n > 0 ? '(' + (n > 99 ? '99+' : n) + ') ' + t : t; }
  var IC_BELL = '<svg' + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + '><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>';
  var IC_BELL_OFF = '<svg' + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + '><path d="M8.7 3A6 6 0 0 1 18 8c0 2.6.4 4.5.9 5.8"/><path d="M17 17H3s3-1 3-8c0-.6.1-1.2.3-1.8"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/><path d="M2 2l20 20"/></svg>';
  var PERM_AR = {
    'default': ['فعّل الإشعارات', 'اسمح بإشعارات الرسائل الجديدة حتى لو الصفحة مش قدامك'],
    granted: ['الإشعارات شغّالة', 'هيوصلك إشعار مع كل رسالة جديدة من عميل'],
    denied: ['الإشعارات مقفولة', 'المتصفح قافل الإشعارات للموقع ده. افتح إعدادات الموقع (علامة القفل جنب العنوان) واسمح بالإشعارات'],
    unsupported: ['الإشعارات غير مدعومة', 'المتصفح ده مش بيدعم إشعارات الويب. الصوت والعداد شغالين عادي']
  };
  /* state: 'default'|'granted'|'denied'|'unsupported'; muted: bool; note: optional Arabic status line */
  function notifyHtml(state, muted, note) {
    var k = PERM_AR[state] ? state : 'unsupported', l = PERM_AR[k];
    return '<span class="wa-notif" data-wa-notif data-perm="' + k + '">' +
      '<button type="button" class="wa-nbtn" data-wa-notify="' + k + '" aria-pressed="' + (k === 'granted') + '" title="' + esc(l[1]) + '"' + (k === 'unsupported' ? ' aria-disabled="true"' : '') + '>' + (k === 'granted' ? IC_BELL : IC_BELL_OFF) + '<span>' + l[0] + '</span></button>' +
      '<button type="button" class="wa-nbtn wa-mute" data-wa-mute aria-pressed="' + !!muted + '" aria-label="' + (muted ? 'تشغيل صوت الرسائل' : 'كتم صوت الرسائل') + '" title="' + (muted ? 'الصوت مكتوم' : 'الصوت شغّال') + '">' + (muted ? IC_BELL_OFF : IC_BELL) + '<span class="wa-nmute-t">' + (muted ? 'الصوت مكتوم' : 'الصوت') + '</span></button>' +
      (note ? '<span class="wa-nnote" data-wa-notif-note role="status">' + esc(note) + '</span>' : '') + '</span>';
  }
  var NOTIF_CSS = '.wa-notifbar{flex:none;padding:6px 12px;border-bottom:1px solid #1f252c;background:#111418}.wa-notif{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.wa-nbtn{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 10px;border-radius:18px;border:1px solid #2a313a;background:#161a20;color:#f2f3f5;font:inherit;font-size:13px;cursor:pointer}.wa-nbtn svg{width:16px;height:16px;flex:none}.wa-nbtn[data-wa-notify=default]{border-color:#25d366;color:#25d366}.wa-nbtn[data-wa-notify=denied]{border-color:#b45309;color:#fbbf24}.wa-nbtn[aria-disabled=true]{opacity:.6;cursor:default}.wa-nbtn:focus-visible{outline:2px solid #79c9eb;outline-offset:2px}.wa-nnote{flex-basis:100%;font-size:12px;color:#9aa4b0;line-height:1.5}@media(pointer:coarse),(max-width:780px){.wa-nbtn{min-height:44px}.wa-nmute-t{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}}';
  /* tab badge style is inline (the tab lives outside the conversations view) */
  var TAB_BADGE_CSS = 'display:inline-block;min-width:18px;height:18px;margin-inline-start:6px;padding:0 5px;box-sizing:border-box;border-radius:9px;background:#25d366;color:#06210f;font-size:12px;font-weight:700;line-height:18px;text-align:center;vertical-align:middle';
  var api = { createUnread: createUnread, titleBadge: titleBadge, notifyHtml: notifyHtml, NOTIF_CSS: NOTIF_CSS, TAB_BADGE_CSS: TAB_BADGE_CSS, hashId: hashId, isInbound: isInbound, normAr: normAr, create: create, render: render, renderWa: renderWa, chatListHtml: chatListHtml, bubbles: bubbles, mediaHtml: mediaHtml, mediaMiss: mediaMiss, previewText: previewText, openLightbox: openLightbox, dateLabel: dateLabel, unreadCount: unreadCount, totalUnread: totalUnread, KEY: KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaUnifiedInbox = api;
})(typeof window !== 'undefined' ? window : globalThis);
