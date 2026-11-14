// UX63: Arabic generic/indication aliases + typo tolerance in instant search.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ar-EG' });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    return u.startsWith(new URL(BASE).origin) || u.startsWith('data:') ? r.continue() : r.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/emergency/stock.json', r => r.fulfill({ status: 404, body: '' })); // keep the 12 demo products
  await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.novaSearch && window.NOVA_DEMO, null, { timeout: 8000 });

  const run = qs => page.evaluate(qs => {
    const demo = window.NOVA_DEMO.products.slice(0, 12);
    const idx = window.novaSearch.createIndex(demo);
    return qs.map(q => ({ q, names: idx.search(q).map(p => p.name) }));
  }, qs);

  const expect = [
    ['اموكسيسيلين', 'أوجمنتين'], ['ديكلوفيناك', 'فولتارين'], ['باراسيتامول', 'بانادول'],
    ['مسكن صداع', 'بانادول'], ['كولسترول', 'ليبيتور'], ['بخاخ انف', 'أوتريفين'], ['سترزين', 'سيتريزين']
  ];
  for (const r of await run(expect.map(e => e[0]))) {
    const want = expect.find(e => e[0] === r.q)[1];
    assert.ok(r.names.some(n => n.includes(want)), `${r.q} -> ${want}, got ${JSON.stringify(r.names)}`);
  }
  const old = [['بنادول', 'بانادول'], ['اوجمنتن', 'أوجمنتين'], ['panadol', 'بانادول'], ['كونكر', 'كونكور']];
  for (const r of await run(old.map(e => e[0]))) {
    assert.ok(r.names[0].includes(old.find(e => e[0] === r.q)[1]), `${r.q} first: ${JSON.stringify(r.names)}`);
  }
  assert.equal((await run(['زززخخخ']))[0].names.length, 0, 'nonsense returns 0');
  // exact beats alias tier
  assert.ok((await run(['paracetamol']))[0].names.length >= 1);
  // speed
  const t = await page.evaluate(() => {
    const big = window.novaSearch.createIndex(Array.from({ length: 5000 }, (_, i) => ({ id: 'X' + i, name: 'دواء ' + i + ' (Drug' + i + ')', generic: i % 7 ? 'Paracetamol' : 'Amoxicillin', price: 1 })));
    const small = window.novaSearch.createIndex(window.NOVA_DEMO.products.slice(0, 12));
    const time = (idx, q) => { idx.search(q); const a = performance.now(); idx.search(q); return performance.now() - a; };
    return [time(big, 'باراسيتامول'), time(big, 'مسكن صداع'), time(big, 'زززخخخ'), time(small, 'سترزين')];
  });
  t.forEach(ms => assert.ok(ms < 10, 'search under 10ms: ' + ms.toFixed(2)));
  assert.deepEqual(errors, [], 'no console errors');
  console.log('search-aliases OK', t.map(x => x.toFixed(2)).join(' '));
} finally { await browser.close(); }
