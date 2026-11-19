
/* SALE-01: one-device switch for the production backend (nova-rx-api). DEFAULT OFF. The flag is per device
   (localStorage novaBackend.enabled); nothing in the HTML turns it on. OFF => the app stays fully local and this card makes
   no network call. ON => inbox/auto-reply calls use novaBackend.url (https override) or production nova-rx-api.
   The access key is kept in sessionStorage only (gone when the tab closes), never shown back, never logged. */
(function(){'use strict';
var PROD='https://nova-rx-api.elsousypharmacy.workers.dev',KE='novaBackend.enabled',KU='novaBackend.url',KT='novaBackend.token';
function L(){try{return localStorage}catch(e){return null}}function S(){try{return sessionStorage}catch(e){return null}}
function get(st,k){try{return st?st.getItem(k):null}catch(e){return null}}
function cfg(){var on=get(L(),KE)==='true';if(!on)return{enabled:false,baseUrl:'',hasToken:false,production:false};var u=String(get(L(),KU)||'').trim();if(!/^https:\/\/[^\s/]+/i.test(u))u=PROD;u=u.replace(/\/+$/,'');return{enabled:true,baseUrl:u,hasToken:!!get(S(),KT),production:u===PROD}}
function setEnabled(v){var l=L();if(!l)return;try{if(v)l.setItem(KE,'true');else{l.removeItem(KE);var s=S();if(s)s.removeItem(KT)}}catch(e){}}
function setToken(t){var s=S();if(!s)return;try{t=String(t||'').trim();if(t)s.setItem(KT,t);else s.removeItem(KT)}catch(e){}}
function tr(a,e){try{return localStorage.getItem('nova-rx-language')==='en'?e:a}catch(x){return a}}
function esc(x){return String(x==null?'':x).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function mount(el){if(!el)return;var c=cfg();
el.innerHTML='<h3>'+tr('الربط بالسيرفر (جهاز واحد)','Server link (one device)')+'</h3>'
+'<p id="novaBackendState" data-state="'+(c.enabled?'on':'off')+'">'+(c.enabled?tr('مفعّل على هذا الجهاز فقط. السيرفر: ','On for this device only. Server: ')+'<bdi dir="ltr">'+esc(c.baseUrl)+'</bdi>'+(c.production?tr(' (الإنتاج)',' (production)'):''):tr('مقفول (الافتراضي): البيع والفواتير على هذا الجهاز فقط، ومفيش اتصال بالسيرفر.','Off (default): sales and invoices stay on this device; no server calls.'))+'</p>'
+'<p>'+tr('يتفعّل على جهاز المالك فقط بعد موافقته. البيع المحلي يفضل شغال زي ما هو في الحالتين.','Enable on the owner device only, with his approval. Local selling keeps working either way.')+'</p>'
+'<div class="nova-vat-row"><button type="button" class="nova-page-btn" id="novaBackendToggle" style="min-height:44px">'+(c.enabled?tr('إيقاف الربط','Turn off'):tr('تفعيل على هذا الجهاز','Turn on for this device'))+'</button></div>'
+(c.enabled?'<p id="novaBackendTokenState">'+(c.hasToken?tr('مفتاح الدخول: محفوظ للجلسة دي بس (يتمسح لما تقفل التبويب).','Access key: kept for this session only.'):tr('مفتاح الدخول: مش متسجل. من غيره السيرفر هيرفض الطلبات.','Access key: not set; the server will refuse requests.'))+'</p>'
+'<div class="nova-vat-row"><input id="novaBackendToken" class="nova-field" type="password" autocomplete="off" spellcheck="false" dir="ltr" value="" style="min-height:44px" aria-label="'+tr('مفتاح الدخول للجلسة','Session access key')+'" placeholder="'+tr('مفتاح الدخول','Access key')+'"><button type="button" class="nova-page-btn" id="novaBackendTokenSave" style="min-height:44px">'+tr('حفظ للجلسة','Save for session')+'</button></div>':'');
var b=el.querySelector('#novaBackendToggle');if(b)b.onclick=function(){if(!cfg().enabled){if(typeof confirm==='function'&&!confirm(tr('تفعيل الربط بسيرفر الإنتاج على هذا الجهاز فقط؟','Turn on the production server link for this device only?')))return;setEnabled(true)}else setEnabled(false);mount(el)};
var sv=el.querySelector('#novaBackendTokenSave'),ti=el.querySelector('#novaBackendToken');if(sv&&ti)sv.onclick=function(){setToken(ti.value);ti.value='';mount(el)}}
window.novaBackendFlag={PRODUCTION_URL:PROD,config:cfg,setEnabled:setEnabled,setToken:setToken,mount:mount};
})();
