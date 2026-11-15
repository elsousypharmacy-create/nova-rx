/* NOVA Rx — UX-01 Arabic RTL design system (pure logic, no network, frontend/local only).
   Single source for: Cairo/RTL settings, dark + light colour tokens (WCAG AA checked), shared Arabic messages.
   Dark values mirror index.html :root (Black Edition). Light theme is opt-in only (owner decision on light theme pending).
   Works as <script> (window.NovaUx) and Node. Not wired to a screen yet. */
(function (root) {
  'use strict';
  var FONT = 'Cairo, Tahoma, Arial, sans-serif';
  var DARK = { 'bg-base': '#08090b', 'bg-panel': '#111418', 'bg-surface': '#1b2026', 'border-focus': '#76b8d5',
    'bg-elevated': '#232a32', 'on-accent': '#08090b', 'border-subtle': '#2a313a',
    'text-main': '#f1f3f5', 'text-muted': '#a4adb7', 'text-dim': '#808b96', 'accent': '#76b8d5',
    'ok': '#60b99b', 'danger': '#ff6b6b', 'warn': '#d9bf86' };
  var LIGHT = { 'bg-base': '#f6f7f9', 'bg-panel': '#ffffff', 'bg-surface': '#eef1f4', 'border-focus': '#0b5f85',
    'bg-elevated': '#ffffff', 'on-accent': '#ffffff', 'border-subtle': '#d5dbe1',
    'text-main': '#14181d', 'text-muted': '#4a5560', 'text-dim': '#5b6670', 'accent': '#0b5f85',
    'ok': '#0d6b4d', 'danger': '#b42318', 'warn': '#8a5a00' };
  var THEMES = { dark: DARK, light: LIGHT };
  /* Text/background pairs that must reach WCAG AA (4.5:1 normal text). */
  var PAIRS = [['text-main', 'bg-base'], ['text-main', 'bg-panel'], ['text-main', 'bg-surface'], ['text-muted', 'bg-panel'],
    ['text-muted', 'bg-surface'], ['text-dim', 'bg-panel'], ['accent', 'bg-panel'], ['ok', 'bg-panel'], ['danger', 'bg-panel'], ['warn', 'bg-panel'],
    ['text-main', 'bg-elevated'], ['text-muted', 'bg-elevated'], ['accent', 'bg-elevated'], ['accent', 'bg-surface'], ['on-accent', 'accent'],
    ['ok', 'bg-surface'], ['danger', 'bg-surface'], ['warn', 'bg-surface']];
  /* UX420: non-colour design tokens, emitted as --nx-* by apply() and mirrored statically in ux-tokens.css. */
  var SCALE = { 'fs-xs': '12px', 'fs-sm': '13px', 'fs-md': '15px', 'fs-lg': '18px', 'fs-xl': '22px', 'fs-2xl': '28px',
    'lh-tight': '1.3', 'lh-base': '1.6', 'fw-regular': '400', 'fw-semibold': '600', 'fw-bold': '700',
    'sp-1': '4px', 'sp-2': '8px', 'sp-3': '12px', 'sp-4': '16px', 'sp-5': '24px', 'sp-6': '32px', 'sp-7': '48px',
    'r-1': '6px', 'r-2': '10px', 'r-3': '14px', 'r-pill': '999px',
    'icon-sm': '14px', 'icon-md': '16px', 'icon-lg': '20px', 'icon-xl': '24px',
    'ease': 'cubic-bezier(.2,.7,.2,1)', 'dur-fast': '120ms', 'dur-base': '180ms', 'dur-slow': '260ms', 'focus-ring': '2px' };
  var SHADOWS = { dark: { 'shadow-1': '0 1px 2px rgba(0,0,0,.5)', 'shadow-2': '0 6px 18px rgba(0,0,0,.55)' },
    light: { 'shadow-1': '0 1px 2px rgba(20,24,29,.12)', 'shadow-2': '0 6px 18px rgba(20,24,29,.16)' } };

  var MESSAGES = {
    loading: 'جارٍ التحميل…', empty: 'لا توجد بيانات للعرض', saved: 'تم الحفظ', saveFailed: 'تعذّر الحفظ، حاول مرة أخرى',
    offline: 'لا يوجد اتصال، سيتم الحفظ على هذا الجهاز', notPermitted: 'ليست لديك صلاحية لهذا الإجراء',
    confirmDelete: 'هل أنت متأكد من الحذف؟ لا يمكن التراجع', required: 'هذا الحقل مطلوب', retry: 'إعادة المحاولة',
    cancel: 'إلغاء', confirm: 'تأكيد', close: 'إغلاق'
  };

  function hexToRgb(h) {
    var m = /^#([0-9a-f]{6})$/i.exec(String(h)); if (!m) throw new Error('bad-color');
    var n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function lum(h) {
    var c = hexToRgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  /* Returns pairs below AA for a theme ([] = all pass). */
  function audit(theme, min) {
    var t = THEMES[theme]; if (!t) throw new Error('bad-theme'); min = min || 4.5;
    return PAIRS.map(function (p) { return { fg: p[0], bg: p[1], ratio: contrast(t[p[0]], t[p[1]]) }; })
      .filter(function (r) { return r.ratio < min; });
  }
  function message(key) { if (!MESSAGES[key]) throw new Error('unknown-message'); return MESSAGES[key]; }
  /* Applies RTL + Cairo + theme tokens to a document element. Dark is the default. */
  function apply(doc, theme) {
    var t = THEMES[theme || 'dark']; if (!t) throw new Error('bad-theme');
    var el = doc.documentElement; el.setAttribute('lang', 'ar'); el.setAttribute('dir', 'rtl'); el.setAttribute('data-theme', theme || 'dark');
    Object.keys(t).forEach(function (k) { el.style.setProperty('--nx-' + k, t[k]); });
    Object.keys(SCALE).forEach(function (k) { el.style.setProperty('--nx-' + k, SCALE[k]); });
    Object.keys(SHADOWS[theme || 'dark']).forEach(function (k) { el.style.setProperty('--nx-' + k, SHADOWS[theme || 'dark'][k]); });
    el.style.setProperty('--nx-font', FONT);
  }

  var api = { FONT: FONT, THEMES: THEMES, SCALE: SCALE, SHADOWS: SHADOWS, MESSAGES: MESSAGES, contrast: contrast, audit: audit, message: message, apply: apply };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NovaUx = api;
})(typeof window !== 'undefined' ? window : this);
