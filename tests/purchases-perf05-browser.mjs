// PERF-05: /purchases fails fast without a dashboard PIN (< 1s unlock state),
// short client timeout on PINLESS auto-attempt, and reserved banner/empty-state space (CLS < 0.1 at 390x844).
// Fake/local data only. Blocks all external requests and non-GET writes (except mocked read-only /api/purchases/stock).
// Run: node tests/purchases-perf05-browser.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const SHOTS = path.join(ROOT, 'qa/screens/PERF-05');
fs.mkdirSync(SHOTS, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const urlPath = new URL(req.url, 'http://127.0.0.1').pathname;
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const full = path.resolve(ROOT, rel);
  if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(full);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}/purchases.html`;

const FAKE_PIN = '0000';
const FAKE_STOCK = [
  { id: '1', code: '1301', name: 'بانادول إكسترا تجريبي', nameEn: 'Panadol Extra 500mg (Fake)', stock: 1, minStock: 4, idealStock: 10, dailySales: 1.5, observedDays: 14 },
  { id: '2', code: '1302', name: 'أوجمنتين تجريبي', nameEn: 'Augmentin 1g (Fake)', stock: 0, minStock: 3, idealStock: 6, dailySales: 0.8, observedDays: 14 },
];

const execPath = process.env.NOVA_CHROMIUM || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
const browser = await chromium.launch({ headless: true, executablePath: execPath });

async function openScenario(vp, {
  env,
  stockDelayMs = 6200,
  stockMode = 'locked', // 'locked' | 'ok' | 'slow-then-403'
  authDelayMs = 950,
  sessions = { aumet: 'ok', pharmaoverseas: 'ok' },
  sessionDelayMs = 200,
} = {}) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'ar-EG' });
  await ctx.addInitScript((e) => {
    if (e) window.NOVA_ENV = e;
    localStorage.setItem('novaPurchasePrefsV1', JSON.stringify({
      days: 21,
      level: 'ideal',
      suppliers: ['aumet', 'pharmaoverseas'],
      aumetSellers: ['one'],
    }));
    window.__cls = 0;
    window.__shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        window.__cls += entry.value;
        window.__shifts.push({ t: Math.round(entry.startTime), v: Number(entry.value.toFixed(4)) });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  }, env);

  const stockBodies = [];
  const logs = [];
  const errors = [];

  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.hostname !== '127.0.0.1') return route.abort();
    if (!u.pathname.startsWith('/api/')) {
      if (req.method() !== 'GET') return route.abort();
      return route.continue();
    }
    if (u.pathname === '/api/purchases/stock') {
      const body = req.postDataJSON() || {};
      stockBodies.push(body);
      const hasPin = !!body.dashboardPin;
      if (hasPin) {
        await new Promise((r) => setTimeout(r, authDelayMs));
        if (body.dashboardPin === FAKE_PIN) {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, schemaVersion: 1, generatedAt: new Date().toISOString(), items: FAKE_STOCK }),
          });
        }
        return route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'source-auth-required' }),
        });
      }
      await new Promise((r) => setTimeout(r, stockDelayMs));
      if (stockMode === 'ok') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: true, schemaVersion: 1, generatedAt: new Date().toISOString(), items: FAKE_STOCK }),
        });
      }
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'source-auth-required' }),
      });
    }
    if (u.pathname === '/api/suppliers/status') {
      await new Promise((r) => setTimeout(r, sessionDelayMs));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          suppliers: [
            { id: 'aumet', state: sessions.aumet || 'ok' },
            { id: 'pharmaoverseas', state: sessions.pharmaoverseas || 'ok' },
          ],
        }),
      });
    }
    if (u.pathname === '/api/suppliers/sellers') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sellers: [{ id: 'one', name: 'مخزن تجريبي' }] }),
      });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => logs.push(m.text()));
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  return { ctx, page, t0, stockBodies, logs, errors };
}

try {
  const results = [];

  // 1) Production (no PIN, 6.2s slow server mock) at 390x844 and 1280x800:
  //    Must fail fast with 0 /api/purchases/stock calls, unlock card < 1000ms, CLS < 0.1.
  for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const tag = `${vp.width}x${vp.height}`;

    // 1a) Production, healthy sessions
    let s = await openScenario(vp, { env: 'production', stockDelayMs: 6200, sessions: { aumet: 'ok', pharmaoverseas: 'ok' } });
    await s.page.locator('#needsLockWrap .unlock-card').waitFor({ state: 'visible', timeout: 1000 });
    const unlockMs = Date.now() - s.t0;
    await s.page.waitForTimeout(450);
    const cls = await s.page.evaluate(() => Number(window.__cls.toFixed(4)));
    assert.ok(unlockMs < 1000, `prod ${tag} unlockMs=${unlockMs}ms must be < 1000ms`);
    assert.equal(s.stockBodies.length, 0, `prod ${tag} must NOT call /api/purchases/stock without PIN`);
    assert.ok(cls < 0.1, `prod ${tag} CLS=${cls} must be < 0.1`);
    assert.equal(await s.page.evaluate(() => document.documentElement.dir), 'rtl');
    assert.ok(await s.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no horizontal overflow at ${tag}`);
    await s.page.screenshot({ path: path.join(SHOTS, `unlock-prod-${tag}.png`) });
    results.push({ case: `prod-ok-${tag}`, unlockMs, stockCalls: s.stockBodies.length, cls });

    // Verify entering fake PIN works even when authenticated fetch takes 950ms (> 600ms pinless timeout)
    await s.page.locator('#dashboard-style').fill(FAKE_PIN);
    await s.page.click('[data-empty-act=unlock]');
    await s.page.locator('#rows tr[data-key]').first().waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(s.stockBodies.length, 1, 'authenticated unlock calls /api/purchases/stock once');
    assert.equal(s.stockBodies[0].dashboardPin, FAKE_PIN);
    const leak = await s.page.evaluate((v) => ({
      ls: JSON.stringify(localStorage),
      ss: sessionStorage.getItem('novaNeedsSessionPin'),
      dom: document.body.innerHTML.includes(`value="${v}"`),
    }), FAKE_PIN);
    assert.ok(!leak.ls.includes(FAKE_PIN) && leak.ss === FAKE_PIN && !leak.dom && !s.logs.join('\n').includes(FAKE_PIN), 'PIN in sessionStorage only, not localStorage/DOM/logs');
    assert.deepEqual(s.errors, []);
    await s.ctx.close();

    // 1b) Production, BOTH sessions expired (longest banner) -> banner appears asynchronously, CLS still < 0.1
    s = await openScenario(vp, { env: 'production', stockDelayMs: 6200, sessions: { aumet: 'expired', pharmaoverseas: 'expired' }, sessionDelayMs: 250 });
    await s.page.locator('#needsLockWrap .unlock-card').waitFor({ state: 'visible', timeout: 1000 });
    const unlockBannerMs = Date.now() - s.t0;
    await s.page.waitForTimeout(600); assert.equal(await s.page.locator('#sessionBanner').isVisible(), false, 'owner 20 Nov: no supplier session banner on النواقص');
    await s.page.waitForTimeout(300);
    const clsBanner = await s.page.evaluate(() => Number(window.__cls.toFixed(4)));
    assert.ok(unlockBannerMs < 1000, `prod+banner ${tag} unlockMs=${unlockBannerMs}ms must be < 1000ms`);
    assert.equal(s.stockBodies.length, 0, `prod+banner ${tag} must NOT call /api/purchases/stock without PIN`);
    assert.ok(clsBanner < 0.1, `prod+banner ${tag} CLS=${clsBanner} must be < 0.1`);
    await s.page.screenshot({ path: path.join(SHOTS, `unlock-banner-${tag}.png`) });
    assert.deepEqual(s.errors, []);
    results.push({ case: `prod-banner-${tag}`, unlockMs: unlockBannerMs, stockCalls: s.stockBodies.length, cls: clsBanner });
    await s.ctx.close();
  }

  // 2) Unknown/default host (env undefined on 127.0.0.1) stays PIN-gated and fails fast
  {
    const s = await openScenario({ width: 390, height: 844 }, { env: undefined, stockDelayMs: 6200 });
    await s.page.locator('#needsLockWrap .unlock-card').waitFor({ state: 'visible', timeout: 1000 });
    const unlockMs = Date.now() - s.t0;
    assert.ok(unlockMs < 1000, `default-host unlockMs=${unlockMs}ms must be < 1000ms`);
    assert.equal(s.stockBodies.length, 0, 'default host must NOT call /api/purchases/stock without PIN');
    assert.deepEqual(s.errors, []);
    await s.ctx.close();
  }

  // 3) Preview (PINLESS) with slow 6.2s server -> short client timeout aborts and shows unlock card < 1000ms, CLS < 0.1
  {
    const s = await openScenario({ width: 390, height: 844 }, {
      env: 'preview',
      stockDelayMs: 6200,
      stockMode: 'locked',
      sessions: { aumet: 'expired', pharmaoverseas: 'ok' },
      sessionDelayMs: 200,
    });
    await s.page.locator('#needsLockWrap .unlock-card').waitFor({ state: 'visible', timeout: 1000 });
    const unlockMs = Date.now() - s.t0;
    await s.page.waitForTimeout(300);
    const cls = await s.page.evaluate(() => Number(window.__cls.toFixed(4)));
    assert.ok(unlockMs < 1000, `preview slow unlockMs=${unlockMs}ms must be < 1000ms`);
    assert.equal(s.stockBodies.length, 1, 'preview PINLESS still attempts once');
    assert.equal(s.stockBodies[0].dashboardPin, '');
    assert.ok(cls < 0.1, `preview slow CLS=${cls} must be < 0.1`);
    assert.equal(await s.page.locator('#unlockHint:visible').count(), 0, 'timeout must not show wrong-PIN message');
    assert.equal(await s.page.locator('#needsStateBox .load-error:visible').count(), 0, 'timeout must not show red error');
    await s.page.screenshot({ path: path.join(SHOTS, 'unlock-preview-timeout-390x844.png') });
    assert.deepEqual(s.errors, []);
    results.push({ case: 'preview-slow-390x844', unlockMs, stockCalls: s.stockBodies.length, cls });
    await s.ctx.close();
  }

  // 4) Preview (PINLESS) with fast 200 OK server -> auto-loads stock without PIN prompt
  {
    const s = await openScenario({ width: 390, height: 844 }, {
      env: 'preview',
      stockDelayMs: 80,
      stockMode: 'ok',
    });
    await s.page.locator('#rows tr[data-key]').first().waitFor({ state: 'visible', timeout: 1500 });
    assert.equal(s.stockBodies.length, 1);
    assert.equal(await s.page.locator('#needsLockWrap .unlock-card:visible').count(), 0);
    assert.deepEqual(s.errors, []);
    await s.ctx.close();
  }

  console.log('PERF-05 measurements:', JSON.stringify(results));
  console.log('PASS: PERF-05 fast fail (<1s unlock), PINLESS short timeout, CLS < 0.1 at 390x844, production PIN-gated');
} finally {
  await browser.close();
  server.close();
}
