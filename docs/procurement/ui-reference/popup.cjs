const { chromium } = require('playwright');
const out = process.argv[2];
const css = `
.sx{display:flex;align-items:center;gap:8px;margin-inline-start:14px}
.sx-chip{font-size:11px;border-radius:999px;padding:3px 9px;white-space:nowrap;font-weight:600}
.sx-low{background:rgba(187,164,119,.16);color:var(--accent-amber)}
.sp-card{max-width:720px;width:92%;max-height:84vh}
.sp-body{overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:8px}
.sp-sec{font-size:11px;color:var(--text-dim);margin:6px 2px 0}
.sp-row{display:grid;grid-template-columns:1fr auto auto;gap:14px;align-items:center;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:6px;padding:10px 12px}
.sp-row.best{border-color:var(--accent-green)}
.sp-name{font-size:13px;font-weight:700;direction:ltr;text-align:right}
.sp-meta{font-size:11px;color:var(--text-muted);margin-top:3px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.sp-tag{border-radius:999px;padding:1px 8px;font-size:10.5px;font-weight:600}
.t-best{background:rgba(96,185,155,.15);color:var(--accent-green)}
.t-ok{background:rgba(96,185,155,.10);color:var(--accent-green)}
.sp-price{text-align:left;min-width:110px}
.sp-p{font:700 16px var(--font-mono);color:var(--text-main)}
.sp-pub{font:11px var(--font-mono);color:var(--text-dim);text-decoration:line-through;margin-inline-end:6px}
.sp-disc{font-size:11px;font-weight:700;color:var(--accent-amber)}
.sp-qty{direction:ltr;display:flex;align-items:center;gap:6px}
.sp-qty b{min-width:26px;text-align:center;font:700 13px var(--font-mono)}
.sp-qty .btn{width:30px;padding:6px 0}
.sp-add{display:flex;gap:8px;align-items:center}
.sp-foot-note{margin-inline-end:auto;font-size:11px;color:var(--text-dim)}
`;
const svg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
const row = (n, p, pub, d, u, qty, best) => `<div class="sp-row ${best ? 'best' : ''}">
  <div><div class="sp-name">${n}</div><div class="sp-meta"><span>PharmaOverseas</span><span>سعر القرص ${u} ج.م</span><span class="sp-tag ${best ? 't-best' : 't-ok'}">${best ? 'الأنسب' : 'متوفر'}</span></div></div>
  <div class="sp-price"><div><span class="sp-pub">${pub}</span><span class="sp-disc">خصم ${d}%</span></div><div class="sp-p">${p} <span style="font:11px var(--font);color:var(--text-muted)">ج.م</span></div></div>
  <div class="sp-add"><div class="sp-qty"><button class="btn btn-secondary">−</button><b>${qty}</b><button class="btn btn-secondary">+</button></div><button class="btn btn-primary">أضف لطلبية المورد</button></div></div>`;
(async () => {
  const b = await chromium.launch();
  const page = async () => { const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    await p.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle' }); await p.addStyleTag({ content: css }); return p; };
  // 1: row with button styled like app buttons
  let p = await page(); await p.fill('#mainSearchInput', 'augmentin'); await p.waitForTimeout(700);
  await p.evaluate(s => { const it = document.querySelector('.suggestion-item'); const w = document.createElement('div'); w.className = 'sx';
    w.innerHTML = '<span class="sx-chip sx-low">الرصيد 28 · منخفض</span><button class="btn btn-secondary">' + s + 'الموردين</button>'; it.insertBefore(w, it.lastElementChild); }, svg);
  await p.waitForTimeout(200); await p.screenshot({ path: out + '/pp1-row.png' }); await p.close();
  // 2: popup centered using the app's own modal classes
  p = await page(); await p.fill('#mainSearchInput', 'augmentin'); await p.waitForTimeout(700);
  const rows = row('AUGMENTIN 1 GM 14 TABLETS', '164.80', 210, '21.52', '11.77', 1, true)
    + '<div class="sp-sec">بدائل اقترحها المورد (غالباً نفس المادة الفعالة، راجعها)</div>'
    + row('MAGNABIOTIC 1 GM 10 F.C. TABS.', '37.20', '46.5', 20, '3.72', 1)
    + row('E-MOXCLAV 1G 10 F.C. TAB.', '74.40', 96, '22.5', '7.44', 1)
    + row('AUGRAM 1 G 7 TAB', '59.20', 76, '22.11', '8.46', 1)
    + row('HIBIOTIC 1 GM 16 TAB.', '135.20', 173, '21.85', '8.45', 1);
  await p.evaluate(h => { const d = document.createElement('div'); d.className = 'modal-backdrop active'; d.style.zIndex = 9300;
    d.innerHTML = '<div class="modal-card sp-card"><div class="modal-header"><div><h3>أوجمنتين 1 جم عند الموردين</h3><div style="font-size:11px;color:var(--text-muted);margin-top:3px">رصيدك الحالي 28 علبة</div></div></div><div class="sp-body">' + h + '</div><div class="modal-footer"><span class="sp-foot-note">سعر الصيدلية قبل التوصيل · Aumet لسه ما اتربطش</span><button class="btn btn-secondary">إغلاق</button></div></div>';
    document.body.appendChild(d); }, rows);
  await p.waitForTimeout(500); await p.screenshot({ path: out + '/pp2-popup.png' }); await b.close();
})();
