/* NOVA Rx — SEC-01 UI for auth-local.js: accounts card in Settings + re-authentication dialog (mock auth, on-device). */
(function () {
  'use strict';
  var A = function () { return window.novaAuth; };
  var en = function () { return document.documentElement.lang === 'en'; };
  var tr = function (ar, e) { return en() ? e : ar; };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ERR = {
    'bad-credentials': ['الاسم أو كلمة المرور غير صحيحة', 'Wrong name or password'], 'weak-password': ['كلمة المرور أقل من 6 أحرف', 'Password is shorter than 6 characters'],
    'bad-name': ['الاسم غير صالح', 'Invalid name'], 'duplicate-name': ['الاسم مستخدم', 'Name already used'], 'reauth-required': ['أكّد كلمة المرور أولًا', 'Confirm your password first'],
    'permission': ['ليس لديك صلاحية', 'Not allowed for your role'], 'no-session': ['سجّل الدخول أولًا', 'Sign in first']
  };
  var ROLE_AR = { owner: 'المالك', manager: 'المدير', pharmacist: 'الصيدلي', cashier: 'الكاشير', store: 'المخزن', accountant: 'المحاسب', delivery: 'المندوب' };
  var ACT_AR = { 'sale.create': 'إنشاء بيع', 'sale.return': 'مرتجع بيع', 'sale.cancel': 'إلغاء بيع', 'data.export': 'تصدير البيانات', 'data.import': 'استيراد البيانات', 'stock.adjust': 'تعديل المخزون', 'prices.edit': 'تعديل الأسعار', 'reports.view': 'عرض التقارير', 'accounts.manage': 'إدارة الحسابات', 'purchases.manage': 'إدارة المشتريات', 'delivery.update': 'تحديث التوصيل' };
  var roleL = function (r) { return en() ? r : (ROLE_AR[r] || r); };
  var actL = function (a) { return en() ? a : (ACT_AR[a] || a); };
  var msg = function (e) { var m = ERR[e && e.code]; return m ? tr(m[0], m[1]) : tr('تعذر التنفيذ', 'Could not complete'); };
  var field = 'style="min-height:40px;padding:6px 10px;background:#0e1419;color:#e7ebf0;border:1px solid #303841;border-radius:6px;font-size:14px"';

  /* Asks for the password of the signed-in person; calls ok() only after a successful re-authentication. */
  function reauth(ok) {
    if (!A().current()) { window.alert(tr('سجّل الدخول من الإعدادات أولًا', 'Sign in from Settings first')); return; }
    var ov = document.createElement('div'); ov.id = 'novaReauth'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px';
    ov.innerHTML = '<div style="background:#14181d;color:#e7ebf0;border:1px solid #303841;border-radius:12px;max-width:360px;width:100%;padding:16px;display:grid;gap:8px">' +
      '<strong>' + tr('تأكيد الهوية', 'Confirm it is you') + ' — ' + esc(A().current().name) + '</strong>' +
      '<input type="password" id="novaReauthPw" autocomplete="current-password" placeholder="' + tr('كلمة المرور', 'Password') + '" ' + field + '>' +
      '<div id="novaReauthMsg" role="alert" style="color:#ffb4a8;min-height:18px;font-size:13px"></div>' +
      '<div style="display:flex;gap:8px"><button type="button" id="novaReauthOk" class="nova-return-btn" style="min-height:44px;flex:1">' + tr('تأكيد', 'Confirm') + '</button><button type="button" id="novaReauthNo" class="nova-return-btn" style="min-height:44px">' + tr('إلغاء', 'Cancel') + '</button></div></div>';
    document.body.appendChild(ov);
    var pw = ov.querySelector('#novaReauthPw'); pw.focus();
    var go = function () { A().reauthenticate(pw.value).then(function () { ov.remove(); ok(); }, function (e) { ov.querySelector('#novaReauthMsg').textContent = msg(e); }); };
    ov.querySelector('#novaReauthOk').onclick = go; pw.onkeydown = function (e) { if (e.key === 'Enter') go(); };
    ov.querySelector('#novaReauthNo').onclick = function () { ov.remove(); };
  }

  /* Runs fn now if a recent re-authentication exists (or no accounts exist yet), otherwise asks for the password first. */
  function guard(fn) { if (A().sensitiveAllowed()) fn(); else reauth(fn); }

  function mount() {
    var host = document.getElementById('novaAuthCard'); if (!host || !A()) return;
    var cur = A().current(), h = '<h3>' + tr('الحسابات والجلسات', 'Accounts & sessions') + '</h3>';
    h += '<p style="font-size:12px;color:#9eacb9">' + tr('تجريبي: حسابات محلية على هذا الجهاز فقط، وليست حماية حقيقية.', 'Mock: local accounts on this device only, not a real security boundary.') + '</p><div id="novaAuthMsg" role="status" style="min-height:18px;font-size:13px;color:#ffb4a8"></div>';
    if (cur) {
      h += '<p>' + tr('الدخول باسم', 'Signed in as') + ' <b>' + esc(cur.name) + '</b> (' + esc(roleL(cur.role)) + ') — ' + tr('تنتهي الجلسة', 'expires') + ' ' + esc(new Date(cur.expiresAt).toLocaleString()) + ' <button type="button" id="novaAuthOut" class="nova-page-btn">' + tr('خروج', 'Sign out') + '</button></p>';
      h += '<h4>' + tr('الجلسات النشطة', 'Active sessions') + '</h4><ul id="novaAuthSessions">' + A().sessions().map(function (s) { return '<li>' + esc(s.account) + ' · ' + esc(s.deviceId.slice(0, 10)) + (s.current ? ' (' + tr('هذه', 'this') + ')' : '') + ' <button type="button" class="nova-page-btn" data-revoke="' + esc(s.id) + '">' + tr('إنهاء', 'Revoke') + '</button></li>'; }).join('') + '</ul>';
      h += '<h4>' + tr('الأجهزة الموثوقة', 'Trusted devices') + '</h4><ul id="novaAuthDevices">' + A().trustedDevices().map(function (d) { return '<li>' + esc(d.label) + ' · ' + esc(d.id.slice(0, 10)) + (d.thisDevice ? ' (' + tr('هذا الجهاز', 'this device') + ')' : '') + ' <button type="button" class="nova-page-btn" data-untrust="' + esc(d.id) + '">' + tr('إزالة', 'Remove') + '</button></li>'; }).join('') + '</ul>';
    } else {
      h += '<div style="display:grid;gap:var(--sp-2);max-width:300px"><input id="novaAuthName" placeholder="' + tr('الاسم', 'Name') + '" maxlength="60" ' + field + '><input id="novaAuthPw" type="password" placeholder="' + tr('كلمة المرور', 'Password') + '" ' + field + '><button type="button" id="novaAuthIn" class="nova-page-btn">' + tr('دخول', 'Sign in') + '</button></div>';
    }
    if (!A().hasAccounts()) h += '<p style="font-size:12px">' + tr('لا توجد حسابات: أول حساب يُنشأ يصبح المالك.', 'No accounts yet: the first one created becomes the owner.') + '</p>';
    if (!A().hasAccounts() || (cur && (cur.role === 'owner' || cur.role === 'manager'))) {
      h += '<details><summary>' + tr('إضافة حساب', 'Add account') + '</summary><div style="display:grid;gap:var(--sp-2);max-width:300px;margin-top:6px"><input id="novaNewName" placeholder="' + tr('الاسم', 'Name') + '" maxlength="60" ' + field + '><input id="novaNewPw" type="password" placeholder="' + tr('كلمة المرور (6+)', 'Password (6+)') + '" ' + field + '><select id="novaNewRole" aria-label="' + tr('الدور', 'Role') + '" ' + field + '>' + A().ROLES.filter(function (r) { return !cur || cur.role === 'owner' || (r !== 'owner' && r !== 'manager'); }).map(function (r) { return '<option value="' + r + '">' + roleL(r) + '</option>'; }).join('') + '</select><button type="button" id="novaNewOk" class="nova-page-btn" aria-label="' + tr('إنشاء حساب', 'Create account') + '">' + tr('إنشاء', 'Create') + '</button></div></details>';
    }
    h += permsHtml();
    host.innerHTML = h;
    var m = function (t) { host.querySelector('#novaAuthMsg').textContent = t; }, done = function (p) { return p.then(mount, function (e) { m(msg(e)); }); }, $ = function (s) { return host.querySelector(s); };
    if ($('#novaAuthIn')) $('#novaAuthIn').onclick = function () { done(A().signIn($('#novaAuthName').value, $('#novaAuthPw').value)); };
    if ($('#novaAuthOut')) $('#novaAuthOut').onclick = function () { A().signOut(); mount(); };
    host.querySelectorAll('[data-revoke]').forEach(function (b) { b.onclick = function () { guard(function () { A().revokeSession(b.dataset.revoke); mount(); }); }; });
    host.querySelectorAll('[data-untrust]').forEach(function (b) { b.onclick = function () { guard(function () { A().removeDevice(b.dataset.untrust); mount(); }); }; });
    if ($('#novaNewOk')) $('#novaNewOk').onclick = function () {
      var go = function () { try { done(A().createAccount({ name: $('#novaNewName').value, password: $('#novaNewPw').value, role: $('#novaNewRole').value })); } catch (e) { m(msg(e)); } };
      if (A().hasAccounts()) guard(go); else go();
    };
  }

  /* Permissions matrix card (read-only view) + the denied-actions log. */
  function permsHtml() {
    var P = window.NovaPerms; if (!P) return '';
    var h = '<details id="novaPermDetails"><summary>' + tr('مصفوفة الصلاحيات (للمدير)', 'Permissions matrix (manager)') + '</summary><div style="overflow:auto"><table id="novaPermMatrix" style="border-collapse:collapse;font-size:12px"><thead><tr><th></th>' + P.ROLES.map(function (r) { return '<th style="padding:2px 6px">' + roleL(r) + '</th>'; }).join('') + '</tr></thead><tbody>';
    P.ACTIONS.forEach(function (a) { h += '<tr><td style="padding:2px 6px">' + esc(actL(a)) + '</td>' + P.ROLES.map(function (r) { return '<td style="text-align:center">' + (P.MATRIX[r].indexOf(a) >= 0 ? '✓' : '–') + '</td>'; }).join('') + '</tr>'; });
    h += '</tbody></table></div></details>';
    var d = window.novaPerms ? window.novaPerms.denied().slice(-10).reverse() : [];
    h += '<h4>' + tr('محاولات مرفوضة', 'Denied actions') + '</h4><ul id="novaPermDenied">' + (d.length ? d.map(function (x) { return '<li>' + esc(x.at.slice(0, 19)) + ' · ' + esc(x.account || '-') + ' (' + esc(x.role ? roleL(x.role) : '-') + ') · ' + esc(actL(x.action)) + ' · ' + esc(x.why) + '</li>'; }).join('') : '<li>' + tr('لا شيء', 'None') + '</li>') + '</ul>';
    return h;
  }
  function deny() { window.alert(tr('ليس لديك صلاحية لهذا الإجراء', 'Your role is not allowed to do this')); }
  /* True if the signed-in role may do `action`; otherwise logs the denial, tells the user and returns false. */
  function allow(action) { if (window.novaPerms && !window.novaPerms.require(action)) { deny(); return false; } return true; }

  window.novaAuthUI = { allow: allow, mount: mount, reauth: reauth, guard: guard };
})();
