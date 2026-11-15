/* UX430 UI: Home card + dedicated WhatsApp KPIs page. Read-only: one GET to /api/v1/inbox/history/metrics (UX300 endpoint, same
   gate as the conversations list since UX400, no PIN header). Data stays in memory only. Never sends a message: tapping a waiting
   chat only opens it in المحادثات (the same click a pharmacist would make). Automated browsers (navigator.webdriver) do not
   auto-load the Home numbers so unrelated offline smoke tests make no network call; localStorage nova.waKpi.autoload=1 opts in. */
var KPW = { data: null, at: 0, busy: false, err: '', preset: 'today', fromKey: '', toKey: '', trendN: 7, open: false, wait: [] };
var KP_WD = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
var KP_MEDIA = [['image', 'صور'], ['audio', 'صوت'], ['video', 'فيديو'], ['document', 'مستندات'], ['sticker', 'ملصقات'], ['other', 'وسائط أخرى']];
function kpEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function kpNum(n) { return n == null ? '—' : String(Math.round(n)); }
function kpUrl() {
  var u = '';
  try { u = localStorage.getItem('novaBackend.url') || ''; if (!u && localStorage.getItem('novaBackend.enabled') === 'true') u = 'https://nova-rx-api.elsousypharmacy.workers.dev'; } catch (e) { }
  return String(u || 'https://nova-rx-api-staging.elsousypharmacy.workers.dev').replace(/\/+$/, '') + '/api/v1/inbox/history/metrics';
}
function kpAuto() {
  try { if (localStorage.getItem('nova.waKpi.autoload') === '1') return true; } catch (e) { }
  return !(typeof navigator !== 'undefined' && navigator.webdriver);
}
function kpLoad(force) {
  if (KPW.busy || typeof fetch !== 'function') return;
  if (!force && KPW.data && Date.now() - KPW.at < 60000) { kpPaint(); return; }
  KPW.busy = true; KPW.err = ''; kpPaint();
  fetch(kpUrl(), { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'omit' }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (r.status === 401 || r.status === 429) throw new Error('السيرفر ده لسه مش فاتح بيانات واتساب. افتح نسخة التجربة أو حاول تاني بعد شوية.');
      if (!r.ok || !j || !j.ok || !j.data) throw new Error('السيرفر مش بيرد دلوقتي. حاول تاني بعد شوية.');
      KPW.data = j.data; KPW.at = Date.now();
    });
  }, function () { throw new Error(typeof navigator !== 'undefined' && navigator.onLine === false ? 'أنت غير متصل بالإنترنت.' : 'تعذّر الاتصال بالسيرفر.'); })
    .catch(function (e) { KPW.err = String((e && e.message) || e); })
    .then(function () { KPW.busy = false; kpPaint(); });
}
function kpDelta(a, b) {
  if (a == null || b == null) return '';
  var d = a - b;
  if (!d) return 'زي أمس';
  return (d > 0 ? '▲ ' : '▼ ') + Math.abs(Math.round(d)) + ' عن أمس';
}
function kpCardHtml() {
  var h = KPW.data ? kpHeadline(KPW.data, Date.now()) : null, t = h && h.today, y = h && h.yesterday;
  var fr = t && t.firstResponse.avg != null ? kpDur(t.firstResponse.avg) : '—';
  function tile(v, l, sub, cls, key) { return '<span class="wk-t' + (cls ? ' ' + cls : '') + '" data-wk="' + key + '"><b>' + kpEsc(v) + '</b><span>' + l + '</span><i>' + kpEsc(sub || ' ') + '</i></span>'; }
  return '<span class="wk-top"><span class="wk-ico" aria-hidden="true">✆</span>واتساب النهارده<span class="wk-more">كل المؤشرات ‹</span></span>' +
    '<span class="wk-tiles">' +
    tile(t ? t.chats : '—', 'محادثات', t ? kpDelta(t.chats, y.chats) : '', '', 'chats') +
    tile(t ? t.msgs : '—', 'رسائل', t ? kpDelta(t.msgs, y.msgs) : '', '', 'msgs') +
    tile(t ? t.waitingOpen : '—', 'بانتظار الرد', t && t.waitingOpen ? 'محتاجين رد' : (t ? 'مفيش حد مستني' : ''), t && t.waitingOpen ? 'wk-warn' : '', 'waiting') +
    tile(fr, 'متوسط أول رد', t && t.firstResponse.n ? 'من الصيدلي (' + t.firstResponse.n + ')' : (t ? 'لسه مفيش ردود' : ''), '', 'first') +
    '</span>' + (KPW.err && !KPW.data ? '<span class="wk-note" role="status">' + kpEsc(KPW.err) + '</span>' : KPW.busy && !KPW.data ? '<span class="wk-note" role="status">جارٍ التحميل…</span>' : '');
}
function kpTrendHtml(n) {
  var tr = kpTrend(KPW.data, Date.now(), n), mx = 1, i, s = '';
  for (i = 0; i < tr.length; i++) mx = Math.max(mx, tr[i].msgs, tr[i].chats);
  var sumM = 0, sumC = 0;
  for (i = 0; i < tr.length; i++) {
    var d = tr[i]; sumM += d.msgs; sumC += d.chats;
    s += '<div class="wkp-col' + (d.msgs ? '' : ' zero') + '" title="' + d.key + ': ' + d.chats + ' محادثة، ' + d.msgs + ' رسالة" data-day="' + d.key + '"><span class="c" style="height:' + Math.round(d.chats / mx * 100) + '%"></span><span class="m" style="height:' + Math.round(d.msgs / mx * 100) + '%"></span></div>';
  }
  return '<div class="wkp-chart" role="img" aria-label="رسائل ومحادثات آخر ' + n + ' يوم">' + s + '</div>' +
    '<div class="wkp-axis"><span>' + tr[0].key.slice(5) + '</span><span>' + tr[tr.length - 1].key.slice(5) + '</span></div>' +
    '<div class="wkp-leg"><span><i style="background:#76b8d5"></i>رسائل: <b data-trend-msgs>' + sumM + '</b></span><span><i style="background:#60b99b"></i>محادثات (مجموع الأيام): <b data-trend-chats>' + sumC + '</b></span></div>';
}
function kpHeatHtml(r) {
  var mx = 0, w, h, s = '<span></span>';
  for (w = 0; w < 7; w++) for (h = 0; h < 24; h++) mx = Math.max(mx, r.heat[w][h]);
  for (h = 0; h < 24; h++) s += '<span class="hl">' + (h % 3 === 0 ? h : '') + '</span>';
  var order = [6, 0, 1, 2, 3, 4, 5];
  for (var oi = 0; oi < 7; oi++) {
    w = order[oi]; s += '<span class="dl">' + KP_WD[w] + '</span>';
    for (h = 0; h < 24; h++) {
      var v = r.heat[w][h], a = mx ? v / mx : 0;
      s += '<span class="cell" data-heat="' + w + '-' + h + '" title="' + KP_WD[w] + ' ' + kpPad(h) + ':00 — ' + v + ' رسالة"' + (v ? ' style="background:rgba(118,184,213,' + (0.18 + a * 0.82).toFixed(2) + ')"' : '') + '></span>';
    }
  }
  var top = r.hours.map(function (n, i) { return { h: i, n: n }; }).filter(function (x) { return x.n; }).sort(function (a, b) { return b.n - a.n || a.h - b.h; }).slice(0, 3);
  return '<div class="wkp-heat" role="img" aria-label="أوقات الذروة حسب اليوم والساعة">' + s + '</div>' +
    '<p class="wkp-foot" data-peak>' + (top.length ? 'أكتر ساعات زحمة: ' + top.map(function (x) { return kpPad(x.h) + ':00 (' + x.n + ')'; }).join('، ') : 'مفيش رسائل عملاء في الفترة دي.') + '</p>';
}
function kpPageHtml() {
  var presets = [['today', 'اليوم'], ['7d', '7 أيام'], ['30d', '30 يوم'], ['custom', 'مخصص']], seg = '';
  presets.forEach(function (p) { seg += '<button type="button" data-kp-preset="' + p[0] + '" aria-pressed="' + (KPW.preset === p[0]) + '">' + p[1] + '</button>'; });
  var head = '<div class="wkp-head"><button type="button" class="wkp-btn" data-kp-back aria-label="رجوع">→ رجوع</button><h1>مؤشرات واتساب<small>بتوقيت القاهرة • قراءة فقط</small></h1><button type="button" class="wkp-btn" data-kp-reload aria-label="تحديث">↻</button></div>' +
    '<div class="wkp-filter"><div class="wkp-seg" role="group" aria-label="الفترة">' + seg + '</div>' +
    '<div class="wkp-dates"' + (KPW.preset === 'custom' ? '' : ' hidden') + '><label>من <input type="date" data-kp-from value="' + kpEsc(KPW.fromKey) + '"></label><label>إلى <input type="date" data-kp-to value="' + kpEsc(KPW.toKey) + '"></label></div></div>';
  if (!KPW.data) return '<div class="wkp">' + head + '<div class="wkp-msg' + (KPW.err ? ' err' : '') + '" role="status">' + (KPW.err ? kpEsc(KPW.err) : 'جارٍ تحميل المؤشرات…') + '</div></div>';
  var now = Date.now(), rg = kpRange(KPW.preset, now, KPW.fromKey, KPW.toKey), r = kpCompute(KPW.data, { from: rg.from, to: rg.to, now: now }), hl = kpHeadline(KPW.data, now);
  var label = KPW.preset === 'today' ? 'اليوم' : KPW.preset === '7d' ? 'آخر 7 أيام' : KPW.preset === '30d' ? 'آخر 30 يوم' : (kpDayKey(rg.from) + ' ← ' + kpDayKey(rg.to - 1));
  function k(cls, key, l, v, sub) { return '<div class="wkp-k' + (cls ? ' ' + cls : '') + '" data-kpi="' + key + '"><span>' + l + '</span><b>' + kpEsc(v) + '</b><i>' + kpEsc(sub || ' ') + '</i></div>'; }
  var fr = r.firstResponse;
  var out = '<div class="wkp">' + head + (KPW.err ? '<div class="wkp-msg err" role="status">' + kpEsc(KPW.err) + ' (المعروض آخر بيانات اتحملت)</div>' : '') +
    '<div class="wkp-grid" aria-label="' + kpEsc(label) + '">' +
    k('acc', 'chats', 'محادثات • ' + label, r.chats, r.inMsgs + ' رسالة من العملاء') +
    k('', 'msgs', 'رسائل • ' + label, r.msgs, 'صيدلي ' + r.staffMsgs + ' • بوت ' + r.botMsgs) +
    k(r.waitingOpen ? 'warn' : 'ok', 'waiting', 'بانتظار الرد الآن', r.waitingOpen, 'آخر 24 ساعة') +
    k('', 'avg', 'متوسط أول رد للصيدلي', kpDur(fr.avg), fr.n ? fr.n + ' رد' : 'مفيش ردود') +
    k('', 'median', 'وسيط أول رد للصيدلي', kpDur(fr.median), 'نص الردود أسرع من كده') +
    k('', 'media', 'وسائط', r.mediaTotal, 'صور وصوت وملفات') + '</div>';
  var t = hl.today, y = hl.yesterday;
  out += '<div class="wkp-two"><section class="wkp-sec" data-sec="today"><h2>النهارده مقابل امبارح</h2><div class="wkp-tv">' +
    '<div data-tv="chats"><span>محادثات</span><b>' + t.chats + '</b><em>أمس ' + y.chats + '</em></div>' +
    '<div data-tv="msgs"><span>رسائل</span><b>' + t.msgs + '</b><em>أمس ' + y.msgs + '</em></div>' +
    '<div data-tv="avg"><span>متوسط أول رد</span><b>' + kpDur(t.firstResponse.avg) + '</b><em>أمس ' + kpDur(y.firstResponse.avg) + '</em></div>' +
    '<div data-tv="median"><span>وسيط أول رد</span><b>' + kpDur(t.firstResponse.median) + '</b><em>أمس ' + kpDur(y.firstResponse.median) + '</em></div></div></section>' +
    '<section class="wkp-sec" data-sec="trend"><h2>الاتجاه<div class="wkp-seg sm" role="group" aria-label="مدة الاتجاه"><button type="button" data-kp-trend="7" aria-pressed="' + (KPW.trendN === 7) + '">7 أيام</button><button type="button" data-kp-trend="30" aria-pressed="' + (KPW.trendN === 30) + '">30 يوم</button></div></h2>' + kpTrendHtml(KPW.trendN) + '</section></div>';
  KPW.wait = r.waiting;
  var wl = r.waiting.slice(0, 50).map(function (w) {
    return '<li><button type="button" class="' + (w.open ? 'open' : 'closed') + '" data-kp-chat="' + kpEsc(w.c) + '"><span class="n">' + kpEsc(w.name) + '<span class="s">' + (w.open ? 'مستني من ' + kpClockStr(w.t) : 'عدّت 24 ساعة — واتساب مش هيسمح بالرد لحد ما يكتب تاني') + '</span></span><span class="d" data-wait-dur>' + kpDur(w.d) + '</span></button></li>';
  }).join('');
  out += '<section class="wkp-sec" data-sec="waiting"><h2>بانتظار الرد<small>' + r.waitingOpen + ' مفتوحة • ' + (r.waiting.length - r.waitingOpen) + ' قديمة • اضغط لفتح المحادثة</small></h2>' +
    (wl ? '<ul class="wkp-wait">' + wl + '</ul>' : '<p class="wkp-foot">مفيش عملاء مستنيين رد. 👏</p>') + '</section>';
  out += '<section class="wkp-sec" data-sec="heat"><h2>أوقات الذروة<small>رسائل العملاء • ' + kpEsc(label) + '</small></h2>' + kpHeatHtml(r) + '</section>';
  var c = r.customers, np = c.total ? Math.round(c.newC / c.total * 100) : 0;
  var sMax = 1; r.staff.forEach(function (x) { sMax = Math.max(sMax, x.n); }); sMax = Math.max(sMax, r.botMsgs);
  var staff = r.staff.map(function (x) { return '<div class="wkp-bar" data-staff="' + kpEsc(x.name) + '"><span class="l">' + kpEsc(x.name || 'صيدلي (بدون اسم)') + '</span><span class="t"><i style="width:' + Math.round(x.n / sMax * 100) + '%"></i></span><span class="v">' + x.n + '</span></div>'; }).join('');
  if (r.botMsgs) staff += '<div class="wkp-bar bot" data-staff-bot><span class="l">البوت (للمقارنة)</span><span class="t"><i style="width:' + Math.round(r.botMsgs / sMax * 100) + '%"></i></span><span class="v">' + r.botMsgs + '</span></div>';
  out += '<div class="wkp-two"><section class="wkp-sec" data-sec="customers"><h2>عملاء جدد وعائدين<small>' + kpEsc(label) + '</small></h2>' +
    '<div class="wkp-tv"><div data-cust="new"><span>جدد</span><b>' + c.newC + '</b></div><div data-cust="ret"><span>عائدين</span><b>' + c.returning + '</b></div></div>' +
    '<div class="wkp-split" role="img" aria-label="جدد ' + np + '٪"><i style="width:' + np + '%;background:#60b99b"></i><i style="width:' + (c.total ? 100 - np : 0) + '%;background:#76b8d5"></i></div>' +
    '<p class="wkp-foot">جديد = أول رسالة ليه في الفترة دي. عائد = كتب قبل كده.</p></section>' +
    '<section class="wkp-sec" data-sec="staff"><h2>ردود كل صيدلي<small>' + r.staffMsgs + ' رد</small></h2>' + (staff ? '<div class="wkp-bars">' + staff + '</div>' : '<p class="wkp-foot">مفيش ردود في الفترة دي.</p>') + '</section></div>';
  out += '<section class="wkp-sec" data-sec="media"><h2>الوسائط<small>' + r.mediaTotal + ' • ' + kpEsc(label) + '</small></h2><div class="wkp-chips">' +
    KP_MEDIA.map(function (m) { return '<span class="wkp-chip" data-media="' + m[0] + '">' + m[1] + '<b>' + (r.media[m[0]] || 0) + '</b></span>'; }).join('') + '</div></section>';
  out += '<ul class="wkp-foot"><li>أول رد = الوقت من أول رسالة للعميل مستنية لحد أول رد من الصيدلي (ردود البوت مش محسوبة).</li><li>بانتظار الرد = آخر رسالة في المحادثة من العميل. المفتوحة = أقل من 24 ساعة.</li><li>آخر تحديث ' + kpClockStr(KPW.at) + '.</li></ul></div>';
  return out;
}
function kpClockStr(t) { var p = kpParts(t); return kpPad(p.h) + ':' + kpPad(p.mi); }
var kpCardEl = null, kpViewEl = null, kpLastFocus = null;
function kpPaint() {
  if (kpCardEl) kpCardEl.innerHTML = kpCardHtml();
  if (kpViewEl && KPW.open) {
    var f = document.activeElement, sel = f && kpViewEl.contains(f) ? (f.getAttribute('data-kp-preset') ? '[data-kp-preset="' + f.getAttribute('data-kp-preset') + '"]' : f.getAttribute('data-kp-trend') ? '[data-kp-trend="' + f.getAttribute('data-kp-trend') + '"]' : f.hasAttribute('data-kp-from') ? '[data-kp-from]' : f.hasAttribute('data-kp-to') ? '[data-kp-to]' : f.hasAttribute('data-kp-reload') ? '[data-kp-reload]' : null) : null;
    var st = kpViewEl.scrollTop;
    kpViewEl.innerHTML = kpPageHtml(); kpViewEl.scrollTop = st;
    if (sel) { var n = kpViewEl.querySelector(sel); if (n) try { n.focus({ preventScroll: true }); } catch (e) { n.focus(); } }
  }
}
function kpOpenPage() {
  if (!kpViewEl) return;
  kpLastFocus = document.activeElement;
  KPW.open = true; kpViewEl.hidden = false; kpViewEl.scrollTop = 0;
  try { document.documentElement.style.overflow = 'hidden'; } catch (e) { }
  kpPaint(); kpLoad(true);
  var b = kpViewEl.querySelector('[data-kp-back]'); if (b) b.focus();
}
function kpClosePage(noFocus) {
  if (!kpViewEl) return;
  KPW.open = false; kpViewEl.hidden = true;
  try { document.documentElement.style.overflow = ''; } catch (e) { }
  if (!noFocus && kpLastFocus && kpLastFocus.focus) try { kpLastFocus.focus(); } catch (e) { }
  kpPaint();
}
// Open one chat in المحادثات exactly like a pharmacist tap: show the inbox, then click that row. Sends nothing.
function kpOpenChat(id) {
  kpClosePage(true);
  var btn = document.getElementById('novaWaBtn') || document.querySelector('[data-wa-inbox-open]');
  if (!btn) return;
  btn.click();
  var tries = 0;
  (function look() {
    var box = document.getElementById('novaInboxView'), row = null;
    if (box) { var rows = box.querySelectorAll('[data-conv]'); for (var i = 0; i < rows.length; i++) if (rows[i].getAttribute('data-conv') === id) { row = rows[i]; break; } }
    if (row) { row.click(); return; }
    if (++tries < 60) setTimeout(look, 200);
  })();
}
function kpInit() {
  var ws = document.querySelector('.pos-root .main-workspace');
  if (ws && !document.getElementById('novaWaKpiCard')) {
    kpCardEl = document.createElement('button');
    kpCardEl.type = 'button'; kpCardEl.id = 'novaWaKpiCard'; kpCardEl.dir = 'rtl';
    kpCardEl.setAttribute('aria-label', 'مؤشرات واتساب النهارده — افتح صفحة المؤشرات');
    var hdr = ws.querySelector('.top-header');
    if (hdr && hdr.parentNode === ws) ws.insertBefore(kpCardEl, hdr.nextSibling); else ws.insertBefore(kpCardEl, ws.firstChild);
    kpCardEl.addEventListener('click', kpOpenPage);
  }
  if (!document.getElementById('novaWaKpiView')) {
    kpViewEl = document.createElement('div');
    kpViewEl.id = 'novaWaKpiView'; kpViewEl.dir = 'rtl'; kpViewEl.hidden = true;
    kpViewEl.setAttribute('role', 'dialog'); kpViewEl.setAttribute('aria-modal', 'true'); kpViewEl.setAttribute('aria-label', 'مؤشرات واتساب');
    document.body.appendChild(kpViewEl);
    kpViewEl.addEventListener('click', function (e) {
      var t = e.target;
      if (t.closest('[data-kp-back]')) { kpClosePage(); return; }
      if (t.closest('[data-kp-reload]')) { kpLoad(true); return; }
      var p = t.closest('[data-kp-preset]');
      if (p) {
        KPW.preset = p.getAttribute('data-kp-preset');
        if (KPW.preset === 'custom' && !KPW.fromKey) { var tk = kpDayKey(Date.now()); KPW.fromKey = kpDayKey(kpDaysBack(Date.now(), 7)); KPW.toKey = tk; }
        kpPaint(); return;
      }
      var tr = t.closest('[data-kp-trend]'); if (tr) { KPW.trendN = +tr.getAttribute('data-kp-trend') === 30 ? 30 : 7; kpPaint(); return; }
      var ch = t.closest('[data-kp-chat]'); if (ch) { kpOpenChat(ch.getAttribute('data-kp-chat')); }
    });
    kpViewEl.addEventListener('change', function (e) {
      var t = e.target;
      if (t.hasAttribute('data-kp-from')) { KPW.fromKey = t.value; KPW.preset = 'custom'; kpPaint(); }
      else if (t.hasAttribute('data-kp-to')) { KPW.toKey = t.value; KPW.preset = 'custom'; kpPaint(); }
    });
    kpViewEl.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); kpClosePage(); } });
  }
  kpPaint();
  if (kpAuto()) {
    setTimeout(function () { kpLoad(false); }, 1200);
    setInterval(function () { if (document.visibilityState === 'visible' && kpCardEl && kpCardEl.offsetParent && !KPW.open) kpLoad(true); }, 300000);
  }
  window.novaWaKpis = { open: kpOpenPage, close: kpClosePage, reload: function () { kpLoad(true); } };
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kpInit); else kpInit();
