
/* SALE-06: «تجهيز صيدلية جديدة (تجريبي)». Sale-readiness shell, NOT billing: no plans, no prices, no payment method.
   DEFAULT OFF: per-device flag localStorage novaOnboarding.enabled === 'true' (nothing in the HTML turns it on).
   OFF => the Settings card stays hidden and empty, and this script makes no network call at all.
   ON  => mode 'api' only if the SALE-01 backend flag is ON and a session access key exists: calls the existing N121
          routes /api/v1/onboarding/* (server flag NOVA_ONBOARDING, owner role). Otherwise mode 'local': fake data kept on
          this device only (no network). Rollback = soft-disable (status disabled; nothing is deleted). Passwords are sent
          once in the request body (api) and never stored, shown back or logged. */
(function(){'use strict';
var KE='novaOnboarding.enabled',KL='novaOnboarding.local',KLAST='novaOnboarding.last',P='/api/v1/onboarding/';
var ID_RE=/^[a-z0-9][a-z0-9-]{2,39}$/,USER_RE=/^[a-z0-9._-]{3,40}$/i;
var STEPS=['tenant','branches','owner','roles','import'];
var STEP_AR={tenant:'الصيدلية',branches:'الفروع',owner:'المالك',roles:'الصلاحيات',import:'استيراد البيانات'};
var ST_AR={done:'تم',pending:'لسه',skipped:'متخطّى'};
var SEED=['باراسيتامول 500 مجم','أموكسيسيلين 500 مجم','فيتامين د 1000'];
function L(){try{return localStorage}catch(e){return null}}
function get(k){try{var l=L();return l?l.getItem(k):null}catch(e){return null}}
function put(k,v){try{var l=L();if(!l)return;if(v==null)l.removeItem(k);else l.setItem(k,v)}catch(e){}}
function enabled(){return get(KE)==='true'}
function setEnabled(v){put(KE,v?'true':null)}
function token(){try{return sessionStorage.getItem('novaBackend.token')||''}catch(e){return ''}}
function backend(){try{var f=window.novaBackendFlag,c=f&&f.config?f.config():null;return c&&c.enabled&&c.baseUrl?c:null}catch(e){return null}}
function mode(){if(!enabled())return 'off';var b=backend();return b&&b.hasToken&&token()&&typeof fetch==='function'?'api':'local'}
function esc(x){return String(x==null?'':x).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function fail(code,m){return{ok:false,code:code,message_ar:m}}
function off(){return Promise.resolve(fail('ONBOARDING_OFF','الشاشة مقفولة على هذا الجهاز.'))}
/* Same rules as backend/src/onboarding.js createTenant, checked before any call. */
function validate(i){i=i||{};var id=String(i.tenantId||'').trim().toLowerCase(),name=String(i.name||'').trim();
var br=String(i.branches==null?'':i.branches).split(/[,،\n]/).map(function(s){return s.trim()}).filter(Boolean);
var u=String(i.username||'').trim(),pw=String(i.password||'');
if(!ID_RE.test(id))return fail('ONBOARDING_BAD_TENANT','معرّف الصيدلية: حروف إنجليزية صغيرة وأرقام و- (3 إلى 40).');
if(!name)return fail('ONBOARDING_BAD_NAME','اسم الصيدلية مطلوب.');
var seen={},dup=false;br.forEach(function(b){if(seen[b])dup=true;seen[b]=1});
if(!br.length||dup)return fail('ONBOARDING_BAD_BRANCHES','يلزم فرع واحد على الأقل بأسماء غير مكررة.');
if(!USER_RE.test(u)||pw.length<8)return fail('ONBOARDING_BAD_OWNER','بيانات المالك غير صالحة (اسم مستخدم 3+ وكلمة مرور 8+).');
return{ok:true,body:{tenantId:id,name:name,branches:br,owner:{username:u,password:pw,displayName:String(i.displayName||'').trim()||null}}}}
function api(method,path,body){if(mode()!=='api')return off();var b=backend();
var o={method:method,headers:{Accept:'application/json',Authorization:'Bearer '+token()}};
if(body){o.headers['Content-Type']='application/json';o.body=JSON.stringify(body)}
return fetch(b.baseUrl+P+path,o).then(function(r){return r.json().catch(function(){return null}).then(function(j){
if(r.ok&&j&&j.ok)return j;
if(r.status===404&&(!j||!j.code||j.code==='ONBOARDING_DISABLED'))return fail('ONBOARDING_DISABLED','الميزة مقفولة على السيرفر (NOVA_ONBOARDING). تفعيلها قرار المالك.');
return fail(j&&j.code||('HTTP_'+r.status),j&&j.message_ar||'تعذّر تنفيذ العملية على السيرفر.')})})
.catch(function(){return fail('ONBOARDING_NETWORK','تعذّر الاتصال بالسيرفر. لم يتغير شيء على هذا الجهاز.')})}
/* Local preview store (fake data, this device only). Never holds a password. */
function db(){try{var j=JSON.parse(get(KL)||'null');return j&&Array.isArray(j.tenants)?j:{tenants:[]}}catch(e){return{tenants:[]}}}
function save(d){put(KL,JSON.stringify(d))}
function find(d,id){for(var i=0;i<d.tenants.length;i++)if(d.tenants[i].id===id)return d.tenants[i];return null}
function view(t){return{ok:true,tenant:{id:t.id,name:t.name,status:t.status,sandbox:!!t.sandbox,disabledAt:t.disabledAt||null},steps:STEPS.map(function(s){return{step:s,status:t.steps[s]||'pending'}}),local:true}}
function rnd(){var s='';for(var i=0;i<8;i++)s+='0123456789abcdef'.charAt(Math.floor(Math.random()*16));return s}
var local={
create:function(body,sandbox){var d=db();if(find(d,body.tenantId))return fail('ONBOARDING_TENANT_EXISTS','الصيدلية موجودة مسبقاً.');
var t={id:body.tenantId,name:body.name,status:'active',sandbox:!!sandbox,branches:body.branches.slice(),owner:body.owner.username.toLowerCase(),seeded:sandbox?SEED.length:0,
steps:{tenant:'done',branches:'done',roles:'done',owner:'done',import:sandbox?'done':'pending'}};
d.tenants.push(t);save(d);return{ok:true,tenantId:t.id,branches:t.branches.length,sandbox:t.sandbox,seeded:t.seeded,nextStep:sandbox?null:'import',local:true}},
status:function(id){var t=find(db(),id);return t?view(t):fail('ONBOARDING_NOT_FOUND','الصيدلية غير موجودة.')},
setStatus:function(id,st){var d=db(),t=find(d,id);if(!t)return fail('ONBOARDING_NOT_FOUND','الصيدلية غير موجودة.');t.status=st;t.disabledAt=st==='disabled'?new Date().toISOString():null;save(d);return{ok:true,status:st,local:true}},
skip:function(id){var d=db(),t=find(d,id);if(!t)return fail('ONBOARDING_NOT_FOUND','الصيدلية غير موجودة.');if(t.status!=='active')return fail('ONBOARDING_TENANT_DISABLED','الصيدلية معطّلة.');t.steps['import']='skipped';save(d);return{ok:true,local:true}}};
function q(id){return 'tenantId='+encodeURIComponent(String(id||''))}
function remember(r,id){if(r&&r.ok&&id)put(KLAST,id);return r}
function createTenant(input){var m=mode();if(m==='off')return off();var v=validate(input);if(!v.ok)return Promise.resolve(v);
if(m==='local')return Promise.resolve(remember(local.create(v.body,false),v.body.tenantId));
return api('POST','tenants',v.body).then(function(r){return remember(r,v.body.tenantId)})}
function createSandbox(){var m=mode();if(m==='off')return off();
if(m==='local'){var id='demo-'+rnd();return Promise.resolve(remember(local.create({tenantId:id,name:'صيدلية تجريبية',branches:['الفرع التجريبي'],owner:{username:'demo-owner'}},true),id))}
return api('POST','sandbox',{}).then(function(r){return remember(r,r&&r.tenantId)})}
function status(id){var m=mode();if(m==='off')return off();id=String(id||get(KLAST)||'');return m==='local'?Promise.resolve(local.status(id)):api('GET','status?'+q(id))}
function disable(id){var m=mode();if(m==='off')return off();return m==='local'?Promise.resolve(local.setStatus(id,'disabled')):api('POST','disable',{tenantId:id})}
function enable(id){var m=mode();if(m==='off')return off();return m==='local'?Promise.resolve(local.setStatus(id,'active')):api('POST','enable',{tenantId:id})}
function skipImport(id){var m=mode();if(m==='off')return off();return m==='local'?Promise.resolve(local.skip(id)):api('POST','import-step',{tenantId:id,skipped:true})}
function stepsHtml(s){return '<ul class="nova-onb-steps" id="novaOnbSteps">'+(s||[]).map(function(x){return '<li data-step="'+esc(x.step)+'" data-status="'+esc(x.status)+'">'+esc(STEP_AR[x.step]||x.step)+': '+esc(ST_AR[x.status]||x.status)+'</li>'}).join('')+'</ul>'}
function field(id,label,type,ltr,ph){return '<label for="'+id+'">'+label+'<input id="'+id+'" class="nova-field" type="'+type+'" autocomplete="off" spellcheck="false"'+(ltr?' dir="ltr"':'')+(ph?' placeholder="'+esc(ph)+'"':'')+'></label>'}
function mount(el){if(!el)return;var m=mode();
if(m==='off'){el.innerHTML='';el.hidden=true;return}
el.hidden=false;
el.innerHTML='<h3>تجهيز صيدلية جديدة (تجريبي)</h3>'
+'<p id="novaOnbMode" data-mode="'+m+'">'+(m==='api'?'متصل بالسيرفر: الطلبات تروح لمسارات التجهيز الموجودة (لازم المفتاح يكون للمالك، والميزة مفعّلة على السيرفر).':'معاينة محلية: بيانات تجريبية على هذا الجهاز فقط، ومفيش أي اتصال بالسيرفر.')+'</p>'
+'<p id="novaOnbNoPay">بدون دفع: مفيش باقات ولا أسعار ولا وسائل دفع في الشاشة دي.</p>'
+'<div class="nova-onb-grid">'+field('novaOnbTenant','معرّف الصيدلية (إنجليزي)','text',true,'pharmacy-1')+field('novaOnbName','اسم الصيدلية','text',false,'')
+field('novaOnbBranches','الفروع (افصل بفاصلة)','text',false,'الفرع الرئيسي')+field('novaOnbUser','اسم مستخدم المالك','text',true,'owner')
+field('novaOnbPass','كلمة مرور المالك (8+)','password',true,'')+'</div>'
+'<div class="nova-onb-actions"><button type="button" class="nova-page-btn" id="novaOnbCreate">إنشاء الصيدلية والفروع والمالك</button><button type="button" class="nova-page-btn" id="novaOnbSandbox">صيدلية تجريبية ببيانات تجريبية</button></div>'
+'<p id="novaOnbResult" role="status" aria-live="polite" data-kind=""></p>'
+'<div id="novaOnbCurrent"></div>';
var res=el.querySelector('#novaOnbResult'),cur=el.querySelector('#novaOnbCurrent'),busy=false;
function say(r,okMsg){res.dataset.kind=r&&r.ok?'ok':'error';res.textContent=r&&r.ok?okMsg:(r&&r.message_ar)||'تعذّر تنفيذ العملية.'}
function show(id){if(!id){cur.innerHTML='';return Promise.resolve()}return status(id).then(function(s){if(!s||!s.ok){cur.innerHTML='';return}var t=s.tenant||{};
cur.innerHTML='<p id="novaOnbTenantState" data-status="'+esc(t.status)+'">الصيدلية: <bdi dir="ltr">'+esc(t.id)+'</bdi> — '+esc(t.name)+(t.sandbox?' (تجريبية)':'')+' — '+(t.status==='active'?'شغالة':'معطّلة')+'</p>'+stepsHtml(s.steps)
+'<div class="nova-onb-actions">'+(t.status==='active'?'<button type="button" class="nova-page-btn" id="novaOnbSkipImport">تخطّي الاستيراد الآن</button><button type="button" class="nova-page-btn" id="novaOnbDisable">تعطيل (رجوع آمن، بدون مسح)</button>':'<button type="button" class="nova-page-btn" id="novaOnbEnable">إعادة التفعيل</button>')+'<button type="button" class="nova-page-btn" id="novaOnbRefresh">تحديث الحالة</button></div>';
var on=function(sel,fn){var b=cur.querySelector(sel);if(b)b.onclick=fn};
on('#novaOnbRefresh',function(){show(t.id)});
on('#novaOnbSkipImport',function(){run(function(){return skipImport(t.id)},'تم تخطّي خطوة الاستيراد.',t.id)});
on('#novaOnbDisable',function(){if(typeof confirm==='function'&&!confirm('تعطيل هذه الصيدلية؟ البيانات تفضل محفوظة ويمكن إعادة التفعيل.'))return;run(function(){return disable(t.id)},'تم التعطيل. لم يُمسح أي شيء.',t.id)});
on('#novaOnbEnable',function(){run(function(){return enable(t.id)},'تمت إعادة التفعيل.',t.id)})})}
function run(fn,okMsg,id){if(busy)return;busy=true;return fn().then(function(r){say(r,okMsg);busy=false;return show(r&&r.ok?(r.tenantId||id):id)},function(){busy=false;say(null)})}
el.querySelector('#novaOnbCreate').onclick=function(){var pw=el.querySelector('#novaOnbPass');var input={tenantId:el.querySelector('#novaOnbTenant').value,name:el.querySelector('#novaOnbName').value,branches:el.querySelector('#novaOnbBranches').value,username:el.querySelector('#novaOnbUser').value,password:pw.value};pw.value='';
run(function(){return createTenant(input)},'تم إنشاء الصيدلية والفروع والمالك. الخطوة الجاية: استيراد البيانات.')};
el.querySelector('#novaOnbSandbox').onclick=function(){run(function(){return createSandbox()},'تم إنشاء صيدلية تجريبية ببيانات تجريبية.')};
show(get(KLAST))}
window.novaOnboarding={KEY:KE,enabled:enabled,setEnabled:setEnabled,mode:mode,validate:validate,createTenant:createTenant,createSandbox:createSandbox,status:status,disable:disable,enable:enable,skipImport:skipImport,mount:mount};
var _el=document.getElementById('novaOnboardingCard');if(_el)mount(_el);
})();
