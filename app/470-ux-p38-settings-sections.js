(function(){
 var SECS=[['setup','تجهيز الصيدلية'],['general','عام'],['accounts','الحسابات والصلاحيات'],['devices','الطابعات والأجهزة'],['stock','التشغيلات والصلاحية'],['suppliers','الموردين'],['sync','الربط والمفاتيح'],['about','عن النظام']];
 function secOf(c){var id=c.id,h=((c.querySelector('h2,h3,h4')||{}).textContent)||'';
  if(id==='novaSetupCard'||id==='novaOnboardingCard')return 'setup';
  if(id==='novaAuthCard')return 'accounts';if(id==='novaDevicesCard')return 'devices';if(id==='novaAboutCard')return 'about';
  if(id==='novaBackendCard'||/API|التكاملات|Integrations/i.test(h))return 'sync';
  if(id==='novaPharmacyProfileCard'||id==='novaSaleSettingsCard'||id==='novaOffersCard'||id==='novaFullBackupCard'||c.querySelector('.nova-lang-switch')||/ضريبة|VAT|Tax/i.test(h))return 'general';
  if(/التشغيلات|الصلاحية|Lots|Expiry/i.test(h))return 'stock';if(/الموردين|Suppliers/i.test(h))return 'suppliers';return 'general'}
 function enhance(){var g=document.querySelector('#novaPageView .nova-settings-grid');if(!g||g.getAttribute('data-secs'))return;g.setAttribute('data-secs','1');
  var cards=[].filter.call(g.children,function(c){return c.classList.contains('nova-setting-card')}),groups={};
  cards.forEach(function(c){var s=secOf(c);c.setAttribute('data-sec',s);(groups[s]=groups[s]||[]).push(c)});
  var wrap=document.createElement('div');wrap.className='nova-set-layout';g.parentNode.insertBefore(wrap,g);
  var nav=document.createElement('nav');nav.className='nova-set-nav';nav.setAttribute('aria-label','أقسام الإعدادات');
  SECS.forEach(function(s){var k=s[0];if(!groups[k])return;var hd=document.createElement('h2');hd.className='nova-set-sec';hd.id='set-sec-'+k;hd.textContent=s[1];g.appendChild(hd);groups[k].forEach(function(c){g.appendChild(c)});
   var a=document.createElement('a');a.href='#set-sec-'+k;a.setAttribute('data-set-sec',k);a.textContent=s[1];nav.appendChild(a)});
  wrap.appendChild(nav);wrap.appendChild(g);
  if(nav.firstChild)nav.firstChild.setAttribute('aria-current','true');
  nav.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('[data-set-sec]');if(!a)return;e.preventDefault();
   [].forEach.call(nav.querySelectorAll('[data-set-sec]'),function(x){x.removeAttribute('aria-current')});a.setAttribute('aria-current','true');try{a.scrollIntoView({inline:'nearest',block:'nearest'})}catch(_){}
   var t=document.getElementById('set-sec-'+a.getAttribute('data-set-sec'));if(t){t.setAttribute('tabindex','-1');t.focus({preventScroll:true});var sc=document.getElementById('novaPageView');if(sc){var navH=getComputedStyle(nav).flexDirection==='row'?nav.offsetHeight:0;var top=t.getBoundingClientRect().top-sc.getBoundingClientRect().top+sc.scrollTop-navH-12;sc.scrollTo({top:top})}else t.scrollIntoView({block:'start'})}});
 }
 function place(){var g=document.querySelector('#novaPageView .nova-settings-grid[data-secs]');if(!g)return;var nav=g.parentNode.querySelector('.nova-set-nav');
  [].forEach.call(g.children,function(c){if(!c.classList.contains('nova-setting-card')||c.getAttribute('data-sec'))return;var k=secOf(c);c.setAttribute('data-sec',k);
   var hd=document.getElementById('set-sec-'+k);
   if(!hd){var idx=-1;SECS.forEach(function(s,i){if(s[0]===k)idx=i});hd=document.createElement('h2');hd.className='nova-set-sec';hd.id='set-sec-'+k;hd.textContent=SECS[idx][1];
    var next=null;for(var i=idx+1;i<SECS.length&&!next;i++)next=document.getElementById('set-sec-'+SECS[i][0]);g.insertBefore(hd,next);g.insertBefore(c,next);
    if(nav){var a=document.createElement('a');a.href='#set-sec-'+k;a.setAttribute('data-set-sec',k);a.textContent=SECS[idx][1];var na=null;for(var j=idx+1;j<SECS.length&&!na;j++)na=nav.querySelector('[data-set-sec="'+SECS[j][0]+'"]');nav.insertBefore(a,na)}
   }else{var end=hd.nextElementSibling;while(end&&!end.classList.contains('nova-set-sec'))end=end.nextElementSibling;g.insertBefore(c,end)}
  })}
 var gObs=null;function hook(){enhance();var g=document.querySelector('#novaPageView .nova-settings-grid[data-secs]');if(!g&&gObs){gObs.disconnect();gObs=null;hook.g=null}if(g&&window.MutationObserver&&g!==hook.g){hook.g=g;if(gObs)gObs.disconnect();gObs=new MutationObserver(place);gObs.observe(g,{childList:true})}place()}
 var v=document.getElementById('novaPageView');if(v&&window.MutationObserver)new MutationObserver(hook).observe(v,{childList:true});hook();
 /* direct open on #settings: the card fillers load after the first render, so redraw once everything is loaded */
 window.addEventListener('load',function(){if(document.body.dataset.activePage!=='settings')return;var c=document.getElementById('novaAuthCard');if(c&&c.children.length)return;var tb=document.querySelector('.nova-tab[data-page=settings]');if(tb)tb.click()});
})();