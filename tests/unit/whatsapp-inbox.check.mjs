import fs from 'node:fs';
import assert from 'node:assert/strict';
const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../../whatsapp-inbox.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../../whatsapp-inbox.css', import.meta.url), 'utf8');

// 1. Navigation: tab wired into nav and router
assert.ok(html.includes('data-page="whatsapp"'), 'whatsapp nav tab missing');
assert.ok(html.includes("'whatsapp'"), 'whatsapp not in router allowlist');
assert.ok(html.includes('NOVA_WHATSAPP.mount(view)'), 'router does not mount inbox');
assert.ok(html.includes('whatsapp-inbox.js'), 'module not loaded');
assert.ok(html.includes('whatsapp-inbox.css'), 'stylesheet not loaded');

// 2. RTL + Arabic UI
assert.ok(js.includes('dir="rtl"'), 'RTL dir missing');
assert.ok(js.includes('lang="ar"'), 'Arabic lang missing');
for (const token of ['صندوق واتساب', 'استلام المحادثة', 'إرجاع للبوت', 'بحث في المحادثات']) assert.ok(js.includes(token), 'missing Arabic label: ' + token);

// 3. Demo data clearly distinguished, no fabricated real conversations
assert.ok(js.includes('وضع العرض التجريبي'), 'demo banner missing');
assert.ok(js.includes('مثال: عميل تجريبي'), 'demo fixture labeling missing');
assert.ok(!/05\d{8}/.test(js), 'real-looking phone number in fixtures');

// 4. Adapter seam + states
for (const token of ['listConversations', 'getThread', 'takeover', 'resume', 'sendMessage', 'LIVE_SEND_DISABLED']) assert.ok(js.includes(token), 'adapter seam missing: ' + token);
for (const token of ['wa-state-loading', 'wa-state-empty', 'wa-state-error', 'لا نتائج مطابقة للبحث']) assert.ok(js.includes(token), 'state missing: ' + token);
assert.ok(js.includes('aria-busy'), 'loading a11y missing');

// 5. Takeover / bot-hold states
assert.ok(js.includes("botState = 'hold'"), 'takeover hold state missing');
assert.ok(js.includes('البوت معلّق'), 'hold badge missing');

// 6. No secrets / tokens anywhere in client module
const secretPatterns = [/EAAG[\w-]{10,}/, /WA_TOKEN\s*[:=]\s*['"][^'"]+/, /access_token\s*[:=]\s*['"][^'"]+/i, /Bearer\s+[A-Za-z0-9._-]{20,}/, /phone_number_id\s*[:=]\s*['"]\d+/];
for (const p of secretPatterns) {
  assert.ok(!p.test(js), 'possible secret in whatsapp-inbox.js: ' + p);
  assert.ok(!p.test(html), 'possible secret in index.html: ' + p);
}

// 7. Responsive mobile layout
assert.ok(css.includes('@media (max-width:820px)'), 'mobile breakpoint missing');
assert.ok(css.includes('.wa-back'), 'mobile back button style missing');

console.log('WhatsApp inbox static checks PASS');
