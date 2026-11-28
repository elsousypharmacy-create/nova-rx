(function(){
 var SECS=[
  ['general','عام','General'],
  ['setup','تجهيز الصيدلية','Pharmacy setup'],
  ['accounts','الحسابات والصلاحيات','Accounts and permissions'],
  ['devices','الطابعات والأجهزة','Printers and devices'],
  ['stock','التشغيلات والصلاحية','Lots and expiry'],
  ['suppliers','الموردين','Suppliers'],
  ['sync','الربط والمفاتيح','Connection and keys'],
  ['about','عن النظام','About']
 ];
 function isEn(){try{return localStorage.getItem('nova-rx-language')==='en'}catch(e){return document.documentElement.lang==='en'}}
 function T(ar,en){return isEn()?en:ar}
 function norm(s){return (window.novaNormAr?window.novaNormAr(s):String(s||'').toLowerCase()).trim()}
 function secOf(c){var id=c.id,h=((c.querySelector('h2,h3,h4')||{}).textContent)||'';
  if(id==='novaSetupCard'||id==='novaOnboardingCard')return 'setup';
  if(id==='novaAuthCard')return 'accounts';if(id==='novaDevicesCard')return 'devices';if(id==='novaAboutCard')return 'about';
  if(id==='novaBackendCard'||/API|التكاملات|Integrations/i.test(h))return 'sync';
  if(id==='novaPharmacyProfileCard'||id==='novaSaleSettingsCard'||id==='novaOffersCard'||id==='novaFullBackupCard'||c.querySelector('.nova-lang-switch')||/ضريبة|VAT|Tax/i.test(h))return 'general';
  if(/التشغيلات|الصلاحية|Lots|Expiry/i.test(h))return 'stock';if(/الموردين|Suppliers/i.test(h))return 'suppliers';return 'general'}
 var activeSec='general';
 function applyView(g,nav,qStr){
  if(!g)return;
  var q=norm(qStr);
  var cards=[].filter.call(g.children,function(c){return c.classList.contains('nova-setting-card')});
  var heads=[].filter.call(g.children,function(c){return c.classList.contains('nova-set-sec')});
  if(q){
   var shownSecs={};
   cards.forEach(function(c){
    var match=norm(c.textContent).indexOf(q)>=0;
    c.classList.toggle('nova-sec-hide',!match);
    if(match)shownSecs[c.getAttribute('data-sec')]=1;
   });
   heads.forEach(function(h){
    var k=h.id.replace('set-sec-','');
    h.classList.toggle('nova-sec-hide',!shownSecs[k]);
   });
   return;
  }
  cards.forEach(function(c){
   var k=c.getAttribute('data-sec');
   c.classList.toggle('nova-sec-hide',activeSec!=='all'&&k!==activeSec);
  });
  heads.forEach(function(h){
   var k=h.id.replace('set-sec-','');
   h.classList.toggle('nova-sec-hide',activeSec!=='all'&&k!==activeSec);
  });
 }
 function enhance(){var g=document.querySelector('#novaPageView .nova-settings-grid');if(!g||g.getAttribute('data-secs'))return;g.setAttribute('data-secs','1');
  var cards=[].filter.call(g.children,function(c){return c.classList.contains('nova-setting-card')}),groups={};
  cards.forEach(function(c){var s=secOf(c);c.setAttribute('data-sec',s);(groups[s]=groups[s]||[]).push(c)});
  var wrap=document.createElement('div');wrap.className='nova-set-layout';g.parentNode.insertBefore(wrap,g);
  var rail=document.createElement('div');rail.className='nova-set-rail';
  var swrap=document.createElement('div');swrap.className='nova-set-search-wrap';
  var sinp=document.createElement('input');sinp.type='search';sinp.id='novaSetSearch';sinp.className='nova-page-search';
  sinp.placeholder=T('ابحث في الإعدادات…','Search settings…');
  sinp.setAttribute('aria-label',T('ابحث في الإعدادات','Search settings'));
  swrap.appendChild(sinp);
  var nav=document.createElement('nav');nav.className='nova-set-nav';nav.setAttribute('aria-label',T('أقسام الإعدادات','Settings sections'));
  SECS.forEach(function(s){var k=s[0];if(!groups[k])return;var hd=document.createElement('h2');hd.className='nova-set-sec';hd.id='set-sec-'+k;hd.textContent=T(s[1],s[2]);g.appendChild(hd);groups[k].forEach(function(c){g.appendChild(c)});
   var a=document.createElement('a');a.href='#set-sec-'+k;a.setAttribute('data-set-sec',k);a.textContent=T(s[1],s[2]);nav.appendChild(a)});
  var allLink=document.createElement('a');allLink.href='#set-sec-all';allLink.setAttribute('data-set-sec','all');allLink.textContent=T('عرض كل الأقسام','All sections');nav.appendChild(allLink);
  rail.appendChild(swrap);rail.appendChild(nav);
  wrap.appendChild(rail);wrap.appendChild(g);
  if(!SECS.some(function(s){return s[0]===activeSec&&groups[s[0]]}))activeSec=groups.general?'general':(SECS.find(function(s){return groups[s[0]]})||['all'])[0];
  var curLink=nav.querySelector('[data-set-sec="'+activeSec+'"]')||nav.firstChild;
  if(curLink)curLink.setAttribute('aria-current','true');
  sinp.addEventListener('input',function(){applyView(g,nav,sinp.value)});
  nav.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('[data-set-sec]');if(!a)return;e.preventDefault();
   activeSec=a.getAttribute('data-set-sec')||'general';
   if(sinp.value)sinp.value='';
   [].forEach.call(nav.querySelectorAll('[data-set-sec]'),function(x){x.removeAttribute('aria-current')});a.setAttribute('aria-current','true');try{a.scrollIntoView({inline:'nearest',block:'nearest'})}catch(_){}
   applyView(g,nav,'');
   var sc=document.getElementById('novaPageView');if(sc)sc.scrollTo({top:0});
   var t=activeSec==='all'?g.querySelector('.nova-set-sec'):document.getElementById('set-sec-'+activeSec);if(t){t.setAttribute('tabindex','-1');t.focus({preventScroll:true})}
  });
  applyView(g,nav,'');
 }
 function place(){var g=document.querySelector('#novaPageView .nova-settings-grid[data-secs]');if(!g)return;var nav=document.querySelector('#novaPageView .nova-set-nav'),allLink=nav&&nav.querySelector('[data-set-sec="all"]');
  [].forEach.call(g.children,function(c){if(!c.classList.contains('nova-setting-card')||c.getAttribute('data-sec'))return;var k=secOf(c);c.setAttribute('data-sec',k);
   var hd=document.getElementById('set-sec-'+k);
   if(!hd){var idx=-1;SECS.forEach(function(s,i){if(s[0]===k)idx=i});hd=document.createElement('h2');hd.className='nova-set-sec';hd.id='set-sec-'+k;hd.textContent=T(SECS[idx][1],SECS[idx][2]);
    var next=null;for(var i=idx+1;i<SECS.length&&!next;i++)next=document.getElementById('set-sec-'+SECS[i][0]);g.insertBefore(hd,next);g.insertBefore(c,next);
    if(nav){var a=document.createElement('a');a.href='#set-sec-'+k;a.setAttribute('data-set-sec',k);a.textContent=T(SECS[idx][1],SECS[idx][2]);var na=null;for(var j=idx+1;j<SECS.length&&!na;j++)na=nav.querySelector('[data-set-sec="'+SECS[j][0]+'"]');nav.insertBefore(a,na||allLink)}
   }else{var end=hd.nextElementSibling;while(end&&!end.classList.contains('nova-set-sec'))end=end.nextElementSibling;g.insertBefore(c,end)}
  });
  var sinp=document.getElementById('novaSetSearch');
  applyView(g,nav,sinp?sinp.value:'');
 }
 var gObs=null;function hook(){enhance();var g=document.querySelector('#novaPageView .nova-settings-grid[data-secs]');if(!g&&gObs){gObs.disconnect();gObs=null;hook.g=null}if(g&&window.MutationObserver&&g!==hook.g){hook.g=g;if(gObs)gObs.disconnect();gObs=new MutationObserver(place);gObs.observe(g,{childList:true})}place()}
 var v=document.getElementById('novaPageView');if(v&&window.MutationObserver)new MutationObserver(hook).observe(v,{childList:true});hook();
 /* direct open on #settings: the card fillers load after the first render, so redraw once everything is loaded */
 window.addEventListener('load',function(){if(document.body.dataset.activePage!=='settings')return;var c=document.getElementById('novaAuthCard');if(c&&c.children.length)return;var tb=document.querySelector('.nova-tab[data-page=settings]');if(tb)tb.click()});
})();