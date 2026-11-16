// WA-SEND-RETRY: a network error while sending retries once with the SAME clientId, then checks the chat before asking the user to.
// Cases: drop once => one bubble, sent; drop twice but the chat already has the message => sent; drop twice and not there => failed bubble + note;
// server SEND_DUPLICATE and message in chat => sent. Run: python3 -m http.server 8765 --bind 127.0.0.1 & node tests/ux/wa-send-retry.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const snapshot = readFileSync(new URL('../../data/emergency-stock.json', import.meta.url), 'utf8');
const T = Date.now() - 3600e3, ID = 'wa_201000000001';
const IN = { id: 'wa_wamid.1', dir: 'in', kind: 'in', text: 'عندكم بنادول؟', at: T, status: null };
const CONVS = [{ id: ID, customer: 'منى التجريبية', updatedAt: T, count: 1, last: IN }];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const origin = new URL(BASE).origin;
let mode = 'once', sends = [], extra = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG', serviceWorkers: 'block' });
await ctx.route('**/*', async (r) => {
  const q = r.request(), u = q.url(), cors = { 'Access-Control-Allow-Origin': origin };
  if (u.includes('/api/v1/inbox/history/')) {
    if (q.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': 'Content-Type,X-Nova-Pin', 'Access-Control-Allow-Methods': 'GET,POST' } });
    if (u.endsWith('/send') && q.method() === 'POST') {
      const b = JSON.parse(q.postData()); sends.push(b);
      if (mode === 'once') return sends.length === 1 ? r.abort('failed') : r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, message: { id: 'ps_1', dir: 'out', kind: 'pharm', text: b.text, at: Date.now(), status: 'sent' } }) });
      if (mode === 'dup') return r.fulfill({ status: 409, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'SEND_DUPLICATE', message_ar: 'x' }) });
      return r.abort('failed');
    }
    if (u.includes('/conversations')) return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, conversations: CONVS }) });
    const msgs = [IN, ...extra];
    return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ ok: true, conversation: { id: ID, customer: 'منى التجريبية', updatedAt: T, messages: msgs } }) });
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(q.method())) return r.abort();
  return u.startsWith(origin) || u.startsWith('data:') ? r.continue() : r.abort();
});
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/emergency/stock.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: snapshot }));
await page.goto(BASE, { waitUntil: 'load' }); await page.waitForTimeout(500);
await page.locator('#novaWaBtn').click();
const view = page.locator('#novaInboxView');
await view.locator(`[data-conv="${ID}"]`).click();
await view.locator('[data-mid="wa_wamid.1"]').waitFor();
const input = view.locator('#waInput');
await page.waitForFunction(() => { const i = document.querySelector('#waInput'); return i && !i.disabled; });
async function send(text, m, serverHas) {
  mode = m; sends = []; extra = serverHas ? [{ id: 'srv_' + text, dir: 'out', kind: 'pharm', text, at: Date.now(), status: 'sent' }] : [];
  await input.fill(text); await input.press('Enter');
}
// 1 drop once -> retried, same clientId, sent
await send('رسالة 1', 'once', false);
await view.locator('[data-mid="ps_1"] [data-tick="sent"]').waitFor({ timeout: 8000 });
assert.equal(sends.length, 2); assert.equal(sends[0].clientId, sends[1].clientId, 'same clientId on retry');
// 2 drop twice, chat has it -> sent, no banner
await send('رسالة 2', 'down', true);
await view.locator('[data-mid="srv_رسالة 2"] [data-tick="sent"]').waitFor({ timeout: 8000 });
assert.equal(sends.length, 2);
// 3 duplicate + chat has it -> sent
await send('رسالة 3', 'dup', true);
await view.locator('[data-mid="srv_رسالة 3"] [data-tick="sent"]').waitFor({ timeout: 8000 });
// 4 drop twice, not in chat -> failed + note
await send('رسالة 4', 'down', false);
await view.locator('.wa-out [data-tick="failed"]').waitFor({ timeout: 8000 });
assert.ok((await view.innerText()).includes('مش متأكدين إن الرسالة اتبعتت'), 'note shown');
assert.deepEqual(errors, []);
await browser.close(); console.log('wa-send-retry: all passed');
