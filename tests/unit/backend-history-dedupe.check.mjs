// A message sent from NOVA (ps_) and the bot's forwarded copy (wb_) are ONE message in the thread. Run: node tests/unit/backend-history-dedupe.check.mjs
import assert from 'node:assert/strict';
import { dropBotEchoes } from '../../backend/src/inbox-history.js';
const m = (id, dir, kind, text, at, media) => ({ id, dir, kind, text, at, ...(media ? { media } : {}) });
const T = 1e12 + 5e8;
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('bot copy of a message sent from NOVA is hidden; the NOVA copy stays', () => {
  const r = dropBotEchoes([m('wa_1', 'in', 'in', 'hi', T), m('ps_a', 'out', 'pharm', 'اهلا', T + 1000), m('wb_x', 'out', 'bot', 'اهلا', T + 2000)]);
  assert.deepEqual(r.map((x) => x.id), ['wa_1', 'ps_a']);
});
t('works whichever row comes first', () => {
  assert.deepEqual(dropBotEchoes([m('wb_x', 'out', 'bot', 'اهلا', T), m('ps_a', 'out', 'pharm', 'اهلا', T + 1000)]).map((x) => x.id), ['ps_a']);
});
t('a real bot auto-reply (no NOVA twin) stays', () => {
  assert.deepEqual(dropBotEchoes([m('ps_a', 'out', 'pharm', 'اهلا', T), m('wb_y', 'out', 'bot', 'متوفر ✅', T + 500)]).map((x) => x.id), ['ps_a', 'wb_y']);
});
t('same text but more than 3 minutes apart is a different message', () => {
  assert.equal(dropBotEchoes([m('ps_a', 'out', 'pharm', 'اهلا', T), m('wb_x', 'out', 'bot', 'اهلا', T + 181000)]).length, 2);
});
t('exactly 3 minutes is still the same message', () => {
  assert.equal(dropBotEchoes([m('ps_a', 'out', 'pharm', 'اهلا', T), m('wb_x', 'out', 'bot', 'اهلا', T + 180000)]).length, 1);
});
t('two real sends of the same text both stay (each hides only its own bot copy)', () => {
  const r = dropBotEchoes([m('ps_a', 'out', 'pharm', 'اهلا', T), m('wb_1', 'out', 'bot', 'اهلا', T + 100), m('ps_b', 'out', 'pharm', 'اهلا', T + 5000), m('wb_2', 'out', 'bot', 'اهلا', T + 5100)]);
  assert.deepEqual(r.map((x) => x.id), ['ps_a', 'ps_b']);
  const r2 = dropBotEchoes([m('ps_a', 'out', 'pharm', 'اهلا', T), m('ps_b', 'out', 'pharm', 'اهلا', T + 5000)]);
  assert.equal(r2.length, 2, 'two NOVA sends are never merged');
});
t('only one bot copy is hidden per NOVA message (a second identical bot row stays)', () => {
  assert.deepEqual(dropBotEchoes([m('ps_a', 'out', 'pharm', 'اهلا', T), m('wb_1', 'out', 'bot', 'اهلا', T + 100), m('wb_2', 'out', 'bot', 'اهلا', T + 200)]).map((x) => x.id), ['ps_a', 'wb_2']);
});
t('incoming messages and other chats are never touched', () => {
  const r = dropBotEchoes([m('wa_1', 'in', 'in', 'اهلا', T), m('ps_a', 'out', 'pharm', 'اهلا', T + 10)]);
  assert.equal(r.length, 2);
});
t('photo + caption: bot copy of a photo is hidden, a text with the same words is not mistaken for it', () => {
  const img = { type: 'image', cached: true };
  assert.deepEqual(dropBotEchoes([m('ps_a', 'out', 'pharm', 'الروشتة', T, img), m('wb_x', 'out', 'bot', 'الروشتة', T + 50, img)]).map((x) => x.id), ['ps_a']);
  assert.equal(dropBotEchoes([m('ps_a', 'out', 'pharm', 'الروشتة', T, img), m('wb_x', 'out', 'bot', 'الروشتة', T + 50)]).length, 2);
});
t('empty / no NOVA sends: list unchanged (same array)', () => { const a = [m('wb_x', 'out', 'bot', 'x', T)]; assert.equal(dropBotEchoes(a), a); });
console.log(`PASS history dedupe: ${n} cases`);
