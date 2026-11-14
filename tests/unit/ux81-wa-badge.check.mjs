// UX81: WhatsApp header icon + unread badge. Run: node tests/unit/ux81-wa-badge.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync('index.html', 'utf8');
assert.match(html, /id="novaWaBtn"/);
assert.ok(html.indexOf('id="novaWaBtn"') < html.indexOf('id="novaPageView"'), 'icon is in the all-pages nav bar');
const src = /<script id="ux81-wa-badge">([\s\S]*?)<\/script>/.exec(html)[1];
function run({ store = {}, session = {}, fetchImpl }) {
  const badge = { hidden: true, textContent: '' }, attrs = {};
  const btn = { listeners: {}, addEventListener(e, f) { this.listeners[e] = f; }, setAttribute(k, v) { attrs[k] = v; } };
  let clicked = 0, href = null;
  const doc = { readyState: 'complete', hidden: false, getElementById: (id) => id === 'novaWaBadge' ? badge : id === 'novaWaBtn' ? btn : id === 'novaInboxTab' && store.tab ? { click() { clicked++; } } : null };
  const ctx = { document: doc, localStorage: { getItem: (k) => store[k] ?? null }, sessionStorage: { getItem: (k) => session[k] ?? null },
    fetch: fetchImpl, setInterval: () => 1, location: {}, window: null, JSON, Array, Number, String };
  ctx.window = ctx; Object.defineProperty(ctx.location, 'href', { set(v) { href = v; } });
  ctx.window.addEventListener = () => {};
  vm.runInNewContext(src, ctx);
  return { badge, attrs, btn, ctx, clicked: () => clicked, href: () => href };
}
const conv = (dir) => ({ id: 'a', messages: [{ dir: 'x' }, { dir }] });
// n = 0 (empty / flag off / only answered) -> hidden
let r = run({}); assert.equal(r.badge.hidden, true);
r = run({ store: { 'nova.inbox.v1': JSON.stringify({ conversations: [conv('out')] }) } });
assert.equal(r.badge.hidden, true); assert.equal(r.badge.textContent, '');
// n > 0 (local)
r = run({ store: { 'nova.inbox.v1': JSON.stringify({ conversations: [conv('in'), conv('in'), conv('out')] }) } });
assert.equal(r.badge.hidden, false); assert.equal(r.badge.textContent, '2'); assert.match(r.attrs['aria-label'], /2/);
// backend: n > 0, updates, then 0
let convs = [conv('in'), conv('in'), conv('in')];
const store = { 'novaBackend.enabled': 'true', 'novaBackend.url': 'https://x.test/' };
r = run({ store, session: { 'novaBackend.token': 't' }, fetchImpl: async (u, o) => { assert.equal(u, 'https://x.test/api/v1/inbox/conversations'); return { ok: true, json: async () => ({ conversations: convs }) }; } });
await r.ctx.NovaWaBadge.refresh(); assert.equal(r.badge.textContent, '3'); assert.equal(r.badge.hidden, false);
convs = [conv('out')]; await r.ctx.NovaWaBadge.refresh(); assert.equal(r.badge.hidden, true);
// backend failure: no throw, badge hidden
r = run({ store, session: { 'novaBackend.token': 't' }, fetchImpl: async () => { throw new Error('down'); } });
await r.ctx.NovaWaBadge.refresh(); assert.equal(r.badge.hidden, true);
// click: opens inbox tab when present, else the bridge page
r = run({ store: { tab: 1 } }); r.btn.listeners.click(); assert.equal(r.clicked(), 1);
r = run({}); r.btn.listeners.click(); assert.match(r.href(), /whatsapp\/inbox\.html/);
console.log('ux81-wa-badge OK');
