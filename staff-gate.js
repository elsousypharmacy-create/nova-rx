/* NOVA Rx — SEC-01 / S1-07 staff gate: nobody opens /, /whatsapp or /?app=whatsapp without a signed-in staff session.
   - Login screen (Arabic RTL) on top of a hidden app. Session = auth-local.js (8 h, device trusted on sign-in).
   - Server session: POST {api}/api/v1/auth/login (backend/src/auth/auth.js). Its Bearer token is what the conversations
     API needs (backend/src/inbox-history.js historyAccess); without it no chat is ever requested (hGet in index.html).
   - The server-verified account is mirrored on this device (NovaAuth.adoptVerified) so the pharmacist can work offline later.
   - When novaBackend.enabled is off and this is not the WhatsApp screen, a local NovaAuth account is enough (offline first).
   - First run with no account on this device: the owner creates the first account (no built-in password or PIN).
   - Enforced on every host. Only on a developer loopback host (localhost / 127.0.0.1 / file:) is it off unless
     window.NOVA_STAFF_GATE === true or ?staffGate=1 (the local test harness). The server check is the real boundary.
   Works as a <script> (window.novaStaff) and in Node (module.exports, pure logic only). No secrets, nothing hardcoded. */
(function (root) {
  'use strict';

  var KEY = 'nova.staff.server';
  var PROD = 'https://nova-rx-api.elsousypharmacy.workers.dev', STG = 'https://nova-rx-api-staging.elsousypharmacy.workers.dev';
  var ROLE_MAP = { stock: 'store', staff: 'cashier' };
  var CLIENT_ROLES = ['cashier', 'pharmacist', 'store', 'accountant', 'delivery', 'manager', 'owner'];

  function isLoopback(loc) {
    var h = String((loc && loc.hostname) || '');
    return (loc && loc.protocol === 'file:') || h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
  }
  function qs(loc, k) { try { return new URLSearchParams((loc && loc.search) || '').get(k); } catch (e) { return null; } }
  /* Fail closed: a non-loopback host is ALWAYS gated; a flag can only switch the gate ON. */
  function enforced(loc, flag) { return flag === true || !isLoopback(loc) || qs(loc, 'staffGate') === '1'; }
  function waMode(loc) {
    var p = String((loc && loc.pathname) || '').replace(/\/+$/, '') || '/';
    return p === '/whatsapp' || p === '/wa' || qs(loc, 'app') === 'whatsapp';
  }
  function err(code) { var e = new Error(code); e.code = code; return e; }

  function create(o) {
    var st = o.storage, now = o.now || function () { return Date.now(); }, fx = o.fetch || null, loc = o.location || {}, auth = o.auth;
    function get(k) { try { return st.getItem(k); } catch (e) { return null; } }
    function backendOn() { return get('novaBackend.enabled') === 'true'; }
    function apiBase() { var u = get('novaBackend.url') || (backendOn() ? PROD : STG); return String(u).replace(/\/+$/, '').replace(/\/api\/v1(\/.*)?$/, ''); }
    function needServer() { return waMode(loc) || backendOn(); }
    function isOn() { return enforced(loc, typeof o.flag === 'function' ? o.flag() : o.flag); }
    function readSrv() { try { var v = JSON.parse(get(KEY)); return v && typeof v === 'object' ? v : null; } catch (e) { return null; } }
    function writeSrv(v) { try { if (v) st.setItem(KEY, JSON.stringify(v)); else st.removeItem(KEY); } catch (e) { /* storage full / blocked */ } }
    function local() { try { return auth ? auth.current() : null; } catch (e) { return null; } }
    /* The server token lives only as long as the local 8 h session that opened it, for the same API. */
    function server() {
      var s = readSrv(); if (!s) return null;
      var me = local();
      if (!me || s.sessionId !== me.sessionId || s.base !== apiBase() || !(s.refreshExp > now())) { writeSrv(null); return null; }
      return s;
    }
    function store(base, j, sid) {
      var t = now();
      writeSrv({ base: base, user: String(j.user || ''), role: String(j.role || ''), access: j.access_token, refresh: j.refresh_token,
        accessExp: t + Math.max(60, (Number(j.expires_in) || 3600) - 60) * 1000, refreshExp: t + (Number(j.refresh_expires_in) || 12 * 3600) * 1000, sessionId: sid });
    }
    function post(url, body, extra) {
      var h = { 'Content-Type': 'application/json', Accept: 'application/json' }, k;
      if (extra) for (k in extra) h[k] = extra[k];
      return fx(url, { method: 'POST', headers: h, body: JSON.stringify(body || {}), credentials: 'omit', cache: 'no-store' })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j || {} }; }); });
    }
    var refreshing = null;
    function refresh() {
      if (refreshing) return refreshing;
      var s = server(); if (!s || !s.refresh || !fx) return Promise.resolve(false);
      refreshing = post(s.base + '/api/v1/auth/refresh', { refresh_token: s.refresh }).then(function (x) {
        if (x.r.ok && x.j.ok && x.j.access_token) { store(s.base, x.j, s.sessionId); return true; }
        if (x.r.status === 400 || x.r.status === 401) writeSrv(null);
        return false;
      }, function () { return false; }).then(function (v) { refreshing = null; return v; });
      return refreshing;
    }
    function serverLogin(name, pw, trust) {
      if (!fx) return Promise.resolve({ kind: 'unavailable' });
      var base = apiBase();
      return post(base + '/api/v1/auth/login', { username: name, password: pw, device_id: auth.deviceId(), trust_device: !!trust }).then(function (x) {
        if (x.r.ok && x.j.ok && x.j.access_token) return { kind: 'ok', j: x.j, base: base };
        if (x.r.status === 400 || x.r.status === 401) return { kind: 'denied' };
        if (x.r.status === 429) return { kind: 'locked' };
        return { kind: 'unavailable' }; // 404 auth disabled, 5xx
      }, function () { return { kind: 'unavailable' }; });
    }
    function mapRole(r) { r = ROLE_MAP[r] || r; return CLIENT_ROLES.indexOf(r) >= 0 ? r : 'cashier'; }

    var api = {
      KEY: KEY,
      enforced: isOn,
      waMode: function () { return waMode(loc); },
      needServer: needServer,
      apiBase: apiBase,
      current: local,
      server: server,
      hasAccounts: function () { return !!auth && auth.hasAccounts(); },
      /* The gate is open: not enforced here, or a valid local staff session exists. */
      ok: function () { return !isOn() || !!local(); },
      /* Bearer for the conversations API ('' = none: the caller must not request chats). */
      bearer: function () { var s = server(); return s && s.accessExp > now() ? s.access : ''; },
      canRefresh: function () { var s = server(); return !!(s && s.refresh); },
      refresh: refresh,
      /* Role check at the moment of an action (sale.create, accounts.manage, ...). Signed out = denied when enforced. */
      allow: function (action) {
        if (!isOn()) return true;
        if (!local()) return false;
        var P = o.perms ? o.perms() : null;
        return P ? P.can(action) : false;
      },
      /* Server first (when online); local account as the offline / backend-off fallback. Resolves {mode:'server'|'local', offline}. */
      signIn: function (name, pw, trust) {
        name = String(name == null ? '' : name).trim(); pw = String(pw == null ? '' : pw);
        if (!name || !pw) return Promise.reject(err('missing'));
        var need = needServer();
        return serverLogin(name.toLowerCase(), pw, trust).then(function (res) {
          if (res.kind === 'ok') {
            return auth.adoptVerified({ name: String(res.j.user || name.toLowerCase()), role: mapRole(res.j.role), password: pw })
              .then(function (s) { store(res.base, res.j, s.id); return { mode: 'server', offline: false }; });
          }
          if (res.kind === 'locked') throw err('locked');
          if (res.kind === 'denied' && need) throw err('bad-credentials');
          if (res.kind === 'unavailable' && need && !auth.hasAccounts()) throw err('offline-first');
          return auth.signIn(name, pw).then(function () { writeSrv(null); return { mode: 'local', offline: res.kind === 'unavailable' }; },
            function () { throw err('bad-credentials'); });
        });
      },
      /* First run on this device: the owner creates the first account (auth-local makes the first account the owner). */
      firstRun: function (name, pw, pw2) {
        if (String(pw) !== String(pw2)) return Promise.reject(err('mismatch'));
        if (auth.hasAccounts()) return Promise.reject(err('permission'));
        return Promise.resolve().then(function () { return auth.createAccount({ name: name, password: pw, role: 'owner' }); })
          .then(function () { return auth.signIn(name, pw); }).then(function () { return { mode: 'local', offline: false }; });
      },
      signOut: function () {
        var s = readSrv(); writeSrv(null);
        try { auth.signOut(); } catch (e) { /* already out */ }
        if (s && s.access && fx) fx(s.base + '/api/v1/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + s.access }, credentials: 'omit' }).catch(function () {});
      }
    };
    return api;
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { create: create, enforced: enforced, waMode: waMode, isLoopback: isLoopback, KEY: KEY }; return; }

  /* ---------------- browser: login screen ---------------- */
  var doc = root.document, html = doc.documentElement;
  var S = create({ storage: root.localStorage, fetch: root.fetch ? root.fetch.bind(root) : null, location: root.location, auth: root.novaAuth,
    flag: function () { return root.NOVA_STAFF_GATE; }, perms: function () { return root.novaPerms; } });
  root.novaStaff = S;

  var MSG = {
    missing: 'اكتب اسم المستخدم وكلمة المرور.', 'bad-credentials': 'الاسم أو كلمة المرور غير صحيحة.',
    locked: 'محاولات كثيرة: الحساب مقفول مؤقتًا. حاول بعد ربع ساعة.', 'offline-first': 'مفيش اتصال بالسيرفر، وما فيش حساب محفوظ على الجهاز ده. اتصل بالإنترنت لأول دخول.',
    mismatch: 'كلمتا المرور مش متطابقتين.', 'weak-password': 'كلمة المرور لازم 6 حروف أو أكتر.', 'bad-name': 'الاسم غير صالح.', 'duplicate-name': 'الاسم ده مستخدم.',
    permission: 'في حسابات على الجهاز ده بالفعل: سجّل الدخول.'
  };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  function changed() { try { root.dispatchEvent(new CustomEvent('nova-staff-change', { detail: { signedIn: !!S.current(), server: !!S.bearer() } })); } catch (e) { /* old browser */ } }
  function unlock() {
    var g = doc.getElementById('novaStaffGate'); if (g) g.remove();
    html.classList.remove('nova-staff-locked');
    changed();
  }
  /* mode: 'login' | 'first'. opts.server: the caller needs a server session (conversations) even if the app gate is open. */
  function show(mode, opts) {
    opts = opts || {};
    if (!doc.body) { doc.addEventListener('DOMContentLoaded', function () { show(mode, opts); }); return; }
    var srv = !!opts.server || S.needServer();
    if (!mode) mode = !S.hasAccounts() && !srv ? 'first' : 'login';
    html.classList.add('nova-staff-locked');
    var g = doc.getElementById('novaStaffGate');
    if (!g) { g = doc.createElement('div'); g.id = 'novaStaffGate'; doc.body.appendChild(g); }
    g.setAttribute('role', 'dialog'); g.setAttribute('aria-modal', 'true'); g.setAttribute('aria-labelledby', 'novaStaffTitle'); g.dir = 'rtl'; g.lang = 'ar';
    g.dataset.mode = mode; g.dataset.server = srv ? '1' : '0';
    var first = mode === 'first', cur = S.current();
    var sub = first ? 'أول تشغيل على الجهاز ده: المالك ينشئ أول حساب. الحساب ده هيبقى «المالك» ويقدر يضيف الموظفين بعد كده.'
      : (srv ? 'ادخل بحساب الصيدلية عشان تظهر المحادثات وتقدر تبيع.' : 'ادخل باسمك وكلمة المرور عشان تفتح البيع.');
    g.innerHTML = '<form class="nsg-card" id="novaStaffForm" novalidate autocomplete="on">' +
      '<div class="nsg-brand" aria-hidden="true">NOVA<small>Rx</small></div>' +
      '<h1 id="novaStaffTitle">' + (first ? 'إنشاء حساب المالك' : 'تسجيل دخول الموظفين') + '</h1>' +
      '<p class="nsg-sub">' + sub + '</p>' +
      (opts.note ? '<p class="nsg-note" role="status">' + esc(opts.note) + '</p>' : '') +
      '<label class="nsg-f"><span>' + (first ? 'اسم المالك' : 'اسم المستخدم') + '</span><input id="novaStaffName" name="username" autocomplete="username" maxlength="60" required value="' + esc(cur && opts.server ? cur.name : '') + '"></label>' +
      '<label class="nsg-f"><span>كلمة المرور</span><input id="novaStaffPw" name="password" type="password" autocomplete="' + (first ? 'new-password' : 'current-password') + '" required></label>' +
      (first ? '<label class="nsg-f"><span>تأكيد كلمة المرور</span><input id="novaStaffPw2" type="password" autocomplete="new-password" required></label>' : '') +
      (first ? '' : '<label class="nsg-check"><input type="checkbox" id="novaStaffTrust" checked> <span>الجهاز ده موثوق (الجلسة 8 ساعات)</span></label>') +
      '<div id="novaStaffMsg" class="nsg-msg" role="alert" aria-live="assertive"></div>' +
      '<button type="submit" id="novaStaffGo" class="nsg-go">' + (first ? 'إنشاء الحساب والدخول' : 'دخول') + '</button>' +
      (!srv && !S.hasAccounts() ? '<button type="button" class="nsg-link" id="novaStaffSwitch">' + (first ? 'عندي حساب على السيرفر: دخول' : 'أول تشغيل؟ إنشاء حساب المالك') + '</button>' : '') +
      (opts.server && S.ok() && S.current() ? '<button type="button" class="nsg-link" id="novaStaffLater">مش دلوقتي</button>' : '') +
      '<p class="nsg-foot">كلمة المرور بتتحفظ مشفّرة على الجهاز ده بس، ومحدش من الدعم هيطلبها منك.</p>' +
      '</form>';
    var $ = function (id) { return g.querySelector('#' + id); };
    var form = $('novaStaffForm'), go = $('novaStaffGo'), msg = $('novaStaffMsg');
    if ($('novaStaffSwitch')) $('novaStaffSwitch').onclick = function () { show(first ? 'login' : 'first', opts); };
    if ($('novaStaffLater')) $('novaStaffLater').onclick = function () { var x = doc.getElementById('novaStaffGate'); if (x) x.remove(); if (S.ok()) html.classList.remove('nova-staff-locked'); };
    form.onsubmit = function (ev) {
      ev.preventDefault();
      if (go.disabled) return;
      var n = $('novaStaffName').value, p = $('novaStaffPw').value;
      ['novaStaffName', 'novaStaffPw'].forEach(function (id) { $(id).setAttribute('aria-invalid', $(id).value ? 'false' : 'true'); });
      if (!String(n).trim() || !p) { msg.textContent = MSG.missing; return; }
      go.disabled = true; go.setAttribute('aria-busy', 'true'); msg.textContent = '';
      var job = first ? S.firstRun(n, p, $('novaStaffPw2').value) : S.signIn(n, p, $('novaStaffTrust') && $('novaStaffTrust').checked);
      job.then(function (r) {
        try { root.sessionStorage.setItem('nova.staff.mode', r && r.offline ? 'offline' : (r && r.mode) || 'local'); } catch (e) { /* ignore */ }
        if (r && r.mode === 'local' && S.needServer()) root.__novaStaffNote = r.offline ? 'شغّال بدون اتصال: المحادثات هتظهر لما النت يرجع وتدخل تاني.' : '';
        unlock();
      }, function (e) {
        msg.textContent = MSG[e && e.code] || MSG['bad-credentials'];
        go.disabled = false; go.removeAttribute('aria-busy');
        var pw = $('novaStaffPw'); pw.value = ''; pw.focus();
      });
    };
    setTimeout(function () { var f = $('novaStaffName'); if (f && !f.value) f.focus(); else if ($('novaStaffPw')) $('novaStaffPw').focus(); }, 0);
  }
  function check() {
    if (S.ok()) { if (html.classList.contains('nova-staff-locked') && !doc.getElementById('novaStaffGate')) html.classList.remove('nova-staff-locked'); return true; }
    if (!doc.getElementById('novaStaffGate')) { S.server(); show(); }
    return false;
  }
  S.show = show;
  S.check = check;
  /* Conversations need a server session: open the login screen in server mode (the app behind stays usable after «مش دلوقتي»). */
  S.requireServer = function (note) { show('login', { server: true, note: note || '' }); };
  S.logout = function () { S.signOut(); if (S.enforced()) show(); changed(); }; // not enforced (loopback harness): just sign out

  check();
  root.setInterval(check, 30000); // the 8 h session ends while the screen is open
  root.addEventListener('storage', function (e) { if (!e.key || e.key.indexOf('nova.auth.') === 0 || e.key === KEY) { check(); changed(); } });
  /* refresh the conversations token ahead of expiry while signed in */
  root.setInterval(function () { var s = S.server(); if (s && s.accessExp - Date.now() < 120000) S.refresh(); }, 60000);
})(typeof window !== 'undefined' ? window : globalThis);
