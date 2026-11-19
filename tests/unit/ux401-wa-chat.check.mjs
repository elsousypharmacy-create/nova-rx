import { readAppHtml } from '../lib/app-html.mjs'; // PERF-02: index.html + split app/ files
// UX401: chat pane like WhatsApp Web (pure HTML from unified-inbox.js + controller wiring in index.html).
// Ticks from status, reply/quote, voice player, document type, emoji picker, attach menu (no file send), send-off / 24h gating.
// Run: node tests/unit/ux401-wa-chat.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const U = createRequire(import.meta.url)('../../unified-inbox.js');
const page = readAppHtml(new URL('../../index.html', import.meta.url), 'utf8');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const NOW = new Date(2026, 10, 15, 16, 22).getTime();
const msg = (h, id) => { const i = h.indexOf(`data-mid="${id}"`); assert.ok(i > 0, 'row ' + id); const j = h.indexOf('<div class="wa-msg', i + 5); return h.slice(i, j < 0 ? undefined : j); };

t('ticks: sent 1 check, delivered 2 grey, read 2 blue, failed red, sending clock; unknown status never fakes «read»; incoming none', () => {
  const k = (status) => U.tick({ dir: 'out', status });
  assert.match(k('sent'), /class="wa-tick sent" data-tick="sent"/); assert.equal((k('sent').match(/<path/g) || []).length, 1);
  assert.match(k('delivered'), /data-tick="delivered"/); assert.equal((k('delivered').match(/<path/g) || []).length, 2);
  assert.match(k('read'), /class="wa-tick read" data-tick="read"/); assert.equal((k('read').match(/<path/g) || []).length, 2);
  assert.match(k('failed'), /data-tick="failed"[^>]*aria-label="ما اتبعتتش"/); assert.match(k('sending'), /data-tick="sending"[^>]*aria-label="جاري الإرسال"/);
  assert.match(k(null), /class="wa-tick delivered" data-tick="delivered"/); assert.match(k('weird'), /data-tick="delivered"/);
  assert.equal(U.tick({ dir: 'in', status: 'read' }), '');
  assert.ok(!/[✓🕓]/u.test(['sent', 'delivered', 'read', 'failed', 'sending'].map(k).join('')), 'SVG, no glyphs');
  const css = U.renderWa([], {});
  assert.ok(css.includes('.wa-tick.read{color:#53bdeb}') && css.includes('.wa-tick.failed{color:#ff6b7a}'));
});

const C = [{ id: 'a', customer: 'سارة', updatedAt: NOW, messages: [
  { id: 'q1', dir: 'in', text: 'عندكم <بانادول>؟', at: NOW - 3600e3 },
  { id: 'q2', dir: 'out', kind: 'pharm', text: 'أيوه', at: NOW - 3000e3, status: 'read', replyTo: 'q1' },
  { id: 'q3', dir: 'out', kind: 'pharm', text: 'تمام', at: NOW - 2000e3, status: 'sent', quote: { id: 'q2', dir: 'out', text: 'أيوه' } },
  { id: 'q4', dir: 'in', text: 'شكرا', at: NOW - 1000e3 },
  { id: 'q5', dir: 'out', kind: 'pharm', text: 'العفو', at: NOW - 500e3, status: 'delivered' },
  { id: 'tmp_x', dir: 'out', kind: 'pharm', text: 'جاري', at: NOW - 100e3, status: 'sending' },
] }];

t('quote above the bubble: replyTo resolves in-thread, m.quote object, opts.quotes map; escaped; «أنت» for own, customer name otherwise', () => {
  const h = U.renderWa(C, { now: NOW, selected: 'a', sendEnabled: true, quotes: { q5: { id: 'q4', dir: 'in', text: 'شكرا' } } });
  assert.match(msg(h, 'q2'), /data-quoted><div class="wa-bubble wa-has-quote" dir="auto"><button type="button" class="wa-quote wa-q-in" data-wa-quote="q1" data-wa-quote-jump="q1"[^>]*><span class="wa-q-who">سارة<\/span><span class="wa-q-txt" dir="auto">عندكم &lt;بانادول&gt;؟<\/span><\/button><span class="wa-tl"><span class="wa-text" dir="auto">أيوه/ /* UX408: no «الصيدلي» sender label in a 1-to-1 chat */);
  assert.match(msg(h, 'q3'), /class="wa-quote wa-q-out" data-wa-quote="q2"[^>]*><span class="wa-q-who">أنت</);
  assert.match(msg(h, 'q5'), /data-wa-quote-jump="q4"/);
  assert.ok(!msg(h, 'q4').includes('wa-quote'), 'no quote without a reference');
  const miss = U.bubbles([{ id: 'z', dir: 'out', text: 'x', at: NOW, status: 'sent', replyTo: 'gone' }], NOW, {});
  assert.ok(!miss.includes('wa-quote'), 'unknown replyTo renders no empty quote');
});

t('reply buttons only when sending is on, never on optimistic tmp_ rows; incoming button before the bubble, outgoing after (inner side)', () => {
  const on = U.renderWa(C, { now: NOW, selected: 'a', sendEnabled: true }), off = U.renderWa(C, { now: NOW, selected: 'a', sendEnabled: false });
  assert.equal((on.match(/data-wa-reply="/g) || []).length, 5); assert.ok(!on.includes('data-wa-reply="tmp_x"'));
  assert.equal((off.match(/data-wa-reply="/g) || []).length, 0);
  assert.match(msg(on, 'q4'), /^data-mid="q4"[^>]*><button type="button" class="wa-rbtn" data-wa-reply="q4" tabindex="-1"/);
  assert.match(msg(on, 'q5'), /<\/div><button type="button" class="wa-rbtn" data-wa-reply="q5"[^>]*>[^]*<\/button><\/div>$/);
});

t('composer quote bar (only when sending is on) with cancel', () => {
  const q = { id: 'q4', dir: 'in', text: 'شكرا' };
  const h = U.renderWa(C, { now: NOW, selected: 'a', sendEnabled: true, quote: q });
  assert.match(h, /<div class="wa-qbar" data-wa-qbar data-qid="q4"><div class="wa-quote wa-q-in" data-wa-quote="q4"><span class="wa-q-who">سارة<\/span><span class="wa-q-txt" dir="auto">شكرا<\/span><\/div><button type="button" class="wa-qx" data-wa-qcancel aria-label="إلغاء الرد">/);
  assert.ok(h.indexOf('data-wa-qbar') < h.indexOf('data-wa-composer'), 'bar above the composer');
  assert.ok(!U.renderWa(C, { now: NOW, selected: 'a', sendEnabled: false, quote: q }).includes('data-wa-qbar'), 'no quote bar when sending is off');
  const long = U.quoteHtml({ id: 'l', dir: 'in', text: 'ا'.repeat(400) }, 'x'); assert.ok(long.includes('…') && long.length < 1200, 'long quote clipped');
  assert.match(U.quoteHtml({ id: 'm', dir: 'in', text: '[صورة]', media: { type: 'image', caption: 'روشتة' } }, 'x'), /q-txt" dir="auto">📷 صورة · روشتة</ /* UX408 glyph */);
});

t('UX408 composer: no emoji button/panel in the field (iOS keyboard has emoji); + attach menu when sending is on, disabled otherwise; attach never offers a file input', () => {
  const on = U.renderWa(C, { now: NOW, selected: 'a', sendEnabled: true }), off = U.renderWa(C, { now: NOW, selected: 'a', sendEnabled: false, windowClosed: true });
  assert.ok(!on.includes('data-wa-emoji') && !on.includes('data-wa-emo='), 'no emoji clutter in the composer');
  assert.match(U.emojiPanelHtml(false), /<div class="wa-emoji" id="waEmoji" data-wa-emoji-panel role="dialog" aria-label="اختر رمز تعبيري" hidden>/);
  assert.ok(U.EMOJI.length >= 40);
  assert.match(on, /data-wa-attach aria-label="إرفاق" title="إرفاق" aria-haspopup="menu" aria-expanded="false" aria-controls="waAttach">/);
  assert.match(on, /<div class="wa-attmenu" id="waAttach" data-wa-attach-menu role="menu" aria-label="إرفاق" hidden>/);
  assert.equal((on.match(/data-wa-att="[a-z]+" aria-disabled="true"/g) || []).length, 3); assert.ok(!/type="file"/.test(on), 'no file input');
  assert.match(on, /data-wa-att-note>إرسال الملفات للعملاء من نوفا لسه مش متاح — النص بس/);
  assert.match(off, /data-wa-attach aria-label="إرفاق \(الإرسال متوقف\)" aria-disabled="true"/);
  assert.ok(!off.includes('data-wa-emoji-panel') && !off.includes('data-wa-attach-menu'));
  assert.match(off, /data-send="off"/); assert.match(off, /<input type="text" id="waInput" dir="auto"[^>]* disabled>/); assert.match(off, /data-wa-send aria-label="إرسال" disabled>/);
  assert.match(off, /data-wa-window role="status">عدّى أكتر من 24 ساعة/);
  assert.match(on, /data-wa-mic aria-label="رسالة صوتية \(قريباً\)" title="قريباً" aria-disabled="true"/);
});

t('voice note player + document type', () => {
  const url = (id) => 'https://api.test/media?id=' + id;
  const v = U.bubbles([{ id: 'v1', dir: 'in', text: '[رسالة صوتية]', at: NOW, media: { type: 'audio', cached: true, duration: 75 } }], NOW, { url });
  assert.match(v, /data-wa-voice><button type="button" class="wa-vplay" data-wa-vplay data-wa-mid="v1" aria-label="تشغيل الرسالة الصوتية" aria-pressed="false">/);
  assert.match(v, /role="slider"/); assert.match(v, /data-wa-vdur>1:15</); assert.match(v, /<audio class="wa-maudio" data-wa-mplay data-wa-mid="v1" preload="metadata" src="https:\/\/api\.test\/media\?id=v1"/);
  assert.ok(!/<audio[^>]* controls/.test(v));
  assert.equal(U.durLabel(5), '0:05'); assert.equal(U.durLabel(600), '10:00');
  assert.equal(U.docExt('تحاليل.PDF'), 'PDF'); assert.equal(U.docExt('x', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'DOCX'); assert.equal(U.docExt('noext', 'application/x-unknown'), '');
  const d = U.bubbles([{ id: 'd1', dir: 'in', text: '[مستند]', at: NOW, media: { type: 'document', cached: true, filename: 'روشتة.pdf', size: 245760 } }], NOW, { url });
  assert.match(d, /data-wa-ext="PDF">[^]*<span class="wa-mext">PDF<\/span>/); assert.match(d, /PDF · 240 ك\.ب · اضغط للفتح أو التحميل/);
});

t('index.html controller: quote/emoji/attach state passed to renderWa; send carries replyTo + keeps quote on failure; stick to bottom on send', () => {
  const ctl = page.slice(page.indexOf('var wa={sel:null'), page.indexOf('<style id="ux209-wa-target">'));
  assert.ok(ctl.includes('quote:null,qmap:{},emo:false,att:false'));
  assert.ok(ctl.includes('mediaUrl:mUrl,mediaFail:wa.mfail,quote:wa.quote,quotes:wa.qmap,emojiOpen:wa.emo,attachOpen:wa.att,hasText:!!dv,olderRemote:wa.sel?tOlderState(wa.sel):null});vKeep(pa);'));
  assert.ok(ctl.includes('function hSend(id,text,q){'));
  assert.ok(ctl.includes("q&&q.id!=null?{id:id,text:text,clientId:cl,replyTo:String(q.id)}:{id:id,text:text,clientId:cl}"));
  assert.ok(ctl.includes('(wa.draft=text,wa.quote=wa.quote||q||null)'), 'draft + quote restored when the server refuses');
  assert.ok(ctl.includes('var q=wa.quote;wa.quote=null;wa.emo=wa.att=false;wa.stick=1;'));
  assert.ok(ctl.includes('if(wa.stick){fromBottom=null;wa.stick=0}'));
  assert.ok(/function waQuote\(id\)\{if\(!sendOn\(\)\)return;/.test(ctl), 'no reply when sending is off / window closed');
  assert.ok(/touchstart',function\(e\)\{sw=null;[^]*?!sendOn\(\)\)return;/.test(ctl), 'no swipe reply when sending is off');
  assert.ok(ctl.includes("Math.abs(s.dx)>=56)waQuote(") && ctl.includes(',480);'), 'swipe >=56px / hold 480ms');
  assert.ok(!/data-wa-att[^]*?fetch\(/.test(ctl.slice(ctl.indexOf('function waPop'), ctl.indexOf('var sw=null'))), 'attach/emoji code never fetches');
});

console.log('ux401-wa-chat.check: ' + n + ' passed');
