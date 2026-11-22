import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0];
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
      const full = path.resolve(ROOT, rel);
      if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.writeHead(404); res.end('Not found'); return;
      }
      const ext = path.extname(full);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      fs.createReadStream(full).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function assert(cond, msg) { if (!cond) throw new Error('ASSERT FAILED: ' + msg); }

const { server, port } = await startServer();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const errors = [];

try {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    if (!sessionStorage.getItem('__vault_test_cleared')) {
      localStorage.clear();
      sessionStorage.setItem('__vault_test_cleared', '1');
    }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.novaLazy && window.novaLazy.load());

  // Real permissions (no mocks): the action must exist in auth-permissions.js (an unknown action is always denied),
  // a fresh device with no accounts may record, and the closed-shift button reads the last row of nova-rx-shift-closings-v1.
  const realCheck = await page.evaluate(() => {
    const known = window.NovaPerms.ACTIONS.indexOf('accounts.manage') >= 0;
    const ok = window.novaVault.move({ type: 'drawer_in', amount: 50, reason: 'real perms' });
    localStorage.setItem('nova-rx-shift-v1', JSON.stringify({ counted: 999 }));
    const none = window.novaVault.getClosedShiftCash();
    localStorage.setItem('nova-rx-shift-closings-v1', JSON.stringify([{ id: 'SC1', at: 1, counted: 120 }, { id: 'SC2', at: 2, counted: 345.5 }]));
    const last = window.novaVault.getClosedShiftCash();
    localStorage.removeItem('nova-rx-vault-moves-v1'); localStorage.removeItem('nova-rx-shift-v1'); localStorage.removeItem('nova-rx-shift-closings-v1');
    return { known, ok: ok.ok, none, last };
  });
  assert(realCheck.known, "'accounts.manage' is a real action in auth-permissions.js");
  assert(realCheck.ok, 'real novaPerms (no accounts yet) allows the move');
  assert(realCheck.none === null, 'a count typed before closing is not a closed shift');
  assert(realCheck.last && realCheck.last.amount === 345.5 && realCheck.last.shiftRef === 'SC2', 'closed shift = last closing row: ' + JSON.stringify(realCheck.last));

  const apiCheck = await page.evaluate(() => {
    localStorage.setItem('nova-rx-vault-moves-v1', '{corrupt');
    const safeBal = window.novaVault.balances();

    window.novaPerms = { require: () => false };
    const denied = window.novaVault.move({ type: 'drawer_in', amount: 100, reason: 'توريد' });

    window.novaPerms = { require: () => { throw new Error('boom'); } };
    const thrown = window.novaVault.move({ type: 'drawer_in', amount: 100, reason: 'توريد' });

    window.novaPerms = { require: (p) => p === 'accounts.manage' };
    window.novaAuth = { current: () => ({ name: 'أحمد', role: 'owner' }) };

    const badSubPiastre = window.novaVault.move({ type: 'drawer_in', amount: 10.005, reason: 'كسر' });
    const badReason = window.novaVault.move({ type: 'drawer_in', amount: 10, reason: '   ' });
    const r1 = window.novaVault.move({ type: 'drawer_in', amount: '١٠٠٠٫٥٠', reason: 'توريد وردية الصباح', shiftRef: 'SH-1' });
    const rDup = window.novaVault.move({ type: 'drawer_in', amount: 500, reason: 'مكرر', shiftRef: 'SH-1' });
    const rDep = window.novaVault.move({ type: 'bank_deposit', amount: '٤٠٠', reason: 'إيداع بنكي' });
    const rNegVault = window.novaVault.move({ type: 'vault_expense', amount: 700, reason: 'كهرباء' });
    const rNegBank = window.novaVault.move({ type: 'bank_withdraw', amount: 500, reason: 'سحب زائد' });
    const rExp = window.novaVault.move({ type: 'vault_expense', amount: 100.5, reason: 'نظافة' });
    const rWdr = window.novaVault.move({ type: 'bank_withdraw', amount: 100, reason: 'تغذية الخزنة' });

    return {
      safeBal, denied, thrown, badSubPiastre, badReason, r1, rDup, rDep, rNegVault, rNegBank, rExp, rWdr,
      finalBal: window.novaVault.balances(),
      count: window.novaVault.list().length
    };
  });

  assert(apiCheck.safeBal.vault === 0 && apiCheck.safeBal.bank === 0, 'corrupt JSON must not crash');
  assert(!apiCheck.denied.ok && apiCheck.denied.error === 'forbidden', 'fail-closed false perm');
  assert(!apiCheck.thrown.ok && apiCheck.thrown.error === 'forbidden', 'fail-closed throwing perm');
  assert(!apiCheck.badSubPiastre.ok && apiCheck.badSubPiastre.error === 'bad-amount', 'reject sub-piastre amounts');
  assert(!apiCheck.badReason.ok && apiCheck.badReason.error === 'reason-required', 'reason required');
  assert(apiCheck.r1.ok && apiCheck.r1.move.amount === 1000.5 && apiCheck.r1.move.amountCents === 100050, 'Arabic-Indic decimal amount in piastres');
  assert(!apiCheck.rDup.ok && apiCheck.rDup.error === 'duplicate-shift', 'shift handover idempotency');
  assert(apiCheck.rDep.ok, 'bank deposit ok');
  assert(!apiCheck.rNegVault.ok && apiCheck.rNegVault.error === 'insufficient-vault', 'no negative vault');
  assert(!apiCheck.rNegBank.ok && apiCheck.rNegBank.error === 'insufficient-bank', 'no negative bank');
  assert(apiCheck.rExp.ok && apiCheck.rWdr.ok, 'expense and withdraw ok');
  assert(apiCheck.finalBal.vault === 600 && apiCheck.finalBal.bank === 300, 'exact piastre balances');
  assert(apiCheck.count === 4, 'append-only 4 valid moves');

  await page.evaluate(() => { try { sessionStorage.setItem('nova.reportsTab', 'vault'); } catch {} }); // UI-BATCH1: reports tabs
  await page.evaluate(() => document.querySelector('.nova-tab[data-page="reports"]').click()); // at 390px the top tabs are hidden behind the bottom bar (app/562)
  await page.evaluate(id => window.novaPageViews.openTool(id), 'novaVaultCard'); await page.waitForTimeout(400); // Q21-2c: the card is a tool in «الأدوات»
  await page.waitForSelector('#novaVaultCard', { timeout: 5000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > 390);
  assert(!overflow, 'no horizontal overflow at 390px');
  assert(errors.length === 0, 'no page errors: ' + errors.join('; '));

  console.log('«vault-bank PASS»');
} finally {
  await browser.close();
  server.close();
}
