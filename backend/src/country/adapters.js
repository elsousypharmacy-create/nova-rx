// N113 (INT-05): country adapters — tax / currency / locale + e-invoice stub.
// Pure module: no network, no bindings. Flag NOVA_COUNTRY_ADAPTERS=1 (default OFF => callers use legacy local behaviour).
// ZATCA e-invoice flag NOVA_ZATCA_EINVOICE=1 (default OFF); real submission needs CSID => NEEDS-OWNER, never called here.

export function countryAdaptersEnabled(env) { return !!env && String(env.NOVA_COUNTRY_ADAPTERS) === '1'; }
export function zatcaEnabled(env) { return !!env && String(env.NOVA_ZATCA_EINVOICE) === '1'; }

const rid = () => 'req-' + Math.random().toString(36).slice(2, 10);
function fail(code, message_ar, status = 400) {
  return { ok: false, status, code, message_ar, requestId: rid() };
}

// All money in integer minor units (halalas / piasters). Tax is rounded half-up.
function makeTax(rateBp, name) {
  return {
    name, rateBp,
    // net amount (minor units) -> { net, tax, gross }
    add(net) {
      if (!Number.isSafeInteger(net) || net < 0) return fail('COUNTRY_BAD_AMOUNT', 'المبلغ غير صالح');
      const tax = Math.floor((net * rateBp + 5000) / 10000);
      return { ok: true, net, tax, gross: net + tax };
    },
    // gross amount (tax-inclusive) -> { net, tax, gross }
    extract(gross) {
      if (!Number.isSafeInteger(gross) || gross < 0) return fail('COUNTRY_BAD_AMOUNT', 'المبلغ غير صالح');
      const net = Math.floor((gross * 10000 + (10000 + rateBp) / 2) / (10000 + rateBp));
      return { ok: true, net, tax: gross - net, gross };
    },
  };
}

function makeLocale(locale, currency, symbol_ar, minorDigits = 2) {
  return {
    locale, currency, symbol_ar, minorDigits, dir: 'rtl',
    format(minor) {
      if (!Number.isSafeInteger(minor)) return fail('COUNTRY_BAD_AMOUNT', 'المبلغ غير صالح');
      const neg = minor < 0 ? '-' : '';
      const a = Math.abs(minor), p = 10 ** minorDigits;
      const whole = Math.floor(a / p), frac = String(a % p).padStart(minorDigits, '0');
      return `${neg}${whole}.${frac} ${symbol_ar}`;
    },
  };
}

// E-invoice adapter stub. Never performs network calls.
function einvoiceStub(scheme) {
  return {
    scheme,
    async submit(env, invoice) {
      if (scheme !== 'ZATCA') return fail('EINVOICE_UNSUPPORTED', 'الفاتورة الإلكترونية غير مدعومة لهذه الدولة', 501);
      if (!zatcaEnabled(env)) return fail('EINVOICE_DISABLED', 'الفاتورة الإلكترونية (زاتكا) غير مفعّلة', 404);
      if (!invoice || typeof invoice !== 'object') return fail('EINVOICE_BAD_INVOICE', 'بيانات الفاتورة غير صالحة');
      // Real ZATCA clearance/reporting needs CSID onboarding (NEEDS-OWNER). Stub only.
      return fail('EINVOICE_NOT_ONBOARDED', 'لم يتم تسجيل المنشأة في زاتكا بعد (CSID مطلوب)', 501);
    },
  };
}

const ADAPTERS = {
  SA: { country: 'SA', tax: makeTax(1500, 'VAT'), ...{ money: makeLocale('ar-SA', 'SAR', 'ر.س') }, einvoice: einvoiceStub('ZATCA') },
  EG: { country: 'EG', tax: makeTax(1400, 'VAT'), ...{ money: makeLocale('ar-EG', 'EGP', 'ج.م') }, einvoice: einvoiceStub('ETA') },
};

export function listCountries() { return Object.keys(ADAPTERS); }
export function getCountryAdapter(code) {
  const a = ADAPTERS[String(code || '').toUpperCase()];
  return a || fail('COUNTRY_UNSUPPORTED', 'الدولة غير مدعومة', 404);
}
