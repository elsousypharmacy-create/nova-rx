// UX407: conversations screen — staff-reply prefix stripped for display, WhatsApp sides (outgoing right / incoming left under RTL),
// composer is not a <form> and has no focus ring, keyboard fit pins to visualViewport offsetTop+height and locks other fields.
// Run: node tests/unit/ux407-wa-composer.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const U = createRequire(import.meta.url)('../../unified-inbox.js');
const page = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const P = '\u{1F468}‍⚕️';
const NOW = new Date(2026, 10, 15, 16, 22).getTime();

t('leading prefix stripped (emoji optional, colon optional, both titles, spaces/newlines)', () => {
  const f = U.stripStaffPrefix;
  assert.equal(f(P + ' رد الصيدلي:\n\nاهلا'), 'اهلا');
  assert.equal(f('رد الصيدلي: اهلا'), 'اهلا');
  assert.equal(f(P + ' رد الدكتور:\nتمام'), 'تمام');
  assert.equal(f(P + ' رد الصيدلي\n\nاهلا'), 'اهلا');
  assert.equal(f('رد الصيدلي\nاهلا'), 'اهلا');
  assert.equal(f('  \u{1F468}‍⚕ رد الصيدلي :  اهلا'), 'اهلا');
  assert.equal(f('\u{1F9D1}\u{1F3FD}‍⚕️ رد الصيدلي: hi'), 'hi');
  assert.equal(f(P + ' رد الصيدلي:\n\nسطر 1\nسطر 2'), 'سطر 1\nسطر 2');
});
t('never mid-text, never a sentence that only starts with the words, never empties a message', () => {
  const f = U.stripStaffPrefix;
  for (const s of ['اهلا ' + P + ' رد الصيدلي: x', 'رد الصيدلي على سؤالك: موجود', P + ' رد الصيدلي:', 'رد الصيدلي', 'اهلا', '', 'الصيدلي: x'])
    assert.equal(f(s), s, JSON.stringify(s));
});
const conv = [{ id: 'a', customer: 'دكتور احمد', updatedAt: NOW, history: true, messages: [
  { id: 'm1', dir: 'in', kind: 'in', text: 'رد الصيدلي: سؤال من العميل', at: NOW - 4000 },
  { id: 'm2', dir: 'out', kind: 'bot', text: P + ' رد الصيدلي:\n\nاهلا', at: NOW - 3000, status: 'read' },
  { id: 'm3', dir: 'out', kind: 'pharm', text: 'اهلا', at: NOW - 2000, status: 'sent' },
  { id: 'm4', dir: 'out', kind: 'bot', text: 'البوت يرد', at: NOW - 1000, status: 'delivered' },
  { id: 'm5', dir: 'out', kind: 'pharm', text: P + ' رد الدكتور:\nتمام', at: NOW - 500, status: 'read' }] }];
const msg = (h, id) => h.match(new RegExp('<div class="wa-msg[^"]*" data-dir="[^"]*" data-mid="' + id + '"[\\s\\S]*?</div></div>'))[0];
t('bubbles show only the real text; UX408: no «الصيدلي»/«البوت» sender label in a 1-to-1 chat; incoming untouched', () => {
  const h = U.bubbles(conv[0].messages, NOW);
  assert.ok(!h.includes('رد الصيدلي:\n') && !h.includes(P) && !h.includes('رد الدكتور'), 'no prefix/emoji in any outgoing bubble');
  assert.ok(!h.includes('wa-who') && !h.includes('>الصيدلي<') && !h.includes('>البوت<'), 'no sender labels');
  assert.match(msg(h, 'm2'), /<div class="wa-bubble" dir="auto"><span class="wa-tl"><span class="wa-text" dir="auto">اهلا<\/span>/);
  assert.match(msg(h, 'm5'), /<span class="wa-text" dir="auto">تمام<\/span>/);
  assert.match(msg(h, 'm4'), /data-kind="bot"[^]*<span class="wa-text" dir="auto">البوت يرد</);
  assert.match(msg(h, 'm1'), /<span class="wa-text" dir="auto">رد الصيدلي: سؤال من العميل<\/span>/, 'incoming customer text is never rewritten');
  assert.equal((h.match(/data-mid="m\d"/g) || []).length, 5, 'no dedupe/merge: every bubble rendered');
  assert.equal(conv[0].messages[1].text, P + ' رد الصيدلي:\n\nاهلا', 'stored row untouched');
});
t('list preview strips the prefix too', () => {
  const h = U.chatListHtml([{ ...conv[0], messages: conv[0].messages.slice(0, 2) }], null, '', NOW);
  assert.match(h, /class="wa-preview"><span class="wa-tick read" data-tick="read"[^>]*><svg[^]*?<\/svg><\/span> اهلا</ /* UX401: SVG ticks */);
});
t('WhatsApp sides under RTL: outgoing right (flex-start, green), incoming left (flex-end); UX408: tails at the bottom of the LAST bubble, edge side', () => {
  const h = U.renderWa(conv, { now: NOW, selected: 'a', sendEnabled: true });
  assert.ok(h.includes('.wa-msg.wa-in{justify-content:flex-end}.wa-msg.wa-out{justify-content:flex-start}'));
  assert.ok(h.includes('.wa-out .wa-bubble{background:#0f4a3c}'));
  assert.ok(h.includes('.wa-last .wa-bubble:before{content:"";position:absolute;bottom:0;') && h.includes('.wa-in.wa-last .wa-bubble:before{left:-8px') && h.includes('.wa-out.wa-last .wa-bubble:before{right:-8px'));
  assert.ok(!h.includes('.wa-first .wa-bubble:before'), 'no top tail on the first bubble');
  assert.match(msg(h, 'm3'), /data-tick="sent"[^>]*><svg viewBox="0 0 18 11"[^>]*><path d="[^"]+"\/><\/svg></ /* UX401: one SVG check */);
});
t('composer: plain div (no form), single text input, button send; no focus ring; tap highlight off; kbd padding', () => {
  const h = U.renderWa(conv, { now: NOW, selected: 'a', sendEnabled: true });
  assert.ok(!/<form/.test(h));
  const c = h.slice(h.indexOf('<div class="wa-composer"'));
  assert.equal((c.match(/<input/g) || []).length, 1);
  assert.match(c, /<button type="button" class="wa-send" data-wa-send aria-label="إرسال">/);
  assert.ok(c.includes('data-has-text="0"') && h.includes('.wa-composer[data-has-text="0"] .wa-send{display:none}'), 'UX408: send only with text');
  assert.ok(h.includes('#waComposer #waInput:focus-visible') && /#waComposer #waInput:focus-within\{outline:none!important;outline-offset:0!important;box-shadow:none!important/.test(h));
  assert.ok(h.includes('.wa-composer,.wa-composer *{-webkit-tap-highlight-color:transparent}'));
  assert.ok(h.includes('.wa-root[data-kbd] .wa-composer{padding-bottom:8px}'));
});
t('index.html: Enter/button send without a form, visualViewport offsetTop fit, field lock restored', () => {
  assert.ok(page.includes("e.key==='Enter'&&!e.shiftKey&&!e.isComposing") && page.includes("closest('[data-wa-send]')") && page.includes('function waSubmit(){'));
  assert.ok(!page.includes("box.addEventListener('submit',function(e){e.preventDefault();if(!sendOn()||!wa.sel)return;"));
  const vv = page.match(/<script id="NOVA_FIX50_VV">([\s\S]*?)<\/script>/)[1];
  assert.ok(vv.includes('(Number(vv.offsetTop)||0)+vv.height') && vv.includes("r.setAttribute('data-kbd','1')") && vv.includes("removeAttribute('data-kbd')"));
  assert.ok(vv.includes('function lock(on)') && vv.includes('el.inert=true') && vv.includes('lock(false)'));
  new Function(vv); // parses
});
console.log('ux407-wa-composer.check: ' + n + ' passed');
