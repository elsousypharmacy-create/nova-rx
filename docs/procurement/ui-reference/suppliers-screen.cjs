const { chromium } = require('playwright');
const out = process.argv[2];
const css = `
.ss-card{max-width:560px;width:92%}
.ss-body{padding:14px 16px;display:flex;flex-direction:column;gap:10px;max-height:70vh;overflow:auto}
.ss-row{display:flex;align-items:center;gap:12px;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:6px;padding:12px}
.ss-logo{width:36px;height:36px;border-radius:6px;background:var(--bg-surface-active);display:flex;align-items:center;justify-content:center;font:700 14px var(--font-mono);color:var(--accent-cyan-light)}
.ss-name{font-size:13px;font-weight:700}.ss-sub{font-size:11px;color:var(--text-muted);margin-top:3px}
.ss-grow{flex:1}
.ss-tag{font-size:11px;font-weight:600;border-radius:999px;padding:3px 9px;display:inline-flex;gap:6px;align-items:center}
.ss-ok{background:rgba(96,185,155,.14);color:var(--accent-green)} .ss-off{background:var(--bg-surface-active);color:var(--text-muted)}
.ss-dot{width:6px;height:6px;border-radius:50%;background:currentColor}
.ss-lbl{font-size:11.5px;color:var(--text-muted);margin-bottom:5px;display:block}
.ss-in{width:100%;height:38px;background:var(--bg-base);border:1px solid var(--border-subtle);border-radius:6px;color:var(--text-main);padding:0 12px;font:13px var(--font);box-sizing:border-box}
.ss-note{font-size:11.5px;color:var(--text-muted);background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:6px;padding:10px 12px;line-height:1.7}
.ss-sel{display:flex;gap:8px}.ss-opt{flex:1;border:1px solid var(--border-subtle);border-radius:6px;padding:10px;background:var(--bg-surface);font-size:12.5px;font-weight:600;text-align:center}
.ss-opt.on{border-color:var(--accent-cyan-light);background:rgba(56,126,158,.18)} .ss-opt.dis{opacity:.5}
.ss-opt small{display:block;font-weight:500;color:var(--text-dim);margin-top:3px;font-size:10.5px}
`;
(async () => {
  const b = await chromium.launch();
  const mk = async (file, title, body, footer) => {
    const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    await p.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'networkidle' }); await p.addStyleTag({ content: css });
    await p.evaluate(([t, bd, ft]) => { const d = document.createElement('div'); d.className = 'modal-backdrop active'; d.style.zIndex = 9300;
      d.innerHTML = '<div class="modal-card ss-card"><div class="modal-header"><h3>' + t + '</h3><button class="btn btn-secondary">إغلاق</button></div><div class="ss-body">' + bd + '</div><div class="modal-footer">' + ft + '</div></div>'; document.body.appendChild(d); }, [title, body, footer]);
    await p.waitForTimeout(400); await p.screenshot({ path: `${out}/${file}` }); await p.close();
  };
  await mk('sup1-list.png', 'الموردين',
    `<div class="ss-row"><div class="ss-logo">PO</div><div class="ss-grow"><div class="ss-name">PharmaOverseas</div><div class="ss-sub">الحساب: ahmed@••••.com · آخر فحص ناجح 10:42 ص</div></div><span class="ss-tag ss-ok"><span class="ss-dot"></span>مربوط</span><button class="btn btn-secondary">فحص</button></div>
     <div class="ss-row"><div class="ss-logo">AU</div><div class="ss-grow"><div class="ss-name">Aumet</div><div class="ss-sub">لسه محتاج نجهّز الربط معاه</div></div><span class="ss-tag ss-off">قريباً</span></div>`,
    '<button class="btn btn-primary">+ إضافة مورد</button>');
  await mk('sup2-add.png', 'إضافة مورد',
    `<div><span class="ss-lbl">اختار المورد</span><div class="ss-sel"><div class="ss-opt on">PharmaOverseas<small>جاهز</small></div><div class="ss-opt dis">Aumet<small>قريباً</small></div><div class="ss-opt dis">مورد تاني<small>ابعتلي الموقع</small></div></div></div>
     <div><span class="ss-lbl">الإيميل</span><input class="ss-in" dir="ltr" value="pharmacy@example.com"></div>
     <div><span class="ss-lbl">كلمة السر</span><input class="ss-in" dir="ltr" type="password" value="••••••••••"></div>
     <div class="ss-note">كلمة السر بتتحفظ مشفّرة على سيرفر NOVA ومش بتظهر تاني، حتى ليك. تقدر تمسح الربط في أي وقت. النظام بيقرأ الأسعار بس، وما بيطلبش حاجة.</div>`,
    '<button class="btn btn-secondary">إلغاء</button><button class="btn btn-secondary">فحص الاتصال</button><button class="btn btn-primary">حفظ</button>');
  await b.close();
})();
