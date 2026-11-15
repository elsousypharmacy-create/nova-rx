// UX328: sale header shows full invoice number (copyable); hint hide button labelled. Local, fake data, non-GET blocked.
// Run: python3 -m http.server 8765 --bind 127.0.0.1 & CHROME_PATH=/usr/bin/chromium node tests/ui-ux328-sale-header.mjs
let pw; try { pw = await import('@playwright/test'); } catch { pw = await import(process.env.PW_PATH || '/tmp/pw/node_modules/playwright-core/index.mjs'); }
const BASE = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
const b = await pw.chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  const ctx = await b.newContext({ viewport: vp, serviceWorkers: 'block' });
  const origin = new URL(BASE).origin;
  await ctx.route('**/*', r => { const q = r.request(); if (q.method() !== 'GET' && q.method() !== 'HEAD') return r.abort(); return q.url().startsWith(origin) || q.url().startsWith('data:') ? r.continue() : r.abort(); });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: 'load' }); await p.waitForTimeout(1000);
  const n = await p.evaluate(() => { const e = document.getElementById('activeSaleNumber'); return { t: e.textContent, trunc: e.scrollWidth > e.clientWidth + 1, role: e.getAttribute('role'), r: e.getBoundingClientRect().right, l: e.getBoundingClientRect().left }; });
  ok(/^S-\d{6}$/.test(n.t), `${vp.width}: number text ${n.t}`);
  ok(!n.trunc, `${vp.width}: number not truncated`);
  ok(n.role === 'button' && n.l >= 0 && n.r <= vp.width, `${vp.width}: number is tappable and inside viewport`);
  const h = await p.evaluate(() => { const e = document.getElementById('novaHintHide'); return e && { vis: !!e.offsetParent, txt: e.textContent.trim(), aria: e.getAttribute('aria-label'), es: document.getElementById('emptyInvoiceState').getBoundingClientRect().height }; });
  ok(h && h.vis && h.txt.length > 6 && !!h.aria, `${vp.width}: hide control labelled (${h && h.txt})`);
  ok(h && (vp.width > 600 || h.es < 280), `${vp.width}: empty state height ${h && Math.round(h.es)} < 280`);
  await ctx.close();
}
await b.close(); process.exit(fail ? 1 : 0);
