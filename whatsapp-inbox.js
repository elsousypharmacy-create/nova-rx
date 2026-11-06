/* NOVA Rx — WhatsApp Inbox (Phase 1 UI prototype)
 * Self-contained module: mock adapter seam + demo fixtures + RTL renderer.
 * No live Meta/WhatsApp calls, no tokens, no outbound messages.
 * Adapter seam is the ONLY place a future Apps Script bridge attaches. */
(function () {
  'use strict';

  /* ---- Adapter seam ----------------------------------------------------
   * Future live bridge (existing Elsousy Apps Script bot) must implement:
   *   listConversations()      -> Promise<Conversation[]>   (read-only inbox)
   *   getThread(id)            -> Promise<Message[]>        (read-only thread)
   *   takeover(id, employee)   -> Promise<void>             (bot hold/handoff)
   *   resume(id)               -> Promise<void>             (return to bot)
   *   sendMessage(id, payload) -> Promise<Message>          (OUTBOUND — gated)
   * GAPS before going live (documented, not assumed):
   *  - The Apps Script bot exposes waSend/waInfo server-side only; there is NO
   *    public read API for conversations. A doGet inbox endpoint + auth is needed.
   *  - WA_TOKEN lives in Apps Script Properties and must NEVER reach the client.
   *  - Authorization model (which employee may read/take over) is undefined.
   *  - sendMessage stays a stub here until a server-side relay exists. */
  function MockWhatsAppAdapter(fixtures) {
    this.fixtures = fixtures;
    this.connected = false; // always false in phase 1: mock only
  }
  MockWhatsAppAdapter.prototype.listConversations = function () {
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(JSON.parse(JSON.stringify(this.fixtures.conversations))); }.bind(this), 60);
    }.bind(this));
  };
  MockWhatsAppAdapter.prototype.getThread = function (id) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        var t = this.fixtures.threads[id];
        t ? resolve(JSON.parse(JSON.stringify(t))) : reject(new Error('THREAD_NOT_FOUND'));
      }.bind(this), 40);
    }.bind(this));
  };
  MockWhatsAppAdapter.prototype.takeover = function (id, employee) {
    var c = this.fixtures.conversations.find(function (x) { return x.id === id; });
    if (c) { c.botState = 'hold'; c.assignedTo = employee; }
    return Promise.resolve(c ? JSON.parse(JSON.stringify(c)) : null);
  };
  MockWhatsAppAdapter.prototype.resume = function (id) {
    var c = this.fixtures.conversations.find(function (x) { return x.id === id; });
    if (c) { c.botState = 'active'; c.assignedTo = null; }
    return Promise.resolve(c ? JSON.parse(JSON.stringify(c)) : null);
  };
  MockWhatsAppAdapter.prototype.sendMessage = function () {
    return Promise.reject(new Error('LIVE_SEND_DISABLED: phase 1 renders demo data only; no outbound relay exists yet'));
  };

  /* ---- Demo fixtures (clearly labeled; NOT real customers) ------------- */
  var DEMO_FIXTURES = {
    conversations: [
      { id: 'demo-1', name: 'مثال: عميل تجريبي أ', phone: '05XXXXXXXX', lastPreview: 'هل يتوفر بانادول إكسترا؟', lastAt: '10:42', unread: 2, botState: 'active', assignedTo: null, hasPrescription: false },
      { id: 'demo-2', name: 'مثال: عميل تجريبي ب', phone: '05XXXXXXXX', lastPreview: 'أرسلت صورة الروشتة', lastAt: '09:15', unread: 0, botState: 'hold', assignedTo: 'موظف تجريبي', hasPrescription: true },
      { id: 'demo-3', name: 'مثال: عميل تجريبي ج', phone: '05XXXXXXXX', lastPreview: 'شكراً لكم', lastAt: 'أمس', unread: 0, botState: 'active', assignedTo: null, hasPrescription: false }
    ],
    threads: {
      'demo-1': [
        { id: 'm1', dir: 'in', type: 'text', text: 'السلام عليكم، هل يتوفر بانادول إكسترا؟', at: '10:40' },
        { id: 'm2', dir: 'out', type: 'text', text: 'وعليكم السلام، نعم متوفر.', at: '10:41', via: 'bot' },
        { id: 'm3', dir: 'in', type: 'text', text: 'كم السعر؟', at: '10:42' }
      ],
      'demo-2': [
        { id: 'm1', dir: 'in', type: 'text', text: 'مساء الخير، هذه الروشتة', at: '09:10' },
        { id: 'm2', dir: 'in', type: 'image', caption: 'صورة روشتة (مرفق تجريبي)', at: '09:11' },
        { id: 'm3', dir: 'out', type: 'text', text: 'تم الاستلام، سيراجعها الصيدلي.', at: '09:15', via: 'employee' }
      ],
      'demo-3': [
        { id: 'm1', dir: 'in', type: 'text', text: 'شكراً لكم', at: 'أمس' }
      ]
    }
  };

  var state = {
    adapter: new MockWhatsAppAdapter(DEMO_FIXTURES),
    conversations: null, // null = loading
    error: null,
    query: '',
    activeId: null,
    thread: null,
    threadError: null,
    mobileThreadOpen: false,
    employee: 'موظف تجريبي'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function badge(c) {
    var parts = '';
    if (c.unread > 0) parts += '<span class="wa-badge wa-badge-unread" aria-label="رسائل غير مقروءة">' + c.unread + '</span>';
    if (c.botState === 'hold') parts += '<span class="wa-badge wa-badge-hold">موظف: ' + esc(c.assignedTo || '') + ' · البوت معلّق</span>';
    else parts += '<span class="wa-badge wa-badge-bot">البوت نشط</span>';
    if (c.hasPrescription) parts += '<span class="wa-badge wa-badge-rx">روشتة</span>';
    return parts;
  }

  function filteredConversations() {
    var q = state.query.trim();
    if (!q) return state.conversations || [];
    return (state.conversations || []).filter(function (c) {
      return c.name.indexOf(q) !== -1 || c.lastPreview.indexOf(q) !== -1 || c.phone.indexOf(q) !== -1;
    });
  }

  function renderList() {
    if (state.error) {
      return '<div class="wa-state wa-state-error" role="alert">تعذر تحميل المحادثات التجريبية.<br><button type="button" class="wa-btn" data-wa-action="retry">إعادة المحاولة</button></div>';
    }
    if (!state.conversations) {
      return '<div class="wa-state wa-state-loading" aria-busy="true">جارٍ تحميل بيانات العرض…</div>';
    }
    var list = filteredConversations();
    if (!list.length) {
      return '<div class="wa-state wa-state-empty">' + (state.query.trim() ? 'لا نتائج مطابقة للبحث «' + esc(state.query) + '».' : 'لا توجد محادثات في بيانات العرض.') + '</div>';
    }
    return list.map(function (c) {
      return '<button type="button" class="wa-conv' + (c.id === state.activeId ? ' active' : '') + '" data-wa-action="open" data-wa-id="' + esc(c.id) + '">'
        + '<span class="wa-avatar" aria-hidden="true">' + esc(c.name.replace('مثال: ', '').charAt(0)) + '</span>'
        + '<span class="wa-conv-main"><span class="wa-conv-top"><strong>' + esc(c.name) + '</strong><time>' + esc(c.lastAt) + '</time></span>'
        + '<span class="wa-conv-preview">' + esc(c.lastPreview) + '</span>'
        + '<span class="wa-conv-badges">' + badge(c) + '</span></span></button>';
    }).join('');
  }

  function renderThread() {
    if (!state.activeId) {
      return '<div class="wa-state wa-state-empty wa-thread-placeholder">اختر محادثة من القائمة لعرض الرسائل التجريبية.</div>';
    }
    var conv = (state.conversations || []).find(function (c) { return c.id === state.activeId; });
    if (state.threadError) {
      return '<div class="wa-state wa-state-error" role="alert">تعذر تحميل الرسائل.<br><button type="button" class="wa-btn" data-wa-action="retry-thread">إعادة المحاولة</button></div>';
    }
    if (!state.thread) {
      return '<div class="wa-state wa-state-loading" aria-busy="true">جارٍ تحميل الرسائل…</div>';
    }
    var msgs = state.thread.map(function (m) {
      var body = m.type === 'image'
        ? '<span class="wa-img-ph" role="img" aria-label="مرفق صورة تجريبي">🧾 ' + esc(m.caption || 'مرفق') + '</span>'
        : esc(m.text);
      return '<div class="wa-msg wa-msg-' + (m.dir === 'in' ? 'in' : 'out') + '">' + body
        + '<span class="wa-msg-meta">' + esc(m.at) + (m.via === 'bot' ? ' · عبر البوت' : m.via === 'employee' ? ' · عبر موظف' : '') + '</span></div>';
    }).join('');
    var held = conv && conv.botState === 'hold';
    var composerNote = held
      ? 'أنت مسيطر على المحادثة الآن — الإرسال الحي غير متصل بعد (وضع العرض).'
      : 'البوت يرد تلقائياً. استلم المحادثة للرد اليدوي.';
    return '<header class="wa-thread-head">'
      + '<button type="button" class="wa-btn wa-back" data-wa-action="back" aria-label="رجوع للقائمة">→</button>'
      + '<div class="wa-thread-id"><strong>' + esc(conv ? conv.name : '') + '</strong><span dir="ltr">' + esc(conv ? conv.phone : '') + '</span></div>'
      + '<div class="wa-thread-actions">' + (held
        ? '<button type="button" class="wa-btn wa-btn-resume" data-wa-action="resume">إرجاع للبوت</button>'
        : '<button type="button" class="wa-btn wa-btn-takeover" data-wa-action="takeover">استلام المحادثة</button>') + '</div></header>'
      + '<div class="wa-thread-body" id="waThreadBody">' + (msgs || '<div class="wa-state wa-state-empty">لا رسائل بعد.</div>') + '</div>'
      + '<footer class="wa-composer">'
      + '<label class="wa-attach" title="إرفاق صورة / روشتة (معاينة محلية فقط)">📎<input type="file" id="waAttach" accept="image/*" hidden></label>'
      + '<div class="wa-composer-mid"><div id="waAttachPrev" class="wa-attach-prev" hidden></div>'
      + '<textarea id="waComposerInput" rows="1" placeholder="اكتب رسالة… (عرض تجريبي — لا يُرسل شيء)" aria-label="نص الرسالة"></textarea></div>'
      + '<button type="button" class="wa-btn wa-btn-send" data-wa-action="send">إرسال</button>'
      + '<p class="wa-composer-note">' + composerNote + '</p></footer>';
  }

  function render(root) {
    root.innerHTML = '<div class="wa-inbox' + (state.mobileThreadOpen && state.activeId ? ' wa-mobile-thread' : '') + '" dir="rtl" lang="ar">'
      + '<div class="wa-demo-banner" role="note">وضع العرض التجريبي — بيانات وهمية لا تمثل عملاء حقيقيين ولا يوجد اتصال بحساب واتساب.</div>'
      + '<div class="wa-layout">'
      + '<aside class="wa-list-pane"><div class="wa-list-head"><h2>صندوق واتساب</h2>'
      + '<input type="search" id="waSearch" class="wa-search" placeholder="بحث في المحادثات…" aria-label="بحث في المحادثات" value="' + esc(state.query) + '"></div>'
      + '<div class="wa-list" role="list">' + renderList() + '</div></aside>'
      + '<section class="wa-thread-pane" aria-label="تفاصيل المحادثة">' + renderThread() + '</section>'
      + '</div></div>';
    wire(root);
  }

  function applyConversation(updated) {
    if (!updated || !state.conversations) return;
    var i = state.conversations.findIndex(function (c) { return c.id === updated.id; });
    if (i !== -1) state.conversations[i] = updated;
  }

  function refresh(root) {    var q = state.query, input = root.querySelector('#waSearch');
    render(root);
    if (input && document.activeElement && document.activeElement.id === 'waSearch') { /* re-render keeps value */ }
    var next = root.querySelector('#waSearch');
    if (next && q) { next.focus(); next.setSelectionRange(next.value.length, next.value.length); }
    var body = root.querySelector('#waThreadBody');
    if (body) body.scrollTop = body.scrollHeight;
  }

  function loadConversations(root) {
    state.conversations = null; state.error = null; refresh(root);
    state.adapter.listConversations().then(function (list) {
      state.conversations = list; refresh(root);
    }, function () { state.error = 'load'; refresh(root); });
  }

  function openThread(root, id) {
    state.activeId = id; state.thread = null; state.threadError = null; state.mobileThreadOpen = true;
    var conv = (state.conversations || []).find(function (c) { return c.id === id; });
    if (conv) conv.unread = 0;
    refresh(root);
    state.adapter.getThread(id).then(function (t) { state.thread = t; refresh(root); }, function () { state.threadError = true; refresh(root); });
  }

  function wire(root) {
    root.querySelectorAll('[data-wa-action]').forEach(function (el) {
      el.addEventListener('click', function () {
        var action = el.getAttribute('data-wa-action'), id = el.getAttribute('data-wa-id');
        if (action === 'open') openThread(root, id);
        else if (action === 'back') { state.mobileThreadOpen = false; refresh(root); }
        else if (action === 'retry') loadConversations(root);
        else if (action === 'retry-thread') openThread(root, state.activeId);
        else if (action === 'takeover') {
          state.adapter.takeover(state.activeId, state.employee).then(function (c) { applyConversation(c); refresh(root); });
        } else if (action === 'resume') {
          state.adapter.resume(state.activeId).then(function (c) { applyConversation(c); refresh(root); });
        } else if (action === 'send') {
          var ta = root.querySelector('#waComposerInput');
          var text = ta ? ta.value.trim() : '';
          if (!text || !state.thread) return;
          state.thread.push({ id: 'local-' + Date.now(), dir: 'out', type: 'text', text: text, at: 'الآن', via: 'employee', demo: true });
          refresh(root);
        }
      });
    });
    var search = root.querySelector('#waSearch');
    if (search) search.addEventListener('input', function () { state.query = search.value; refresh(root); });
    var attach = root.querySelector('#waAttach');
    if (attach) attach.addEventListener('change', function () {
      var prev = root.querySelector('#waAttachPrev');
      var f = attach.files && attach.files[0];
      if (!prev) return;
      if (f) {
        var url = URL.createObjectURL(f);
        prev.hidden = false;
        prev.innerHTML = '<img src="' + url + '" alt="معاينة المرفق (محلي، لا يُرفع)"><button type="button" class="wa-btn" id="waAttachClear" aria-label="إزالة المرفق">×</button>';
        prev.querySelector('#waAttachClear').addEventListener('click', function () {
          URL.revokeObjectURL(url); prev.hidden = true; prev.innerHTML = ''; attach.value = '';
        });
      } else { prev.hidden = true; prev.innerHTML = ''; }
    });
  }

  window.NOVA_WHATSAPP = {
    mount: function (container) {
      state.mobileThreadOpen = false;
      render(container);
      loadConversations(container);
    },
    _state: state // exposed for deterministic tests only
  };
})();
