/* UX40: one inline SVG sprite (stroke 1.75, currentColor, 16px default, 20px in headings).
   Replaces emoji/text glyphs in buttons and headings (static and dynamic) with <svg><use>. */
(function () {
  if (window.NovaIcons) return;
  var P = {
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    sparkle: '<path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z"/><path d="M19 3v4M17 5h4"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
    printer: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v6H7z"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.2v.1"/>'
  };
  var MAP = { '✦': 'sparkle', '✕': 'x', '✓': 'check', '🔐': 'lock', '⚙️': 'gear', '⚙': 'gear', '🖨️': 'printer', '🖨': 'printer', '👁️': 'eye', '👁': 'eye', '↻': 'refresh', '⚠️': 'warn', '⚠': 'warn' };
  var RE = /(⚙️|🖨️|👁️|⚠️|[✦✕✓🔐⚙🖨👁↻⚠])️?/u;
  var SEL = 'button,a.btn,summary,.btn,h1,h2,h3,h4,[role=button]';
  function svg(name) { return '<svg class="nova-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#nico-' + name + '"/></svg>'; }
  function sprite() {
    if (document.getElementById('novaIconSprite') || !document.body) return;
    var s = '<svg id="novaIconSprite" xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">';
    for (var k in P) s += '<symbol id="nico-' + k + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + P[k] + '</symbol>';
    var d = document.createElement('div'); d.innerHTML = s + '</svg>'; document.body.insertBefore(d.firstChild, document.body.firstChild);
  }
  function fix(root) {
    if (!root || !root.nodeType) return;
    var host = root.nodeType === 1 ? root : root.parentElement;
    if (!host) return;
    var els = [];
    if (host.matches && host.matches(SEL)) els.push(host);
    else if (host.closest) { var c = host.closest(SEL); if (c) els.push(c); }
    if (host.querySelectorAll) els.push.apply(els, host.querySelectorAll(SEL));
    els.forEach(function (el) {
      var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), hits = [], n;
      while ((n = w.nextNode())) { if (RE.test(n.nodeValue) && !(n.parentElement && n.parentElement.closest('script,style,svg,textarea'))) hits.push(n); }
      hits.forEach(function (t) {
        var parts = t.nodeValue.split(new RegExp(RE.source, 'gu')), frag = document.createDocumentFragment(), only = !t.nodeValue.replace(new RegExp(RE.source, 'gu'), '').trim();
        for (var i = 0; i < parts.length; i++) {
          if (i % 2) { var tmp = document.createElement('span'); tmp.innerHTML = svg(MAP[parts[i]] || 'x'); frag.appendChild(tmp.firstChild); if (only && el.getAttribute && !el.getAttribute('aria-label') && !el.getAttribute('title')) el.setAttribute('aria-label', parts[i] === '✕' ? 'إغلاق' : 'icon'); }
          else if (parts[i]) frag.appendChild(document.createTextNode(parts[i]));
        }
        t.parentNode.replaceChild(frag, t);
      });
    });
  }
  function start() {
    sprite(); fix(document.body);
    new MutationObserver(function (ms) { ms.forEach(function (m) { if (m.type === 'characterData') fix(m.target); else m.addedNodes.forEach(function (a) { if (a.nodeType === 1 || a.nodeType === 3) fix(a); }); }); })
      .observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  window.NovaIcons = { fix: fix, names: Object.keys(P) };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
