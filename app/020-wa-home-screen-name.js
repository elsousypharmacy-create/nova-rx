
  /* UX409/UX412: /whatsapp and /?app=whatsapp Add to Home Screen use the name and icon "NOVA WhatsApp". The main app keeps /manifest.webmanifest (NOVA Rx). */
  (function(){try{
    var path=(location.pathname||'').replace(/\/+$/,'')||'/';
    var marked=path==='/whatsapp'||path==='/wa'||new URLSearchParams(location.search).get('app')==='whatsapp';
    var standalone=!!((window.navigator&&window.navigator.standalone)||(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches));
    if(!marked)return;
    if(standalone){try{sessionStorage.setItem('nova.wa.standalone','1')}catch(e){}}
  }catch(e){return}
  document.documentElement.classList.add('app-whatsapp');window.NOVA_APP='whatsapp';
  document.title='NOVA WhatsApp';
  function set(sel,a,v){var el=document.querySelector(sel);if(el)el.setAttribute(a,v)}
  set('meta[name=apple-mobile-web-app-title]','content','NOVA WhatsApp');
  set('meta[name=application-name]','content','NOVA WhatsApp');
  set('link[rel=manifest]','href','/manifest-whatsapp.webmanifest?v=2');
  set('link[rel="apple-touch-icon"]','href','/icons/nova-whatsapp-180.png');
  var ic=document.querySelector('link[rel="icon"]');if(ic){ic.setAttribute('href','/icons/nova-whatsapp-192.png');ic.setAttribute('type','image/png')}
  set('meta[name=theme-color]','content','#14171c');
  /* UX413: in standalone iOS, 100dvh is often shorter than the screen (black-translucent + viewport-fit=cover),
     and max-height:100dvh then leaves a near-black #050607 gap under the list. Size the shell to window.innerHeight. */
  function fit(){var h=window.innerHeight||0;try{var c=document.documentElement.clientHeight;if(c>h)h=c}catch(e){}
  /* owner's iPhone (home-screen app, black-translucent): innerHeight and clientHeight are 47pt shorter than the screen, which left a band under the composer. Portrait standalone only, and only when the gap is plausible (<=120). */
  try{var st=navigator.standalone===true||(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches);if(st&&window.innerHeight>=window.innerWidth){var sh=Math.max(window.screen.height||0,window.screen.width||0);if(sh>h&&sh-h<=120)h=sh}}catch(e){}
  if(h)document.documentElement.style.setProperty('--wa-app-h',h+'px')}
  window.NovaWaFitAppHeight=fit;fit();
  window.addEventListener('resize',fit);window.addEventListener('orientationchange',fit);window.addEventListener('pageshow',fit);
  })();
  