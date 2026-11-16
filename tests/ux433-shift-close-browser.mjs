// UX433: shift close action. Fake sales in localStorage; every non-GET and non-local request is aborted.
// Run: node tests/ux433-shift-close-browser.mjs   (needs @playwright/test + Chrome/Chromium)
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
const exe = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
assert(exe, 'Set CHROME_PATH');
const PORT = 8773;
const server = spawn(process.execPath, ['scripts/dev-server.mjs', '--port', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const now = Date.now();
const mk = (i, pay, total) => ({ id: 'S' + i, number: '2026-' + String(i).padStart(5, '0'), at: now - i * 6e4, total, vat: +(total * 0.15 / 1.15).toFixed(2), payment: pay, customer: '', lines: [{ name: 'بنادول 500', price: total, qty: 1, discount: 0 }] });
const sales = [mk(1, 'cash', 45.5), mk(2, 'card', 120), mk(3, 'cash', 22.25)];
let fail = 0, blocked = 0; const log = (ok, m) => { console.log((ok ? 'PASS ' : 'FAIL ') + m); if (!ok) fail++; };
const browser = await chromium.launch({ headless: true, executablePath: exe, args: ['--no-sandbox'] });
try {
  for (const [w, h] of [[1366, 768], [390, 844]]) {
    const tag = w + 'x' + h;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'ar-EG', serviceWorkers: 'block', hasTouch: w < 500 });
    await ctx.route('**/*', r => { const q = r.request(); const u = new URL(q.url()); if (q.method() !== 'GET') { blocked++; return r.abort() } if (u.hostname !== '127.0.0.1' && !u.protocol.startsWith('data')) return r.abort(); return r.continue() });
    await ctx.addInitScript(s => { if (!sessionStorage.getItem('ux433')) { localStorage.clear(); sessionStorage.setItem('ux433', '1'); localStorage.setItem('nova-rx-sales-v1', JSON.stringify(s)); localStorage.setItem('nova-rx-language', 'ar') } window.__printed = 0; window.print = () => { window.__printed++ } }, sales);
    const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(String(e.message || e)));
    await pg.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' }); await pg.waitForTimeout(900);
    const open = async () => { await pg.evaluate(() => document.querySelector('.nova-tab[data-page="reports"]').click()); await pg.waitForTimeout(500) };
    await open();
    await pg.locator('#novaShiftFloat').fill('100'); await pg.locator('#novaShiftFloat').dispatchEvent('change'); await pg.waitForTimeout(400);
    // empty close is rejected
    await pg.locator('#novaShiftDo').click();
    log((await pg.locator('#novaShiftMsg').innerText()).length > 0 && !(await pg.evaluate(() => localStorage.getItem('nova-rx-shift-closings-v1'))), `${tag} close without count rejected, nothing saved`);
    // keyboard Enter flow
    await pg.locator('#novaShiftCount').fill('160'); await pg.locator('#novaShiftCount').press('Enter');
    await pg.waitForTimeout(200);
    const recs = await pg.evaluate(() => JSON.parse(localStorage.getItem('nova-rx-shift-closings-v1') || '[]'));
    const r = recs[0] || {};
    log(recs.length === 1, `${tag} Enter in counted field saves exactly one record`);
    log(r.period === 'day' && r.float === 100 && Math.abs(r.expected - 167.75) < 0.01 && r.counted === 160 && Math.abs(r.diff - (-7.75)) < 0.01 && typeof r.at === 'number' && 'cashier' in r, `${tag} record fields ${JSON.stringify(r)}`);
    const sum = await pg.locator('#novaShiftSummary').innerText();
    log(/تم إقفال الوردية/.test(sum) && await pg.locator('#novaShiftPrintAfter').isVisible(), `${tag} confirmation summary + print-after-close shown`);
    await pg.locator('#novaShiftPrintAfter').click(); log((await pg.evaluate(() => window.__printed)) === 1, `${tag} print after close`);
    // reload persistence
    await pg.reload({ waitUntil: 'load' }); await pg.waitForTimeout(800); await open();
    log((await pg.locator('#novaShiftCount').inputValue()) === '160', `${tag} counted cash persists after reload`);
    log((await pg.locator('#novaShiftDiff').getAttribute('data-diff')) === '-7.75', `${tag} diff recomputed after reload`);
    const last = await pg.locator('#novaShiftLast').innerText();
    log(/آخر إقفال/.test(last) && /160\.00/.test(last), `${tag} last closing shown after reload: ${last}`);
    // button click flow, second record, previous shown
    await pg.locator('#novaShiftCount').fill('167.75'); await pg.locator('#novaShiftDo').click(); await pg.waitForTimeout(200);
    const n = await pg.evaluate(() => JSON.parse(localStorage.getItem('nova-rx-shift-closings-v1')).length);
    log(n === 2 && /الإقفال السابق/.test(await pg.locator('#novaShiftSummary').innerText()), `${tag} button close appends record and shows previous closing`);
    log(!(await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag} no horizontal overflow`);
    log(errs.length === 0, `${tag} no page errors ${errs.join('|')}`);
    await ctx.close();
  }
  log(true, `blocked non-GET requests: ${blocked}`);
} finally { await browser.close(); server.kill() }
if (fail) { console.log(`FAILED ${fail}`); process.exit(1) } console.log('ALL PASS');
