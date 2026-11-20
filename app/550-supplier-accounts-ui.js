/* AUDIT-03 (Gemini Neon draft + follow-up, reviewed and integrated by Claude): supplier accounts and expenses screen on the
   reports page. Logic: supplier-accounts.js (FIN-04). Data: window.__novaSupplierProvider (app/548-nova-providers.js). */
/* NOVA Rx — Supplier Accounts & Expenses Screen (UI for window.NovaSupplierAccounts)
   Self-contained IIFE, ES2018, no imports, no framework, no build step.
   Mounts after #novaRetReasons (or its closest .nova-panel) via MutationObserver. */
(function () {
  'use strict';

  const SECTION_ID = 'novaSupplierAccountsSection';
  const STYLE_ID = 'novaSupplierAccountsStyles';
  const DIALOG_HOST_ID = 'novaSupplierAccountsDialogHost';
  const PRINT_HOST_ID = 'novaSupplierAccountsPrintHost';
  const ANCHOR_ID = 'novaRetReasons';
  const STORAGE_KEY = 'nova.supplierAccounts';
  const CATEGORIES = ['rent', 'utilities', 'salaries', 'cleaning', 'transport', 'maintenance', 'other'];

  const en = () => {
    try {
      return localStorage.getItem('nova-rx-language') === 'en';
    } catch (e) {
      return false;
    }
  };

  const t = (ar, enText) => (en() ? enText : ar);

  const CAT_LABELS = {
    rent: () => t('إيجار', 'Rent'),
    utilities: () => t('كهرباء', 'Electricity / Utilities'),
    salaries: () => t('مرتبات', 'Salaries'),
    cleaning: () => t('نظافة', 'Cleaning'),
    transport: () => t('مواصلات', 'Transport'),
    maintenance: () => t('صيانة', 'Maintenance'),
    other: () => t('أخرى', 'Other')
  };

  const STATUS_LABELS = {
    draft: () => t('مستني اعتماد', 'Pending Approval'),
    approved: () => t('معتمد (جاهز للصرف)', 'Approved (Ready to Pay)'),
    rejected: () => t('مرفوض', 'Rejected'),
    paid: () => t('اتصرف', 'Paid')
  };

  const ERR_LABELS = {
    'bad-amount': () => t('المبلغ مش مظبوط — اكتب رقم موجب بحد أقصى قرشين.', 'Invalid amount — enter a positive number (max 2 decimals).'),
    'missing-supplier': () => t('اختار المورد الأول.', 'Select a supplier first.'),
    'unknown-supplier': () => t('المورد ده مش متسجل.', 'Supplier not found.'),
    'missing-key': () => t('في رقم مرجعي ناقص.', 'Missing reference ID.'),
    'overpayment': () => t('المبلغ أكبر من الرصيد المستحق على الصيدلية للمورد ده.', 'Amount exceeds the open balance owed to this supplier.'),
    'missing-document': () => t('لازم تكتب رقم المستند أو الفاتورة.', 'Document reference is required.'),
    'missing-category': () => t('اختار بند المصروف.', 'Select an expense category.'),
    'bad-category': () => t('بند المصروف غير مسموح به.', 'Invalid expense category.'),
    'missing-user': () => t('لازم يكون في مستخدم مسجل دخول.', 'A logged-in user is required.'),
    'self-approval': () => t('ماينفعش اللي سجّل المصروف هو نفسه اللي يعتمده.', 'Creator cannot approve or reject their own expense.'),
    'not-draft': () => t('المصروف ده اتاخد فيه قرار قبل كده.', 'This expense has already been decided.'),
    'not-approved': () => t('ماينفعش تصرف مصروف قبل ما يتعتمد.', 'Expense must be approved before payment.'),
    'store-corrupt': () => t('بيانات الحسابات فيها مشكلة — راجع التخزين المحلي.', 'Account storage is corrupted.'),
    'store-write-failed': () => t('فشل حفظ البيانات في المتصفح.', 'Failed to save data to local storage.')
  };

  function errMsg(err) {
    const code = err && err.code ? err.code : '';
    if (ERR_LABELS[code]) return ERR_LABELS[code]();
    return t('حصلت مشكلة غير متوقعة. جرّب تاني.', 'Unexpected error. Please try again.');
  }

  function esc(val) {
    return String(val == null ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtMoney(n) {
    const num = Number(n) || 0;
    const formatted = num.toLocaleString('en-US',   /* Western digits like the rest of the app */ {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return formatted + ' ' + t('ج.م', 'EGP');
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleDateString(en() ? 'en-GB' : 'ar-EG-u-nu-latn', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (e) {
      return String(ts);
    }
  }

  function parseAmount(raw) {
    const cleaned = String(raw == null ? '' : raw).replace(/,/g, '').trim();
    if (!cleaned) return NaN;
    const n = Number(cleaned);
    if (!isFinite(n) || n <= 0) return NaN;
    return Math.round(n * 100) / 100;
  }

  function genId(prefix) {
    return prefix + '-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
  }

  /* ---- Provider & Module Access ---- */
  function getProvider() {
    return window.__novaSupplierProvider || null;
  }

  let acctInstance = null;
  function getAcct() {
    if (acctInstance) return acctInstance;
    if (!window.NovaSupplierAccounts || typeof window.NovaSupplierAccounts.createSupplierAccounts !== 'function') {
      return null;
    }
    acctInstance = window.NovaSupplierAccounts.createSupplierAccounts(localStorage, STORAGE_KEY, {
      categories: CATEGORIES
    });
    return acctInstance;
  }

  function readRawLedger() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { suppliers: {}, moves: [], expenses: [], bank: [] };
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : { suppliers: {}, moves: [], expenses: [], bank: [] };
    } catch (e) {
      return { suppliers: {}, moves: [], expenses: [], bank: [] };
    }
  }

  function syncSuppliers(acct, provider) {
    const list = provider && typeof provider.suppliers === 'function' ? provider.suppliers() || [] : [];
    const raw = readRawLedger();
    list.forEach((s) => {
      if (!s || !s.id) return;
      const existing = raw.suppliers && raw.suppliers[s.id];
      if (!existing || existing.name !== s.name) {
        try {
          acct.setSupplier(String(s.id), {
            name: String(s.name || s.id),
            termDays: existing ? existing.termDays : 30,
            discount: existing ? existing.discount : null
          });
        } catch (e) {
          /* ignore malformed supplier entry */
        }
      }
    });
    return list;
  }

  /* ---- UI State ---- */
  const state = {
    tab: 'suppliers', // 'suppliers' | 'expenses'
    expFilter: 'all', // 'all' | 'draft' | 'approved' | 'paid' | 'rejected'
    flash: null       // { kind: 'ok' | 'err', text: string }
  };

  let activeDialogCleanup = null;

  /* ---- Styles ---- */
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${SECTION_ID} {
        background: #14181d;
        border: 1px solid #2a313a;
        border-radius: 12px;
        padding: 18px;
        margin-top: 18px;
        color: #f1f3f5;
        font-family: inherit;
      }
      #${SECTION_ID} * { box-sizing: border-box; }
      #${SECTION_ID} .nsa-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
        border-bottom: 1px solid #2a313a;
        padding-bottom: 12px;
      }
      #${SECTION_ID} .nsa-title {
        margin: 0;
        font-size: 1.15rem;
        color: #f1f3f5;
      }
      #${SECTION_ID} .nsa-tabs {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      #${SECTION_ID} .nsa-tab {
        min-height: 44px;
        padding: 0 16px;
        border-radius: 8px;
        border: 1px solid #343b44;
        background: #0b0d10;
        color: #aab1bb;
        cursor: pointer;
        font-size: 0.95rem;
        font-weight: 600;
      }
      #${SECTION_ID} .nsa-tab[aria-selected="true"] {
        background: #387e9e;
        border-color: #79c9eb;
        color: #f1f3f5;
      }
      #${SECTION_ID} .nsa-tab:focus-visible,
      #${SECTION_ID} button:focus-visible,
      #${SECTION_ID} input:focus-visible,
      #${SECTION_ID} select:focus-visible,
      #${DIALOG_HOST_ID} button:focus-visible,
      #${DIALOG_HOST_ID} input:focus-visible,
      #${DIALOG_HOST_ID} select:focus-visible,
      #${DIALOG_HOST_ID} textarea:focus-visible {
        outline: 2px solid #79c9eb;
        outline-offset: 2px;
      }
      #${SECTION_ID} .btn,
      #${DIALOG_HOST_ID} .btn {
        min-height: 44px;
        min-width: 44px;
        padding: 8px 14px;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
      }
      #${SECTION_ID} .nsa-flash {
        padding: 10px 14px;
        border-radius: 8px;
        margin-bottom: 12px;
        font-size: 0.92rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
      }
      #${SECTION_ID} .nsa-flash-ok {
        background: rgba(121, 201, 235, 0.14);
        border: 1px solid #387e9e;
        color: #79c9eb;
      }
      #${SECTION_ID} .nsa-flash-err {
        background: rgba(255, 155, 155, 0.14);
        border: 1px solid #ff9b9b;
        color: #ff9b9b;
      }
      #${SECTION_ID} .nsa-toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 12px;
      }
      #${SECTION_ID} .nsa-summary {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        color: #aab1bb;
        font-size: 0.92rem;
      }
      #${SECTION_ID} .nsa-summary strong { color: #f1f3f5; }
      #${SECTION_ID} .nsa-table-wrap {
        overflow-x: auto;
        border: 1px solid #2a313a;
        border-radius: 8px;
        background: #0b0d10;
      }
      #${SECTION_ID} table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.92rem;
      }
      #${SECTION_ID} th,
      #${SECTION_ID} td {
        padding: 10px 12px;
        border-bottom: 1px solid #2a313a;
        text-align: start;
        vertical-align: middle;
      }
      #${SECTION_ID} th {
        color: #aab1bb;
        background: #14181d;
        font-weight: 600;
        white-space: nowrap;
      }
      #${SECTION_ID} tr:last-child td { border-bottom: none; }
      #${SECTION_ID} .nsa-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      #${SECTION_ID} .nsa-badge {
        display: inline-block;
        padding: 3px 8px;
        border-radius: 999px;
        font-size: 0.8rem;
        font-weight: 600;
        border: 1px solid #343b44;
      }
      #${SECTION_ID} .nsa-badge-draft { color: #f0d9a0; border-color: #f0d9a0; }
      #${SECTION_ID} .nsa-badge-approved { color: #79c9eb; border-color: #79c9eb; }
      #${SECTION_ID} .nsa-badge-paid { color: #9be8b0; border-color: #3a7d52; }
      #${SECTION_ID} .nsa-badge-rejected { color: #ff9b9b; border-color: #ff9b9b; }
      #${SECTION_ID} .nsa-muted { color: #aab1bb; font-size: 0.85rem; }
      #${SECTION_ID} .nsa-empty {
        padding: 24px;
        text-align: center;
        color: #aab1bb;
      }
      #${SECTION_ID} .nsa-filters {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      #${SECTION_ID} .nsa-filter-btn {
        min-height: 44px;
        padding: 0 12px;
        border-radius: 8px;
        border: 1px solid #343b44;
        background: #0b0d10;
        color: #aab1bb;
        cursor: pointer;
        font-size: 0.85rem;
      }
      #${SECTION_ID} .nsa-filter-btn[aria-pressed="true"] {
        border-color: #79c9eb;
        color: #f1f3f5;
        background: #1d2730;
      }
      /* Dialog */
      #${DIALOG_HOST_ID} {
        position: fixed;
        inset: 0;
        z-index: 9999;
        background: rgba(0, 0, 0, 0.72);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
      }
      #${DIALOG_HOST_ID} .nsa-dialog {
        background: #14181d;
        border: 1px solid #343b44;
        border-radius: 12px;
        color: #f1f3f5;
        width: 100%;
        max-width: 560px;
        max-height: 90vh;
        overflow-y: auto;
        padding: 18px;
      }
      #${DIALOG_HOST_ID} .nsa-dialog-wide { max-width: 780px; }
      #${DIALOG_HOST_ID} .nsa-dialog-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        border-bottom: 1px solid #2a313a;
        padding-bottom: 10px;
        margin-bottom: 14px;
      }
      #${DIALOG_HOST_ID} .nsa-dialog-head h3 { margin: 0; font-size: 1.08rem; }
      #${DIALOG_HOST_ID} .nsa-field { margin-bottom: 12px; }
      #${DIALOG_HOST_ID} .nsa-field label {
        display: block;
        margin-bottom: 5px;
        color: #aab1bb;
        font-size: 0.9rem;
      }
      #${DIALOG_HOST_ID} .nsa-field input,
      #${DIALOG_HOST_ID} .nsa-field select,
      #${DIALOG_HOST_ID} .nsa-field textarea {
        width: 100%;
        min-height: 44px;
        padding: 8px 10px;
        border-radius: 8px;
        border: 1px solid #343b44;
        background: #0b0d10;
        color: #f1f3f5;
        font-size: 0.95rem;
      }
      #${DIALOG_HOST_ID} .nsa-check {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
        cursor: pointer;
        color: #f1f3f5;
      }
      #${DIALOG_HOST_ID} .nsa-check input { width: 20px; height: 20px; min-height: 20px; }
      #${DIALOG_HOST_ID} .nsa-dialog-err {
        color: #ff9b9b;
        background: rgba(255, 155, 155, 0.12);
        border: 1px solid #ff9b9b;
        border-radius: 8px;
        padding: 8px 10px;
        margin-bottom: 12px;
        font-size: 0.9rem;
      }
      #${DIALOG_HOST_ID} .nsa-dialog-foot {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 14px;
        flex-wrap: wrap;
      }
      #${DIALOG_HOST_ID} .nsa-aging-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 8px;
        margin-bottom: 12px;
      }
      #${DIALOG_HOST_ID} .nsa-aging-card {
        background: #0b0d10;
        border: 1px solid #2a313a;
        border-radius: 8px;
        padding: 8px 10px;
      }
      #${DIALOG_HOST_ID} .nsa-aging-card span { display: block; font-size: 0.8rem; color: #aab1bb; }
      #${DIALOG_HOST_ID} .nsa-aging-card strong { font-size: 0.95rem; }
      #${DIALOG_HOST_ID} table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.88rem;
      }
      #${DIALOG_HOST_ID} th, #${DIALOG_HOST_ID} td {
        padding: 8px;
        border-bottom: 1px solid #2a313a;
        text-align: start;
      }
      #${PRINT_HOST_ID} { display: none; }
      @media print {
        body.nsa-printing > *:not(#${PRINT_HOST_ID}) { display: none !important; }
        body.nsa-printing #${PRINT_HOST_ID} {
          display: block !important;
          color: #000;
          background: #fff;
          padding: 16px;
          font-family: sans-serif;
        }
        body.nsa-printing #${PRINT_HOST_ID} table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 12px;
        }
        body.nsa-printing #${PRINT_HOST_ID} th,
        body.nsa-printing #${PRINT_HOST_ID} td {
          border: 1px solid #333;
          padding: 6px 8px;
          text-align: start;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /* ---- Accessible Dialog Helper ---- */
  function openDialog(opts) {
    closeDialog();
    const opener = document.activeElement;
    const dir = en() ? 'ltr' : 'rtl';
    const host = document.createElement('div');
    host.id = DIALOG_HOST_ID;
    host.setAttribute('dir', dir);

    const titleId = 'nsaDlgTitle-' + Date.now();
    const wideClass = opts.wide ? ' nsa-dialog-wide' : '';

    host.innerHTML = `
      <div class="nsa-dialog${wideClass}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <div class="nsa-dialog-head">
          <h3 id="${titleId}">${esc(opts.title)}</h3>
          <button type="button" class="btn btn-secondary" data-nsa-close aria-label="${esc(t('إغلاق', 'Close'))}">✕</button>
        </div>
        <div class="nsa-dialog-body">${opts.bodyHtml}</div>
      </div>
    `;

    document.body.appendChild(host);
    const dialogEl = host.querySelector('.nsa-dialog');

    const getFocusable = () =>
      Array.prototype.slice.call(
        dialogEl.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
      );

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog();
        return;
      }
      if (e.key === 'Tab') {
        const nodes = getFocusable();
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    function onClick(e) {
      if (e.target === host || e.target.closest('[data-nsa-close]')) {
        closeDialog();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    host.addEventListener('click', onClick);

    activeDialogCleanup = () => {
      document.removeEventListener('keydown', onKeyDown);
      host.removeEventListener('click', onClick);
      if (host.parentNode) host.parentNode.removeChild(host);
      activeDialogCleanup = null;
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
        opener.focus();
      }
    };

    const focusables = getFocusable();
    const firstInput = dialogEl.querySelector('input, select, textarea');
    if (firstInput) firstInput.focus();
    else if (focusables[0]) focusables[0].focus();

    if (typeof opts.onMount === 'function') {
      opts.onMount(dialogEl, closeDialog);
    }
  }

  function closeDialog() {
    if (activeDialogCleanup) activeDialogCleanup();
  }

  function showDialogErr(dialogEl, msg) {
    let box = dialogEl.querySelector('.nsa-dialog-err');
    if (!box) {
      box = document.createElement('div');
      box.className = 'nsa-dialog-err';
      box.setAttribute('role', 'alert');
      const body = dialogEl.querySelector('.nsa-dialog-body');
      body.insertBefore(box, body.firstChild);
    }
    box.textContent = msg;
  }

  /* ---- Supplier Dialogs ---- */
  function openInvoiceDialog(supplier) {
    const acct = getAcct();
    if (!acct) return;
    openDialog({
      title: t('إضافة فاتورة شراء — ', 'Add Purchase Invoice — ') + supplier.name,
      bodyHtml: `
        <form data-nsa-form>
          <div class="nsa-field">
            <label for="nsaInvAmt">${esc(t('مبلغ الفاتورة (ج.م)', 'Invoice Amount (EGP)'))}</label>
            <input id="nsaInvAmt" name="amount" type="number" step="0.01" min="0.01" required />
          </div>
          <div class="nsa-field">
            <label for="nsaInvRef">${esc(t('رقم الفاتورة / المرجع', 'Invoice / Reference #'))}</label>
            <input id="nsaInvRef" name="ref" type="text" placeholder="${esc(t('مثال: INV-1024', 'e.g. INV-1024'))}" />
          </div>
          <div class="nsa-dialog-foot">
            <button type="button" class="btn btn-secondary" data-nsa-close>${esc(t('إلغاء', 'Cancel'))}</button>
            <button type="submit" class="btn btn-primary">${esc(t('حفظ الفاتورة', 'Save Invoice'))}</button>
          </div>
        </form>
      `,
      onMount: (dlg, close) => {
        dlg.querySelector('[data-nsa-form]').addEventListener('submit', (e) => {
          e.preventDefault();
          const amt = parseAmount(dlg.querySelector('#nsaInvAmt').value);
          if (isNaN(amt)) {
            showDialogErr(dlg, ERR_LABELS['bad-amount']());
            return;
          }
          const ref = dlg.querySelector('#nsaInvRef').value.trim();
          const id = ref || genId('inv');
          try {
            acct.addInvoice({ id: id, supplierId: String(supplier.id), amount: amt, ref: ref || id });
            state.flash = { kind: 'ok', text: t('اتسجلت فاتورة الشراء بنجاح.', 'Purchase invoice recorded.') };
            close();
            renderSection();
          } catch (err) {
            showDialogErr(dlg, errMsg(err));
          }
        });
      }
    });
  }

  function openPaymentDialog(supplier) {
    const acct = getAcct();
    const provider = getProvider();
    if (!acct) return;
    const bal = acct.balance(String(supplier.id));
    openDialog({
      title: t('سداد لمورد — ', 'Pay Supplier — ') + supplier.name,
      bodyHtml: `
        <p class="nsa-muted" style="margin-top:0">${esc(t('الرصيد المستحق حالياً:', 'Current balance owed:'))} <strong>${esc(fmtMoney(bal))}</strong></p>
        <form data-nsa-form>
          <div class="nsa-field">
            <label for="nsaPayAmt">${esc(t('مبلغ السداد (ج.م)', 'Payment Amount (EGP)'))}</label>
            <input id="nsaPayAmt" name="amount" type="number" step="0.01" min="0.01" max="${esc(bal > 0 ? bal : '')}" value="${esc(bal > 0 ? bal : '')}" required />
          </div>
          <div class="nsa-field">
            <label for="nsaPayRef">${esc(t('رقم الإيصال / المرجع', 'Receipt / Reference #'))}</label>
            <input id="nsaPayRef" name="ref" type="text" placeholder="${esc(t('اختياري', 'Optional'))}" />
          </div>
          <label class="nsa-check">
            <input id="nsaPayCash" type="checkbox" checked />
            <span>${esc(t('خصم المبلغ من الدرج (صرف نقدي)', 'Deduct from cash drawer'))}</span>
          </label>
          <div class="nsa-dialog-foot">
            <button type="button" class="btn btn-secondary" data-nsa-close>${esc(t('إلغاء', 'Cancel'))}</button>
            <button type="submit" class="btn btn-primary">${esc(t('تأكيد السداد', 'Confirm Payment'))}</button>
          </div>
        </form>
      `,
      onMount: (dlg, close) => {
        // AUDIT-03 review: no double submit; the drawer step can never cause a duplicate payment on retry
        const form = dlg.querySelector('[data-nsa-form]');
        const submitBtn = form.querySelector('button[type="submit"]');
        let submitting = false;
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (submitting) return;
          const amt = parseAmount(dlg.querySelector('#nsaPayAmt').value);
          if (isNaN(amt) || !(amt > 0)) {
            showDialogErr(dlg, ERR_LABELS['bad-amount']());
            return;
          }
          const ref = dlg.querySelector('#nsaPayRef').value.trim();
          const fromCash = dlg.querySelector('#nsaPayCash').checked;
          if (fromCash && (!provider || typeof provider.cashOut !== 'function')) {
            showDialogErr(dlg, t('مش قادر أخصم من الدرج دلوقتي.', 'Cannot deduct from the cash drawer right now.'));
            return;
          }
          const id = ref || genId('pay');
          submitting = true;
          if (submitBtn) submitBtn.disabled = true;
          try {
            acct.pay({ id: id, supplierId: String(supplier.id), amount: amt, ref: ref || id });
          } catch (err) {
            submitting = false;
            if (submitBtn) submitBtn.disabled = false;
            showDialogErr(dlg, errMsg(err));
            return;
          }
          if (fromCash) {
            try {
              provider.cashOut(amt, t('سداد مورد: ', 'Supplier payment: ') + supplier.name + (ref ? ' (' + ref + ')' : ''));
            } catch (err) {
              state.flash = { kind: 'err', text: t('اتسجل السداد بس الخصم من الدرج فشل — ما تعيدش السداد، راجع الدرج.', 'Payment recorded but the drawer deduction failed — do not pay again; check the drawer.') };
              close();
              renderSection();
              return;
            }
          }
          state.flash = { kind: 'ok', text: t('اتسجل السداد بنجاح.', 'Supplier payment recorded.') };
          close();
          renderSection();
        });
      }
    });
  }

  function openStatementDialog(supplier) {
    const acct = getAcct();
    if (!acct) return;
    const sid = String(supplier.id);
    const bal = acct.balance(sid);
    const aging = acct.aging(sid);
    const raw = readRawLedger();
    const moves = (raw.moves || []).filter((m) => m.supplierId === sid).sort((a, b) => (a.at || 0) - (b.at || 0));

    let running = 0;
    const rowsHtml = moves.length
      ? moves
          .map((m) => {
            const amt = (m.cents || 0) / 100;
            let typeLabel = m.type;
            let delta = 0;
            if (m.type === 'invoice') {
              typeLabel = t('فاتورة شراء', 'Invoice');
              delta = amt;
            } else if (m.type === 'payment') {
              typeLabel = t('سداد', 'Payment');
              const disc = (m.allocations || []).reduce((s, a) => s + (a.discount || 0), 0) / 100;
              delta = -(amt + disc);
            } else if (m.type === 'credit') {
              typeLabel = t('مرتجع للمورد', 'Supplier return');
              delta = -amt;
            } else if (m.type === 'reversal') {
              typeLabel = t('عكس حركة', 'Reversal');
            }
            running += delta;
            return `
              <tr>
                <td>${esc(fmtDate(m.at))}</td>
                <td>${esc(typeLabel)}</td>
                <td>${esc(m.ref || m.id)}</td>
                <td>${m.type === 'invoice' ? esc(fmtMoney(amt)) : '—'}</td>
                <td>${m.type === 'payment' || m.type === 'credit' ? esc(fmtMoney(amt)) : '—'}</td>
                <td>${esc(fmtMoney(Math.max(0, running)))}</td>
              </tr>
            `;
          })
          .join('')
      : `<tr><td colspan="6" style="text-align:center;color:#aab1bb">${esc(t('مفيش حركات متسجلة للمورد ده لسه.', 'No transactions yet for this supplier.'))}</td></tr>`;

    const tableHtml = `
      <table>
        <thead>
          <tr>
            <th>${esc(t('التاريخ', 'Date'))}</th>
            <th>${esc(t('النوع', 'Type'))}</th>
            <th>${esc(t('المرجع', 'Ref'))}</th>
            <th>${esc(t('فواتير (+)', 'Invoices (+)'))}</th>
            <th>${esc(t('سداد (-)', 'Payments (-)'))}</th>
            <th>${esc(t('الرصيد', 'Balance'))}</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;

    openDialog({
      title: t('كشف حساب مورد — ', 'Supplier Statement — ') + supplier.name,
      wide: true,
      bodyHtml: `
        <div class="nsa-aging-grid">
          <div class="nsa-aging-card"><span>${esc(t('الرصيد الحالي', 'Current Balance'))}</span><strong>${esc(fmtMoney(bal))}</strong></div>
          <div class="nsa-aging-card"><span>${esc(t('جاري', 'Current'))}</span><strong>${esc(fmtMoney(aging.current))}</strong></div>
          <div class="nsa-aging-card"><span>${esc(t('متأخر 1-30 يوم', '1-30 Days'))}</span><strong>${esc(fmtMoney(aging.d1_30))}</strong></div>
          <div class="nsa-aging-card"><span>${esc(t('متأخر 31-60 يوم', '31-60 Days'))}</span><strong>${esc(fmtMoney(aging.d31_60))}</strong></div>
          <div class="nsa-aging-card"><span>${esc(t('متأخر +60 يوم', '60+ Days'))}</span><strong>${esc(fmtMoney(aging.d61_plus))}</strong></div>
        </div>
        ${tableHtml}
        <div class="nsa-dialog-foot">
          <button type="button" class="btn btn-secondary" data-nsa-close>${esc(t('إغلاق', 'Close'))}</button>
          <button type="button" class="btn btn-primary" data-nsa-print>${esc(t('طباعة كشف الحساب', 'Print Statement'))}</button>
        </div>
      `,
      onMount: (dlg) => {
        dlg.querySelector('[data-nsa-print]').addEventListener('click', () => {
          printStatement(supplier.name, bal, tableHtml);
        });
      }
    });
  }

  function printStatement(supplierName, balance, tableHtml) {
    let host = document.getElementById(PRINT_HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = PRINT_HOST_ID;
      document.body.appendChild(host);
    }
    host.setAttribute('dir', en() ? 'ltr' : 'rtl');
    host.innerHTML = `
      <h2>${esc(t('كشف حساب مورد — ', 'Supplier Statement — ') + supplierName)}</h2>
      <p>${esc(t('تاريخ الطباعة: ', 'Printed: ') + fmtDate(Date.now()))} | ${esc(t('الرصيد المستحق: ', 'Balance Owed: ') + fmtMoney(balance))}</p>
      ${tableHtml}
    `;
    document.body.classList.add('nsa-printing');
    const cleanup = () => {
      document.body.classList.remove('nsa-printing');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    setTimeout(cleanup, 1500);
  }

  /* ---- Add / rename supplier (Gemini follow-up, reviewed) ---- */
  function normalizeName(name) {
    return String(name == null ? '' : name).trim().toLowerCase();
  }

  function hasDuplicateSupplierName(provider, name, excludeId) {
    const target = normalizeName(name);
    if (!target) return false;
    const list = provider && typeof provider.suppliers === 'function' ? provider.suppliers() || [] : [];
    return list.some((s) => s && String(s.id) !== String(excludeId || '') && normalizeName(s.name) === target);
  }

  function openAddSupplierDialog() {
    const provider = getProvider();
    if (!provider || typeof provider.addSupplier !== 'function') {
      state.flash = { kind: 'err', text: t('إضافة الموردين مش متفعّلة في النظام حالياً.', 'Adding suppliers is not available.') };
      renderSection();
      return;
    }

    openDialog({
      title: t('إضافة مورد جديد', 'Add New Supplier'),
      bodyHtml: `
        <form data-nsa-form>
          <div class="nsa-field">
            <label for="nsaSupName">${esc(t('اسم المورد', 'Supplier Name'))}</label>
            <input id="nsaSupName" type="text" required placeholder="${esc(t('مثال: شركة المتحدة للأدوية', 'e.g. United Pharma'))}" />
          </div>
          <div class="nsa-field">
            <label for="nsaSupPhone">${esc(t('رقم التليفون (اختياري)', 'Phone (optional)'))}</label>
            <input id="nsaSupPhone" type="tel" placeholder="${esc(t('مثال: 01012345678', 'e.g. 01012345678'))}" />
          </div>
          <div class="nsa-dialog-foot">
            <button type="button" class="btn btn-secondary" data-nsa-close>${esc(t('إلغاء', 'Cancel'))}</button>
            <button type="submit" class="btn btn-primary">${esc(t('حفظ المورد', 'Save Supplier'))}</button>
          </div>
        </form>
      `,
      onMount: (dlg, close) => {
        dlg.querySelector('[data-nsa-form]').addEventListener('submit', (e) => {
          e.preventDefault();
          const name = dlg.querySelector('#nsaSupName').value.trim();
          const phone = dlg.querySelector('#nsaSupPhone').value.trim();
          if (!name) {
            showDialogErr(dlg, t('لازم تكتب اسم المورد.', 'Supplier name is required.'));
            return;
          }
          if (hasDuplicateSupplierName(provider, name)) {
            showDialogErr(dlg, t('في مورد متسجل بنفس الاسم ده قبل كده.', 'A supplier with this name already exists.'));
            return;
          }
          try {
            const created = provider.addSupplier({ name: name, phone: phone || undefined });
            const acct = getAcct();
            if (acct && created && created.id) {
              acct.setSupplier(String(created.id), { name: String(created.name || name) });
            }
            state.flash = { kind: 'ok', text: t('اتضاف المورد بنجاح.', 'Supplier added.') };
            close();
            renderSection();
          } catch (err) {
            showDialogErr(dlg, errMsg(err));
          }
        });
      }
    });
  }

  function openRenameSupplierDialog(supplier) {
    const provider = getProvider();
    if (!provider || typeof provider.renameSupplier !== 'function') {
      state.flash = { kind: 'err', text: t('تعديل اسم المورد مش متفعّل حالياً.', 'Renaming suppliers is not available.') };
      renderSection();
      return;
    }

    openDialog({
      title: t('تعديل اسم المورد', 'Rename Supplier'),
      bodyHtml: `
        <form data-nsa-form>
          <div class="nsa-field">
            <label for="nsaRenameSup">${esc(t('الاسم الجديد', 'New Name'))}</label>
            <input id="nsaRenameSup" type="text" required value="${esc(supplier.name)}" />
          </div>
          <div class="nsa-dialog-foot">
            <button type="button" class="btn btn-secondary" data-nsa-close>${esc(t('إلغاء', 'Cancel'))}</button>
            <button type="submit" class="btn btn-primary">${esc(t('حفظ الاسم', 'Save Name'))}</button>
          </div>
        </form>
      `,
      onMount: (dlg, close) => {
        dlg.querySelector('[data-nsa-form]').addEventListener('submit', (e) => {
          e.preventDefault();
          const newName = dlg.querySelector('#nsaRenameSup').value.trim();
          if (!newName) {
            showDialogErr(dlg, t('لازم تكتب اسم المورد.', 'Supplier name is required.'));
            return;
          }
          if (hasDuplicateSupplierName(provider, newName, supplier.id)) {
            showDialogErr(dlg, t('في مورد تاني متسجل بنفس الاسم ده.', 'Another supplier already has this name.'));
            return;
          }
          try {
            provider.renameSupplier(String(supplier.id), newName);
            state.flash = { kind: 'ok', text: t('اتعدّل اسم المورد بنجاح.', 'Supplier renamed.') };
            close();
            renderSection();
          } catch (err) {
            showDialogErr(dlg, errMsg(err));
          }
        });
      }
    });
  }

  /* ---- Expense Dialogs ---- */
  function openAddExpenseDialog() {
    const acct = getAcct();
    const provider = getProvider();
    if (!acct) return;
    const user = provider && typeof provider.currentUser === 'function' ? provider.currentUser() : null;
    if (!user || !user.id) {
      state.flash = { kind: 'err', text: ERR_LABELS['missing-user']() };
      renderSection();
      return;
    }

    const catOptions = CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(CAT_LABELS[c]())}</option>`).join('');

    openDialog({
      title: t('إضافة مصروف جديد (يحتاج اعتماد)', 'Add New Expense (Requires Approval)'),
      bodyHtml: `
        <form data-nsa-form>
          <div class="nsa-field">
            <label for="nsaExpAmt">${esc(t('المبلغ (ج.م)', 'Amount (EGP)'))}</label>
            <input id="nsaExpAmt" type="number" step="0.01" min="0.01" required />
          </div>
          <div class="nsa-field">
            <label for="nsaExpCat">${esc(t('البند', 'Category'))}</label>
            <select id="nsaExpCat" required>${catOptions}</select>
          </div>
          <div class="nsa-field">
            <label for="nsaExpDoc">${esc(t('رقم المستند / الإيصال', 'Document / Receipt Ref'))}</label>
            <input id="nsaExpDoc" type="text" required placeholder="${esc(t('مثال: إيصال كهرباء 441', 'e.g. Receipt #441'))}" />
          </div>
          <div class="nsa-field">
            <label for="nsaExpNote">${esc(t('ملاحظة (اختياري)', 'Note (optional)'))}</label>
            <input id="nsaExpNote" type="text" />
          </div>
          <div class="nsa-dialog-foot">
            <button type="button" class="btn btn-secondary" data-nsa-close>${esc(t('إلغاء', 'Cancel'))}</button>
            <button type="submit" class="btn btn-primary">${esc(t('تسجيل للاعتماد', 'Submit for Approval'))}</button>
          </div>
        </form>
      `,
      onMount: (dlg, close) => {
        dlg.querySelector('[data-nsa-form]').addEventListener('submit', (e) => {
          e.preventDefault();
          const amt = parseAmount(dlg.querySelector('#nsaExpAmt').value);
          if (isNaN(amt)) {
            showDialogErr(dlg, ERR_LABELS['bad-amount']());
            return;
          }
          const cat = dlg.querySelector('#nsaExpCat').value;
          const doc = dlg.querySelector('#nsaExpDoc').value.trim();
          const note = dlg.querySelector('#nsaExpNote').value.trim();
          try {
            acct.addExpense({
              id: genId('exp'),
              amount: amt,
              category: cat,
              document: doc,
              createdBy: String(user.id),
              note: note
            });
            state.flash = { kind: 'ok', text: t('اتسجل المصروف ومستني اعتماد مدير.', 'Expense submitted and awaiting manager approval.') };
            close();
            renderSection();
          } catch (err) {
            showDialogErr(dlg, errMsg(err));
          }
        });
      }
    });
  }

  function openDecideExpenseDialog(expense, approve) {
    const acct = getAcct();
    const provider = getProvider();
    if (!acct || !provider || typeof provider.verifyApprover !== 'function') return;

    openDialog({
      title: approve ? t('اعتماد مصروف', 'Approve Expense') : t('رفض مصروف', 'Reject Expense'),
      bodyHtml: `
        <p class="nsa-muted" style="margin-top:0">
          ${esc(CAT_LABELS[expense.category] ? CAT_LABELS[expense.category]() : expense.category)} —
          <strong>${esc(fmtMoney(expense.amount))}</strong> (${esc(expense.document)})
        </p>
        <form data-nsa-form>
          <div class="nsa-field">
            <label for="nsaAppUser">${esc(t('اسم المدير المُعتمد', 'Approver Username'))}</label>
            <input id="nsaAppUser" type="text" autocomplete="username" required />
          </div>
          <div class="nsa-field">
            <label for="nsaAppPass">${esc(t('كلمة المرور', 'Password'))}</label>
            <input id="nsaAppPass" type="password" autocomplete="current-password" required />
          </div>
          ${
            approve
              ? ''
              : `<div class="nsa-field">
                  <label for="nsaAppReason">${esc(t('سبب الرفض', 'Rejection Reason'))}</label>
                  <input id="nsaAppReason" type="text" required />
                </div>`
          }
          <div class="nsa-dialog-foot">
            <button type="button" class="btn btn-secondary" data-nsa-close>${esc(t('إلغاء', 'Cancel'))}</button>
            <button type="submit" class="btn ${approve ? 'btn-primary' : 'btn-danger'}" data-nsa-submit>
              ${esc(approve ? t('تأكيد الاعتماد', 'Confirm Approval') : t('تأكيد الرفض', 'Confirm Rejection'))}
            </button>
          </div>
        </form>
      `,
      onMount: (dlg, close) => {
        dlg.querySelector('[data-nsa-form]').addEventListener('submit', async (e) => {
          e.preventDefault();
          const submitBtn = dlg.querySelector('[data-nsa-submit]');
          const name = dlg.querySelector('#nsaAppUser').value.trim();
          const pass = dlg.querySelector('#nsaAppPass').value;
          const reason = approve ? '' : dlg.querySelector('#nsaAppReason').value.trim();
          submitBtn.disabled = true;
          try {
            const approver = await provider.verifyApprover(name, pass);
            if (!approver || !approver.id) {
              showDialogErr(dlg, t('بيانات المدير مش صحيحة.', 'Invalid approver credentials.'));
              submitBtn.disabled = false;
              return;
            }
            if (approve) {
              acct.approveExpense(expense.id, String(approver.id));
              state.flash = { kind: 'ok', text: t('تم اعتماد المصروف — تقدر تصرفه من الدرج دلوقتي.', 'Expense approved — ready to pay from drawer.') };
            } else {
              acct.rejectExpense(expense.id, String(approver.id), reason);
              state.flash = { kind: 'ok', text: t('تم رفض المصروف.', 'Expense rejected.') };
            }
            close();
            renderSection();
          } catch (err) {
            showDialogErr(dlg, errMsg(err));
            submitBtn.disabled = false;
          }
        });
      }
    });
  }

  function handlePayExpense(expense) {
    const acct = getAcct();
    const provider = getProvider();
    if (!acct) return;
    // AUDIT-03 review: pay only when the drawer can be debited; report a partial failure honestly
    if (!provider || typeof provider.cashOut !== 'function') {
      state.flash = { kind: 'err', text: t('مش قادر أخصم من الدرج دلوقتي.', 'Cannot deduct from the cash drawer right now.') };
      renderSection();
      return;
    }
    try {
      acct.payExpense(expense.id);
    } catch (err) {
      state.flash = { kind: 'err', text: errMsg(err) };
      renderSection();
      return;
    }
    try {
      const catText = CAT_LABELS[expense.category] ? CAT_LABELS[expense.category]() : expense.category;
      provider.cashOut(expense.amount, t('مصروف: ', 'Expense: ') + catText + ' (' + expense.document + ')');
      state.flash = { kind: 'ok', text: t('اتصرف المصروف واتخصم من الدرج.', 'Expense paid and deducted from cash drawer.') };
    } catch (err) {
      state.flash = { kind: 'err', text: t('المصروف اتسجل مصروف بس الخصم من الدرج فشل — راجع الدرج قبل قفل الوردية.', 'Expense marked paid but the drawer deduction failed — check the drawer before closing the shift.') };
    }
    renderSection();
  }

  /* ---- Renderers ---- */
  function renderSuppliersTab(acct, suppliers) {
    let totalOwed = 0;
    const rows = suppliers.map((s) => {
      const sid = String(s.id);
      const bal = acct.balance(sid);
      totalOwed += bal;
      const discounts = acct.discountsAvailable(sid);
      const discHint = discounts.length
        ? `<div class="nsa-muted">${esc(t('خصم سداد مبكر متاح:', 'Early-pay discount:'))} ${esc(fmtMoney(discounts.reduce((a, d) => a + d.saves, 0)))}</div>`
        : '';
      return `
        <tr>
          <td>
            <strong>${esc(s.name)}</strong>
            ${discHint}
          </td>
          <td><strong>${esc(fmtMoney(bal))}</strong></td>
          <td>
            <div class="nsa-actions">
              <button type="button" class="btn btn-secondary" data-nsa-act="inv" data-sid="${esc(sid)}">${esc(t('فاتورة شراء', 'Add Invoice'))}</button>
              <button type="button" class="btn btn-primary" data-nsa-act="pay" data-sid="${esc(sid)}" ${bal <= 0 ? 'disabled' : ''}>${esc(t('سداد', 'Pay'))}</button>
              <button type="button" class="btn btn-secondary" data-nsa-act="stmt" data-sid="${esc(sid)}">${esc(t('كشف حساب', 'Statement'))}</button>
              <button type="button" class="btn btn-secondary" data-nsa-act="rename" data-sid="${esc(sid)}">${esc(t('تعديل الاسم', 'Rename'))}</button>
            </div>
          </td>
        </tr>
      `;
    });

    return `
      <div class="nsa-toolbar">
        <div class="nsa-summary">
          <span>${esc(t('عدد الموردين:', 'Suppliers:'))} <strong>${suppliers.length}</strong></span>
          <span>${esc(t('إجمالي المستحق للموردين:', 'Total Owed:'))} <strong>${esc(fmtMoney(totalOwed))}</strong></span>
        </div>
        <button type="button" class="btn btn-primary" data-nsa-act="addsup">${esc(t('+ إضافة مورد', '+ Add Supplier'))}</button>
      </div>
      <div class="nsa-table-wrap">
        ${
          suppliers.length
            ? `<table>
                <thead>
                  <tr>
                    <th>${esc(t('المورد', 'Supplier'))}</th>
                    <th>${esc(t('الرصيد المستحق', 'Balance Owed'))}</th>
                    <th>${esc(t('إجراءات', 'Actions'))}</th>
                  </tr>
                </thead>
                <tbody>${rows.join('')}</tbody>
              </table>`
            : `<div class="nsa-empty">${esc(t('مفيش موردين لسه — ضيف أول مورد', 'No suppliers yet — add the first one'))}<div style="margin-top:10px"><button type="button" class="btn btn-primary" data-nsa-act="addsup">${esc(t('+ إضافة مورد', '+ Add Supplier'))}</button></div></div>`
        }
      </div>
    `;
  }

  function renderExpensesTab(acct) {
    const all = acct.expenses();
    const pendingCount = all.filter((x) => x.status === 'draft').length;
    const filtered = state.expFilter === 'all' ? all : all.filter((x) => x.status === state.expFilter);
    const filters = [
      { id: 'all', label: t('الكل', 'All') + ' (' + all.length + ')' },
      { id: 'draft', label: t('مستني اعتماد', 'Pending') + ' (' + pendingCount + ')' },
      { id: 'approved', label: t('معتمد', 'Approved') },
      { id: 'paid', label: t('اتصرف', 'Paid') },
      { id: 'rejected', label: t('مرفوض', 'Rejected') }
    ];

    const rows = filtered
      .slice()
      .reverse()
      .map((x) => {
        const catText = CAT_LABELS[x.category] ? CAT_LABELS[x.category]() : x.category;
        const stText = STATUS_LABELS[x.status] ? STATUS_LABELS[x.status]() : x.status;
        let actions = '<span class="nsa-muted">—</span>';
        if (x.status === 'draft') {
          actions = `
            <div class="nsa-actions">
              <button type="button" class="btn btn-primary" data-nsa-act="approve" data-eid="${esc(x.id)}">${esc(t('اعتماد', 'Approve'))}</button>
              <button type="button" class="btn btn-danger" data-nsa-act="reject" data-eid="${esc(x.id)}">${esc(t('رفض', 'Reject'))}</button>
            </div>
          `;
        } else if (x.status === 'approved') {
          actions = `
            <div class="nsa-actions">
              <button type="button" class="btn btn-primary" data-nsa-act="payexp" data-eid="${esc(x.id)}">${esc(t('صرف من الدرج', 'Pay from Drawer'))}</button>
            </div>
          `;
        }
        return `
          <tr>
            <td>${esc(fmtDate(x.at))}</td>
            <td><strong>${esc(catText)}</strong>${x.note ? `<div class="nsa-muted">${esc(x.note)}</div>` : ''}</td>
            <td>${esc(x.document)}</td>
            <td><strong>${esc(fmtMoney(x.amount))}</strong></td>
            <td>
              <span class="nsa-badge nsa-badge-${esc(x.status)}">${esc(stText)}</span>
              ${x.reason ? `<div class="nsa-muted">${esc(x.reason)}</div>` : ''}
            </td>
            <td>${actions}</td>
          </tr>
        `;
      });

    return `
      <div class="nsa-toolbar">
        <div class="nsa-filters" role="group" aria-label="${esc(t('تصفية المصروفات', 'Filter expenses'))}">
          ${filters
            .map(
              (f) =>
                `<button type="button" class="nsa-filter-btn" data-nsa-filter="${esc(f.id)}" aria-pressed="${state.expFilter === f.id ? 'true' : 'false'}">${esc(f.label)}</button>`
            )
            .join('')}
        </div>
        <button type="button" class="btn btn-primary" data-nsa-act="addexp">${esc(t('+ إضافة مصروف', '+ Add Expense'))}</button>
      </div>
      <div class="nsa-table-wrap">
        ${
          filtered.length
            ? `<table>
                <thead>
                  <tr>
                    <th>${esc(t('التاريخ', 'Date'))}</th>
                    <th>${esc(t('البند', 'Category'))}</th>
                    <th>${esc(t('المستند', 'Document'))}</th>
                    <th>${esc(t('المبلغ', 'Amount'))}</th>
                    <th>${esc(t('الحالة', 'Status'))}</th>
                    <th>${esc(t('إجراءات', 'Actions'))}</th>
                  </tr>
                </thead>
                <tbody>${rows.join('')}</tbody>
              </table>`
            : `<div class="nsa-empty">${esc(t('مفيش مصروفات في القائمة دي.', 'No expenses in this view.'))}</div>`
        }
      </div>
    `;
  }

  function renderSection() {
    const section = document.getElementById(SECTION_ID);
    if (!section) return;
    section.setAttribute('dir', en() ? 'ltr' : 'rtl');

    const acct = getAcct();
    const provider = getProvider();
    if (!acct) {
      section.innerHTML = `<div class="nsa-empty">${esc(t('موديول حسابات الموردين مش متحمّل.', 'Supplier accounts module is not loaded.'))}</div>`;
      return;
    }

    const suppliers = syncSuppliers(acct, provider);
    const flashHtml = state.flash
      ? `<div class="nsa-flash nsa-flash-${state.flash.kind === 'err' ? 'err' : 'ok'}" role="status">
           <span>${esc(state.flash.text)}</span>
           <button type="button" class="btn btn-secondary" data-nsa-dismiss-flash aria-label="${esc(t('إخفاء', 'Dismiss'))}">✕</button>
         </div>`
      : '';

    const bodyHtml = state.tab === 'suppliers' ? renderSuppliersTab(acct, suppliers) : renderExpensesTab(acct);

    section.innerHTML = `
      <div class="nsa-header">
        <h2 class="nsa-title">${esc(t('حسابات الموردين والمصروفات', 'Supplier Accounts & Expenses'))}</h2>
        <div class="nsa-tabs" role="tablist">
          <button type="button" class="nsa-tab" role="tab" data-nsa-tab="suppliers" aria-selected="${state.tab === 'suppliers' ? 'true' : 'false'}">${esc(t('الموردين', 'Suppliers'))}</button>
          <button type="button" class="nsa-tab" role="tab" data-nsa-tab="expenses" aria-selected="${state.tab === 'expenses' ? 'true' : 'false'}">${esc(t('المصروفات', 'Expenses'))}</button>
        </div>
      </div>
      ${flashHtml}
      ${bodyHtml}
    `;
  }

  /* ---- Event Delegation on Section ---- */
  function attachSectionEvents(section) {
    section.addEventListener('click', (e) => {
      const dismissBtn = e.target.closest('[data-nsa-dismiss-flash]');
      if (dismissBtn) {
        state.flash = null;
        renderSection();
        return;
      }

      const tabBtn = e.target.closest('[data-nsa-tab]');
      if (tabBtn) {
        state.tab = tabBtn.getAttribute('data-nsa-tab');
        state.flash = null;
        renderSection();
        return;
      }

      const filterBtn = e.target.closest('[data-nsa-filter]');
      if (filterBtn) {
        state.expFilter = filterBtn.getAttribute('data-nsa-filter');
        renderSection();
        return;
      }

      const actBtn = e.target.closest('[data-nsa-act]');
      if (!actBtn) return;

      const act = actBtn.getAttribute('data-nsa-act');
      const provider = getProvider();
      const acct = getAcct();
      if (!acct) return;

      if (act === 'addsup') {
        openAddSupplierDialog();
        return;
      }
      if (act === 'addexp') {
        openAddExpenseDialog();
        return;
      }

      const sid = actBtn.getAttribute('data-sid');
      if (sid) {
        const list = provider && typeof provider.suppliers === 'function' ? provider.suppliers() || [] : [];
        const sup = list.find((s) => String(s.id) === sid) || { id: sid, name: sid };
        if (act === 'inv') openInvoiceDialog(sup);
        else if (act === 'pay') openPaymentDialog(sup);
        else if (act === 'stmt') openStatementDialog(sup);
        else if (act === 'rename') openRenameSupplierDialog(sup);
        return;
      }

      const eid = actBtn.getAttribute('data-eid');
      if (eid) {
        const exp = acct.expenses().find((x) => x.id === eid);
        if (!exp) return;
        if (act === 'approve') openDecideExpenseDialog(exp, true);
        else if (act === 'reject') openDecideExpenseDialog(exp, false);
        else if (act === 'payexp') handlePayExpense(exp);
      }
    });
  }

  /* ---- Mount & MutationObserver ---- */
  function tryMount() {
    if (document.getElementById(SECTION_ID)) return;
    // AUDIT-03 integration: #novaRetReasons exists only when there are sales; otherwise mount at the end of the open reports page
    const anchor = document.getElementById(ANCHOR_ID);
    const view = document.getElementById('novaPageView');
    const onReports = !!document.querySelector('.nova-tab.active[data-page="reports"]');
    if (!anchor && !(onReports && view)) return;

    ensureStyles();
    const target = anchor ? (anchor.closest('.nova-panel') || anchor) : null;
    const section = document.createElement('section');
    section.id = SECTION_ID;
    section.className = 'nova-panel';
    section.setAttribute('aria-label', t('حسابات الموردين والمصروفات', 'Supplier Accounts & Expenses'));

    if (target && target.parentNode) target.parentNode.insertBefore(section, target.nextSibling);
    else view.appendChild(section);
    attachSectionEvents(section);
    renderSection();
  }

  function startObserver() {
    tryMount();
    if (!document.body) return;
    const observer = new MutationObserver(() => {
      if (!document.getElementById(SECTION_ID) && (document.getElementById(ANCHOR_ID) || document.querySelector('.nova-tab.active[data-page="reports"]'))) {
        tryMount();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
})();