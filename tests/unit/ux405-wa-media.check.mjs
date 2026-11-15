// UX405: conversations bubbles render incoming media like WhatsApp (pure HTML from unified-inbox.js; no network).
// Run: node tests/unit/ux405-wa-media.check.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const U = createRequire(import.meta.url)('../../unified-inbox.js');
const NOW = Date.parse('2026-11-15T12:00:00+03:00');
const url = (id) => 'https://api.test/api/v1/inbox/history/media?id=' + encodeURIComponent(id);
const m = (id, type, media, text) => ({ id, dir: 'in', kind: 'in', text, at: NOW - 60000, status: null, media: { type, cached: true, skipped: null, caption: null, filename: null, size: null, ...media } });
const one = (msg, mo = { url }) => U.bubbles([msg], NOW, mo);
let h;
h = one(m('wa_1', 'image', { caption: 'روشتة' }, '[صورة] روشتة'));
assert.match(h, /<img class="wa-mimg" data-wa-mimg data-wa-mid="wa_1" src="https:\/\/api\.test\/api\/v1\/inbox\/history\/media\?id=wa_1"/);
assert.match(h, /data-wa-media-open="https:\/\/api\.test/); assert.match(h, /<span class="wa-text">روشتة<\/span>/); assert.ok(!h.includes('[صورة]'));
h = one(m('wa_s', 'sticker', {}, '[ملصق]')); assert.match(h, /wa-m-sticker/); assert.match(h, /wa-mo-ov/); assert.ok(!h.includes('wa-text'));
h = one(m('wa_a', 'audio', {}, '[رسالة صوتية]')); assert.match(h, /<audio class="wa-maudio" data-wa-mplay data-wa-mid="wa_a" controls preload="none"/);
h = one(m('wa_v', 'video', { caption: 'شوف' }, '[فيديو] شوف')); assert.match(h, /<video class="wa-mvideo"[^>]* controls playsinline/); assert.match(h, /wa-text">شوف</);
h = one(m('wa_d', 'document', { filename: '<b>x".pdf', size: 3 * 1048576 }, '[مستند] x.pdf'));
assert.match(h, /<a class="wa-media wa-mdoc"[^>]* target="_blank" rel="noopener noreferrer" download="&lt;b&gt;x&quot;\.pdf"/); assert.match(h, /3 ميجا/); assert.ok(!h.includes('<b>x"'), 'filename escaped');
// fallbacks: metadata only / not cached / failed load / no url function -> Arabic card, no <img>/<audio>
for (const [msg, mo, re] of [[m('wa_b', 'image', { skipped: 'too_large', cached: false }, '[صورة]'), { url }, /5 ميجا/], [m('wa_f', 'video', { skipped: 'fetch_failed', cached: false }, '[فيديو]'), { url }, /تعذّر تحميل الملف/],
  [m('wa_g', 'image', {}, '[صورة]'), { url, fail: { wa_g: 1 } }, /مش متاح هنا/], [m('wa_n', 'audio', {}, '[رسالة صوتية]'), {}, /مش متاح هنا/]]) {
  h = one(msg, mo); assert.match(h, /data-wa-media-miss/); assert.match(h, re); assert.ok(!/<img|<audio|<video/.test(h)); assert.ok(!/\[(صورة|فيديو|رسالة صوتية)\]/.test(h)); assert.ok(!h.includes('wa-mo-ov'));
}
// text messages and old rows without media are unchanged
assert.equal(U.bubbles([{ id: 't', dir: 'in', text: '[صورة]', at: NOW }], NOW), U.bubbles([{ id: 't', dir: 'in', text: '[صورة]', at: NOW }], NOW, { url }));
assert.match(U.bubbles([{ id: 't', dir: 'in', text: '[صورة]', at: NOW }], NOW), /wa-text">\[صورة\]</);
// list preview label instead of the raw placeholder
assert.equal(U.previewText(m('x', 'image', { caption: 'روشتة' }, '[صورة] روشتة')), 'صورة · روشتة');
assert.equal(U.previewText(m('x', 'document', { filename: 'a.pdf' }, '[مستند] a.pdf')), 'مستند · a.pdf');
assert.equal(U.previewText({ text: 'hi' }), 'hi');
// renderWa passes mediaUrl/mediaFail through
h = U.renderWa([{ id: 'c', customer: 'ع', updatedAt: NOW, messages: [m('wa_1', 'image', {}, '[صورة]')] }], { selected: 'c', now: NOW, mediaUrl: url });
assert.match(h, /data-wa-mimg/); assert.match(h, /\.wa-lb|wa-mdoc/);
console.log('ux405-wa-media check OK');
