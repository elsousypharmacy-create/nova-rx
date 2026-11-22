// tests/ux/ops-perms-real.mjs
// QUEUE12: the ops screens in app/594-ops-screens.js must ask for actions that EXIST in auth-permissions.js
// (an unknown action is always denied, so a wrong name locks the owner out too).
// Loads the REAL NovaPerms (no mocks of decide()) with a signed-in owner and a signed-in cashier:
// owner may write cheques / supplier notes / swaps / payroll / vault; cashier is refused and nothing is stored.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.replace(/^\/+/, ''));
  const full = path.resolve(ROOT, rel);
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); res.end('Not Found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
let failed = false;
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.novaLazy && window.novaLazy.load());

  const out = await page.evaluate(() => {
    const NP = window.NovaPerms;
    if (!NP || typeof NP.create !== 'function') return { error: 'NovaPerms (auth-permissions.js) not loaded' };
    const snap = () => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k !== 'nova.perm.denied') o[k] = localStorage.getItem(k); } return JSON.stringify(o); };
    const ops = {
      cheques: () => window.novaCheques.add({ supplier: 'مورد اختبار', number: 'Q12-' + Math.random(), bank: 'الأهلي', amount: 100, dueAt: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10) }),
      supplierNotes: () => window.novaSupplierNotes.add({ supplier: 'مورد اختبار', kind: 'credit', amountPiasters: 1500, reference: 'Q12-' + Math.random(), reason: 'اختبار صلاحيات' }),
      swaps: () => window.novaPharmacySwaps.addPharmacy({ name: 'صيدلية اختبار ' + Math.random(), phone: '01000000009', note: '' }),
      payroll: () => window.novaPayroll.setEmployee({ name: 'موظف اختبار ' + Math.random(), baseSalaryPiasters: 100000, commissionPercent: 1, targetPiasters: 0, bonusPercent: 0 }),
      vault: () => window.novaVault.move({ type: 'drawer_in', amount: 10, reason: 'اختبار صلاحيات' })
    };
    const res = {};
    for (const role of ['owner', 'cashier']) {
      window.novaPerms = NP.create({ storage: localStorage, current: () => ({ name: 'حساب ' + role, role }), hasAccounts: () => true });
      res[role] = {};
      for (const [name, fn] of Object.entries(ops)) {
        const before = snap(); let threw = null;
        try { fn(); } catch (e) { threw = String(e); }
        res[role][name] = { stored: snap() !== before, threw };
      }
    }
    res.denied = window.novaPerms.denied().map((d) => d.action + '/' + d.why);
    return res;
  });
  assert.ok(!out.error, out.error);
  for (const name of ['cheques', 'supplierNotes', 'swaps', 'payroll', 'vault']) {
    assert.equal(out.owner[name].threw, null, `owner ${name} threw: ${out.owner[name].threw}`);
    assert.equal(out.owner[name].stored, true, `owner can write ${name} (action must exist in auth-permissions ACTIONS)`);
    assert.equal(out.cashier[name].stored, false, `cashier is refused ${name}`);
  }
  assert.ok(!out.denied.some((d) => /unknown-action/.test(d)), 'no unknown-action denials: ' + out.denied.join(', '));
  assert.ok(out.denied.some((d) => /role-denied/.test(d)), 'cashier refusals logged as role-denied');

  // Static guard: every action string the ops screens ask for exists in auth-permissions.js.
  const src = fs.readFileSync(path.join(ROOT, 'app', '594-ops-screens.js'), 'utf8');
  const { ACTIONS } = (await import('node:module')).createRequire(import.meta.url)(path.join(ROOT, 'auth-permissions.js'));
  const used = [...src.matchAll(/\b(?:require|can|hasPerm)\('([a-z]+\.[a-z_]+)'\)/g)].map((m) => m[1]);
  assert.ok(used.length >= 10, 'found permission calls in 594: ' + used.length);
  const unknown = [...new Set(used.filter((a) => ACTIONS.indexOf(a) < 0))];
  assert.deepEqual(unknown, [], 'actions in 594 missing from auth-permissions ACTIONS');
  assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
  console.log('PASS ops-perms-real: owner writes 5 ops screens, cashier refused, ' + used.length + ' perm calls all known');
} catch (e) {
  failed = true; console.error('FAIL ops-perms-real:', e.message);
} finally {
  await browser.close(); server.close();
}
if (failed) process.exit(1);
