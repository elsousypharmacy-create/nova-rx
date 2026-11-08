const { chromium } = require('playwright');
const out = process.argv[2];
const css = `
.su{display:inline-flex;align-items:stretch;height:32px;margin-inline-start:auto;margin-inline-end:28px;align-self:center;
  background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:6px;overflow:hidden;font-family:var(--font);font-size:12px;font-weight:600}
.su-stock{display:flex;align-items:center;gap:7px;padding:0 12px;color:var(--text-main);white-space:nowrap}
.su-dot{width:7px;height:7px;border-radius:50%}
.su-low .su-dot{background:var(--accent-amber)} .su-ok .su-dot{background:var(--accent-green)}
.su-low .su-stock b{color:var(--accent-amber)}
.su-stock b{font:700 13px var(--font-mono)}
.su-stock small{font-size:11px;font-weight:600;color:var(--text-muted)}
.su-btn{display:flex;align-items:center;gap:6px;padding:0 12px;border:0;border-inline-start:1px solid var(--border-subtle);background:transparent;color:var(--accent-cyan-light);font:600 12px var(--font);cursor:pointer}
.su-btn:hover{background:var(--bg-surface-hover)}
.su-low .su-btn{background:rgba(56,126,158,.18)}
.su-btn.icon{padding:0 11px}
`;
const svg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
(async () => {
  const b = await chromium.launch();
  const shot = async (q, html, file) => {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    await p.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle' });
    await p.fill('#mainSearchInput', q); await p.waitForTimeout(700); await p.addStyleTag({ content: css });
    await p.evaluate(h => { const it = document.querySelector('.suggestion-item'); const w = document.createElement('div'); w.innerHTML = h; it.insertBefore(w.firstElementChild, it.lastElementChild); }, html);
    await p.waitForTimeout(250);
    const box = await p.$('.suggestion-item'); const bb = await box.boundingBox();
    await p.screenshot({ path: `${out}/${file}`, clip: { x: 200, y: Math.max(0, bb.y - 90), width: 1080, height: bb.height + 200 } }); await p.close();
  };
  await shot('augmentin', `<div class="su su-low"><span class="su-stock"><span class="su-dot"></span><small>الرصيد</small><b>28</b><small>· منخفض</small></span><button class="su-btn">${svg}الموردين</button></div>`, 'u-low.png');
  await shot('panadol', `<div class="su su-ok"><span class="su-stock"><span class="su-dot"></span><small>الرصيد</small><b>120</b></span><button class="su-btn icon" title="الموردين">${svg}</button></div>`, 'u-ok.png');
  await b.close();
})();
