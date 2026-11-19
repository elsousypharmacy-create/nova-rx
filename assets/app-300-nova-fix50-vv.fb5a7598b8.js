(function(){var vv=window.visualViewport,t=0;
/* UX407: the composer is pinned to the VISUAL viewport bottom (offsetTop + height): on iPhone the page is scrolled under the keyboard
   (visualViewport.offsetTop > 0), so sizing to height alone left an empty ~60px band. The home-indicator safe-area padding is dropped
   while typing (data-kbd), and the remaining offset is measured and corrected so the row sits flush on the keyboard like WhatsApp.
   While #waInput is focused every other form field is made unfocusable (tabindex=-1 + inert, restored on blur) so iOS has no
   prev/next targets for its form accessory bar. */
function root(){return document.querySelector('.wa-root[data-view=chat]')}
var LOCK='input,textarea,select,[contenteditable]:not([contenteditable=false])';
var mo=null;/* while locked: if the focused composer is removed (back, re-render) no focusout fires, so watch the DOM and release */
function watch(on){if(on&&!mo&&window.MutationObserver){mo=new MutationObserver(function(){var a=document.activeElement;if(!a||a.id!=='waInput'){lock(false)}});mo.observe(document.body,{childList:true,subtree:true})}else if(!on&&mo){mo.disconnect();mo=null}}
function lock(on){watch(on);var els=document.querySelectorAll(on?LOCK:'[data-wa-kbd-off]');for(var i=0;i<els.length;i++){var el=els[i];
if(on){if(el.id==='waInput'||el.hasAttribute('data-wa-kbd-off'))continue;el.setAttribute('data-wa-kbd-off',(el.hasAttribute('tabindex')?'t'+el.getAttribute('tabindex'):'-')+(el.inert?'1':'0'));el.setAttribute('tabindex','-1');el.inert=true}
else{var v=el.getAttribute('data-wa-kbd-off')||'-0';el.removeAttribute('data-wa-kbd-off');if(v.charAt(0)==='t')el.setAttribute('tabindex',v.slice(1,-1));else el.removeAttribute('tabindex');el.inert=v.slice(-1)==='1'}}}
function fit(){var r=root(),a=document.activeElement,foc=a&&a.id==='waInput';
if(!foc&&document.querySelector('[data-wa-kbd-off]'))lock(false);/* input removed while focused (back, re-render): never leave fields inert */
if(!r||!foc||innerWidth>700){if(r){r.style.removeProperty('height');r.style.removeProperty('min-height');r.style.removeProperty('flex');r.removeAttribute('data-kbd')}document.documentElement.style.removeProperty('--nova-vvh');return}
var h=vv?vv.height:innerHeight,bot=function(){return vv?(Number(vv.offsetTop)||0)+vv.height:innerHeight};document.documentElement.style.setProperty('--nova-vvh',h+'px');
r.setAttribute('data-kbd','1');
window.scrollTo(0,0);var top=Math.max(0,r.getBoundingClientRect().top);if(top>0)window.scrollBy(0,top);
top=r.getBoundingClientRect().top;var H=Math.max(220,bot()-Math.max(0,top));r.style.height=H+'px';r.style.minHeight='0';r.style.flex='0 0 auto';/* UX404: flex-grow must not stretch the chat under the keyboard */
var c=r.querySelector('[data-wa-composer]');if(c){var d=bot()-c.getBoundingClientRect().bottom;if(Math.abs(d)>0.5&&H+d>=220)r.style.height=(H+d)+'px'}/* UX407: flush, whatever sits around the root */
var m=document.getElementById('waMsgs');if(m)m.scrollTop=m.scrollHeight}
function later(){cancelAnimationFrame(t);t=requestAnimationFrame(fit)}/* UX404: follow the keyboard in the same frame (no 60ms lag/gap) */
document.addEventListener('focusin',function(e){if(e.target&&e.target.id==='waInput'){if(innerWidth<=700)lock(true);/* phone layout only: on desktop the list/search stay usable beside the chat */fit();setTimeout(fit,300)}});
document.addEventListener('focusout',function(e){if(e.target&&e.target.id==='waInput'){setTimeout(function(){var a=document.activeElement;if(!a||a.id!=='waInput')lock(false);fit()},50)}});
document.addEventListener('pointerdown',function(){var a=document.activeElement;if((!a||a.id!=='waInput')&&document.querySelector('[data-wa-kbd-off]'))lock(false)},true);
if(vv){vv.addEventListener('resize',later);vv.addEventListener('scroll',later)}})();