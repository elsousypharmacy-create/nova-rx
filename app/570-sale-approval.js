/* NOVA Rx — SALE-APPROVAL: one shared «موافقة المدير» dialog for the sale screen (credit-limit override #116, big discount / line delete #100).
   window.novaSaleApproval.request({ title, message, reason }) -> Promise<null | { approvedBy, approverId, role, at, unverified }>.
   null = cancelled (the caller must NOT continue). A real approver = a manager/owner account verified by password (novaAuth.verifyAccount).
   With no accounts on the device nothing can be verified: a typed approver name is accepted and the result is marked unverified:true.
   Vanilla JS, no template literals. */
(function (root) {
  'use strict';
  var en = function () { try { return root.localStorage.getItem('nova-rx-language') === 'en'; } catch (e) { return false; } };
  var T = function (ar, e) { return en() ? e : ar; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); };
  var busy = null;

  function request(opts) {
    opts = opts || {};
    if (busy) return Promise.resolve(null);
    var A = root.novaAuth;
    var hasAcc = !!(A && typeof A.hasAccounts === 'function' && A.hasAccounts());
    busy = new Promise(function (resolve) {
      var prev = document.activeElement;
      var ov = document.createElement('div');
      ov.id = 'novaSaleApproval';
      ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'novaSaT');
      ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px';
      var lbl = 'display:block;margin:8px 0 4px;font-size:13px;color:#9eacb9';
      var inp = 'width:100%;min-height:40px;padding:6px 10px;background:#14181d;color:#e8eef3;border:1px solid #343b44;border-radius:8px;box-sizing:border-box';
      ov.innerHTML = '<form novalidate style="background:#1b2027;color:#e8eef3;border:1px solid #343b44;border-radius:12px;padding:16px;width:100%;max-width:420px;max-height:90vh;overflow:auto">'
        + '<h3 id="novaSaT" style="margin:0 0 8px;font-size:17px">' + esc(opts.title || T('موافقة المدير', 'Manager approval')) + '</h3>'
        + '<p data-sa-msg style="margin:0 0 6px;font-size:14px;line-height:1.6;white-space:pre-line">' + esc(opts.message || '') + '</p>'
        + (hasAcc ? '' : '<p style="font-size:12px;color:#f0d9a0;margin:0">' + T('مفيش حسابات على الجهاز: الموافقة هنا بالاسم بس (مش متحقق منها). فعّل الحسابات من الإعدادات.', 'No accounts on this device: approval is by name only (not verified). Enable accounts in Settings.') + '</p>')
        + '<label for="novaSaUser" style="' + lbl + '">' + (hasAcc ? T('اسم المدير أو المالك', 'Manager or owner name') : T('اسم المعتمد', 'Approver name')) + '</label>'
        + '<input id="novaSaUser" autocomplete="off" maxlength="60" style="' + inp + '">'
        + (hasAcc ? '<label for="novaSaPw" style="' + lbl + '">' + T('كلمة السر', 'Password') + '</label><input id="novaSaPw" type="password" autocomplete="off" style="' + inp + '">' : '')
        + '<div data-sa-err role="alert" style="color:#ff9b9b;font-size:13px;min-height:18px;margin:6px 0"></div>'
        + '<div style="display:flex;gap:8px"><button type="submit" class="btn btn-primary" data-sa-ok style="flex:1;min-height:40px">' + T('موافقة', 'Approve') + '</button>'
        + '<button type="button" class="btn btn-secondary" data-sa-cancel style="min-height:40px">' + T('إلغاء', 'Cancel') + '</button></div></form>';
      document.body.appendChild(ov);
      var form = ov.firstChild, err = ov.querySelector('[data-sa-err]'), okBtn = ov.querySelector('[data-sa-ok]');
      var done = false;
      function finish(v) {
        if (done) return; done = true;
        document.removeEventListener('keydown', onKey, true);
        if (ov.parentNode) ov.parentNode.removeChild(ov);
        busy = null;
        try { if (prev && prev.focus) prev.focus(); } catch (e) {}
        resolve(v);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); return; }
        if (/^F\d+$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); return; }
        if (e.key === 'Tab') { // keep focus inside the dialog
          var f = [].slice.call(ov.querySelectorAll('input,button')).filter(function (x) { return !x.disabled; });
          if (!f.length) return;
          var i = f.indexOf(document.activeElement);
          if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
        }
      }
      document.addEventListener('keydown', onKey, true);
      ov.querySelector('[data-sa-cancel]').addEventListener('click', function () { finish(null); });
      form.addEventListener('submit', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        err.textContent = '';
        var name = ov.querySelector('#novaSaUser').value.trim();
        if (!name) { err.textContent = T('اكتب اسم المعتمد', 'Type the approver name'); return; }
        if (!hasAcc) { finish({ approvedBy: name, approverId: '', role: '', at: new Date().toISOString(), unverified: true }); return; }
        var pwEl = ov.querySelector('#novaSaPw'), pw = pwEl.value;
        if (!pw) { err.textContent = T('اكتب كلمة السر', 'Type the password'); return; }
        if (typeof A.verifyAccount !== 'function') { err.textContent = T('خدمة التحقق مش متاحة', 'Verification is not available'); return; }
        okBtn.disabled = true;
        Promise.resolve(A.verifyAccount(name, pw)).then(function (v) {
          pwEl.value = '';
          if (done) return;
          okBtn.disabled = false;
          if (!v || (v.role !== 'manager' && v.role !== 'owner')) { err.textContent = T('البيانات غلط أو الحساب مش مدير/مالك', 'Wrong details, or the account is not a manager/owner'); return; }
          finish({ approvedBy: v.name || name, approverId: v.id || '', role: v.role, at: new Date().toISOString(), unverified: false });
        }).catch(function () { okBtn.disabled = false; err.textContent = T('حصل خطأ أثناء التحقق', 'Verification failed'); });
      });
      setTimeout(function () { var u = ov.querySelector('#novaSaUser'); if (u) u.focus(); }, 0);
    });
    return busy;
  }

  root.novaSaleApproval = { request: request };
})(typeof window !== 'undefined' ? window : this);
