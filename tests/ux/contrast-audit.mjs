// UX-01 audit: measures WCAG contrast of the REAL rendered UI (computed styles), view by view, at tablet landscape.
// Read-only: loads the local static app, never calls a live backend (all non-local requests are aborted).
// Usage: node tests/ux/contrast-audit.mjs [--url http://127.0.0.1:8765/] [--json out.json] [--check]
//   --check  fail (exit 1) if failing text groups exceed the ratchet in tests/ux/contrast-baseline.json
import fs from 'node:fs';
import { chromium } from 'playwright';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const URL_ = arg('--url', 'http://127.0.0.1:8765/');
const OUT = arg('--json', '');
const CHECK = process.argv.includes('--check');
const BASE = new URL('./contrast-baseline.json', import.meta.url);

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'ar-EG' });
await ctx.route('**/*', r => { const u = r.request().url(); return u.startsWith(new URL(URL_).origin) || u.startsWith('data:') || u.startsWith('blob:') ? r.continue() : r.abort(); });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e.message).slice(0, 160)));
await page.addInitScript(() => { try { localStorage.setItem('nova-rx-language', 'ar'); } catch {} });
await page.goto(URL_, { waitUntil: 'load' });
await page.waitForTimeout(1500);

const measure = () => page.evaluate(() => {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const out = []; let skipped = 0; let disabledSkipped = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue.replace(/\s+/g, ' ').trim();
    if (text.length < 2) continue;
    const el = n.parentElement; if (!el || seen.has(el) || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName)) continue;
    seen.add(el);
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    if (el.closest('button:disabled,input:disabled,select:disabled,textarea:disabled,[disabled],[aria-disabled="true"],fieldset:disabled')) { disabledSkipped++; continue; }
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
    if (op < 0.05) continue;
    // effective background: composite ancestors' background colours; a background image/gradient makes it unknown
    const layers = []; let unknown = false;
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.backgroundImage && s.backgroundImage !== 'none') { unknown = true; break; }
      const c = parse(s.backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    if (unknown) { skipped++; continue; }
    let bg = { r: 255, g: 255, b: 255, a: 1 }; // browser default canvas if nothing opaque found
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    let fg = parse(cs.color); if (!fg) continue; fg = over({ ...fg, a: fg.a * op }, bg);
    const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    out.push({ text: text.slice(0, 40), fg: hex(fg), bg: hex(bg), ratio: Math.round(ratio * 100) / 100, size, weight, need, pass: ratio >= need, tag: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : '') });
  }
  const smallTargets = []; let tiny = 0;
  for (const e of document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,[role=button],[tabindex="0"]')) {
    const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none' || e.disabled) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    if (Math.min(r.width, r.height) < 32) smallTargets.push((e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : '') + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' ' + ((e.textContent || e.getAttribute('aria-label') || e.placeholder || '').trim().slice(0, 18))));
  }
  for (const it of out) if (it.size < 11) tiny++;
  return { items: out, skipped, disabledSkipped, smallTargets, tiny, lang: document.documentElement.lang, dir: document.documentElement.dir, font: getComputedStyle(document.body).fontFamily.slice(0, 60), theme: document.title && /Error response|404 Not Found/i.test(document.title) ? 'not-served' : document.documentElement.getAttribute('data-theme') || (document.body.classList.contains('light') ? 'light' : 'dark') };
});

const results = [];
const open = async (url) => { await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(1200); };
const origin = new URL(URL_).origin;
// 1) the main app: default view, then every tab (fresh load each time so a navigating tab cannot hide the next one)
await open(URL_);
const tabs = await page.$$eval('.nova-tab', els => els.map((e, i) => ({ i, label: (e.textContent || '').trim().slice(0, 24) })));
{ const m = await measure(); results.push({ view: 'app: default', lang: m.lang, dir: m.dir, font: m.font, theme: m.theme, texts: m.items.length, skippedBackgroundImage: m.skipped, skippedDisabled: m.disabledSkipped, smallTargets: m.smallTargets, tinyText: m.tiny, failing: m.items.filter(i => !i.pass), title: m.title }); }
for (const t of tabs) {
  await open(URL_);
  try { await page.locator('.nova-tab').nth(t.i).click({ timeout: 2500 }); await page.waitForTimeout(600); } catch { results.push({ view: 'tab: ' + t.label, error: 'could not open' }); continue; }
  const here = page.url().replace(origin, '');
  const m = await measure();
  results.push({ view: 'tab: ' + t.label + (here !== '/' ? ' -> ' + here : ''), lang: m.lang, dir: m.dir, font: m.font, theme: m.theme, texts: m.items.length, skippedBackgroundImage: m.skipped, skippedDisabled: m.disabledSkipped, smallTargets: m.smallTargets, tinyText: m.tiny, failing: m.items.filter(i => !i.pass), title: m.title });
}
// 2) standalone pages
for (const path of ['purchases.html', 'emergency-sales.html', 'sticker-studio.html', 'supplier-compare.html']) {
  try { await open(origin + '/' + path); } catch { results.push({ view: 'page: ' + path, error: 'could not load' }); continue; }
  const m = await measure();
  results.push({ view: 'page: ' + path, lang: m.lang, dir: m.dir, font: m.font, theme: m.theme, texts: m.items.length, skippedBackgroundImage: m.skipped, skippedDisabled: m.disabledSkipped, smallTargets: m.smallTargets, tinyText: m.tiny, failing: m.items.filter(i => !i.pass), title: m.title });
}
await browser.close();

// group failures by colour pair + size so the report is actionable
const groups = new Map();
for (const r of results) for (const f of r.failing || []) {
  const k = `${f.fg} on ${f.bg} @${f.size}px/${f.weight}`;
  const g = groups.get(k) || { pair: k, ratio: f.ratio, need: f.need, count: 0, views: new Set(), examples: [] };
  g.count++; g.views.add(r.view); if (g.examples.length < 3) g.examples.push(`${f.tag}: ${f.text}`); groups.set(k, g);
}
const list = [...groups.values()].map(g => ({ ...g, views: [...g.views] })).sort((a, b) => a.ratio - b.ratio);
const served = results.filter(r => r.theme !== 'not-served');
const targets = results.filter(r => r.theme !== 'not-served').flatMap(r => (r.smallTargets || []).map(t => r.view + ': ' + t));
const uniqueTargets = [...new Set(results.filter(r => r.theme !== 'not-served').flatMap(r => r.smallTargets || []))];
const summary = { smallTargetsUnique: uniqueTargets.length, tinyTextTotal: results.reduce((s, r) => s + (r.tinyText || 0), 0), url: URL_, viewport: '1280x800', views: results.map(r => ({ view: r.view, texts: r.texts, failing: (r.failing || []).length, disabledSkipped: r.skippedDisabled, smallTargets: (r.smallTargets || []).length, tinyText: r.tinyText, lang: r.lang, dir: r.dir, theme: r.theme, error: r.error })), failingGroups: list.length, failingTexts: list.reduce((s, g) => s + g.count, 0), pageErrors: errors.slice(0, 5) };
console.log(JSON.stringify(summary, null, 1));
for (const g of list.slice(0, 25)) console.log(`FAIL ${g.ratio}:1 (need ${g.need}) ${g.pair} x${g.count} [${g.views.slice(0, 3).join(' | ')}] e.g. ${g.examples[0]}`);
for (const t of uniqueTargets.slice(0, 40)) console.log('SMALL-TARGET ' + t);
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ summary, uniqueTargets, groups: list, results }, null, 1));
if (CHECK) {
  const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
  if (summary.failingGroups > base.maxFailingGroups || summary.failingTexts > base.maxFailingTexts || summary.smallTargetsUnique > base.maxSmallTargetsUnique) { console.log(`CHANGES REQUIRED: contrast regressed (groups ${summary.failingGroups} > ${base.maxFailingGroups} or texts ${summary.failingTexts} > ${base.maxFailingTexts} or small targets ${summary.smallTargetsUnique} > ${base.maxSmallTargetsUnique})`); process.exit(1); }
  console.log(`PASS ux contrast ratchet: groups ${summary.failingGroups} <= ${base.maxFailingGroups}, texts ${summary.failingTexts} <= ${base.maxFailingTexts}, small targets ${summary.smallTargetsUnique} <= ${base.maxSmallTargetsUnique}`);
}
