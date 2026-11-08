// NOVA Rx — Issue #4 targeted test: UX-LABELS-PANEL-BLOCKS-NEXT-SALE.
// After checkout -> receipt close -> new sale, the labels overlay must not
// block the POS: search stays visible and items can be added again.
// Headless Chromium via CDP, no npm deps (Node >= 22). Run:
//   node tests/issue-4-labels-panel.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(name, cond, detail = '') {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  -> ' + detail}`);
}

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(repoRoot, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(repoRoot)) { res.writeHead(403); return res.end(); }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const appUrl = `http://127.0.0.1:${server.address().port}/index.html`;

const chromeBin = process.env.CHROME_BIN || 'chromium';
const chrome = spawn(chromeBin, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--remote-debugging-port=0', '--user-data-dir=/tmp/nova-rx-test-i4-' + Date.now(),
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

try {
  await navigateAndWait(appUrl);
  await sleep(300);

  const addProduct = name => evalPage(`(() => {
    const input = document.getElementById('mainSearchInput');
    input.value = ${JSON.stringify(name)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return document.querySelectorAll('#invoiceTableBody tr').length;
  })()`);

  // L1: add a product
  check('L1 product added to invoice', await addProduct('Augmentin') === 1);

  // L2: checkout -> skip customer gate -> checkout modal opens
  await evalPage(`document.getElementById('btnCheckout').click()`);
  await sleep(200);
  check('L2 payment opens directly (customer step is optional)', await evalPage(`document.getElementById('customerCheckoutGate').hidden`));
  await sleep(200);
  check('L3 checkout modal active', await evalPage(`document.getElementById('checkoutModal').classList.contains('active')`));

  // L4: confirm payment -> receipt opens; the labels panel stays closed until the pharmacist taps the launcher
  await evalPage(`document.getElementById('btnConfirmPayment').click()`);
  await sleep(300);
  check('L4 receipt modal active', await evalPage(`document.getElementById('receiptModal').classList.contains('active')`));
  check('L5 labels panel does NOT open by itself after payment (owner decision)', await evalPage(`!document.getElementById('novaLabelsPanel').classList.contains('open')`));
  await evalPage(`document.getElementById('novaAiLaunch').click()`);
  await sleep(400);
  check('L5b the launcher opens it with the sold invoice medicines', await evalPage(`document.getElementById('novaLabelsPanel').classList.contains('open') && document.querySelectorAll('#nlMedicineList .med-card').length >= 1`));
  // L5c: a NEW sale must never show the previous patient's medicines (safety)
  await evalPage(`document.getElementById('novaLabelsPanel').classList.remove('open')`);
  await evalPage(`document.getElementById('btnReceiptNewSale').click()`);
  await sleep(300);
  check('L5c new sale: a different medicine is added', await addProduct('Concor') === 1);
  await evalPage(`document.getElementById('novaAiLaunch').click()`);
  await sleep(600);
  check('L5d opening by hand in the new sale shows ONLY the new cart (not the previous invoice)', await evalPage(`(() => { const c = [...document.querySelectorAll('#nlMedicineList .med-card .med-sum')].map(e => e.innerText); return c.length === 1 && /Concor|كونكور/.test(c[0]) && !/Augmentin|أوجمنتين/.test(c.join(' ')); })()`));

  // L6: close receipt (X) -> new sale -> labels panel must NOT stay open
  await evalPage(`document.getElementById('btnCloseReceipt').click()`);
  await sleep(300);
  check('L6 receipt closed', await evalPage(`!document.getElementById('receiptModal').classList.contains('active')`));
  check('L7 labels panel closed on new sale', await evalPage(`!document.getElementById('novaLabelsPanel').classList.contains('open')`));

  // L8: search input is visible and topmost at its center (not covered by overlay)
  const hit = await evalPage(`(() => {
    const el = document.getElementById('mainSearchInput');
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { visible: r.width > 0 && r.height > 0, hitId: top ? (top.id || top.className) : null, inside: el.contains(top) || top === el };
  })()`);
  check('L8 search input visible and clickable', hit.visible && hit.inside, JSON.stringify(hit));

  // L9: next sale works — adding another product succeeds (no blind/blocked state)
  check('L9 product added on next sale', await addProduct('Panadol') === 1);

  // L10: zero pageerrors across the whole flow
  check('L10 zero pageerrors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 400));
} finally {
  chrome.kill();
  server.close();
}

console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
