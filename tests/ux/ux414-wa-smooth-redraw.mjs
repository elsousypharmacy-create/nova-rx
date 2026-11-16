// UX414: live updates no longer rebuild the conversation. When the 4 s refresh brings a change, existing bubbles, images, chat rows and the
// text field are KEPT (same DOM nodes), only the new message is added, and the reading position does not move. Fake data only.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/ux414-wa-smooth-redraw.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-16T21:17:00+03:00'), M = 60e3;
const A = 'wa_201000000414', B = 'wa_201000000415';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#4a90a4"/></svg>';
const msgsA = []; for (let i = 0; i < 40; i++) msgsA.push({ id: 'a' + i, dir: i % 3 ? 'in' : 'out', kind: i % 3 ? 'in' : 'pharm', text: 'رسالة رقم ' + i + (i % 5 === 0 ? ' — نص أطول شوية عشان يلف على سطرين جوه الفقاعة' : ''), at: NOW - (60 - i) * M, status: i % 3 ? null : 'read' });
msgsA.splice(20, 0, { id: 'aimg', dir: 'in', kind: 'in', text: '[صورة]', at: NOW - 40 * M + 1, media: { type: 'image', cached: true } });
const msgsB = [{ id: 'b1', dir: 'in', kind: 'in', text: 'عندكم بانادول؟', at: NOW - 90 * M }];
const conv = (id, name, msgs) => ({ id, customer: name, updatedAt: msgs.at(-1).at, count: msgs.length, last: msgs.at(-1) });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar-EG', timezoneId: 'Asia/Riyadh', serviceWorkers: 'block', hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
const st = { img: 0, other: [] };
const ctxRoute = (r) => {
  const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin };
  if (q.method() !== 'GET' && q.method() !== 'HEAD') { st.other.push(q.method() + ' ' + u); return r.abort(); }
  if (u.includes('/api/v1/inbox/history/')) {
    const j = (b) => r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.includes('/media?')) { st.img++; return r.fulfill({ status: 200, headers: { ...cors, 'Cache-Control': 'no-store' }, contentType: 'image/svg+xml', body: SVG }); }
    if (u.includes('/send-media')) return j({ ok: true, enabled: false });
    if (u.includes('/conversations')) return j({ ok: true, conversations: [conv(A, 'منى حسن', msgsA), conv(B, 'سارة علي', msgsB)].sort((x, y) => y.updatedAt - x.updatedAt) });
    if (u.includes('/conversation?')) { const id = decodeURIComponent(/id=([^&]+)/.exec(u)[1]); const ms = id === A ? msgsA : msgsB; return j({ ok: true, conversation: { id, customer: id === A ? 'منى حسن' : 'سارة علي', updatedAt: ms.at(-1).at, messages: ms } }); }
    return j({ ok: true });
  }
  return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
};
await ctx.route('**/*', ctxRoute);
const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.clock.setFixedTime(new Date(NOW));
await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
await page.goto(BASE, { waitUntil: 'load' }); await page.waitForTimeout(400);
await page.locator('#novaWaBtn').click();
const view = page.locator('#novaInboxView');
await view.locator(`[data-conv="${A}"]`).click(); await view.locator('#waInput').waitFor(); await page.waitForTimeout(800);
let n = 0; const ok = (m) => { n++; console.log('ok -', m); };
const tag = () => page.evaluate(() => { document.querySelectorAll('#waMsgs .wa-msg, #waList [data-conv], #waMsgs img').forEach((e) => { e.__k = 1; }); const ms = document.getElementById('waMsgs'); ms.__k = 1; document.getElementById('waInput').__k = 1; });
const fresh = () => page.evaluate(() => ({ msgs: [...document.querySelectorAll('#waMsgs .wa-msg')].filter((e) => !e.__k).map((e) => e.dataset.mid), kept: [...document.querySelectorAll('#waMsgs .wa-msg')].filter((e) => e.__k).length,
  rowsNew: [...document.querySelectorAll('#waList [data-conv]')].filter((e) => !e.__k).map((e) => e.dataset.conv), imgKept: [...document.querySelectorAll('#waMsgs img')].every((e) => e.__k), boxKept: !!document.getElementById('waMsgs').__k,
  inputKept: !!document.getElementById('waInput').__k, focus: document.activeElement && document.activeElement.id, value: document.getElementById('waInput').value, top: document.getElementById('waMsgs').scrollTop }));
const waitPoll = async (pred) => { for (let i = 0; i < 70; i++) { await page.waitForTimeout(100); if (await page.evaluate(pred)) return; } throw new Error('poll did not bring the change: ' + pred); };

// read older messages (scroll up), start typing, then ANOTHER chat receives a message
await page.evaluate(() => { const ms = document.getElementById('waMsgs'); ms.scrollTop = Math.round(ms.scrollHeight / 3); });
await page.waitForTimeout(200);
await view.locator('#waInput').click(); await view.locator('#waInput').pressSequentially('مرحبا يا', { delay: 10 });
await page.evaluate(() => { const i = document.getElementById('waInput'); i.setSelectionRange(3, 3); });
await tag(); const img0 = st.img; const top0 = (await fresh()).top;
msgsB.push({ id: 'b2', dir: 'in', kind: 'in', text: 'لسه مستني', at: NOW - 1 * M });
await waitPoll(() => [...document.querySelectorAll('#waList [data-conv]')].some((e) => e.textContent.includes('لسه مستني')));
let f = await fresh();
assert.deepEqual(f.msgs, [], 'no bubble of the open chat is rebuilt'); assert.ok(f.boxKept && f.imgKept, 'message area and photo kept'); assert.equal(st.img, img0, 'the photo is not downloaded again');
assert.ok(Math.abs(f.top - top0) <= 2, 'reading position unchanged: ' + top0 + ' -> ' + f.top);
assert.ok(f.inputKept && f.focus === 'waInput' && f.value === 'مرحبا يا', 'typing undisturbed: ' + JSON.stringify([f.inputKept, f.focus, f.value]));
assert.deepEqual(f.rowsNew, [], 'chat rows kept (only their text/order patched)');
assert.equal(await page.evaluate(() => document.getElementById('waInput').selectionStart), 3, 'cursor position inside the text kept');
ok('another chat gets a message: open chat, photo, scroll position and the text being typed are untouched');

// the OPEN chat receives a new message: exactly one bubble is added
await tag();
msgsA.push({ id: 'anew', dir: 'in', kind: 'in', text: 'تمام شكرا', at: NOW });
await waitPoll(() => !!document.querySelector('#waMsgs [data-mid="anew"]'));
f = await fresh();
assert.deepEqual(f.msgs, ['anew'], 'only the new bubble is new: ' + JSON.stringify(f.msgs)); assert.equal(f.kept, msgsA.length - 1); assert.equal(st.img, img0, 'photo still not re-downloaded');
assert.ok(f.inputKept && f.value === 'مرحبا يا', 'text field kept');
ok('new message in the open chat: one bubble added, everything else kept');
await tag();
msgsA.splice(15, 0, { id: 'alate', dir: 'out', kind: 'pharm', text: 'رد وصل متأخر', at: msgsA[14].at + 1, status: 'sent' });
msgsA.push({ id: 'anew2', dir: 'in', kind: 'in', text: 'تمام', at: NOW + 1 });
await waitPoll(() => !!document.querySelector('#waMsgs [data-mid="alate"]'));
f = await fresh();
assert.deepEqual(f.msgs.sort(), ['alate', 'anew2'], 'only the inserted and the new bubble are new: ' + JSON.stringify(f.msgs)); assert.equal(st.img, img0, 'photo not reloaded when a message is inserted before it'); assert.ok(f.imgKept);
ok('a late message inserted in the middle: only it is added, the rest (photo included) kept');
// leave the text field (tap the messages) with a draft in it, then an update: the draft stays
await page.evaluate(() => document.getElementById('waInput').blur());
msgsB.push({ id: 'b9', dir: 'in', kind: 'in', text: 'رسالة جديدة لسارة', at: NOW + 2 });
await waitPoll(() => [...document.querySelectorAll('#waList [data-conv]')].some((e) => e.textContent.includes('رسالة جديدة لسارة')));
assert.equal(await page.evaluate(() => document.getElementById('waInput').value), 'مرحبا يا', 'draft kept after leaving the field');
ok('draft kept when the field is not focused during an update');

// switching chats still shows the right messages (no stale bubbles), and back
await view.locator('[data-wa-back]').click(); await page.waitForTimeout(400); await view.locator(`[data-conv="${B}"]`).click(); await page.waitForTimeout(800);
let ids = await page.evaluate(() => [...document.querySelectorAll('#waMsgs .wa-msg')].map((e) => e.dataset.mid)); assert.deepEqual(ids, ['b1', 'b2', 'b9']);
await view.locator('[data-wa-back]').click(); await page.waitForTimeout(400); await view.locator(`[data-conv="${A}"]`).click(); await page.waitForTimeout(800);
ids = await page.evaluate(() => [...document.querySelectorAll('#waMsgs .wa-msg')].map((e) => e.dataset.mid));
assert.ok(ids.includes('anew') && ids.includes('aimg') && !ids.includes('b1'), 'chat A content correct after switching');
ok('switching chats: correct messages, no leftovers');

assert.deepEqual(errors, [], 'no page errors'); assert.deepEqual(st.other, [], 'no non-GET request');
await ctx.close();
{ // English interface: after a live update the translated labels stay translated (the language layer still works with morphing)
  const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', serviceWorkers: 'block', hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  await c2.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'en'); } catch (e) {} });
  await c2.route('**/*', (r) => ctxRoute(r));
  const p2 = await c2.newPage(); const e2 = []; p2.on('pageerror', (e) => e2.push(e.message));
  await p2.clock.setFixedTime(new Date(NOW)); await p2.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
  await p2.goto(BASE, { waitUntil: 'load' }); await p2.waitForTimeout(400); await p2.locator('#novaWaBtn').click(); await p2.locator('#novaInboxView [data-conv]').first().waitFor(); await p2.waitForTimeout(600);
  const chips = () => p2.evaluate(() => [...document.querySelectorAll('.wa-chips button, .wa-chips [role=tab]')].map((b) => b.textContent.trim()).join('|'));
  const before = await chips();
  msgsB.push({ id: 'b3', dir: 'in', kind: 'in', text: 'رسالة تالتة', at: NOW });
  for (let i = 0; i < 70; i++) { await p2.waitForTimeout(100); if (await p2.evaluate(() => [...document.querySelectorAll('#waList [data-conv]')].some((e) => e.textContent.includes('رسالة تالتة')))) break; }
  await p2.waitForTimeout(300);
  const after = await chips();
  assert.ok(before, 'chips found');
  assert.equal(after, before, 'labels identical after the update: ' + before + ' -> ' + after);
  assert.deepEqual(e2, []); await c2.close(); ok('English interface selected: labels unchanged after a live update (the language layer keeps working)');
}
await browser.close();
console.log(`PASS ux414 smooth redraw: ${n} groups`);
