(function(){
 if(window.__novaInfoTips)return;window.__novaInfoTips=1;
 var HEAD='h1,h2,h3,h4';
 function tipBtn(host){var b=host.nextElementSibling;if(!(b&&b.classList&&b.classList.contains('nx-i'))){b=document.createElement('button');b.type='button';b.className='nx-i';b.setAttribute('aria-label',(function(){try{return localStorage.getItem('nova-rx-language')==='en'?'Info':'توضيح'}catch(e){return 'توضيح'}})());b.textContent='i';host.insertAdjacentElement('afterend',b)}return b}
 function setTip(b,t){if(b.getAttribute('data-tip')!==t)b.setAttribute('data-tip',t)}
 function prevHost(s){var h=s.previousElementSibling;while(h&&h.classList&&h.classList.contains('nx-i'))h=h.previousElementSibling;return h}
 function eligible(p){return p&&!p.id&&!p.querySelector('button,a,input,select')&&!p.closest('.nova-notice,.nova-stock-notice,[role=alert],dialog')&&(p.textContent||'').trim().length>0&&(p.textContent||'').indexOf('الفترة:')<0}
 function scan(){
  /* page subtitles: <h1>Title</h1><p>explanation</p> */
  document.querySelectorAll('.nova-page-header h1,.nova-page-header h2').forEach(function(h){var p=h.nextElementSibling;if(p&&p.tagName==='P'&&eligible(p)){p.classList.add('nx-src');setTip(tipBtn(h),p.textContent.trim())}});
  /* settings cards: heading followed by explanatory paragraphs */
  document.querySelectorAll('.nova-setting-card').forEach(function(c){var h=c.querySelector(':scope > h2,:scope > h3,:scope > h4');if(!h)return;var ps=[].filter.call(c.querySelectorAll(':scope > p'),eligible);if(!ps.length)return;ps.forEach(function(p){p.classList.add('nx-src')});setTip(tipBtn(h),ps.map(function(p){return p.textContent.trim()}).join('\n'))});
  /* sale screen: small helper lines */
  document.querySelectorAll('.discount-title > span:nth-child(2),.discount-title > span.nx-src').forEach(function(s){var h=prevHost(s);if(h&&(s.textContent||'').trim()){s.classList.add('nx-src');setTip(tipBtn(h),s.textContent.trim())}});
  document.querySelectorAll('.nova-auth-help').forEach(function(s){var h=s.parentElement&&s.parentElement.querySelector('h2,h3,h4,strong');if(h&&(s.textContent||'').trim()){s.classList.add('nx-src');setTip(tipBtn(h),s.textContent.trim())}});
  document.querySelectorAll('.customer-empty-sub').forEach(function(s){var h=prevHost(s);if(h&&h.tagName!=='svg'&&(s.textContent||'').trim()){s.classList.add('nx-src');setTip(tipBtn(h),s.textContent.trim())}});
 }
 var t=0;function later(){clearTimeout(t);t=setTimeout(scan,120)}
 function start(){scan();try{new MutationObserver(later).observe(document.body||document.documentElement,{childList:true,subtree:true,characterData:true})}catch(e){}}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();