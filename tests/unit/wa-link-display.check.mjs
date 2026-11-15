// WA-LINK display: a registered customer name is shown as is; a number-only conversation is shown as a readable number with a person
// avatar; the chat header shows the customer's number under the name. Pure HTML, no network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const U = createRequire(import.meta.url)('../../unified-inbox.js');
const page = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const NOW = new Date(2026, 10, 15, 12, 0).getTime();
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const conv = (id, customer, extra) => Object.assign({ id, customer, updatedAt: NOW - 1000, messages: [{ id: id + 'm', dir: 'in', text: 'مرحبا', at: NOW - 1000 }] }, extra);
const rowOf = (h, id) => h.split('<div class="wa-item').find((x) => x.includes('data-conv="' + id + '"')) || '';

t('registered name is shown as the row name and avatar letter; the number is not', () => {
  const r = rowOf(U.chatListHtml([conv('wa_201142677350', 'محمد السيد')], null, '', NOW), 'wa_201142677350');
  assert.match(r, /<span class="wa-name">محمد السيد<\/span>/); assert.match(r, /wa-avatar" aria-hidden="true">م</); assert.ok(!r.includes('201142677350</span>'));
});
t('number-only conversation: readable local number + person icon, never the bare 20… digits', () => {
  for (const nm of ['201142677350', '+201142677350', '01142677350']) {
    const r = rowOf(U.chatListHtml([conv('wa_201142677350', nm)], null, '', NOW), 'wa_201142677350');
    assert.match(r, /<span class="wa-name"><bdi dir="ltr">0114 267 7350<\/bdi><\/span>/, nm); assert.match(r, /<svg viewBox="0 0 24 24" width="26"/); assert.ok(!r.includes('>201142677350<'));
  }
});
t('customer name equal to the chat id (server fallback) counts as no name', () => {
  const r = rowOf(U.chatListHtml([conv('wa_201142677350', 'wa_201142677350')], null, '', NOW), 'wa_201142677350');
  assert.match(r, /<bdi dir="ltr">0114 267 7350<\/bdi>/);
});
t('non-Egyptian / BSUID ids still render something readable and never throw', () => {
  const h = U.chatListHtml([conv('wa_966501234567', '966501234567'), conv('wa_US.1349xyz', ''), conv('wa_x', 'سامي')], null, '', NOW);
  assert.match(rowOf(h, 'wa_966501234567'), /wa-name"><bdi dir="ltr">966501234567<\/bdi></); assert.match(rowOf(h, 'wa_US.1349xyz'), /wa-name">يوزرنيم واتساب \(من غير رقم\)</); assert.match(rowOf(h, 'wa_x'), /wa-name">سامي</);
});
t('a hostile name is escaped', () => {
  const r = rowOf(U.chatListHtml([conv('wa_201111111111', '<img src=x onerror=1>')], null, '', NOW), 'wa_201111111111');
  assert.ok(!r.includes('<img')); assert.match(r, /&lt;img/);
});
t('search finds a registered name and the number', () => {
  const c = [conv('wa_201142677350', 'محمد السيد')];
  assert.ok(U.chatListHtml(c, null, 'محمد', NOW).includes('data-conv="wa_201142677350"')); assert.ok(U.chatListHtml(c, null, '01142677350', NOW).includes('data-conv="wa_201142677350"') || U.chatListHtml(c, null, '1142677350', NOW).includes('data-conv="wa_201142677350"'));
});
t('chat header: registered name, number under it, call link', () => {
  const h = U.renderWa([conv('wa_201142677350', 'محمد السيد')], { selected: 'wa_201142677350', now: NOW });
  assert.match(h, /wa-head-name">محمد السيد</); assert.match(h, /data-wa-sub>[^<]*<bdi dir="ltr">0114 267 7350<\/bdi>/); assert.match(h, /href="tel:\+201142677350"/);
});
t('chat header of a number-only chat shows the number once (as the name), not twice', () => {
  const h = U.renderWa([conv('wa_201142677350', '201142677350')], { selected: 'wa_201142677350', now: NOW });
  assert.match(h, /wa-head-name"><bdi dir="ltr">0114 267 7350<\/bdi></); assert.ok(!/data-wa-sub>[^<]*(<bdi[^>]*>)?0114 267 7350/.test(h));
});
t('the page runs the same code (inline copy is byte-identical) and redraws when only a name changes', () => {
  assert.equal(page.match(/<script id="fix43-inbox-lib">([\s\S]*?)<\/script>/)[1], readFileSync(new URL('../../unified-inbox.js', import.meta.url), 'utf8'));
  assert.ok(page.includes("[c.id,c.customer,c.count,c.updatedAt,l&&l.id,l&&l.status].join('|')"));
  assert.ok(page.includes("hGet('link-names')") && page.includes('hLink()'));
});
console.log('PASS wa-link display:', n, 'cases');
