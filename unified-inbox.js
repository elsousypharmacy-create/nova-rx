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
  function unreadCount(c) { if (c && c.history) return trailingIn(c); var n = 0, m = arr(c && c.messages); for (var i = m.length - 1; i >= 0 && m[i].dir === 'in'; i--) n++; return n; }
  /* UX408: «لم يُرد» = the last customer-facing message (system rows skipped) is from the customer — the same rule as the dashboard's
     «بانتظار الرد الآن». trailingIn = how many customer messages are waiting after the last staff/bot reply. */
  function trailingIn(c) { var ms = arr(c && c.messages), n = 0; for (var i = ms.length - 1; i >= 0; i--) { var m = ms[i]; if (!m || m.kind === 'sys') continue; if (m.dir !== 'in') break; n++; } return n; }
  function needsReply(c) { return trailingIn(c) > 0; }
  function totalUnread(cs) { return arr(cs).reduce(function (a, c) { return a + (unreadCount(c) > 0 ? 1 : 0); }, 0); }
  /* UX401: WhatsApp ticks as SVG (no emoji/glyph font differences): sending = clock, sent = one grey check, delivered = two grey
     checks, read = two blue checks, failed = red «!» circle. An outgoing row with no/unknown status shows «delivered» (never a fake blue). */
  var TICK_SVG = {
    sending: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.3 1.6"/></svg>',
    sent: '<svg viewBox="0 0 18 11" width="16" height="11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 5.9l3 3.1 6.3-7.3"/></svg>',
    two: '<svg viewBox="0 0 18 11" width="18" height="11" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.2 5.9l3 3.1 6.3-7.3"/><path d="M8.6 8.4l.6.6 6.3-7.3"/></svg>',
    failed: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M8 4.2v4.6" stroke="#1a0b0b" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11.4" r="1.05" fill="#1a0b0b"/></svg>'
  };
  var TICK_AR = { sending: 'جاري الإرسال', sent: 'اتبعتت (علامة واحدة)', delivered: 'وصلت (علامتين)', read: 'اتقرت (علامتين زرق)', failed: 'ما اتبعتتش' };
  function tick(m) {
    if (!m || m.dir !== 'out') return '';
    var k = m.status === 'failed' || m.status === 'sending' || m.status === 'sent' || m.status === 'read' ? m.status : 'delivered';
    return '<span class="wa-tick ' + k + '" data-tick="' + k + '" role="img" aria-label="' + TICK_AR[k] + '" title="' + TICK_AR[k] + '">' + TICK_SVG[k === 'delivered' || k === 'read' ? 'two' : k] + '</span>';
  }
  function initial(name) { var s = String(name || '').trim(); return s ? Array.from(s)[0] : '؟'; }
  /* WA-LINK: a conversation whose "name" is only a phone number (the customer is not registered and has no profile name) is shown as a
     readable number, never as a bare 201142677350, and its avatar is a generic person instead of a digit. The registered pharmacy customer
     name (set on the conversation by the server link) is shown as it is. */
  function numberish(v) { return /^\+?\d[\d\s-]*$/.test(String(v == null ? '' : v).trim()); }
  function localPhone(d) { d = String(d || '').replace(/\D/g, ''); if (/^20(1[0125]\d{8})$/.test(d)) d = '0' + d.slice(2); return /^01[0125]\d{8}$/.test(d) ? d.slice(0, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7) : d; }
  function dispName(c) {
    var n = String((c && c.customer) || '').trim(), id = String((c && c.id) || '');
    if (n && !numberish(n) && n !== id) return n;
    var raw = id.replace(/^wa_/, '');
    if (/^\+?\d{6,20}$/.test(raw)) return localPhone(raw);
    return n && n !== id ? n : /^wa_/.test(id) ? 'يوزرنيم واتساب (من غير رقم)' : id;
  }
  function nameHtml(n) { return /^[\d\s+]+$/.test(String(n)) ? '<bdi dir="ltr">' + esc(n) + '</bdi>' : esc(n); }
  var IC_PERSON = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M12 12a4.2 4.2 0 1 0 0-8.4 4.2 4.2 0 0 0 0 8.4zm0 2.1c-3.6 0-7.2 1.8-7.2 4.5v1.8h14.4v-1.8c0-2.7-3.6-4.5-7.2-4.5z"/></svg>';
  function avatarHtml(c) { var n = String((c && c.customer) || '').trim(); return !n || numberish(n) || n === String((c && c.id) || '') ? IC_PERSON : esc(initial(n)); }
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
  function durLabel(sec) { sec = Math.max(0, Math.round(Number(sec) || 0)); return Math.floor(sec / 60) + ':' + pad(sec % 60); }
  var MIME_EXT = { 'application/pdf': 'PDF', 'application/msword': 'DOC', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX', 'application/vnd.ms-excel': 'XLS', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX', 'text/plain': 'TXT', 'application/zip': 'ZIP' };
  function docExt(fn, mime) { var m = /\.([A-Za-z0-9]{1,5})$/.exec(String(fn || '')); return m ? m[1].toUpperCase() : (MIME_EXT[String(mime || '').toLowerCase()] || ''); }
  var IC_PLAY = '<svg class="wa-i-play" viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M8 5.1v13.8a.8.8 0 0 0 1.2.7l10.6-6.9a.8.8 0 0 0 0-1.4L9.2 4.4A.8.8 0 0 0 8 5.1z"/></svg>';
  var IC_PAUSE = '<svg class="wa-i-pause" viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>';
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
    if (!src && md.local && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+\/=]+$/.test(String(md.local))) src = String(md.local); /* UX411: the photo being sent from this screen, shown from memory until the server copy exists */
    if (!src) return mediaMiss(t, md.skipped || (md.cached ? 'error' : 'missing'), md.filename);
    var a = ' data-wa-mid="' + esc(m.id) + '"';
    if (t === 'image' || t === 'sticker') return '<button type="button" class="wa-media wa-m-' + t + '" data-wa-media="' + t + '" data-wa-media-open="' + esc(src) + '"' + a + ' aria-label="عرض ال' + MT_AR[t] + ' بالحجم الكامل"><img class="wa-mimg" data-wa-mimg' + a + ' src="' + esc(src) + '" alt="' + MT_AR[t] + (m.dir === 'out' ? '' : ' من العميل') + '" loading="lazy" decoding="async"></button>';
    /* UX401: voice note like WhatsApp: round play/pause, progress track (tap to seek), duration (md.duration seconds when the API has it,
       else read from the file metadata by the page), mic badge. The <audio> element is the real player (no controls UI). */
    if (t === 'audio') return '<div class="wa-media wa-m-audio wa-voice" data-wa-media="audio" data-wa-voice><button type="button" class="wa-vplay" data-wa-vplay' + a + ' aria-label="تشغيل الرسالة الصوتية" aria-pressed="false">' + IC_PLAY + IC_PAUSE + '</button>' +
      '<span class="wa-vtrack" data-wa-vtrack role="slider" aria-label="موضع التشغيل" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="wa-vfill" data-wa-vfill></span><span class="wa-vdot" data-wa-vdot></span></span>' +
      '<span class="wa-vdur" data-wa-vdur>' + (Number(md.duration) > 0 ? durLabel(md.duration) : '0:00') + '</span><span class="wa-mic wa-vmic">' + IC_M.audio + '</span>' +
      '<audio class="wa-maudio" data-wa-mplay' + a + ' preload="metadata" src="' + esc(src) + '" aria-label="رسالة صوتية من العميل"></audio></div>';
    if (t === 'video') return '<div class="wa-media wa-m-video" data-wa-media="video"><video class="wa-mvideo" data-wa-mplay' + a + ' controls playsinline preload="metadata" src="' + esc(src) + '" aria-label="فيديو من العميل"></video></div>';
    var fn = md.filename || 'مستند', sz = fmtSize(md.size);
    var ext = docExt(fn, md.mime);
    return '<a class="wa-media wa-mdoc" data-wa-media="document" href="' + esc(src) + '" target="_blank" rel="noopener noreferrer" download="' + esc(fn) + '" aria-label="فتح المستند ' + esc(fn) + '"><span class="wa-mic wa-mdoc-ic" data-wa-ext="' + esc(ext) + '">' + IC_M.document + (ext ? '<span class="wa-mext">' + esc(ext) + '</span>' : '') + '</span><span class="wa-mdoc-t"><b dir="auto">' + esc(fn) + '</b><span>' + esc([ext, sz, 'اضغط للفتح أو التحميل'].filter(Boolean).join(' · ')) + '</span></span></a>';
  }
  /* list preview: "صورة · caption" instead of the raw "[صورة] caption" placeholder */
  /* UX408: like WhatsApp iOS the list shows a glyph + the media word («📷 صورة»), plus the caption; stored bracket placeholders
     («[صورة]», «[صورة] caption», «[رسالة صوتية]»…) from the bot sheet / webhook get the same treatment instead of the raw text. */
  var MT_IC = { image: '📷', sticker: '🏷️', audio: '🎤', video: '🎥', document: '📄' };
  var PH_TYPE = { 'صورة': 'image', 'صوره': 'image', 'ملصق': 'sticker', 'استيكر': 'sticker', 'رسالة صوتية': 'audio', 'رساله صوتيه': 'audio', 'صوت': 'audio', 'تسجيل صوتي': 'audio', 'فيديو': 'video', 'مستند': 'document', 'ملف': 'document' };
  var PH_RE = /^[\s\u200f\u200e]*\[([^\]\n]{1,20})\][\s:\-–—·]*([\s\S]*)$/;
  function mediaLine(type, cap) { return MT_IC[type] + ' ' + MT_AR[type] + (cap ? ' · ' + cap : ''); }
  function previewText(m) {
    var md = m && m.media;
    if (!md || !MT_AR[md.type]) {
      var t = shownText(m), ph = PH_RE.exec(String(t == null ? '' : t)), k = ph && PH_TYPE[ph[1].trim()];
      return k ? mediaLine(k, ph[2].replace(/\s+/g, ' ').trim()) : t;
    }
    return mediaLine(md.type, md.caption || (md.type === 'document' ? md.filename : ''));
  }
  /* UX407: the GAS bot used to prepend «👨‍⚕️ رد الصيدلي:» (or «رد الدكتور:») to staff replies (pharmacy server/src/41_bot_chat_admin.js
     botReply). Old stored rows still carry it, so the prefix is removed for DISPLAY only (stored rows are never rewritten). Only a LEADING
     prefix on an outgoing message is removed: optional doctor emoji, «رد الصيدلي|رد الدكتور», then a colon, or the emoji, or a line break
     (so a sentence that merely starts with those words keeps them), plus the following spaces/newlines. Never mid-text, never on incoming. */
  var STAFF_PREFIX = /^[\s\u200f\u200e]*((?:\uD83D[\uDC68\uDC69]|\uD83E\uDDD1)(?:\uD83C[\uDFFB-\uDFFF])?\u200D?\u2695?\uFE0F?)?[\s\u200f\u200e]*\u0631\u062F\s+\u0627\u0644(?:\u0635\u064A\u062F\u0644\u064A|\u062F\u0643\u062A\u0648\u0631)[ \t\u200f\u200e]*([:\uFF1A]|\r?\n|$)\s*/;
  function stripStaffPrefix(text) {
    var t = String(text == null ? '' : text), m = STAFF_PREFIX.exec(t);
    if (!m || (!m[1] && m[2] === '' && t.length > m[0].length)) return t;
    var r = t.slice(m[0].length);
    return r.trim() ? r : t;
  }
  function hasStaffPrefix(m) { return !!m && m.dir === 'out' && typeof m.text === 'string' && stripStaffPrefix(m.text) !== m.text; }
  function shownText(m) { return m && m.dir === 'out' ? stripStaffPrefix(m.text) : m ? m.text : ''; }
  /* UX401: reply/quote like WhatsApp. A message quotes another via m.quote ({id, dir, text, media}), m.replyTo (id of a row in the same
     thread) or mopts.quotes[m.id] (replies sent from this screen; the WhatsApp API context is not sent by the backend yet).
     quoteHtml renders the coloured snippet used both above a bubble and in the composer bar. */
  function quoteOf(m, byId, qs) {
    var q = (qs && qs[m.id]) || (m.quote && typeof m.quote === 'object' ? m.quote : null) || (m.replyTo != null && byId[m.replyTo]) || null;
    return q && (q.text != null || q.media) ? q : null;
  }
  function quoteSnippet(q) { var t = String(previewText(q) || '').replace(/\s+/g, ' ').trim(); return t.length > 140 ? t.slice(0, 139) + '…' : t; }
  function quoteHtml(q, name, tag) {
    var d = q.dir === 'out' ? 'out' : 'in', who = d === 'out' ? 'أنت' : (name || 'العميل'), sn = quoteSnippet(q), id = q.id != null ? String(q.id) : '';
    var inner = '<span class="wa-q-who">' + esc(who) + '</span><span class="wa-q-txt" dir="auto">' + esc(sn) + '</span>';
    if (tag === 'div') return '<div class="wa-quote wa-q-' + d + '" data-wa-quote="' + esc(id) + '">' + inner + '</div>';
    return '<button type="button" class="wa-quote wa-q-' + d + '" data-wa-quote="' + esc(id) + '"' + (id ? ' data-wa-quote-jump="' + esc(id) + '"' : '') + ' aria-label="رد على: ' + esc(sn) + ' — اضغط للانتقال للرسالة">' + inner + '</button>';
  }
  var IC_REPLY = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 8V4.5L3 11l7 6.5V14c5 0 8.3 1.4 11 5.5-1-5.6-4.2-10.4-11-11.5z"/></svg>';
  function bubbles(msgs, now, mopts) {
    var out = '', last = null, prev = null, byId = {}, qs = mopts && mopts.quotes, rep = !!(mopts && mopts.reply), nm = mopts && mopts.name;
    arr(mopts && mopts.all ? mopts.all : msgs).forEach(function (m) { if (m && m.id != null) byId[m.id] = m; });
    var list = arr(msgs);
    /* UX408: a run = consecutive same-direction bubbles on the same day (a date chip or a system row breaks it). Like WhatsApp iOS the
       TAIL sits at the BOTTOM of the LAST bubble of the run (wa-last), on the screen-edge side; wa-first only adds the run spacing. */
    function dirOf(x) { return x && x.kind !== 'sys' ? (x.dir === 'out' ? 'out' : 'in') : null; }
    list.forEach(function (m, i) {
      var ds = dayStart(m.at);
      if (ds !== last) { last = ds; prev = null; out += '<div class="wa-date" data-date-sep data-day="' + ds + '"><span>' + esc(dateLabel(m.at, now)) + '</span></div>'; }
      if (m.kind === 'sys') { prev = null; out += '<div class="wa-sys" data-mid="' + esc(m.id) + '" data-kind="sys"><span dir="auto">' + esc(m.text) + ' · ' + timeLabel(m.at) + '</span></div>'; return; }
      var d = m.dir === 'out' ? 'out' : 'in', first = prev !== d; prev = d;
      var nx = list[i + 1], lastOfRun = !nx || dirOf(nx) !== d || dayStart(nx.at) !== ds;
      /* UX408: 1-to-1 chat like WhatsApp: no sender name over the bubbles (no «الصيدلي» / «البوت»); kind stays in data-kind */
      var mh = mediaHtml(m, mopts), txt = mh ? (m.media.caption || '') : shownText(m), q = quoteOf(m, byId, qs), qh = q ? quoteHtml(q, nm) : '';
      var rb = rep && !/^tmp_/.test(String(m.id)) ? '<button type="button" class="wa-rbtn" data-wa-reply="' + esc(m.id) + '" tabindex="-1" aria-label="رد على الرسالة" title="رد">' + IC_REPLY + '</button>' : '';
      var meta = '<span class="wa-meta"><span class="wa-time">' + timeLabel(m.at) + '</span>' + tick(m) + '</span>';
      out += '<div class="wa-msg wa-' + d + (first ? ' wa-first' : '') + (lastOfRun ? ' wa-last' : '') + '" data-dir="' + esc(m.dir) + '" data-mid="' + esc(m.id) + '"' + (m.kind ? ' data-kind="' + esc(m.kind) + '"' : '') + (m.status ? ' data-status="' + esc(m.status) + '"' : '') + (mh ? ' data-media="' + esc(m.media.type) + '"' : '') + (q ? ' data-quoted' : '') + '>' + (d === 'in' ? rb : '') + '<div class="wa-bubble' + (mh ? ' wa-has-media' + (txt || qh ? '' : ' wa-media-only' + (/class="wa-media wa-m-(image|sticker|video)"/.test(mh) ? ' wa-mo-ov' : '')) : '') + (qh ? ' wa-has-quote' : '') + '" dir="auto">' + qh + mh +
        /* UX408: text + time share one LTR flex line so time and ticks stay in the bottom-RIGHT corner even for Arabic text (they wrap
           to their own line, still right-aligned, when the last text line is full: the time never covers glyphs) */
        (mh && !txt ? meta : '<span class="wa-tl' + (mh ? ' wa-cap' : '') + '"><span class="wa-text" dir="auto">' + esc(txt) + '</span>' + meta + '</span>') + '</div>' + (d === 'out' ? rb : '') + '</div>';
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
    lb.addEventListener('touchmove', function (e) { if (y0 === null || e.touches.length !== 1) return; dy = Math.max(0, e.touches[0].clientY - y0); img.style.transform = 'translateY(' + dy + 'px)'; img.style.opacity = String(Math.max(0.4, 1 - dy / 400)); /* UX408: the black backdrop stays opaque (no chat chrome through it) */ }, { passive: true });
    lb.addEventListener('touchend', function () { if (y0 === null) return; y0 = null; if (dy > 90) close(); else { img.style.transform = ''; img.style.opacity = ''; } dy = 0; });
    var x = lb.querySelector('[data-wa-lb-close]'); if (x) x.focus();
    return { el: lb, close: close };
  }
  /* UX400b: chat wallpaper = faint pharmacy doodle tile (inline SVG, no network), like the WhatsApp Web dark wallpaper */
  var WP_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><g fill="none" stroke="#c8d3dc" stroke-opacity=".045" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="14" y="20" width="40" height="16" rx="8" transform="rotate(-30 34 28)"/><path d="M34 20v16" transform="rotate(-30 34 28)"/><path d="M126 18v20M116 28h20"/>' +
    '<path d="M150 112a16 16 0 1 1-7.5-13.6L152 96l-2.2 8.2z"/><circle cx="44" cy="128" r="7"/><circle cx="58" cy="142" r="3"/><path d="M82 74l10 10m0-10l-10 10"/>' +
    '<rect x="96" y="146" width="24" height="18" rx="4"/><path d="M100 146v-4h16v4"/><path d="M20 80c6-8 14-8 20 0s14 8 20 0"/></g></svg>';
  var WP = 'url("data:image/svg+xml,' + encodeURIComponent(WP_SVG) + '")';
  var WA_CSS = '.wa-chat-loading{display:flex;flex-direction:column;gap:8px;padding:8px 4px;min-height:200px}.wa-chat-loading-txt{color:#9aa4b0;font-size:14px;text-align:center}.wa-sk{display:block;height:36px;width:55%;border-radius:10px;background:#1b2027;animation:waSk 1.2s ease-in-out infinite}.wa-sk-in{align-self:flex-end}.wa-sk-out{align-self:flex-start;width:45%}.wa-sk.w2{width:35%}@keyframes waSk{50%{opacity:.4}}@media(prefers-reduced-motion:reduce){.wa-sk{animation:none}}.wa-chat-err{display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;margin:8px;padding:10px;border:1px solid #b91c1c;border-radius:8px;color:#f2f3f5}.wa-chat-err button{min-height:44px;padding:0 14px;border-radius:8px;border:1px solid #2a313a;background:#161a20;color:#f2f3f5;cursor:pointer}' +
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
    '.wa-msgs{flex:1;overflow:auto;padding:12px 7%;display:flex;flex-direction:column;gap:3px}.wa-date{text-align:center;margin:10px 0;pointer-events:none}.wa-date span{background:#1f252c;color:#b5c0ca;font-size:12.5px;padding:5px 12px;border-radius:10px;border:1px solid #2a313a}' +
    '.wa-msg{display:flex}.wa-msg.wa-in{justify-content:flex-end}.wa-msg.wa-out{justify-content:flex-start}' +
    '.wa-bubble{position:relative;max-width:65%;padding:6px 9px 8px;border-radius:10px;font-size:14.2px;line-height:19px;color:#f2f3f5;overflow-wrap:anywhere;white-space:pre-wrap}' +
    /* UX407: like WhatsApp, the business's own outgoing bubbles sit on the RIGHT (green, ticks) and the customer's incoming bubbles on the
       LEFT. The root is RTL, so outgoing = flex-start and incoming = flex-end. UX404: tails on the screen-edge side, first bubble of a run only */
    '.wa-in .wa-bubble{background:#1f252c}.wa-out .wa-bubble{background:#0f4a3c}.wa-msg.wa-first{margin-top:6px}.wa-in.wa-last .wa-bubble{border-bottom-left-radius:0}.wa-out.wa-last .wa-bubble{border-bottom-right-radius:0}' +
    '.wa-last .wa-bubble:before{content:"";position:absolute;bottom:0;width:8px;height:13px}.wa-in.wa-last .wa-bubble:before{left:-8px;background:#1f252c;-webkit-clip-path:polygon(100% 0,100% 100%,0 100%);clip-path:polygon(100% 0,100% 100%,0 100%)}.wa-out.wa-last .wa-bubble:before{right:-8px;background:#0f4a3c;-webkit-clip-path:polygon(0 0,100% 100%,0 100%);clip-path:polygon(0 0,100% 100%,0 100%)}' +
    '.wa-meta{position:absolute;bottom:3px;right:9px;left:auto;font-size:11px;line-height:15px;color:#b5c0ca;display:inline-flex;align-items:center;gap:3px;white-space:nowrap;pointer-events:none}.wa-meta>*{direction:ltr;unicode-bidi:isolate}.wa-tick{color:#b5c0ca}.wa-tick.read{color:#53bdeb}.wa-tick.failed{color:#ff9a9a;font-weight:700}.wa-msg[data-status=failed] .wa-bubble{box-shadow:inset 0 0 0 1px #b91c1c}' +
    /* UX404: smooth scrolling: contained scroller, isolated rows, native scroll anchoring, no scroll chaining */
    '.wa-msgs{overscroll-behavior:contain;-webkit-overflow-scrolling:touch;contain:layout paint}.wa-msg{flex:none;contain:layout style}.wa-list{overscroll-behavior:contain}' +
    '.wa-composer{min-height:62px;box-sizing:border-box;background:#1a1e24;border-top:1px solid #2a313a;display:flex;align-items:center;gap:10px;padding:10px 16px}.wa-composer input{flex:1;height:42px;border:1px solid #2a313a;border-radius:10px;padding:0 14px;font:inherit;font-size:15px;background:#0d0f12;color:#f2f3f5}' +
    '.wa-stale{color:#e8c46a;background:#1d1a12;border-top-color:#3a3320}' +
    '.wa-window-note{margin:0;padding:8px 14px;font-size:13px;line-height:1.6;color:#b0bbc7;background:#141a21;border-top:1px solid #29323d;text-align:center}.wa-send-err{background:#3a1416;color:#ffd5d5;border-top:1px solid #7f1d1d;padding:8px 16px;font-size:13.5px;line-height:1.6}.wa-tick.sending{font-size:10px}' +
    '.wa-composer input:disabled{background:#14171c;color:#9eacb9;cursor:not-allowed}.wa-send{width:42px;height:42px;border:0;border-radius:50%;background:#0b7a63;color:#fff;font-size:18px;cursor:pointer}.wa-send:disabled{background:#2a313a;color:#9eacb9;cursor:not-allowed}' +
    /* UX404: WhatsApp composer shell: pill [emoji][input][attach][mic] + round send; safe-area bottom; slide open/back; safe-area top while inbox is open */
    '.wa-composer .wa-c-attach,.wa-composer .wa-c-camera,.wa-composer .wa-c-mic{display:none!important}' + /* owner 2026-11-16: sending files/voice from NOVA is not built; text only, no dead buttons */
    /* UX411: photo sending on -> + and camera visible again (owner hid them while they did nothing); mic stays hidden until voice is built */
    '.wa-composer[data-media="1"] .wa-c-attach,.wa-composer[data-media="1"] .wa-c-camera{display:inline-flex!important}.wa-composer[data-media="1"][data-has-text="1"] .wa-c-camera{display:none!important}.wa-att-on{cursor:pointer;opacity:1}.wa-att-on:hover{background:#26303a}' +
    '.wa-mp{position:fixed;inset:0;z-index:2147483000;background:#0b0d10;display:flex;flex-direction:column;direction:rtl;color:#f2f3f5}.wa-mp-top{flex:none;display:flex;align-items:center;gap:8px;padding:calc(10px + env(safe-area-inset-top,0px)) 12px 10px}.wa-mp-x{width:40px;height:40px;border:0;border-radius:50%;background:#26303a;color:#f2f3f5;font-size:20px;cursor:pointer}.wa-mp-img{flex:1;min-height:0;width:100%;object-fit:contain;background:#000}.wa-mp-bar{flex:none;display:flex;align-items:center;gap:8px;padding:10px 10px calc(10px + env(safe-area-inset-bottom,0px));background:#1a1e24}.wa-mp-cap{flex:1;height:42px;border:0;border-radius:21px;padding:0 16px;font:inherit;font-size:16px;background:#0d0f12;color:#f2f3f5;outline:none}.wa-mp-send{width:46px;height:46px;border:0;border-radius:50%;background:#00a884;color:#fff;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}.wa-mp-send:disabled{opacity:.5}.wa-mp-send svg{width:22px;height:22px;transform:scaleX(-1)}.wa-mp-err{padding:6px 14px;background:#4a1f1f;color:#ffd6d6;font-size:13px}' +
    '.wa-pill{flex:1;min-width:0;display:flex;align-items:center;gap:2px;background:#0d0f12;border:1px solid #2a313a;border-radius:24px;padding:0 4px}.wa-pill input{flex:1;min-width:0;border:0!important;background:transparent!important;border-radius:0!important;padding:0 6px!important;outline:none}.wa-pill:focus-within{border-color:#3d6f63}' +
    '.wa-cbtn{flex:none;width:40px;height:40px;padding:0;border:0;border-radius:50%;background:transparent;color:#9eacb9;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}.wa-cbtn svg{width:22px;height:22px}.wa-cbtn:hover{color:#f2f3f5}.wa-cbtn:focus-visible{outline:2px solid #79c9eb}.wa-cbtn[aria-disabled=true]{cursor:default}' +
    '.wa-composer{gap:8px;padding:8px 10px calc(8px + env(safe-area-inset-bottom,0px))}.wa-send{flex:none;display:inline-flex;align-items:center;justify-content:center}.wa-send svg{width:22px;height:22px;transform:scaleX(-1)}' +
    '@keyframes waOpen{from{transform:translate3d(-100%,0,0)}to{transform:none}}@keyframes waBack{from{transform:translate3d(28%,0,0);opacity:.6}to{transform:none;opacity:1}}' +
    '@media(max-width:700px){.wa-root[data-anim=open] .wa-main{animation:waOpen .2s cubic-bezier(.2,.8,.2,1) var(--wa-ad,0s) both}.wa-root[data-anim=back] .wa-side{animation:waBack .2s cubic-bezier(.2,.8,.2,1) var(--wa-ad,0s) both}.wa-root{border-radius:0;border-inline:0}}' +
    '@media(prefers-reduced-motion:reduce){.wa-root[data-anim] .wa-main,.wa-root[data-anim] .wa-side{animation:none}.wa-tolatest{transition:none}}' +
    'body[data-active-page=inbox] .nova-nav-row{box-sizing:content-box;padding-top:var(--wa-sat,env(safe-area-inset-top,0px))}body[data-active-page=inbox] #novaInboxView{padding:12px env(safe-area-inset-right,0px) max(12px,env(safe-area-inset-bottom,0px)) env(safe-area-inset-left,0px)}@media(max-width:700px){body[data-active-page=inbox] #novaInboxView{padding-block:0}}' +
    '.wa-empty{margin:auto;color:#b5c0ca;text-align:center;padding:24px;display:flex;flex-direction:column;align-items:center;gap:12px;font-size:16px}.wa-empty svg{color:#76b8d5;opacity:.9}.wa-note{font-size:12px;color:#9eacb9;text-align:center;padding:4px}' +
    '.wa-sys{text-align:center;margin:6px 0}.wa-sys span{display:inline-block;max-width:80%;background:#1a1e24;color:#d7c27a;font-size:12.5px;line-height:18px;padding:5px 12px;border-radius:8px;border:1px solid #2a313a;white-space:pre-wrap;overflow-wrap:anywhere}' +
    '.wa-who{display:block;font-size:12px;font-weight:600;margin-bottom:2px}.wa-who-bot{color:#7fd1b9}.wa-who-ph{color:#79c9eb}' +
    '.wa-side-head{justify-content:space-between}.wa-histst{display:flex;align-items:center;gap:6px;margin-inline-start:auto;font-size:12px;font-weight:500;color:#9fb0bf;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    /* UX400b: WhatsApp Web frame: row menu (pin/archive), archived row, pinned icon, chat wallpaper, intro pane, composer shell */
    '.wa-item{position:relative}.wa-pinic{flex:none;display:inline-flex;color:#9eacb9}.wa-pinic svg{width:15px;height:15px}' +
    '.wa-menu{position:absolute;inset-inline-end:12px;top:60px;z-index:5;min-width:190px;padding:6px 0;background:#1f252c;border:1px solid #2a313a;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.55);display:flex;flex-direction:column}.wa-item:nth-child(n+4):nth-last-child(-n+2) .wa-menu{top:auto;bottom:44px}.wa-menu button{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 16px;border:0;background:none;color:#f2f3f5;font:inherit;font-size:14.5px;text-align:start;cursor:pointer}.wa-menu button:hover,.wa-menu button:focus-visible{background:#2a313a;outline:none}.wa-menu svg{width:18px;height:18px;color:#9eacb9;flex:none}' +
    '.wa-archrow,.wa-archhead{display:flex;align-items:center;gap:13px;width:100%;min-height:49px;padding:0 15px;border:0;border-bottom:1px solid #232a32;background:#14171c;color:#f2f3f5;font:inherit;font-size:15px;text-align:start;cursor:pointer}.wa-archrow:hover,.wa-archhead:hover{background:#1f252c}.wa-archrow:focus-visible,.wa-archhead:focus-visible{outline:2px solid #79c9eb;outline-offset:-2px}.wa-archrow svg,.wa-archhead svg{width:20px;height:20px;flex:none;color:#25d366}.wa-archrow-t{flex:1}.wa-archrow-n{font-size:12px;color:#25d366;font-weight:600}.wa-archhead{font-weight:600;background:#1a1e24}.wa-archhead svg{color:#cfd8df}' +
    '.wa-msgs{background-color:#0b0d10;background-image:' + WP + ';background-size:180px 180px}.wa-head{flex:none}.wa-composer{flex:none}.wa-composer input{border-radius:8px}' +
    '.wa-intro{margin:auto;max-width:460px;padding:32px 24px;gap:14px}.wa-intro svg{width:72px;height:72px}.wa-intro h2{margin:0;font-size:22px;font-weight:500;color:#e7edf2}.wa-intro p{margin:0;font-size:14px;line-height:1.7;color:#9eacb9}.wa-main.wa-noselect{border-bottom:6px solid #0b7a63;box-sizing:border-box}' +
    '@media(max-width:700px){.wa-side{width:100%;max-width:none}.wa-root[data-view=chat] .wa-side{display:none}.wa-root[data-view=list] .wa-main{display:none}.wa-back{display:inline-flex}.wa-head{padding:0 8px}.wa-bubble{max-width:85%}.wa-msgs{padding:10px 4%}.wa-side{min-width:0;border-inline-start:0}}' +
    '@media(pointer:coarse),(max-width:700px){.wa-menu{top:66px}.wa-archrow,.wa-archhead{min-height:52px}}';

  /* UX407: composer like WhatsApp on iPhone: no blue focus box (the page-wide input:focus-visible !important ring is overridden by an
     id-level !important rule), no tap highlight; while the keyboard is open (data-kbd, set by NOVA_FIX50_VV) the home-indicator
     safe-area padding is dropped so the row sits directly on the keyboard. */
  WA_CSS += '.wa-composer,.wa-composer *{-webkit-tap-highlight-color:transparent}#waComposer #waInput,#waComposer #waInput:focus,#waComposer #waInput:focus-visible,#waComposer #waInput:focus-within{outline:none!important;outline-offset:0!important;box-shadow:none!important;-webkit-appearance:none;appearance:none}' +
    '.wa-root[data-kbd] .wa-composer{padding-bottom:8px}';
  /* UX400: no PIN on staging/preview; while the first list loads the empty list says so (no lock state). */
  var LIST_LOADING = '<div class="wa-empty" data-wa-list-loading role="status"><span>جاري تحميل المحادثات…</span></div>';
  /* UX236: Arabic-insensitive search key: tashkeel/tatweel removed, hamza/alef forms, ya/alef-maqsura, ta-marbuta, Arabic-Indic digits folded */
  /* UX405: media bubbles (Black Edition) */
  WA_CSS += '.wa-has-media{padding:3px 3px 6px}.wa-cap{display:block;padding:5px 6px 0}.wa-media-only{padding:3px 3px 20px}.wa-mo-ov{padding:3px}.wa-mo-ov .wa-meta{bottom:7px;right:10px;left:auto;padding:1px 6px;border-radius:8px;background:rgba(0,0,0,.45);color:#f2f3f5}' +
    '.wa-media{display:block;box-sizing:border-box;border-radius:8px;overflow:hidden;color:#f2f3f5;font:inherit;text-decoration:none}button.wa-media{padding:0;border:0;background:#0d0f12;cursor:zoom-in}.wa-media:focus-visible{outline:2px solid #79c9eb;outline-offset:2px}' +
    '.wa-m-image{display:block;width:auto;max-width:100%}.wa-m-image .wa-mimg{display:block;width:auto;height:auto;max-width:min(300px,68vw);max-height:min(420px,58dvh);min-width:96px;min-height:64px}.wa-mimg{object-fit:contain;background:#0d0f12;color:transparent}' +
    'button.wa-m-sticker{background:none;width:150px;height:150px}.wa-m-sticker .wa-mimg{display:block;width:150px;height:150px;object-fit:contain}.wa-bubble.wa-mo-ov:has(.wa-m-sticker){background:none!important;box-shadow:none}.wa-bubble.wa-mo-ov:has(.wa-m-sticker):before{display:none}' +
    '.wa-m-audio{display:flex;align-items:center;gap:8px;padding:6px 8px;width:min(300px,66vw);background:rgba(0,0,0,.18)}.wa-maudio{flex:1;min-width:0;height:40px;color-scheme:dark}.wa-mic{flex:none;display:inline-flex;width:40px;height:40px;border-radius:50%;align-items:center;justify-content:center;background:#2a313a;color:#cfd8df}' +
    '.wa-m-video{width:min(280px,64vw);background:#000}.wa-mvideo{display:block;width:100%;max-height:320px;background:#000}' +
    '.wa-mdoc{display:flex;align-items:center;gap:10px;min-height:56px;padding:8px 10px;width:min(280px,64vw);background:rgba(0,0,0,.22);cursor:pointer}.wa-mdoc:hover{background:rgba(0,0,0,.32)}.wa-mdoc-t,.wa-mmiss-t{display:flex;flex-direction:column;min-width:0;gap:2px}.wa-mdoc-t b,.wa-mmiss-t b{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wa-mdoc-t span,.wa-mmiss-t span{font-size:12px;color:#b5c0ca;line-height:1.5;white-space:normal}' +
    '.wa-mmiss{display:flex;align-items:center;gap:10px;padding:8px 10px;width:min(280px,64vw);background:rgba(0,0,0,.22);border:1px dashed #3a4450}.wa-mmiss .wa-mic{color:#d7c27a}';
  /* UX401: WhatsApp Web chat pane (Black Edition = WhatsApp dark): SVG ticks, reply/quote, swipe-to-reply, voice player, document type,
     emoji picker, attach menu, quote bar, tap feedback. Only transform/opacity animate (compositor), all off with reduced motion. */
  WA_CSS += '.wa-tick{display:inline-flex;align-items:center;color:#9eacb9}.wa-tick svg{display:block}.wa-tick.read{color:#53bdeb}.wa-tick.failed{color:#ff6b7a}.wa-preview .wa-tick{vertical-align:-2px;display:inline-flex}' +
    '.wa-quote{display:flex;flex-direction:column;gap:1px;width:100%;min-width:140px;box-sizing:border-box;margin:0 0 4px;padding:5px 10px 6px;border:0;border-inline-start:4px solid #a5b4fc;border-radius:7px;background:rgba(0,0,0,.24);color:inherit;font:inherit;line-height:18px;text-align:start;white-space:normal;cursor:pointer;-webkit-tap-highlight-color:transparent}.wa-quote.wa-q-out{border-inline-start-color:#06cf9c}' +
    '.wa-q-who{font-size:12.5px;font-weight:600;color:#a5b4fc}.wa-q-out .wa-q-who{color:#06cf9c}.wa-q-txt{font-size:13px;color:#c4ccd4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow-wrap:anywhere}.wa-quote:focus-visible{outline:2px solid #79c9eb;outline-offset:1px}.wa-has-media .wa-quote{margin:0 0 3px}' +
    '.wa-rbtn{flex:none;align-self:center;width:30px;height:30px;margin:0 6px;padding:0;border:0;border-radius:50%;background:rgba(31,37,44,.92);color:#cfd8df;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;opacity:0;transition:opacity .12s}.wa-msg:hover .wa-rbtn,.wa-rbtn:focus-visible{opacity:1}.wa-rbtn:hover{color:#fff;background:#2a313a}@media(hover:none),(pointer:coarse){.wa-rbtn{display:none}}' +
    '.wa-msg{touch-action:pan-y}.wa-msg .wa-bubble{transition:transform .18s cubic-bezier(.2,.8,.2,1)}.wa-msg[data-swipe] .wa-bubble{transition:none}.wa-swipe-ic{position:absolute;top:50%;margin-top:-16px;width:32px;height:32px;border-radius:50%;background:#1f252c;color:#cfd8df;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none}.wa-in .wa-swipe-ic{left:-44px}.wa-out .wa-swipe-ic{right:-44px}' +
    '@media(pointer:coarse){.wa-bubble{-webkit-touch-callout:none}}' +
    '.wa-msg.wa-flash .wa-bubble{animation:waFlash 1.4s ease-out}@keyframes waFlash{0%,35%{box-shadow:0 0 0 3px rgba(83,189,235,.6)}100%{box-shadow:0 0 0 0 rgba(83,189,235,0)}}' +
    '.wa-msg[data-live]{animation:waPop .2s cubic-bezier(.2,.8,.2,1) both}' + /* UX402: a bubble that arrived by the live poll slides in (no flash) */
    '.wa-msg[data-status=sending]{animation:waPop .18s cubic-bezier(.2,.8,.2,1) both}@keyframes waPop{from{opacity:0;transform:translate3d(0,10px,0)}to{opacity:1;transform:none}}' +
    '.wa-qbar{flex:none;display:flex;align-items:center;gap:6px;padding:6px 10px 0;background:#1a1e24;border-top:1px solid #2a313a;animation:waUp .16s cubic-bezier(.2,.8,.2,1) both}.wa-qbar .wa-quote{flex:1;min-width:0;margin:0;cursor:default}.wa-qbar+.wa-composer{border-top:0}' +
    '.wa-qx{flex:none;width:40px;height:40px;padding:0;border:0;border-radius:50%;background:transparent;color:#9eacb9;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}.wa-qx svg{width:20px;height:20px}.wa-qx:hover{color:#f2f3f5}.wa-qx:focus-visible{outline:2px solid #79c9eb}' +
    '@keyframes waUp{from{opacity:0;transform:translate3d(0,8px,0)}to{opacity:1;transform:none}}' +
    '.wa-composer{position:relative}.wa-composer[data-send=off] .wa-cbtn{opacity:.5}.wa-cbtn[aria-expanded=true]{color:#06cf9c}' +
    '.wa-emoji,.wa-attmenu{position:absolute;bottom:100%;z-index:6;margin-bottom:6px;background:#1f252c;border:1px solid #2a313a;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.55);animation:waUp .14s cubic-bezier(.2,.8,.2,1) both}.wa-emoji[hidden],.wa-attmenu[hidden]{display:none}' +
    '.wa-emoji{inset-inline:8px;max-width:420px;max-height:min(232px,36dvh);overflow:auto;overscroll-behavior:contain;padding:6px}.wa-emoji-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(44px,1fr));gap:2px}' +
    '.wa-emo{width:100%;height:44px;padding:0;border:0;border-radius:8px;background:transparent;font-size:24px;line-height:44px;cursor:pointer;font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif}.wa-emo:hover,.wa-emo:focus-visible{background:#2a313a;outline:none}' +
    '.wa-attmenu{inset-inline-end:58px;width:min(270px,calc(100% - 24px));padding:6px 0;display:flex;flex-direction:column}.wa-att{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 16px;border:0;background:none;color:#f2f3f5;font:inherit;font-size:14.5px;text-align:start;cursor:not-allowed;opacity:.6}.wa-att svg{width:20px;height:20px;flex:none;color:#06cf9c}' +
    '.wa-att-note{margin:4px 0 2px;padding:8px 16px 4px;border-top:1px solid #2a313a;font-size:12.5px;line-height:1.6;color:#b5c0ca}' +
    '.wa-voice{display:flex;align-items:center;gap:8px;padding:6px 8px;width:min(300px,66vw)}.wa-voice .wa-maudio{display:none}.wa-vplay{flex:none;width:40px;height:40px;padding:0;border:0;border-radius:50%;background:transparent;color:#cfd8df;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}.wa-vplay:focus-visible{outline:2px solid #79c9eb}' +
    '.wa-vplay .wa-i-pause,.wa-vplay[aria-pressed=true] .wa-i-play{display:none}.wa-vplay[aria-pressed=true] .wa-i-pause{display:block}' +
    '.wa-vtrack{position:relative;flex:1;min-width:60px;height:24px;cursor:pointer;touch-action:none}.wa-vtrack:before{content:"";position:absolute;inset-inline:0;top:11px;height:3px;border-radius:2px;background:#4a5563}.wa-vfill{position:absolute;top:11px;inset-inline-start:0;height:3px;width:var(--p,0%);border-radius:2px;background:#53bdeb}.wa-vdot{position:absolute;top:5.5px;inset-inline-start:calc(var(--p,0%) - 6px);width:13px;height:13px;border-radius:50%;background:#53bdeb}' +
    '.wa-vdur{flex:none;min-width:34px;font-size:12px;color:#b5c0ca;direction:ltr;unicode-bidi:isolate;font-variant-numeric:tabular-nums}.wa-vmic{width:34px;height:34px;color:#06cf9c}.wa-vmic svg{width:18px;height:18px}' +
    '.wa-mdoc-ic{position:relative}.wa-mext{position:absolute;bottom:-4px;left:50%;transform:translateX(-50%);padding:0 4px;border-radius:3px;background:#2f7de1;color:#fff;font-size:9px;font-weight:700;line-height:14px;letter-spacing:.3px}.wa-mdoc-ic[data-wa-ext=PDF] .wa-mext{background:#d9363e}' +
    '.wa-cbtn,.wa-send,.wa-vplay,.wa-qx,.wa-emo,.wa-rbtn,.wa-tolatest{transition:transform .08s ease-out,opacity .12s}.wa-cbtn:active,.wa-send:active,.wa-vplay:active,.wa-qx:active,.wa-emo:active,.wa-rbtn:active,.wa-tolatest:active{transform:scale(.9)}.wa-chat:active{background:#232a32}' +
    '@media(prefers-reduced-motion:reduce){.wa-msg[data-live],.wa-msg[data-status=sending],.wa-qbar,.wa-emoji,.wa-attmenu,.wa-msg.wa-flash .wa-bubble{animation:none}.wa-msg .wa-bubble,.wa-cbtn,.wa-send,.wa-vplay,.wa-qx,.wa-emo,.wa-rbtn{transition:none}}';
  /* UX408: WhatsApp iOS review (owner iPhone shots + design-lead frames). Phone: the app tab strip is hidden while the conversations screen
     is open, so ONE solid header (list or chat) sits below the status bar (padding-top = safe-area top; --wa-sat simulates it in tests) and
     the root fills the viewport (flex children min-height:0) so the list scrolls to its last row. Bubbles 17px / 16px corners, tail on the
     last bubble of a run, time+ticks bottom-right, one floating date chip (shown while scrolling, never stacked), list chips + bold unread. */
  WA_CSS += '.wa-msg{align-items:flex-end}.wa-msg>.wa-rbtn{align-self:center}.wa-bubble{padding:6px 10px 7px;border-radius:16px;font-size:15.5px;line-height:21px}@media(max-width:700px),(pointer:coarse){.wa-bubble{font-size:17px;line-height:22px}}' +
    '.wa-tl,.wa-tl.wa-cap{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:flex-end;column-gap:8px;direction:ltr;min-width:0}.wa-tl.wa-cap{padding:5px 6px 0}.wa-tl>.wa-text{flex:0 1 auto;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}.wa-tl>.wa-meta{position:static;flex:none;margin:0 -3px -4px 0}' +
    '.wa-dfloat{position:sticky;top:6px;z-index:4;flex:none;height:0;margin:0;text-align:center;pointer-events:none;visibility:hidden;opacity:0;transition:opacity .2s,visibility 0s linear .2s}.wa-dfloat[data-show]{visibility:visible;opacity:1;transition:opacity .12s}.wa-dfloat span{display:inline-block;background:#1f252c;color:#d5dde4;font-size:12.5px;line-height:16px;padding:5px 12px;border-radius:10px;border:1px solid #2a313a;box-shadow:0 1px 3px rgba(0,0,0,.4)}' +
    '.wa-head{gap:6px}.wa-back{width:44px;height:44px;margin-inline-end:-8px}.wa-head .wa-avatar{width:38px;height:38px;font-size:16px}.wa-head-name{font-size:17px;font-weight:600;line-height:22px}.wa-sub{font-size:12.5px;line-height:16px}' +
    '.wa-hact{display:flex;align-items:center;gap:0;flex:none}.wa-hbtn{width:44px;height:44px;padding:0;border:0;border-radius:50%;background:transparent;color:#53bdeb;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;text-decoration:none}.wa-hbtn svg{width:23px;height:23px}.wa-hbtn[aria-disabled=true]{color:#5d6b78;cursor:default}.wa-hbtn:focus-visible,.wa-home:focus-visible{outline:2px solid #79c9eb}' +
    '.wa-side-head{gap:8px}.wa-title{margin:0;font-size:20px;font-weight:700;line-height:1.2;white-space:nowrap}.wa-home{display:none;flex:none;width:44px;height:44px;padding:0;border:0;border-radius:50%;background:transparent;color:#cfd8df;align-items:center;justify-content:center;cursor:pointer}.wa-home svg{width:22px;height:22px}' +
    '.wa-chips{flex:none;display:flex;gap:8px;padding:0 12px 8px;background:#14171c;overflow-x:auto;scrollbar-width:none}.wa-chips::-webkit-scrollbar{display:none}.wa-chip{flex:none;min-height:36px;padding:0 14px;border-radius:18px;border:0;background:#1f252c;color:#cfd8df;font:inherit;font-size:14px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;gap:6px}.wa-chip[aria-pressed=true]{background:#0f3d2e;color:#25d366}.wa-chip:focus-visible{outline:2px solid #79c9eb;outline-offset:2px}@media(pointer:coarse){.wa-chip{min-height:44px;border-radius:22px}}' +
    '.wa-chip-n{min-width:18px;height:18px;padding:0 5px;box-sizing:border-box;border-radius:9px;background:#25d366;color:#06210f;font-size:11.5px;font-weight:700;line-height:18px;text-align:center}' +
    '.wa-chat.unread .wa-name{font-weight:700;color:#fff}.wa-chat.unread .wa-ctime{color:#25d366;font-weight:600}.wa-chat.unread .wa-preview{color:#d5dde4}.wa-chat[data-state=noreply] .wa-ctime{color:#25d366}.wa-wait{flex:none;width:10px;height:10px;margin-inline-start:6px;border-radius:50%;background:#25d366}.wa-preview .wa-tick{color:#9eacb9}.wa-preview .wa-tick.read{color:#53bdeb}' +
    '.wa-more{display:block;width:calc(100% - 24px);margin:10px 12px;min-height:44px;border:1px solid #2a313a;border-radius:22px;background:#1a1e24;color:#79c9eb;font:inherit;font-size:14px;cursor:pointer}.wa-more[disabled]{opacity:.7;cursor:progress}.wa-older{min-height:40px;padding:0 18px;font-size:14px}@media(pointer:coarse){.wa-older{min-height:44px}}' +
    '.wa-composer{gap:6px;padding:6px 8px max(8px,var(--wa-sab,env(safe-area-inset-bottom,0px)))}.wa-composer>.wa-cbtn{width:40px;height:40px}.wa-composer .wa-c-attach{color:#53bdeb}.wa-composer .wa-c-attach svg{width:26px;height:26px}.wa-pill{min-height:38px;padding:0 12px;border-radius:20px}#waComposer .wa-pill input{height:36px;font-size:17px}' +
    '.wa-composer[data-has-text="0"] .wa-send{display:none}.wa-composer[data-has-text="1"] .wa-c-camera,.wa-composer[data-has-text="1"] .wa-c-mic{display:none}.wa-send{width:40px;height:40px}.wa-attmenu{inset-inline-end:auto;inset-inline-start:8px}' +
    '.wa-side,.wa-main{min-height:0}.wa-list{min-height:0;-webkit-overflow-scrolling:touch}' +
    /* UX409/UX413: fill the screen with 100dvh and --wa-app-h (window.innerHeight in standalone). No max-height:100dvh (that left a near-black band on iPhone PWAs). No leftover tab-bar spacer. List background reaches the bottom edge; padding-bottom: env(safe-area-inset-bottom) lives INSIDE the scroll area. Open chat: the composer sits flush on the bottom edge, only padding-bottom env(safe-area-inset-bottom) inside the bar (same #1a1e24 colour). UX407 zero keyboard gap kept (data-kbd drops the home-indicator padding). html/body use the list colour (#14171c!important) so a shortfall cannot show #050607. */
    '@media(max-width:700px){body[data-active-page=inbox],html.app-whatsapp,html.app-whatsapp body{height:var(--wa-app-h,100dvh);min-height:var(--wa-app-h,100dvh);max-height:none;overflow:hidden;background:#14171c!important}body[data-active-page=inbox] .nova-nav-row{display:none!important}body[data-active-page=inbox] #novaInboxView,html.app-whatsapp #novaInboxView{position:fixed;inset:0;width:100%;height:var(--wa-app-h,100dvh);min-height:var(--wa-app-h,100dvh);max-height:none;box-sizing:border-box;overflow:hidden;margin:0;padding:0;background:#14171c}#novaInboxView>.wa-root{flex:1 1 0;min-height:0;height:100%;border:0;border-radius:0;background:#14171c}.wa-side{height:100%;min-height:0;background:#14171c}.wa-main{height:100%;min-height:0}.wa-list{padding-bottom:var(--wa-sab,env(safe-area-inset-bottom,0px));background:#14171c}.wa-composer{margin:0;background:#1a1e24;padding-bottom:max(8px,var(--wa-sab,env(safe-area-inset-bottom,0px)))}.wa-root[data-kbd] .wa-composer{padding-bottom:8px}html:has(.wa-root[data-view=chat]),html.app-whatsapp:has(.wa-root[data-view=chat]){background:#1a1e24!important}html:has(.wa-root[data-view=list]),html.app-whatsapp:has(.wa-root[data-view=list]){background:#14171c!important}' +
    '.wa-side-head,.wa-head{height:auto;min-height:calc(56px + var(--wa-sat,env(safe-area-inset-top,0px)));padding-top:var(--wa-sat,env(safe-area-inset-top,0px));background:#1a1e24}.wa-side-head{padding-inline:4px 14px}.wa-title{font-size:24px}.wa-home{display:inline-flex}' +
    /* UX413: app-whatsapp inset — 16px + safe-area on both sides for rows, header, search, chips, bubbles, composer. */
    'html.app-whatsapp,html.app-whatsapp body{background:#14171c!important;height:var(--wa-app-h,100dvh)!important;min-height:var(--wa-app-h,100dvh)!important;max-height:none!important}html.app-whatsapp #novaInboxView{max-height:none!important;height:var(--wa-app-h,100dvh)!important;background:#14171c!important}html.app-whatsapp .wa-chat,html.app-whatsapp .wa-side-head,html.app-whatsapp .wa-head,html.app-whatsapp .wa-search,html.app-whatsapp .wa-chips,html.app-whatsapp .wa-composer,html.app-whatsapp .wa-msgs{padding-left:calc(16px + var(--wa-sal,env(safe-area-inset-left,0px)))!important;padding-right:calc(16px + var(--wa-sar,env(safe-area-inset-right,0px)))!important}html.app-whatsapp .wa-composer{padding-bottom:max(8px,var(--wa-sab,env(safe-area-inset-bottom,0px)))!important}html.app-whatsapp .wa-root[data-kbd] .wa-composer{padding-bottom:8px!important}}';
  var LB_CSS = '.wa-lb{position:fixed;inset:0;width:100vw;height:100vh;height:100dvh;z-index:2147483000;background:#000;display:flex;flex-direction:column;touch-action:none;transition:opacity .15s}' +
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
    var uOf = function (c) { return typeof meta.unread === 'function' ? meta.unread(c) : unreadCount(c); }, flt = FILTERS[meta.filter] ? meta.filter : 'all';
    var items = all.filter(function (c) { if (!nq) return showA ? !!ar[c.id] : !ar[c.id]; var h = convHit(c, nq); hits[c.id] = h.msg; return h.found; })
      .filter(function (c) { return flt === 'all' || (flt === 'noreply' ? needsReply(c) : uOf(c) > 0); })
      .sort(function (a, b) { return (pin[b.id] ? 1 : 0) - (pin[a.id] ? 1 : 0) || b.updatedAt - a.updatedAt; });
    var head = nq || flt !== 'all' ? '' : showA ? '<button type="button" class="wa-archhead" data-wa-arch-close aria-label="رجوع إلى كل المحادثات">' + IC_BACK + '<span>المؤرشفة</span></button>'
      : nArch ? '<button type="button" class="wa-archrow" data-wa-arch-open>' + IC_ARCH + '<span class="wa-archrow-t">المؤرشفة</span><span class="wa-archrow-n" data-arch-count="' + nArch + '">' + nArch + '</span></button>' : '';
    var more = moreHtml(meta.more);
    if (!items.length) return head + (loading && !rawQ ? LIST_LOADING : rawQ ? '<div class="wa-empty" data-wa-noresult>لا نتائج لـ “' + esc(rawQ) + '”</div>' : flt !== 'all' ? '<div class="wa-empty" data-wa-nofilter>' + FILTERS[flt][1] + '</div>' : '<div class="wa-empty">لا توجد محادثات</div>') + more;
    return head + items.map(function (c) {
      var ms = arr(c.messages), last = ms[ms.length - 1], u = uOf(c), name = dispName(c), pv = hits[c.id] || last, isP = !!pin[c.id], isA = !!ar[c.id], open = meta.menu === c.id, act = c.id === selId;
      /* UX408: row state like WhatsApp iOS. unread (unseen customer messages) or «لم يُرد» (last message from the customer) => green count
         badge + bold name + green time; replied (last message from the pharmacy/bot) => the grey ticks before the preview. The open chat
         itself shows no badge. No per-row ▾ button: the row is the control (pin/archive = long-press / right-click / context-menu key). */
      var wait = needsReply(c), n = typeof meta.unread === 'function' ? u : Math.max(u, wait && !act ? trailingIn(c) : 0), stt = u > 0 ? 'unread' : wait ? 'noreply' : last && last.dir === 'out' ? 'replied' : 'none';
      return '<div class="wa-item' + (isP ? ' pinned' : '') + (isA ? ' archived' : '') + '" data-wa-item' + (isP ? ' data-pinned' : '') + (isA ? ' data-archived' : '') + '>' +
        '<button type="button" class="wa-chat' + (act ? ' active' : '') + (n ? ' unread' : '') + '" data-conv="' + esc(c.id) + '" data-state="' + stt + '"' + (act ? ' aria-current="true"' : '') + (open ? ' aria-expanded="true"' : '') + ' aria-haspopup="menu" aria-label="' + esc(name + (n ? ' — ' + n + (stt === 'unread' ? ' رسالة غير مقروءة' : ' رسالة مستنية رد') : stt === 'replied' ? ' — اترد عليها' : stt === 'noreply' ? ' — لم يُرد' : '')) + '">' +
        '<span class="wa-avatar" aria-hidden="true">' + avatarHtml(c) + '</span><span class="wa-chat-body" aria-hidden="true"><span class="wa-row"><span class="wa-name">' + nameHtml(name) + '</span>' +
        '<span class="wa-ctime">' + (last ? esc(dateLabel(last.at, now) === 'اليوم' ? timeLabel(last.at) : dateLabel(last.at, now)) : '') + '</span></span>' +
        '<span class="wa-row"><span class="wa-preview">' + (pv ? (pv.dir === 'out' ? tick(pv) + ' ' : '') + esc(previewText(pv)) : '') + '</span>' +
        (isP ? '<span class="wa-pinic" data-wa-pinned title="مثبتة">' + IC_PIN + '</span>' : '') +
        (n ? '<span class="wa-badge" data-unread="' + n + '">' + (n > 99 ? '99+' : n) + '</span>' : stt === 'noreply' && !act ? '<span class="wa-wait" data-wa-wait title="لم يُرد"></span>' : '') + '</span></span></button>' +
        (open ? '<div class="wa-menu" role="menu" data-wa-menu-for="' + esc(c.id) + '"><button type="button" role="menuitem" data-wa-pin="' + esc(c.id) + '">' + IC_PIN + '<span>' + (isP ? 'إلغاء تثبيت المحادثة' : 'تثبيت المحادثة') + '</span></button>' +
          '<button type="button" role="menuitem" data-wa-arch="' + esc(c.id) + '">' + IC_ARCH + '<span>' + (isA ? 'إلغاء أرشفة المحادثة' : 'أرشفة المحادثة') + '</span></button></div>' : '') + '</div>';
    }).join('') + more;
  }
  /* UX408: filter chips under the search field: الكل / لم يُرد / غير مقروء (counts over the main, non-archived list) */
  var FILTERS = { all: ['الكل', ''], noreply: ['لم يُرد', 'مفيش محادثات مستنية رد — كله اترد عليه'], unread: ['غير مقروء', 'مفيش رسائل غير مقروءة'] };
  function chipsHtml(convs, meta) {
    meta = meta || {}; var ar = meta.archived || {}, f = FILTERS[meta.filter] ? meta.filter : 'all', main = arr(convs).filter(function (c) { return !ar[c.id]; });
    var uOf = function (c) { return typeof meta.unread === 'function' ? meta.unread(c) : unreadCount(c); };
    var n = { all: main.length, noreply: main.filter(needsReply).length, unread: main.filter(function (c) { return uOf(c) > 0; }).length };
    return '<div class="wa-chips" role="group" aria-label="تصفية المحادثات" data-wa-chips>' + Object.keys(FILTERS).map(function (k) {
      return '<button type="button" class="wa-chip" data-wa-filter="' + k + '" aria-pressed="' + (k === f) + '">' + FILTERS[k][0] + (k !== 'all' && n[k] ? ' <span class="wa-chip-n" data-n="' + n[k] + '">' + n[k] + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }
  /* UX408: list load-more (the history API returns at most 300 chats per call). more = 'idle' | 'busy' | 'done' | falsy (nothing more). */
  function moreHtml(more) {
    if (more === 'idle' || more === 'busy') return '<button type="button" class="wa-more" data-wa-more-chats' + (more === 'busy' ? ' aria-busy="true" disabled' : '') + '>' + (more === 'busy' ? 'جاري تحميل محادثات أقدم…' : 'تحميل محادثات أقدم') + '</button>';
    if (more === 'done') return '<div class="wa-note" data-wa-more-done>دي كل المحادثات المتاحة من السيرفر</div>';
    return '';
  }
  /* UX404: composer affordances like WhatsApp. UX401: emoji opens a real picker (inserts into the text field, nothing is sent until the
     pharmacist presses send); attach opens a menu that says plainly that files cannot be sent to customers from NOVA yet (text only, the
     backend send is text-only); the mic stays inert («قريباً»). With sending off / 24h window closed every control is disabled. */
  var IC_EMOJI = '<svg' + SVGA + '><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0"/><path d="M9 9.5h.01M15 9.5h.01"/></svg>';
  var IC_CLIP = '<svg' + SVGA + '><path d="M20.5 11.5l-8.3 8.3a5 5 0 0 1-7-7l8.3-8.3a3.3 3.3 0 0 1 4.7 4.7l-8.4 8.3a1.7 1.7 0 0 1-2.3-2.3l7.7-7.7"/></svg>';
  var IC_MIC = '<svg' + SVGA + '><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>';
  var IC_SEND = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4l17.4-7.5a1 1 0 0 0 0-1.8L3.4 3.6a.9.9 0 0 0-1.3 1l1.9 6.4 9 1-9 1-1.9 6.4a.9.9 0 0 0 1.3 1z"/></svg>';
  function cBtn(k, label, ic) { return '<button type="button" class="wa-cbtn wa-c-' + k + '" data-wa-' + k + ' aria-label="' + label + ' (قريباً)" title="قريباً" aria-disabled="true">' + ic + '</button>'; }
  function cTog(k, label, ic, on, open, ctl, pop) { return on ? '<button type="button" class="wa-cbtn wa-c-' + k + '" data-wa-' + k + ' aria-label="' + label + '" title="' + label + '" aria-haspopup="' + pop + '" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="' + ctl + '">' + ic + '</button>' : '<button type="button" class="wa-cbtn wa-c-' + k + '" data-wa-' + k + ' aria-label="' + label + ' (الإرسال متوقف)" aria-disabled="true">' + ic + '</button>'; }
  var EMOJI = ['😀', '😂', '🙂', '😊', '😍', '🥰', '😉', '😅', '🤔', '😢', '😷', '🤒', '🤕', '🤧', '🙏', '🤲', '👍', '👌', '👏', '🤝', '👋', '✋', '💪', '❤️', '💚', '🌹', '🌸', '✨', '🎉', '💯', '✅', '❌', '⚠️', '⏰', '📞', '📍', '🚚', '🛵', '📦', '💊', '🩺', '💉', '🌡️', '🧴', '🏥', '💰', '🧾', '🌙'];
  function emojiPanelHtml(open) { return '<div class="wa-emoji" id="waEmoji" data-wa-emoji-panel role="dialog" aria-label="اختر رمز تعبيري"' + (open ? '' : ' hidden') + '><div class="wa-emoji-grid" role="group" aria-label="الرموز التعبيرية">' + EMOJI.map(function (e) { return '<button type="button" class="wa-emo" data-wa-emo="' + e + '" aria-label="' + e + '">' + e + '</button>'; }).join('') + '</div></div>'; }
  var IC_IMG2 = '<svg' + SVGA + '><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/></svg>';
  var IC_DOC2 = '<svg' + SVGA + '><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';
  var IC_CAM = '<svg' + SVGA + '><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  function attachMenuHtml(open, media) {
    /* UX411: with photo sending on (opts.mediaEnabled) the menu has two live items (gallery, camera); otherwise the old inert menu */
    if (media) return '<div class="wa-attmenu" id="waAttach" data-wa-attach-menu role="menu" aria-label="إرفاق"' + (open ? '' : ' hidden') + '>' +
      [['image', 'صورة من المعرض', IC_IMG2], ['camera', 'الكاميرا', IC_CAM]].map(function (x) { return '<button type="button" role="menuitem" class="wa-att wa-att-on wa-att-' + x[0] + '" data-wa-att="' + x[0] + '">' + x[2] + '<span>' + x[1] + '</span></button>'; }).join('') + '</div>';
    return '<div class="wa-attmenu" id="waAttach" data-wa-attach-menu role="menu" aria-label="إرفاق"' + (open ? '' : ' hidden') + '>' +
    [['image', 'صور وفيديو', IC_IMG2], ['document', 'مستند', IC_DOC2], ['camera', 'الكاميرا', IC_CAM]].map(function (x) { return '<button type="button" role="menuitem" class="wa-att wa-att-' + x[0] + '" data-wa-att="' + x[0] + '" aria-disabled="true">' + x[2] + '<span>' + x[1] + '</span></button>'; }).join('') +
    '<p class="wa-att-note" data-wa-att-note>إرسال الملفات للعملاء من نوفا لسه مش متاح — النص بس. ابعت الصورة أو الملف من واتساب على الموبايل.</p></div>'; }
  var IC_X = '<svg' + SVGA + '><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var IC_PLUS = '<svg' + SVGA + '><path d="M12 5v14M5 12h14"/></svg>';
  var IC_HOME = '<svg' + SVGA + '><path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>';
  var IC_CALL = '<svg' + SVGA + '><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>';
  var IC_VIDEO = '<svg' + SVGA + '><rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3z"/></svg>';
  /* composer quote bar (reply in progress); q = the quoted message, name = customer name */
  function quoteBarHtml(q, name) { return q ? '<div class="wa-qbar" data-wa-qbar data-qid="' + esc(q.id) + '">' + quoteHtml(q, name, 'div') + '<button type="button" class="wa-qx" data-wa-qcancel aria-label="إلغاء الرد">' + IC_X + '</button></div>' : ''; }
  /* opts: { selected, query, now, sendEnabled, newCount (UX404 FAB badge), anim ('open'|'back', UX404 slide),
     UX401: quote (message being replied to), quotes ({mid: quoted message}), emojiOpen, attachOpen } */
  var CHAT_LOADING = '<div class="wa-chat-loading" data-chat-loading role="status"><span class="wa-chat-loading-txt">جاري تحميل المحادثة…</span><span class="wa-sk wa-sk-in"></span><span class="wa-sk wa-sk-out"></span><span class="wa-sk wa-sk-in w2"></span></div>';
  function renderWa(convs, opts) {
    opts = opts || {}; var now = opts.now || Date.now(), sel = null;
    arr(convs).forEach(function (c) { if (c.id === opts.selected) sel = c; });
    var name = sel ? dispName(sel) : '';
    /* UX408: WhatsApp iOS status line: «آخر ظهور …» = the customer's last message (we have no live presence), never message counts */
    var subtitle = '';
    if (sel) {
      var ms0 = arr(sel.messages), lastInM = null;
      for (var k0 = ms0.length - 1; k0 >= 0; k0--) if (ms0[k0] && ms0[k0].dir === 'in' && ms0[k0].kind !== 'sys') { lastInM = ms0[k0]; break; }
      if (lastInM) { var dl = dateLabel(lastInM.at, now); subtitle = 'آخر ظهور ' + (dl === 'اليوم' ? 'اليوم ' : dl === 'أمس' ? 'أمس ' : dl + ' ') + timeLabel(lastInM.at); }
      else if (!opts.chatLoading) subtitle = 'واتساب';
    }
    var tel = sel && /^(?:wa_)?\+?(\d{8,15})$/.exec(String(sel.id));
    /* WA-LINK: the registered customer's number under the name (hidden when the name already is the number) */
    var subPhone = sel && tel && name !== localPhone(tel[1]) ? localPhone(tel[1]) : '';
    var allMs = sel ? arr(sel.messages) : [], lim = Math.max(1, Number(opts.limit) || 80), hid = Math.max(0, allMs.length - lim);
    /* UX408: older messages: the newest 80 are painted, «رسائل أقدم (N)» (or scrolling to the top) reveals 80 more; when the server holds
       more than it returned (thread cap 1000) opts.olderRemote = 'idle'|'busy'|'done' asks it for the previous page. */
    var olderBtn = hid ? '<button type="button" class="wa-older" data-wa-older>رسائل أقدم (' + hid + ')</button>'
      : opts.olderRemote === 'idle' || opts.olderRemote === 'busy' ? '<button type="button" class="wa-older" data-wa-older-remote' + (opts.olderRemote === 'busy' ? ' aria-busy="true" disabled' : '') + '>' + (opts.olderRemote === 'busy' ? 'جاري تحميل رسائل أقدم…' : 'رسائل أقدم من السيرفر') + '</button>'
      : opts.olderRemote === 'done' ? '<div class="wa-note" data-wa-older-done>بداية المحادثة المتاحة</div>' : '';
    var main = sel
      ? '<div class="wa-head"><button type="button" class="wa-back" data-wa-back aria-label="رجوع إلى المحادثات"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 5 16 12 9 19"/></svg></button><span class="wa-avatar" aria-hidden="true">' + (sel ? avatarHtml(sel) : '') + '</span><span class="wa-head-txt"><span class="wa-head-name">' + nameHtml(name) + '</span><span class="wa-sub" data-wa-sub>' + esc(subtitle) + (subPhone ? (subtitle ? ' · ' : '') + '<bdi dir="ltr">' + esc(subPhone) + '</bdi>' : '') + '</span></span>' +
        '<span class="wa-hact"><button type="button" class="wa-hbtn" data-wa-video aria-disabled="true" aria-label="مكالمة فيديو (غير متاحة من نوفا)" title="غير متاحة من نوفا">' + IC_VIDEO + '</button>' +
        (tel ? '<a class="wa-hbtn" data-wa-call href="tel:+' + esc(tel[1]) + '" aria-label="اتصال بالعميل">' + IC_CALL + '</a>' : '<button type="button" class="wa-hbtn" data-wa-call aria-disabled="true" aria-label="اتصال (الرقم غير معروف)">' + IC_CALL + '</button>') + '</span></div>' +
        '<div class="wa-msgs" id="waMsgs" data-wa-wallpaper role="log" aria-live="polite"' + (opts.chatLoading ? ' aria-busy="true"' : '') + ' aria-label="رسائل المحادثة مع ' + esc(name) + '" tabindex="-1">' + (opts.chatLoading ? '' : '<div class="wa-dfloat" data-wa-dfloat aria-hidden="true"><span></span></div>') + (opts.chatLoading ? CHAT_LOADING : '') + (opts.chatError ? '<div class="wa-chat-err" role="alert" data-chat-error><span>' + esc(opts.chatError) + '</span><button type="button" data-wa-reload>إعادة المحاولة</button></div>' : '') + (opts.chatLoading ? '' : olderBtn) + (opts.chatLoading ? '' : bubbles(hid ? allMs.slice(hid) : sel.messages, now, { url: opts.mediaUrl, fail: opts.mediaFail, quotes: opts.quotes, reply: !!opts.sendEnabled, name: name, all: allMs })) + '</div>' +
        '<button type="button" class="wa-tolatest" data-wa-latest' + (opts.newCount ? '' : ' hidden') + ' aria-label="انزل للأحدث' + (opts.newCount ? ' (' + Number(opts.newCount) + ' رسالة جديدة)' : '') + '">' + IC_DOWN + '<span class="wa-fab-n" data-wa-fab-n' + (opts.newCount ? '>' + (opts.newCount > 99 ? '99+' : Number(opts.newCount)) : ' hidden>') + '</span></button>'
      : opts.loading && !arr(convs).length ? LIST_LOADING
      : '<div class="wa-empty wa-intro" data-wa-intro><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg><h2>محادثات واتساب الصيدلية</h2><span>اختر محادثة لعرضها</span><p>الرسائل بتظهر هنا زي واتساب ويب. ابحث بالاسم أو الرقم أو نص الرسالة.</p></div>';
    var en = !!opts.sendEnabled;
    return '<style>' + WA_CSS + (opts.notifHead ? NOTIF_CSS : '') + '</style><div class="wa-root" dir="rtl" data-wa-root data-wa-inbox-open data-view="' + (sel ? 'chat' : 'list') + '"' + (opts.anim === 'open' || opts.anim === 'back' ? ' data-anim="' + opts.anim + '"' : '') + '>' +
      /* UX408: ONE header (no second «المحادثات (N)» title, no app tab strip on the phone): home + large title + count; safe-area top padding in CSS */
      '<aside class="wa-side"><div class="wa-side-head"><button type="button" class="wa-home" data-wa-home aria-label="الرجوع لنوفا (الصفحة الرئيسية)">' + IC_HOME + '</button><h1 class="wa-title">المحادثات</h1>' + (opts.notifHead || '') + (opts.histHead || '') + '</div>' + (opts.histPanel || '') + '<div class="wa-search"><input type="search" id="waSearch" aria-label="ابحث في المحادثات أو ابدأ محادثة جديدة" placeholder="ابحث أو ابدأ محادثة جديدة" value="' + esc(opts.query || '') + '" autocomplete="off" enterkeyhint="search"><button type="button" class="wa-sclear" id="waSearchClear" data-wa-sclear aria-label="مسح البحث"' + (opts.query ? '' : ' hidden') + '>×</button></div>' +
      chipsHtml(convs, opts.list) +
      '<div class="wa-list" id="waList" role="group" aria-label="قائمة المحادثات">' + chatListHtml(convs, opts.selected, opts.query, now, opts.loading, opts.list) + '</div></aside>' +
      /* UX408: WhatsApp iOS composer, not a <form> (no iOS prev/next bar): [+] [text field, nothing inside] [camera][mic] -> [send] once
         there is text (data-has-text, kept by the page on input). In RTL + is at the start (right) and mic/send at the trailing end (left). */
      '<section class="wa-main' + (sel ? '' : ' wa-noselect') + '">' + main + (sel ? (opts.sendErr ? '<div class="wa-send-err" role="alert" data-send-err>' + esc(opts.sendErr) + '</div>' : '') + (opts.windowClosed ? '<div class="wa-window-note" data-wa-window role="status">عدّى أكتر من 24 ساعة على آخر رسالة من العميل. واتساب مش بيسمح بالرد لحد ما يبعت هو رسالة جديدة، وهتفتح الكتابة تلقائياً أول ما توصل.</div>' : '') + (!opts.windowClosed && opts.staleNote ? '<div class="wa-window-note wa-stale" data-wa-stale role="status">آخر رسالة من العميل من أكتر من 24 ساعة. واتساب ممكن ما يوصّلش ردك لحد ما العميل يبعت رسالة جديدة، وساعتها هيوصل.</div>' : '') + (en ? quoteBarHtml(opts.quote, name) : '') + '<div class="wa-composer" id="waComposer" data-wa-composer role="group" aria-label="كتابة رسالة" data-has-text="' + (opts.hasText ? '1' : '0') + '"' + (opts.windowClosed ? ' data-window="closed"' : '') + (en ? '' : ' data-send="off"') + (en && opts.mediaEnabled ? ' data-media="1"' : '') + '>' + (en ? attachMenuHtml(!!opts.attachOpen, !!opts.mediaEnabled) : '') + cTog('attach', 'إرفاق', IC_PLUS, en, en && opts.attachOpen, 'waAttach', 'menu') + '<div class="wa-pill"><input type="text" id="waInput" dir="auto" maxlength="1000" enterkeyhint="send" autocomplete="off" autocapitalize="sentences" aria-label="اكتب رسالة للعميل" placeholder="' + (opts.windowClosed ? 'الرد متوقف: لازم العميل يبعت الأول' : en ? 'اكتب رسالة' : (opts.sendHint || 'الإرسال متوقف')) + '"' + (en ? '' : ' disabled') + '></div>' + (en && opts.mediaEnabled ? cTog('camera', 'الكاميرا', IC_CAM, true, false, 'waFileCam', 'dialog').replace(' aria-haspopup="dialog" aria-expanded="false" aria-controls="waFileCam"', '') : cBtn('camera', 'الكاميرا', IC_CAM)) + cBtn('mic', 'رسالة صوتية', IC_MIC) + '<button type="button" class="wa-send" data-wa-send aria-label="إرسال"' + (en ? '' : ' disabled') + '>' + IC_SEND + '</button>' + (en && opts.mediaEnabled ? '<input type="file" id="waFile" data-wa-file accept="image/*" hidden tabindex="-1" aria-hidden="true"><input type="file" id="waFileCam" data-wa-file-cam accept="image/*" capture="environment" hidden tabindex="-1" aria-hidden="true">' : '') + '</div>' : '') + '</section></div>';
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
      /* UX408: a history chat never opened on this device counts its waiting customer messages (trailing inbound run), whatever the
         first-open baseline says: a chat waiting for a reply is never shown as read. Once opened, only messages after that open count. */
      var own = st.seen[hashId(c.id)];
      if (own == null) { for (i = ms.length - 1; i >= 0; i--) { if (!ms[i] || ms[i].kind === 'sys') continue; if (!isInbound(ms[i])) break; n++; } return Math.max(n, acc[c.id] || 0); }
      for (i = 0; i < ms.length; i++) if (isInbound(ms[i]) && Number(ms[i].at) > Number(own)) n++;
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
  /* UX409: ONE bell button in the list header next to the title. bell = notifications on (granted + sound on), bell-slash = off (not allowed, denied, unsupported or muted). Tap: asks permission when not granted, toggles the sound when granted. */
  function notifyHtml(state, muted) {
    var k = PERM_AR[state] ? state : 'unsupported', on = k === 'granted' && !muted;
    var label = k === 'granted' ? (muted ? 'تشغيل إشعارات وصوت الرسائل' : 'كتم إشعارات وصوت الرسائل') : k === 'default' ? 'تفعيل إشعارات الرسائل الجديدة' : k === 'denied' ? 'الإشعارات مقفولة من المتصفح' : 'الإشعارات غير مدعومة في المتصفح ده';
    return '<span class="wa-notif" data-wa-notif data-perm="' + k + '" data-on="' + on + '">' +
      '<button type="button" class="wa-nbtn wa-bell" data-wa-notify="' + k + '" data-wa-muted="' + !!muted + '" aria-pressed="' + on + '" aria-label="' + label + '" title="' + esc(PERM_AR[k][1]) + '"' + (k === 'unsupported' ? ' aria-disabled="true"' : '') + '>' + (on ? IC_BELL : IC_BELL_OFF) + '</button></span>';
  }
  function noteHtml(note) { return '<div class="wa-nnote wa-nnote-toast" data-wa-notif-note role="status">' + esc(note) + '</div>'; }
  var NOTIF_CSS = '.wa-notif{display:inline-flex;flex:none}.wa-nbtn{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;padding:0;border-radius:50%;border:0;background:transparent;color:#25d366;font:inherit;cursor:pointer}.wa-nbtn svg{width:22px;height:22px;flex:none}.wa-nbtn[data-wa-notify=default],.wa-nbtn[data-wa-notify=unsupported]{color:#9aa4b0}.wa-nbtn[data-wa-notify=denied]{color:#fbbf24}.wa-nbtn[aria-pressed=false]{color:#9aa4b0}.wa-nbtn[aria-disabled=true]{opacity:.6;cursor:default}.wa-nbtn:focus-visible{outline:2px solid #79c9eb;outline-offset:2px}.wa-root{position:relative}.wa-nnote-toast{position:absolute;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:40;padding:10px 14px;border-radius:12px;background:#1c2128;color:#f2f3f5;font-size:13px;line-height:1.45;box-shadow:0 8px 24px rgba(0,0,0,.4);pointer-events:none}';
  /* tab badge style is inline (the tab lives outside the conversations view) */
  var TAB_BADGE_CSS = 'display:inline-block;min-width:18px;height:18px;margin-inline-start:6px;padding:0 5px;box-sizing:border-box;border-radius:9px;background:#25d366;color:#06210f;font-size:12px;font-weight:700;line-height:18px;text-align:center;vertical-align:middle';
  /* UX402: realtime like WhatsApp Web (pure helpers; the page wires them to the existing history poll hPoll).
     pollDelay: 4s while the conversations screen is visible, 15s while the user is on another screen (badges + toast still update),
     paused (null) while the browser tab is hidden (a visibilitychange resumes it) unless o.notifyBg (system notifications allowed but
     no Web Push subscription => a slow 30s poll is the only way to raise the browser Notification), exponential backoff on errors capped at 60s. */
  var POLL_FG = 4000, POLL_BG = 15000, POLL_HIDDEN = 30000, POLL_MAX = 60000;
  function pollDelay(o) {
    o = o || {}; if (o.docHidden && !o.notifyBg) return null;
    var d = o.docHidden ? POLL_HIDDEN : o.screenHidden ? POLL_BG : POLL_FG, f = Math.min(6, Math.max(0, Number(o.fails) || 0));
    return Math.min(POLL_MAX, d * Math.pow(2, f));
  }
  /* server thread + local bubbles (tmp_ sending/failed): a local bubble whose clientId/id the server already has is dropped => no duplicate bubble */
  function mergeLive(server, local) {
    var out = arr(server).slice(), have = {};
    out.forEach(function (m) { if (m) { have['i' + m.id] = 1; if (m.clientId) have['c' + m.clientId] = 1; } });
    arr(local).forEach(function (m) {
      if (!m || String(m.id).indexOf('tmp_') !== 0) return;
      var cl = String(m.id).slice(4);
      if (have['i' + m.id] || have['c' + cl] || (m.clientId && have['c' + m.clientId])) return;
      have['i' + m.id] = 1; out.push(m);
    });
    return out;
  }
  /* ids rendered now that were not on screen before (same chat) => animated in; first render of a chat => none */
  function newIds(prev, now) { if (!prev) return []; return arr(now).filter(function (id) { return !prev[id]; }); }
  /* who gets an in-app toast: a fresh customer message for a chat that is NOT the one on screen right now (mute-if-already-viewing) */
  function toastFor(fresh, o) {
    o = o || {}; var viewing = o.screenVisible && !o.docHidden ? o.selected : null;
    return arr(fresh).filter(function (f) { return f && f.id != null && !(viewing != null && String(viewing) === String(f.id)) && !(o.screenVisible && !o.docHidden && viewing == null); });
  }
  /* Arabic in-app toast for a new customer message (click opens the chat). One toast, replaced by the next one (never stacks) */
  function toastHtml(items) {
    items = arr(items); if (!items.length) return '';
    var f = items[items.length - 1], more = items.length - 1, t = String(f.text || '').replace(/\s+/g, ' ').trim();
    if (t.length > 90) t = t.slice(0, 89) + '…';
    return '<button type="button" class="wa-toast-open" data-wa-toast-open="' + esc(f.id) + '"><span class="wa-toast-t">رسالة جديدة من ' + esc(f.customer || 'عميل') + (more > 0 ? ' <span class="wa-toast-more">و' + more + ' محادثة تانية</span>' : '') + '</span>' + (t ? '<span class="wa-toast-b" dir="auto">' + esc(t) + '</span>' : '') + '</button><button type="button" class="wa-toast-x" data-wa-toast-x aria-label="إغلاق التنبيه">×</button>';
  }
  /* browser Notification content (fallback when Web Push is off): short, no phone number in the title */
  function notifContent(items) {
    items = arr(items); if (!items.length) return null; var f = items[items.length - 1], t = String(f.text || '').replace(/\s+/g, ' ').trim();
    return { title: items.length > 1 ? items.length + ' رسائل جديدة على واتساب' : 'رسالة جديدة من ' + (/^\+?\d[\d\s]{6,}$/.test(String(f.customer || '')) ? 'عميل' : (f.customer || 'عميل')), body: t.length > 120 ? t.slice(0, 119) + '…' : t, tag: 'nova-wa-' + hashId(f.id), chat: f.id };
  }
  var TOAST_CSS = '#novaWaToast{position:fixed;z-index:9999;top:64px;left:16px;max-width:min(360px,calc(100vw - 32px));display:flex;align-items:stretch;gap:2px;background:#161a20;color:#f2f3f5;border:1px solid #2a313a;border-inline-start:3px solid #25d366;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.5);font-size:14px;direction:rtl;animation:waUp .18s ease-out both}#novaWaToast[hidden]{display:none}' +
    '.wa-toast-open{flex:1;min-width:0;min-height:44px;display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:8px 12px;border:0;background:none;color:inherit;font:inherit;text-align:start;cursor:pointer}.wa-toast-t{font-weight:700;color:#25d366}.wa-toast-more{font-weight:400;color:#9aa4b0;font-size:12px}.wa-toast-b{color:#d5dde4;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.wa-toast-x{flex:none;width:44px;min-height:44px;border:0;background:none;color:#9aa4b0;font-size:20px;cursor:pointer}.wa-toast-open:focus-visible,.wa-toast-x:focus-visible{outline:2px solid #79c9eb;outline-offset:-2px}' +
    '@media(max-width:780px){#novaWaToast{top:8px;left:12px;right:12px;max-width:none}}@media(prefers-reduced-motion:reduce){#novaWaToast{animation:none}}' +
    '@keyframes waUp{from{opacity:0;transform:translate3d(0,8px,0)}to{opacity:1;transform:none}}';
  var api = { sendIcon: IC_SEND, pollDelay: pollDelay, mergeLive: mergeLive, newIds: newIds, toastFor: toastFor, toastHtml: toastHtml, notifContent: notifContent, TOAST_CSS: TOAST_CSS, POLL_FG: POLL_FG, POLL_BG: POLL_BG, POLL_HIDDEN: POLL_HIDDEN, chipsHtml: chipsHtml, needsReply: needsReply, trailingIn: trailingIn, moreHtml: moreHtml, tick: tick, quoteHtml: quoteHtml, quoteBarHtml: quoteBarHtml, emojiPanelHtml: emojiPanelHtml, EMOJI: EMOJI, docExt: docExt, durLabel: durLabel, stripStaffPrefix: stripStaffPrefix, createUnread: createUnread, titleBadge: titleBadge, notifyHtml: notifyHtml, noteHtml: noteHtml, NOTIF_CSS: NOTIF_CSS, TAB_BADGE_CSS: TAB_BADGE_CSS, hashId: hashId, isInbound: isInbound, normAr: normAr, create: create, render: render, renderWa: renderWa, chatListHtml: chatListHtml, bubbles: bubbles, mediaHtml: mediaHtml, mediaMiss: mediaMiss, previewText: previewText, openLightbox: openLightbox, dateLabel: dateLabel, unreadCount: unreadCount, totalUnread: totalUnread, KEY: KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaUnifiedInbox = api;
})(typeof window !== 'undefined' ? window : globalThis);
