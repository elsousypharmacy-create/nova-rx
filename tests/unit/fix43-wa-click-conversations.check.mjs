// FIX43: clicking #novaWaBtn lands on the in-app conversations view (#novaInboxView visible, #novaInboxTab active),
// with flag OFF, and never navigates (no integrations/whatsapp/inbox.html, no unified-inbox.js fetch). Run: node tests/unit/fix43-wa-click-conversations.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync('index.html', 'utf8');
const grab = (re) => re.exec(html)[1];
const lib = grab(/<script id="fix43-inbox-lib">([\s\S]*?)<\/script>/);
const ux48 = grab(/<script>(\/\* UX48: hidden local inbox tab[\s\S]*?)<\/script>/);
const ux81 = grab(/<script id="ux81-wa-badge">([\s\S]*?)<\/script>/);

function el(tag) {
  const e = { tag, id: '', hidden: false, style: {}, dataset: {}, listeners: {}, children: [], _cls: new Set(), innerHTML: '', textContent: '', parentNode: null,
    classList: { toggle: (c, on) => { on ? e._cls.add(c) : e._cls.delete(c); }, add: (c) => e._cls.add(c), remove: (c) => e._cls.delete(c), contains: (c) => e._cls.has(c) },
    addEventListener(t, f) { (e.listeners[t] ||= []).push(f); },
    click() { (e.listeners.click || []).forEach((f) => f({ target: { closest: () => null } })); },
    setAttribute() {}, querySelector: () => null, querySelectorAll: () => [],
    insertBefore(n) { n.parentNode = e; e.children.push(n); }, closest: () => null };
  return e;
}
function run(flag) {
  const byId = {}, nav = el('nav'), host = el('div'), wrap = el('div'), btn = el('button'), badge = el('span');
  host.parentNode = wrap; byId.novaPageView = host; byId.novaWaBtn = btn; byId.novaWaBadge = badge;
  nav.querySelectorAll = () => nav.children;
  const doc = { readyState: 'complete', hidden: false, body: { dataset: {} }, head: { appendChild() { throw new Error('script fetch'); } },
    getElementById: (id) => byId[id] || null, querySelector: (s) => (s === '.nova-nav' ? nav : null),
    createElement: (t) => { const e = el(t); Object.defineProperty(e, 'id', { get: () => e._id || '', set: (v) => { e._id = v; byId[v] = e; } }); return e; },
    addEventListener() {} };
  const store = flag ? { 'nova.flags.inbox': '1' } : {};
  let href = null;
  const ctx = { document: doc, localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } }, sessionStorage: { getItem: () => null },
    setInterval: () => 1, location: {}, JSON, Array, Number, String, Date, Object, Error, Promise, console };
  ctx.window = ctx; ctx.addEventListener = () => {};
  Object.defineProperty(ctx.location, 'href', { set(v) { href = v; }, get: () => 'http://x/' });
  vm.createContext(ctx);
  for (const s of [lib, ux48, ux81]) vm.runInContext(s, ctx);
  return { byId, btn, doc, href: () => href, store };
}
for (const flag of [false, true]) {
  const r = run(flag);
  assert.equal(!!r.byId.novaInboxTab, flag, 'flag ' + flag + ': tab only pre-created when flag on');
  r.btn.listeners.click.forEach((f) => f());
  const tab = r.byId.novaInboxTab, view = r.byId.novaInboxView;
  assert.ok(tab && view, 'conversations view exists after click (flag ' + flag + ')');
  assert.equal(view.hidden, false, '#novaInboxView visible');
  assert.ok(tab.classList.contains('active'), '#novaInboxTab active');
  assert.equal(r.doc.body.dataset.activePage, 'inbox');
  assert.match(view.innerHTML, /المحادثات/);
  assert.equal(r.href(), null, 'no navigation (no integrations/whatsapp/inbox.html / 404)');
  r.btn.listeners.click.forEach((f) => f()); // second click is idempotent
  assert.equal(r.href(), null);
}
console.log('fix43-wa-click-conversations OK');
