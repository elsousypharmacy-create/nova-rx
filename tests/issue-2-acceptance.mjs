// NOVA Rx — Issue #2 acceptance tests (P0/P1 fixes).
// Drives headless Chromium over the DevTools Protocol; no npm dependencies
// (Node >= 22 built-in WebSocket). Run: node tests/issue-2-acceptance.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  -> ' + detail}`);
}

// --- Static file server for the repo root ---
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown' };
const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(repoRoot, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(repoRoot)) { res.writeHead(403); return res.end(); }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const appUrl = `http://127.0.0.1:${server.address().port}/index.html`;

// --- Launch headless Chromium with CDP ---
const chromeBin = process.env.CHROME_BIN || 'chromium';
const chrome = spawn(chromeBin, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--remote-debugging-port=0', '--user-data-dir=/tmp/nova-rx-test-profile-' + Date.now(),
  'about:blank'
], { stdio: ['ignore', 'pipe', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  chrome.stderr.on('data', d => {
    buf += d;
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) resolve(m[1]);
  });
  chrome.on('exit', () => reject(new Error('chromium exited early')));
  setTimeout(() => reject(new Error('no DevTools ws url')), 20000);
});

// --- Minimal CDP client ---
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let msgId = 0;
const pending = new Map();
const eventHandlers = [];
ws.onmessage = e => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else if (msg.method) eventHandlers.forEach(fn => fn(msg));
};
function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, msg => msg.error ? reject(new Error(method + ': ' + msg.error.message)) : resolve(msg.result));
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false }, sessionId);

const pageErrors = [];
eventHandlers.push(msg => {
  if (msg.method === 'Runtime.exceptionThrown') pageErrors.push(JSON.stringify(msg.params.exceptionDetails));
});

async function evalPage(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error('page eval failed: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function navigateAndWait(url) {
  await send('Page.navigate', { url }, sessionId);
  for (let i = 0; i < 100; i++) {
    if (await evalPage('document.readyState') === 'complete' &&
        await evalPage('!!document.getElementById("mainSearchInput") && !!window.NOVA_DEMO')) return;
    await sleep(150);
  }
  throw new Error('page did not become ready');
}
async function clickSelector(sel) {
  const rect = await evalPage(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, hit: (document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) || {}).id || null }; })()`);
  if (!rect) throw new Error('selector not found: ' + sel);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 }, sessionId);
  await sleep(150);
  return rect;
}

try {
  await navigateAndWait(appUrl);
  await sleep(300);

  // ---------- Phase A: build invoice, attach customer, set discounts, reload ----------
  await evalPage(`(() => {
    const input = document.getElementById('mainSearchInput');
    const enter = () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.value = 'Augmentin'; input.dispatchEvent(new Event('input', { bubbles: true })); enter();
    input.value = 'Panadol'; input.dispatchEvent(new Event('input', { bubbles: true })); enter();
    document.getElementById('btnAddLoyalty').click();
    input.value = 'Tariq'; input.dispatchEvent(new Event('input', { bubbles: true })); enter();
    const pct = document.getElementById('inputPercentDiscount');
    pct.value = '10'; pct.dispatchEvent(new Event('input', { bubbles: true }));
    const fix = document.getElementById('inputFixedDiscount');
    fix.value = '5'; fix.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(200);

  const before = await evalPage(`({
    rows: document.querySelectorAll('#invoiceTableBody tr').length,
    customer: document.getElementById('custCardName').textContent,
    customerVisible: document.getElementById('customerSelectedBox').style.display !== 'none',
    pct: document.getElementById('inputPercentDiscount').value,
    fix: document.getElementById('inputFixedDiscount').value,
    subtotal: document.getElementById('displaySubtotal').textContent,
    grand: document.getElementById('displayGrandTotal').textContent
  })`);
  check('A1 two line items added', before.rows === 2, JSON.stringify(before));
  check('A2 customer attached', before.customerVisible && before.customer.length > 0, JSON.stringify(before));
  check('A3 discounts entered', before.pct === '10' && before.fix === '5', JSON.stringify(before));

  await navigateAndWait(appUrl);
  await sleep(300);
  const after = await evalPage(`({
    rows: document.querySelectorAll('#invoiceTableBody tr').length,
    customer: document.getElementById('custCardName').textContent,
    customerVisible: document.getElementById('customerSelectedBox').style.display !== 'none',
    pct: document.getElementById('inputPercentDiscount').value,
    fix: document.getElementById('inputFixedDiscount').value,
    subtotal: document.getElementById('displaySubtotal').textContent,
    grand: document.getElementById('displayGrandTotal').textContent
  })`);
  check('A4 lines restored after reload', after.rows === before.rows, JSON.stringify(after));
  check('A5 customer restored after reload', after.customerVisible && after.customer === before.customer, JSON.stringify(after));
  check('A6 exact discount inputs restored', after.pct === '10' && after.fix === '5', JSON.stringify(after));
  check('A7 exact totals restored (no silent change)', after.subtotal === before.subtotal && after.grand === before.grand, `${before.grand} -> ${after.grand}`);

  // ---------- Phase B: excessive then zero discounts survive reload with safe totals ----------
  await evalPage(`(() => {
    const fix = document.getElementById('inputFixedDiscount');
    fix.value = '500'; fix.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(150);
  const floored = (await evalPage(`document.getElementById('displayGrandTotal').textContent`)).replace('ج.م', 'EGP');
  check('B1 excessive discount floors total at 0.00', floored === '0.00 EGP', floored);
  await navigateAndWait(appUrl);
  await sleep(300);
  const flooredAfter = await evalPage(`({ fix: document.getElementById('inputFixedDiscount').value, grand: document.getElementById('displayGrandTotal').textContent.replace('ج.م', 'EGP') })`);
  check('B2 excessive discount restored exactly, still 0.00', flooredAfter.fix === '500' && flooredAfter.grand === '0.00 EGP', JSON.stringify(flooredAfter));

  await evalPage(`(() => {
    const pct = document.getElementById('inputPercentDiscount');
    pct.value = ''; pct.dispatchEvent(new Event('input', { bubbles: true }));
    const fix = document.getElementById('inputFixedDiscount');
    fix.value = '0'; fix.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(150);
  await navigateAndWait(appUrl);
  await sleep(300);
  const zeroed = await evalPage(`({
    pct: document.getElementById('inputPercentDiscount').value,
    grand: document.getElementById('displayGrandTotal').textContent,
    subtotal: document.getElementById('displaySubtotal').textContent,
    discountRowHidden: document.getElementById('discountRow').style.display === 'none'
  })`);
  check('B3 zero discounts: total equals subtotal, discount row hidden', zeroed.grand === zeroed.subtotal && zeroed.discountRowHidden, JSON.stringify(zeroed));

  // ---------- Phase C: search mode badge is clickable in RTL ----------
  const modeBefore = await evalPage(`document.getElementById('searchModeTag').textContent.trim()`);
  const badgeHit = await evalPage(`(() => { const el = document.getElementById('searchModeTag'); const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit === el || el.contains(hit); })()`);
  check('C1 badge is the topmost element at its center (not covered by input)', badgeHit === true);
  await clickSelector('#searchModeTag');
  const modeAfter = await evalPage(`document.getElementById('searchModeTag').textContent.trim()`);
  check('C2 clicking badge center toggles mode', modeBefore !== modeAfter, `${modeBefore} -> ${modeAfter}`);
  await clickSelector('#searchModeTag'); // back to Product for checkout

  // ---------- Phase D: checkout, receipt closes via × with no overlay intercept ----------
  await clickSelector('#btnCheckout');
  await sleep(200);
  const checkoutOpen = await evalPage(`document.getElementById('checkoutModal').classList.contains('active')`);
  check('D1 checkout modal opens (customer attached, no gate)', checkoutOpen === true);
  await clickSelector('#btnConfirmPayment');
  await sleep(300);
  const receiptOpen = await evalPage(`document.getElementById('receiptModal').classList.contains('active')`);
  check('D2 receipt modal opens after payment', receiptOpen === true);
  const closeHit = await evalPage(`(() => { const el = document.getElementById('btnCloseReceipt'); const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit === el || el.contains(hit); })()`);
  check('D3 receipt × is the topmost element at its center (no overlay intercept)', closeHit === true);
  await clickSelector('#btnCloseReceipt');
  await sleep(200);
  const receiptClosed = await evalPage(`!document.getElementById('receiptModal').classList.contains('active')`);
  check('D4 × closes the receipt dialog', receiptClosed === true);

  // ---------- Phase E: responsive viewports, no horizontal overflow, badge still clickable ----------
  for (const [w, h] of [[1366, 768], [1194, 834]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sessionId);
    await navigateAndWait(appUrl);
    await sleep(300);
    const v = await evalPage(`({
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      badgeClickable: (() => { const el = document.getElementById('searchModeTag'); const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit === el || el.contains(hit); })()
    })`);
    check(`E1 ${w}x${h}: no horizontal overflow`, v.overflow === false, JSON.stringify(v));
    check(`E2 ${w}x${h}: badge clickable`, v.badgeClickable === true, JSON.stringify(v));
  }

  // ---------- Phase F: no i18n / DOMStringMap pageerrors across the whole run ----------
  check('F1 no pageerrors (incl. novaOriginalaria-label DOMStringMap)', pageErrors.length === 0, pageErrors.join('\n'));
} finally {
  chrome.kill('SIGKILL');
  server.close();
  ws.close();
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
