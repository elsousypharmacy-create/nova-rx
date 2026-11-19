/* UX48: hidden local inbox tab. Flag nova.flags.inbox==='1' (default OFF => nothing loaded, no UI). Local only, zero network. */
(function(){var on=false;try{on=localStorage.getItem('nova.flags.inbox')==='1'}catch(e){}
function boot(){var nav=document.querySelector('.nova-nav');if(!nav||document.getElementById('novaInboxTab'))return;init(nav)}
/* FIX43: the WhatsApp header icon opens the in-app conversations view (SPA, no navigation) even when the flag is off */
window.NovaOpenInbox=function(){boot();var t=document.getElementById('novaInboxTab');if(t){t.click();return true}return false};
/* UX406: a click on a new-message notification opens /#wa => the conversations screen */
window.addEventListener('load',function(){if(location.hash==='#wa')window.NovaOpenInbox()});
/* WA-APP: /whatsapp and /?app=whatsapp (the standalone WhatsApp link) = the conversations screen on its own: no POS and no other tabs, only the header
   and the conversations. Same code as the in-app «المحادثات» tab, so everything added there appears in both. */
(function(){try{
  var path=(location.pathname||'').replace(/\/+$/,'')||'/';
  var marked=path==='/whatsapp'||path==='/wa'||new URLSearchParams(location.search).get('app')==='whatsapp';
  var standalone=!!((window.navigator&&window.navigator.standalone)||(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches));
  if(!marked)return;
  if(standalone){try{sessionStorage.setItem('nova.wa.standalone','1')}catch(e){}}
}catch(e){return}
window.NOVA_APP='whatsapp';document.documentElement.classList.add('app-whatsapp');document.title='NOVA WhatsApp';
var mt=document.querySelector('meta[name=apple-mobile-web-app-title]');if(mt)mt.setAttribute('content','NOVA WhatsApp');
/* UX411: stay on the conversations list. The house button and switchPage use history.replaceState('#sale')
   (no hashchange), which left the POS home visible under /?app=whatsapp. */
/* UX412: /whatsapp (and /wa) is the dedicated install path. Keep that path so a home-screen launch
   cannot fall back to the POS start_url. Open the inbox when the launch URL is marked, including
   display-mode: standalone. */
var showing=false;
function waKeepUrl(){var p=(location.pathname||'').replace(/\/+$/,'')||'/';var base=(p==='/whatsapp'||p==='/wa')?'/whatsapp':'';return base+'?app=whatsapp#wa'}
function show(){if(showing)return;showing=true;try{if(window.NovaWaFitAppHeight)window.NovaWaFitAppHeight();var next=waKeepUrl();if(location.pathname+location.search+location.hash!==next){try{history.replaceState(null,'',next)}catch(e){}}if(window.NovaOpenInbox)window.NovaOpenInbox();var box=document.getElementById('novaInboxView'),pos=document.querySelector('.pos-root'),host=document.getElementById('novaPageView');if(box)box.hidden=false;if(pos){pos.hidden=true;pos.style.display='none'}if(host)host.hidden=true;try{document.body.dataset.activePage='inbox'}catch(e){}}finally{showing=false}}
function arm(){setTimeout(show,0)}
window.addEventListener('DOMContentLoaded',arm);
window.addEventListener('load',arm);
window.addEventListener('pageshow',arm);
window.addEventListener('popstate',arm);
window.addEventListener('hashchange',function(){if(location.hash!=='#wa')show()});
try{var _rs=history.replaceState.bind(history),_ps=history.pushState.bind(history);function wrap(fn){return function(s,t,u){fn(s,t,u);if(location.hash!=='#wa'||(document.getElementById('novaInboxView')&&document.getElementById('novaInboxView').hidden))show()}};history.replaceState=wrap(_rs);history.pushState=wrap(_ps)}catch(e){}
})();
function init(nav){var U=window.NovaUnifiedInbox;if(!U)return;var remote={enabled:function(){return localStorage.getItem('novaBackend.enabled')==='true'},baseUrl:function(){return localStorage.getItem('novaBackend.url')||'https://nova-rx-api.elsousypharmacy.workers.dev'},fetch:function(u,o){return fetch(u,o)},getToken:function(){return sessionStorage.getItem('novaBackend.token')}};var inbox=U.create(localStorage,remote).load();var wa={sel:null,q:'',err:'',draft:'',pin:{},arch:{},showArch:false,menu:null,mfail:{},quote:null,qmap:{},emo:false,att:false,filt:'all'}/* UX408: list filter chip (all|noreply|unread) *//* UX401: reply quote, quotes of replies sent here (memory only), emoji/attach popovers *//* UX400b: pin/archive/menu state in memory only (chat ids can be phone numbers; never localStorage, same rule as FIX46) */
function listMeta(){return{pinned:wa.pin,archived:wa.arch,showArchived:wa.showArch,menu:wa.menu,unread:nU,filter:wa.filt,more:hMoreState()}};function localSendOn(){try{return localStorage.getItem('nova.flags.inboxSend')==='1'}catch(e){return false}}
/* WA-SEND (owner approved 2026-11-14; UX400 2026-11-15: no PIN on staging/preview): a reply in an old/live WhatsApp chat goes to that customer through the staging API (POST history/send -> pharmacy bot). Text only, 1000 chars, 24h WhatsApp window enforced server-side. */
function histSel(){return !!(wa.sel&&hist.loaded&&hist.convs.some(function(c){return c.id===wa.sel}))}
var WIN_MS=24*3600*1000-2*60*1000;
function lastIn(id){var c=hist.full[id],m=c&&c.messages||[],a=0;for(var i=0;i<m.length;i++)if(m[i].dir==='in'&&Number(m[i].at)>a)a=Number(m[i].at);return a}
/* FIX51: 24h window from the latest REAL inbound; an inbound newer than the one the server rejected re-opens it */
function winStale(id){var c=hist.full[id];if(!c||!Array.isArray(c.messages)||!c.messages.length)return false;var last=0;c.messages.forEach(function(m){if(m&&m.dir==='in'&&Number(m.at)>last)last=Number(m.at)});return Date.now()-last>24*3600*1000}/* UX412: informational only — the composer stays enabled; WhatsApp decides */
function winClosed(id){return false}/* owner 2026-11-16: no 24 h pre-check; the send is attempted and a refusal from WhatsApp shows as a note under the failed message */
function sendOn(){return histSel()?(!!hist.full[wa.sel]&&!winClosed(wa.sel)):localSendOn()}
/* UX235: the demo chat exists only when the local-demo flag is on, and is labelled clearly */
function demoOn(){try{return localStorage.getItem('nova.flags.localDemo')==='1'}catch(e){return false}}
if(demoOn()&&!inbox.list().length){var n=Date.now();inbox.open('demo-1','عرض تجريبي',n);inbox.receive('demo-1','السلام عليكم، هل الدواء متوفر؟',n);inbox.send('demo-1','نعم متوفر',n+1);inbox.setStatus('demo-1','m2','delivered');inbox.link('demo-1',{customerId:'C-1',orderId:'O-1'})}
var tab=document.createElement('button');tab.type='button';tab.className='nova-tab';tab.id='novaInboxTab';tab.textContent='المحادثات';
var anchor=nav.querySelector('[data-page="settings"]');nav.insertBefore(tab,anchor?anchor.nextSibling:nav.firstChild);
var host=document.getElementById('novaPageView'),box=document.createElement('div');box.id='novaInboxView';box.className='nova-page-view';box.dir='rtl';box.hidden=true;host.parentNode.insertBefore(box,host.nextSibling);
var ar={on:null,err:''};
function arCfg(){try{var u=localStorage.getItem('novaBackend.url')||'https://nova-rx-api.elsousypharmacy.workers.dev',k=sessionStorage.getItem('novaBackend.token');return localStorage.getItem('novaBackend.enabled')==='true'&&u&&k?{u:String(u).replace(/\/+$/,'')+'/api/v1/whatsapp/auto-reply',k:k}:null}catch(e){return null}}
function arBar(){if(!arCfg())return '';var t=ar.on===null?'غير متاح':ar.on?'شغّال':'موقوف';return '<div id="novaAutoReply" dir="rtl" style="margin:8px 0;padding:10px;border:1px solid #cbd5e1;border-radius:8px"><button type="button" class="btn" id="novaAutoReplyBtn" aria-pressed="'+(ar.on===true)+'"'+(ar.on===null?' disabled':'')+' style="min-height:44px">الرد الآلي للبوت: '+t+'</button><div style="font-size:13px;margin-top:6px">الرسائل هتفضل توصل حتى لو الرد الآلي موقوف'+(ar.err?' — <span style="color:#b91c1c">'+ar.err+'</span>':'')+'</div></div>'}
function arCall(method,body){var c=arCfg();if(!c||typeof fetch!=='function')return Promise.resolve();return fetch(c.u,{method:method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+c.k},body:body?JSON.stringify(body):undefined}).then(function(r){return r.json()}).then(function(j){if(j&&j.ok&&typeof j.autoReply==='boolean'){ar.on=j.autoReply;ar.err=''}else ar.err=(j&&j.message_ar)||'تعذّر الاتصال بالبوت'}).catch(function(){ar.err='تعذّر الاتصال بالبوت'}).then(draw)}
/* FIX46: old WhatsApp chats come from the staging API. SEC-01 / S1-07: every /inbox/history/* call needs a signed-in STAFF session (Authorization: Bearer from staff-gate.js, window.novaStaff). Without it hGet never calls the API and the conversations screen shows only the login card (hLoginCard, no PIN field); chats stay in memory only and are dropped on logout. Sending happens only through hSend (WA-SEND), on an explicit pharmacist submit. */
var hist={convs:[],full:{},pend:{},oerr:{},err:'',code:'',busy:false,loaded:false,more:false,moreBusy:false,moreDone:false,extra:{},old:{}};
var HMSG={GATED:'السيرفر ده لسه مش فاتح المحادثات. افتح نسخة التجربة أو حاول تاني بعد شوية.',NETWORK:'تعذّر الاتصال بالسيرفر. اتأكد من الإنترنت وحاول تاني.',OFFLINE:'أنت غير متصل بالإنترنت. اتصل بالشبكة وحاول تاني.',SERVER:'السيرفر مش بيرد دلوقتي (خطأ مؤقت). حاول تاني بعد شوية.'};
function hErr(code,msg){var e=new Error(msg||HMSG[code]||HMSG.SERVER);e.code=code;return e}
function escH(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function hUrl(){var u='';try{u=localStorage.getItem('novaBackend.url')||'';if(!u&&localStorage.getItem('novaBackend.enabled')==='true')u='https://nova-rx-api.elsousypharmacy.workers.dev'}catch(e){}return String(u||'https://nova-rx-api-staging.elsousypharmacy.workers.dev').replace(/\/+$/,'')+'/api/v1/inbox/history/'}
function hOn(){return typeof fetch==='function'}
function hHdr(extra){var h={},k;if(extra)for(k in extra)if(Object.prototype.hasOwnProperty.call(extra,k))h[k]=extra[k];try{var b=window.novaStaff&&window.novaStaff.bearer();if(b)h.Authorization='Bearer '+b;else{var p=sessionStorage.getItem('novaHistPin');if(p)h['X-Nova-Pin']=p}}catch(e){}return h}
function hAuthed(){var S=window.novaStaff;if(!S||!S.enforced())return true;if(S.bearer())return true;try{return !!sessionStorage.getItem('novaHistPin')}catch(e){return false}}
function hLoginCard(msg){if(typeof box==='undefined'||!box)return;if(getComputedStyle(box).position==='static')box.style.position='relative';var c=box.querySelector('#waLoginCard');if(!c){c=document.createElement('div');c.id='waLoginCard';c.dir='rtl';c.setAttribute('role','region');c.setAttribute('aria-label','تسجيل الدخول للمحادثات');c.innerHTML='<strong>المحادثات محتاجة تسجيل دخول</strong><p>سجّل الدخول بحساب الصيدلية عشان تظهر محادثات العملاء.</p><p class="wa-login-msg" role="status"></p><button type="button" id="waLoginBtn">تسجيل الدخول</button>';c.querySelector('#waLoginBtn').onclick=function(){if(window.novaStaff)window.novaStaff.requireServer()};box.insertBefore(c,box.firstChild)}var m=c.querySelector('.wa-login-msg');if(m)m.textContent=msg||''}
function hLoginGone(){var c=typeof box!=='undefined'&&box&&box.querySelector('#waLoginCard');if(c)c.remove()}
/* SEC-01: signed out => forget every chat held in memory; signed in => load again. */
window.addEventListener('nova-staff-change',function(){if(!hAuthed()){hist.convs=[];hist.full={};hist.extra={};hist.loaded=false;wa.sel=null;hLoginCard('');draw();return}hLoginGone();if(!hist.busy)hLoad()});
var hRefAt=0;function hUnlockShow(e){var S=window.novaStaff;hist.convs=[];hist.full={};hist.loaded=false;if(S&&e&&e.status===401&&S.canRefresh()&&Date.now()-hRefAt>60000){hRefAt=Date.now();S.refresh().then(function(ok){if(ok&&hAuthed())hLoad();else hLoginCard('')});return}hLoginCard(e&&e.status===429?'محاولات كثيرة. حاول بعد ربع ساعة.':(e&&e.pin==='AUTH_EXPIRED'?'انتهت الجلسة. سجّل الدخول تاني.':''))}
function hSetErr(e){if(e&&e.code==='GATED'){hist.code='GATED';hist.err='';hUnlockShow(e);return}wa.f='#waHistRetry';hist.code=(e&&e.code)||'SERVER';hist.err=String((e&&e.message)||e)}
function hGet(path){if(!hOn())return Promise.reject(hErr('NETWORK'));if(!hAuthed()){var ge=hErr('GATED');ge.status=401;ge.pin='AUTH_REQUIRED';return Promise.reject(ge)}return fetch(hUrl()+path,{method:'GET',headers:hHdr({Accept:'application/json'}),cache:'no-store',credentials:'omit'}).then(function(r){return r.json().catch(function(){return {}}).then(function(j){if(r.status===401||r.status===429){var e=hErr('GATED');e.status=r.status;e.pin=(j&&j.code)||'';if(r.status===401&&e.pin==='PIN_INVALID'){try{sessionStorage.removeItem('novaHistPin')}catch(_){}}throw e}if(!r.ok||!j||!j.ok)throw hErr('SERVER');return j})},function(){throw hErr(typeof navigator!=='undefined'&&navigator.onLine===false?'OFFLINE':'NETWORK')})}
/* WA-LINK: the server attaches the registered pharmacy customer name (by phone number) to the conversations. GET, idempotent, throttled by the
   server (2 min) and here (3 min); on any change the names are updated in place, no reload of messages. Errors are silent: the list still works. */
var linkAt=0;
function hLink(){if(!hOn()||Date.now()-linkAt<180000)return;linkAt=Date.now();hGet('link-names').then(function(j){if(!(j&&j.ok&&j.linked>0))return;return hGet('conversations').then(function(r){var m={};(Array.isArray(r.conversations)?r.conversations:[]).forEach(function(c){if(c&&c.id!=null&&c.customer)m[c.id]=c.customer});var ch=0;hist.convs.forEach(function(c){if(m[c.id]&&c.customer!==m[c.id]){c.customer=m[c.id];ch=1}});Object.keys(hist.extra||{}).forEach(function(k){var c=hist.extra[k];if(c&&m[c.id]&&c.customer!==m[c.id]){c.customer=m[c.id];ch=1}});if(ch)draw()})}).catch(function(){})}
function hLoad(){if(!hOn()||hist.busy)return;hist.busy=true;hist.err='';hist.code='';draw();hGet('conversations').then(function(j){hLoginGone();hist.convs=Array.isArray(j.conversations)?j.conversations:[];hist.extra={};hist.moreDone=false;hist.more=hist.convs.length>=H_CAP;hist.loaded=true;nObserve();if(wa.sel)hOpen(wa.sel);hLink();hMediaProbe()}).catch(hSetErr).then(function(){hist.busy=false;draw()})}
/* UX408: pagination before the API caps drop anything. The history list returns at most 300 chats (LIMIT 300) and a thread its newest
   1000 messages. When a page comes back full, «تحميل محادثات أقدم» / «رسائل أقدم من السيرفر» (or scrolling to the end) asks for the
   page before the oldest row (before=<ms>). A server that ignores the cursor returns rows we already have => marked done, nothing duplicated. GET only. */
var H_CAP=300,T_CAP=1000;
function hMoreState(){return !hist.loaded||!hist.more?null:hist.moreBusy?'busy':hist.moreDone?'done':'idle'}
function hMore(){if(!hist.more||hist.moreBusy||hist.moreDone||!hist.convs.length)return;var o=Infinity;hist.convs.forEach(function(c){var u=Number(c.updatedAt)||0;if(u<o)o=u});hist.moreBusy=true;draw();
hGet('conversations?before='+encodeURIComponent(String(o))+'&limit='+H_CAP).then(function(j){var nl=Array.isArray(j.conversations)?j.conversations:[],ids={},add=[];hist.convs.forEach(function(c){ids[c.id]=1});nl.forEach(function(c){if(c&&c.id!=null&&!ids[c.id]){ids[c.id]=1;add.push(c);hist.extra[c.id]=1}});if(add.length){hist.convs=hist.convs.concat(add);nObserve()}if(!add.length||nl.length<H_CAP)hist.moreDone=true}).catch(function(){}).then(function(){hist.moreBusy=false;draw()})}
function tOlderState(id){var f=hist.full[id],ms=f&&f.messages||[],o=hist.old[id]||{};if(!f||!histSel())return null;var srv=ms.filter(function(m){return String(m.id).indexOf('tmp_')!==0}).length,cnt=0;hist.convs.forEach(function(c){if(c.id===id)cnt=Number(c.count)||0});if(!(srv>=T_CAP||cnt>srv)&&!o.done)return null;return o.busy?'busy':o.done?'done':'idle'}
function tOlder(id){var f=hist.full[id],o=hist.old[id]=hist.old[id]||{};if(!f||o.busy||o.done)return;var ms=f.messages||[],first=ms[0];if(!first){o.done=1;draw();return}o.busy=1;draw();
hGet('conversation?id='+encodeURIComponent(id)+'&before='+encodeURIComponent(String(Number(first.at)||0))+'&limit='+T_CAP).then(function(j){var got=j.conversation&&Array.isArray(j.conversation.messages)?j.conversation.messages:[],have={},add=[];(f.messages||[]).forEach(function(m){have[m.id]=1});got.forEach(function(m){if(m&&!have[m.id]&&Number(m.at)<=Number(first.at)){have[m.id]=1;add.push(m)}});if(add.length){add.sort(function(a,b){return a.at-b.at});f.messages=add.concat(f.messages||[]);wa.lim=(wa.lim||LIM0)+add.length}if(!add.length||got.length<T_CAP)o.done=1}).catch(function(){}).then(function(){o.busy=0;draw()})}
function hOpen(id){if(!hOn()||hist.full[id]||hist.pend[id]||!hist.convs.some(function(c){return c.id===id}))return;hist.pend[id]=1;delete hist.oerr[id];hGet('conversation?id='+encodeURIComponent(id)).then(function(j){delete hist.pend[id];if(j.conversation){hist.full[id]=j.conversation}else hist.oerr[id]='تعذّر تحميل المحادثة.';if(wa.sel===id)draw()}).catch(function(e){delete hist.pend[id];if(e&&e.code==='GATED'){hSetErr(e)}else hist.oerr[id]=String((e&&e.message)||'تعذّر تحميل المحادثة.');draw()})}
/* FIX51: live refresh like WhatsApp: every 4s while the chat screen is visible, silent (no spinner), redraw only when something changed; local sending/failed bubbles are kept. */
function hSig(c){var l=c&&c.last;return c?[c.id,c.customer,c.count,c.updatedAt,l&&l.id,l&&l.status].join('|'):''}
/* UX402: also runs (slower, see U.pollDelay) while the user is on another screen so badges/toast stay live; paused while the browser tab is hidden; backoff on errors. Returns a promise for the scheduler. */
function hBgN(){return nPerm()==='granted'&&!nPushOn}
function hPoll(){if((document.hidden&&!hBgN())||!hOn()||!hist.loaded||hist.busy||hist.polling)return Promise.resolve(false);hLink();hist.polling=1;hist.polls=(hist.polls||0)+1;var sel=wa.sel;
return hGet('conversations').then(function(j){var nl=Array.isArray(j.conversations)?j.conversations:[],ch=nl.length!==hist.convs.length||nl.some(function(c,i){return hSig(c)!==hSig(hist.convs[i])});var old={};hist.convs.forEach(function(c){old[c.id]=c});var chg=nl.filter(function(c){return hSig(c)!==hSig(old[c.id])}).map(function(c){return c.id});
var keep={};hist.convs.forEach(function(c){var f=hist.full[c.id];if(f&&(f.messages||[]).some(function(m){return m.status==='sending'}))keep[c.id]=1});
if(ch){var nid={};nl.forEach(function(c){nid[c.id]=1});hist.convs=nl.map(function(c){return keep[c.id]?old[c.id]:c}).concat(Object.keys(hist.extra).filter(function(id){return !nid[id]&&old[id]}).map(function(id){return old[id]}))}/* UX408: chats loaded with «تحميل محادثات أقدم» survive the 4s refresh (it only returns the newest 300) */
var jobs=[];if(sel&&chg.indexOf(sel)>=0&&hist.full[sel])jobs.push(hGet('conversation?id='+encodeURIComponent(sel)).then(function(r){var f=hist.full[sel],loc=f?(f.messages||[]).filter(function(m){return m.status==='sending'||m.status==='failed'}):[];if(r.conversation){r.conversation.messages=U.mergeLive(r.conversation.messages,loc);/* UX402: no duplicate bubble */hist.full[sel]=r.conversation;ch=true}}));
chg.forEach(function(id){if(id!==sel&&hist.full[id])delete hist.full[id]});
return Promise.all(jobs).then(function(){hist.fails=0;if(ch){nObserve();draw()}})}).catch(function(e){hist.fails=(hist.fails||0)+1;if(e&&e.code==='GATED')hSetErr(e),draw()}).then(function(){hist.polling=0;return true})}
function hConvs(){return hist.convs.map(function(c){var f=hist.full[c.id];return {id:c.id,customer:c.customer||c.id,updatedAt:Number(c.updatedAt)||0,history:true,count:Number(c.count)||0,messages:f?f.messages:(c.last?[c.last]:[])}})}
function hSend(id,text,q){var c=hist.full[id];if(!c||!hOn())return;var now=Date.now(),cl='c'+now.toString(36)+Math.random().toString(36).slice(2,10),tmp={id:'tmp_'+cl,dir:'out',kind:'pharm',text:text,at:now,status:'sending'};if(q)wa.qmap[tmp.id]=q;c.messages=(c.messages||[]).concat([tmp]);hist.convs.forEach(function(x){if(x.id===id){x.last=tmp;x.updatedAt=now;x.count=(Number(x.count)||0)+1}});wa.err='';draw();
var fail=function(msg,restore){tmp.status='failed';wa.err=msg;if(restore&&wa.sel===id)(wa.draft=text,wa.quote=wa.quote||q||null)};
var bodyS=JSON.stringify(q&&q.id!=null?{id:id,text:text,clientId:cl,replyTo:String(q.id)}:{id:id,text:text,clientId:cl}),post=function(){return fetch(hUrl()+'send',{method:'POST',headers:hHdr({'Content-Type':'application/json',Accept:'application/json'}),body:bodyS,cache:'no-store',credentials:'omit'})},
verify=function(msg){return hGet('conversation?id='+encodeURIComponent(id)).then(function(r){var ms=(r.conversation&&r.conversation.messages)||[],hit=ms.filter(function(m){return m&&m.dir==='out'&&m.text===text&&Number(m.at)>=now-60000}).pop();if(hit){for(var k in hit)tmp[k]=hit[k];if(q)wa.qmap[tmp.id]=q;return}fail(msg,false)}).catch(function(){fail(msg,false)})},
handle=function(r){return r.json().catch(function(){return {}}).then(function(j){if(r.status===401){c.messages=c.messages.filter(function(x){return x!==tmp});if(wa.sel===id)(wa.draft=text,wa.quote=wa.quote||q||null);hSetErr(hErr('GATED'));return}if(r.ok&&j&&j.ok&&j.message){for(var k in j.message)tmp[k]=j.message[k];if(q)wa.qmap[tmp.id]=q;return}if(j&&j.code==='SEND_DUPLICATE'){return verify('الرسالة يمكن تكون وصلت (اتبعتت قبل كده). راجع المحادثة.')}if(j&&j.code==='SEND_WINDOW_CLOSED'){fail((j&&j.message_ar)||'الرسالة ما وصلتش: عدّى أكتر من 24 ساعة على آخر رسالة من العميل.',false);return}fail((j&&j.message_ar)||'الرسالة ما اتبعتتش. حاول تاني.',!(j&&j.code==='SEND_UNKNOWN'))})};
/* network error: retry once with the SAME clientId (server de-duplicates), then check the chat for the message instead of asking the user to */
post().then(handle,function(){return new Promise(function(res){setTimeout(res,1500)}).then(post).then(handle,function(){return verify('مش متأكدين إن الرسالة اتبعتت (مشكلة في الاتصال). راجع المحادثة قبل ما تبعت تاني.')})}).then(draw)}
/* UX411: send a PHOTO to the customer (gallery or camera). Buttons exist only when the backend says photo sending is on (hist.media, from GET send-media). */
function mediaOn(){return !!hist.media&&histSel()&&sendOn()}
function hMediaProbe(){if(hist.mediaProbed)return;hist.mediaProbed=true;hGet('send-media').then(function(j){hist.media=!!(j&&j.enabled);hist.audio=!!(j&&j.enabled&&j.audio);draw()}).catch(function(){hist.media=false})}
function waPick(cam){var i=box.querySelector(cam?'[data-wa-file-cam]':'[data-wa-file]');if(i){i.value='';i.click()}}
function waShrink(file,done){if(!file||!/^image\//.test(file.type||'')){done(null,'الملف ده مش صورة.');return}var u=URL.createObjectURL(file),im=new Image();im.onerror=function(){URL.revokeObjectURL(u);done(null,'مش قادر أقرأ الصورة دي. جرّب صورة تانية.')};im.onload=function(){URL.revokeObjectURL(u);try{var w=im.naturalWidth||im.width,h=im.naturalHeight||im.height,tries=[[1600,.85],[1280,.7],[1024,.6]],out=null;for(var k=0;k<tries.length&&!out;k++){var m=tries[k][0],sc=Math.min(1,m/Math.max(w,h)),cv=document.createElement('canvas');cv.width=Math.max(1,Math.round(w*sc));cv.height=Math.max(1,Math.round(h*sc));var cx=cv.getContext('2d');cx.fillStyle='#fff';cx.fillRect(0,0,cv.width,cv.height);cx.drawImage(im,0,0,cv.width,cv.height);var d=cv.toDataURL('image/jpeg',tries[k][1]),b=d.slice(d.indexOf(',')+1);if(b.length*3/4<=4.5*1024*1024)out={dataUrl:d,b64:b,w:cv.width,h:cv.height}}if(!out){done(null,'الصورة كبيرة قوي.');return}done(out)}catch(e){done(null,'مش قادر أجهّز الصورة دي.')}};im.src=u}
function waPreviewClose(){var o=document.querySelector('[data-wa-mp]');if(o&&o.parentNode)o.parentNode.removeChild(o);document.removeEventListener('keydown',waPreviewKey,true)}
function waPreviewKey(e){if(e.key==='Escape'){e.preventDefault();e.stopPropagation();waPreviewClose()}}
function waPreview(img,chat){waPreviewClose();var o=document.createElement('div');o.className='wa-mp';o.setAttribute('data-wa-mp','');o.setAttribute('role','dialog');o.setAttribute('aria-modal','true');o.setAttribute('aria-label','معاينة الصورة قبل الإرسال');
o.innerHTML='<div class="wa-mp-top"><button type="button" class="wa-mp-x" data-wa-mp-x aria-label="إلغاء">✕</button></div><img class="wa-mp-img" data-wa-mp-img alt="الصورة اللي هتتبعت"><div class="wa-mp-bar"><input class="wa-mp-cap" data-wa-mp-cap type="text" maxlength="1024" dir="auto" enterkeyhint="send" autocomplete="off" placeholder="أضف تعليقاً…" aria-label="تعليق على الصورة"><button type="button" class="wa-mp-send" data-wa-mp-send aria-label="إرسال الصورة">'+U.sendIcon+'</button></div>';
o.querySelector('[data-wa-mp-img]').src=img.dataUrl;document.body.appendChild(o);document.addEventListener('keydown',waPreviewKey,true);
var go=function(){var cap=o.querySelector('[data-wa-mp-cap]').value.trim();waPreviewClose();wa.stick=1;hSendMedia(chat,img,cap)};
o.querySelector('[data-wa-mp-x]').addEventListener('click',waPreviewClose);o.querySelector('[data-wa-mp-send]').addEventListener('click',go);o.querySelector('[data-wa-mp-cap]').addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();go()}})}
function hSendMedia(id,img,cap){var c=hist.full[id];if(!c||!hOn())return;var now=Date.now(),cl='c'+now.toString(36)+Math.random().toString(36).slice(2,10),tmp={id:'tmp_'+cl,dir:'out',kind:'pharm',text:cap,at:now,status:'sending',media:{type:'image',mime:'image/jpeg',cached:true,caption:cap,local:img.dataUrl}};if(img.w)dimSet(tmp.id,img.w,img.h);c.messages=(c.messages||[]).concat([tmp]);hist.convs.forEach(function(x){if(x.id===id){x.last=tmp;x.updatedAt=now;x.count=(Number(x.count)||0)+1}});wa.err='';draw();
var fail=function(msg){tmp.status='failed';wa.err=msg},body=JSON.stringify({id:id,mime:'image/jpeg',data:img.b64,caption:cap,clientId:cl}),post=function(){return fetch(hUrl()+'send-media',{method:'POST',headers:hHdr({'Content-Type':'application/json',Accept:'application/json'}),body:body,cache:'no-store',credentials:'omit'})},
verify=function(msg){return hGet('conversation?id='+encodeURIComponent(id)).then(function(r){var ms=(r.conversation&&r.conversation.messages)||[],hit=ms.filter(function(m){return m&&m.dir==='out'&&m.media&&m.media.type==='image'&&Number(m.at)>=now-60000}).pop();if(hit){for(var k in hit)tmp[k]=hit[k];return}fail(msg)}).catch(function(){fail(msg)})},
handle=function(r){return r.json().catch(function(){return {}}).then(function(j){if(r.status===401){c.messages=c.messages.filter(function(x){return x!==tmp});hSetErr(hErr('GATED'));return}if(r.ok&&j&&j.ok&&j.message){for(var k in j.message)tmp[k]=j.message[k];if(img.w)dimSet(tmp.id,img.w,img.h);return}if(j&&j.code==='SEND_DUPLICATE'){return verify('الصورة يمكن تكون وصلت (اتبعتت قبل كده). راجع المحادثة.')}fail((j&&j.message_ar)||'الصورة ما اتبعتتش. حاول تاني.')})};
post().then(handle,function(){return new Promise(function(res){setTimeout(res,1500)}).then(post).then(handle,function(){return verify('مش متأكدين إن الصورة اتبعتت (مشكلة في الاتصال). راجع المحادثة قبل ما تبعت تاني.')})}).then(draw)}
/* UX413: record and send a VOICE NOTE (tap the mic: record, then send or cancel). Formats WhatsApp accepts only: ogg/opus (Firefox), mp4/aac (iPhone Safari), mpeg. Chrome records webm, which WhatsApp rejects: shown as a plain note. */
var REC_TYPES=['audio/ogg;codecs=opus','audio/ogg','audio/webm;codecs=opus','audio/webm','audio/mp4','audio/mpeg'],REC_MAX_S=300,REC_MAX_BYTES=4.5*1024*1024,rec=null;
/* WhatsApp refuses the iPhone recording (fragmented mp4: Meta error 131053) and Chrome's webm: every recording is converted to OGG/Opus
   (WhatsApp's own voice-note format) before sending. Encoder: opus-recorder 8.0.5 (MIT; libopus BSD), loaded from jsDelivr at a pinned
   version and run ONLY if its SHA-256 matches; it runs in a Worker and never sees the page. */
var OPUS_URL='https://cdn.jsdelivr.net/npm/opus-recorder@8.0.5/dist/encoderWorker.min.js',OPUS_SHA='c3a64a87b2868e37c0387da45262900820ec85ab448869011247cbd351858a95',opusSrc=null;
function opusWorkerUrl(){if(opusSrc)return opusSrc;opusSrc=fetch(OPUS_URL,{credentials:'omit'}).then(function(r){if(!r.ok)throw new Error('fetch');return r.arrayBuffer()}).then(function(buf){return crypto.subtle.digest('SHA-256',buf).then(function(d){var hex=Array.prototype.map.call(new Uint8Array(d),function(b){return(b<16?'0':'')+b.toString(16)}).join('');if(hex!==OPUS_SHA)throw new Error('hash');return URL.createObjectURL(new Blob(['var Module={onRuntimeInitialized:function(){postMessage({message:"loaded"})}};\n',buf],{type:'text/javascript'}))})});opusSrc.catch(function(){opusSrc=null});return opusSrc}
function toOggOpus(blob){var AC=window.AudioContext||window.webkitAudioContext;if(!AC)return Promise.reject(new Error('noaudio'));return blob.arrayBuffer().then(function(ab){var ac=new AC();return new Promise(function(res,rej){ac.decodeAudioData(ab,res,rej)}).then(function(a){try{ac.close()}catch(e){}return a},function(e){try{ac.close()}catch(e2){}throw e})}).then(function(audio){return opusWorkerUrl().then(function(url){return new Promise(function(res,rej){
var n=audio.length,mono=new Float32Array(n),chs=audio.numberOfChannels,c,i;for(c=0;c<chs;c++){var d=audio.getChannelData(c);for(i=0;i<n;i++)mono[i]+=d[i]/chs}
var w=new Worker(url),pages=[],to=setTimeout(function(){w.terminate();rej(new Error('timeout'))},30000);
w.onerror=function(){clearTimeout(to);w.terminate();rej(new Error('worker'))};
w.onmessage=function(e){var m=e.data;if(!m)return;if(m.message==='loaded'){w.postMessage({command:'init',encoderSampleRate:48000,originalSampleRate:audio.sampleRate,numberOfChannels:1,encoderApplication:2048,resampleQuality:3});return}
if(m.message==='ready'){w.postMessage({command:'getHeaderPages'});for(var k=0;k<n;k+=4096)w.postMessage({command:'encode',buffers:[mono.slice(k,Math.min(n,k+4096))]});w.postMessage({command:'done'});return}
if(m.message==='done'){clearTimeout(to);w.terminate();res(new Blob(pages,{type:'audio/ogg'}));return}
if(m.page)pages.push(m.page)}})})})}
function recType(){if(typeof MediaRecorder==='undefined'||!MediaRecorder.isTypeSupported)return '';for(var i=0;i<REC_TYPES.length;i++){try{if(MediaRecorder.isTypeSupported(REC_TYPES[i]))return REC_TYPES[i]}catch(e){}}return ''}
function recClose(){if(!rec)return;var r=rec;rec=null;try{clearInterval(r.tick)}catch(e){}try{if(r.mr&&r.mr.state!=='inactive'){r.mr.onstop=null;r.mr.stop()}}catch(e){}try{(r.stream&&r.stream.getTracks()||[]).forEach(function(t){t.stop()})}catch(e){}var o=document.querySelector('[data-wa-rec]');if(o&&o.parentNode)o.parentNode.removeChild(o)}
function recFmt(s){s=Math.max(0,Math.floor(s));return Math.floor(s/60)+':'+(s%60<10?'0':'')+(s%60)}
function recStart(chat){if(rec)return;var type=recType();if(!type){wa.err='المتصفح ده مش بيسجّل بصيغة يقبلها واتساب. جرّب من الآيفون أو من فايرفوكس.';draw();return}
if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){wa.err='التسجيل مش متاح في المتصفح ده.';draw();return}
var mine={chat:chat,type:type,chunks:[],bytes:0,t0:0,mr:null,stream:null,tick:0,done:false};rec=mine;
navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){if(rec!==mine){stream.getTracks().forEach(function(t){t.stop()});return}mine.stream=stream;var mr;try{mr=new MediaRecorder(stream,{mimeType:type})}catch(e){recClose();wa.err='مش قادر أبدأ التسجيل.';draw();return}mine.mr=mr;
mr.ondataavailable=function(e){if(e.data&&e.data.size){mine.chunks.push(e.data);mine.bytes+=e.data.size}};mr.start(1000);mine.t0=performance.now();
var o=document.createElement('div');o.className='wa-rec';o.setAttribute('data-wa-rec','');o.setAttribute('role','group');o.setAttribute('aria-label','تسجيل رسالة صوتية');
o.innerHTML='<button type="button" class="wa-rec-x" data-wa-rec-x aria-label="إلغاء التسجيل">🗑</button><div class="wa-rec-t"><span class="wa-rec-dot" aria-hidden="true"></span><span data-wa-rec-time>0:00</span><span class="wa-rec-hint">بيسجّل…</span></div><button type="button" class="wa-rec-send" data-wa-rec-send aria-label="إرسال الرسالة الصوتية">'+U.sendIcon+'</button>';document.body.appendChild(o);
o.querySelector('[data-wa-rec-x]').addEventListener('click',recClose);o.querySelector('[data-wa-rec-send]').addEventListener('click',function(){recFinish()});
mine.tick=setInterval(function(){var s=(performance.now()-mine.t0)/1000,t=o.querySelector('[data-wa-rec-time]');if(t)t.textContent=recFmt(s);if(s>=REC_MAX_S||mine.bytes>=REC_MAX_BYTES)recFinish()},250)},function(){if(rec===mine)rec=null;wa.err='محتاج تسمح باستخدام المايك عشان تسجّل.';draw()})}
function recFinish(){var r=rec;if(!r||r.done||!r.mr)return;r.done=true;var secs=(performance.now()-r.t0)/1000;clearInterval(r.tick);
r.mr.onstop=function(){var blob=new Blob(r.chunks,{type:r.type.split(';')[0]}),chat=r.chat;recClose();if(secs<1||!blob.size){wa.err='التسجيل قصير قوي. اضغط على المايك وكمّل تسجيل شوية.';draw();return}
if(blob.size>5*1024*1024){wa.err='التسجيل كبير قوي. قصّره وابعته على مرتين.';draw();return}
var b64of=function(b){return new Promise(function(res,rej){var fr=new FileReader();fr.onload=function(){res(String(fr.result))};fr.onerror=rej;fr.readAsDataURL(b)})};
(blob.type==='audio/ogg'?Promise.resolve(blob):toOggOpus(blob)).then(function(ogg){if(ogg.size>5*1024*1024)throw new Error('big');return Promise.all([b64of(ogg),b64of(blob)])}).then(function(u){var url=u[0],i=url.indexOf(',');if(wa.sel!==chat||!mediaOn())return;wa.stick=1;hSendVoice(chat,{mime:'audio/ogg',b64:url.slice(i+1),dataUrl:u[1],secs:Math.round(secs)})},function(e){wa.err=e&&e.message==='big'?'التسجيل كبير قوي. قصّره وابعته على مرتين.':'مش قادر أجهّز التسجيل بصيغة واتساب. اتأكد إن النت شغال وجرّب تاني.';draw()})};
try{r.mr.stop()}catch(e){recClose();wa.err='مش قادر أنهي التسجيل.';draw()}}
function hSendVoice(id,v){var c=hist.full[id];if(!c||!hOn())return;var now=Date.now(),cl='c'+now.toString(36)+Math.random().toString(36).slice(2,10),tmp={id:'tmp_'+cl,dir:'out',kind:'pharm',text:'[رسالة صوتية]',at:now,status:'sending',media:{type:'audio',mime:v.mime,cached:true,duration:v.secs,local:v.dataUrl}};c.messages=(c.messages||[]).concat([tmp]);hist.convs.forEach(function(x){if(x.id===id){x.last=tmp;x.updatedAt=now;x.count=(Number(x.count)||0)+1}});wa.err='';draw();
var fail=function(msg){tmp.status='failed';wa.err=msg},body=JSON.stringify({id:id,kind:'audio',mime:v.mime,data:v.b64,clientId:cl}),post=function(){return fetch(hUrl()+'send-media',{method:'POST',headers:hHdr({'Content-Type':'application/json',Accept:'application/json'}),body:body,cache:'no-store',credentials:'omit'})},
verify=function(msg){return hGet('conversation?id='+encodeURIComponent(id)).then(function(r){var ms=(r.conversation&&r.conversation.messages)||[],hit=ms.filter(function(m){return m&&m.dir==='out'&&m.media&&m.media.type==='audio'&&Number(m.at)>=now-60000}).pop();if(hit){for(var k in hit)tmp[k]=hit[k];return}fail(msg)}).catch(function(){fail(msg)})},
handle=function(r){return r.json().catch(function(){return {}}).then(function(j){if(r.status===401){c.messages=c.messages.filter(function(x){return x!==tmp});hSetErr(hErr('GATED'));return}if(r.ok&&j&&j.ok&&j.message){var dur=tmp.media&&tmp.media.duration;for(var k in j.message)tmp[k]=j.message[k];if(tmp.media&&dur&&!tmp.media.duration)tmp.media.duration=dur;return}if(j&&j.code==='SEND_DUPLICATE'){return verify('الرسالة الصوتية يمكن تكون وصلت (اتبعتت قبل كده). راجع المحادثة.')}fail((j&&j.message_ar)||'الرسالة الصوتية ما اتبعتتش. حاول تاني.')})};
post().then(handle,function(){return new Promise(function(res){setTimeout(res,1500)}).then(post).then(handle,function(){return verify('مش متأكدين إن الرسالة الصوتية اتبعتت (مشكلة في الاتصال). راجع المحادثة قبل ما تبعت تاني.')})}).then(draw)}
box.addEventListener('click',function(e){var t=e.target&&e.target.closest&&e.target.closest('[data-wa-mic]');if(!t||t.getAttribute('aria-disabled')==='true'||!hist.audio||!mediaOn())return;e.preventDefault();wa.att=false;waPop();recStart(wa.sel)});
box.addEventListener('click',function(e){var t=e.target&&e.target.closest&&e.target.closest('[data-wa-att="image"],[data-wa-att="camera"],[data-wa-camera]');if(!t||!mediaOn()||t.getAttribute('aria-disabled')==='true')return;e.preventDefault();var cam=t.getAttribute('data-wa-att')==='camera'||t.hasAttribute('data-wa-camera');wa.att=false;waPop();waPick(cam)});
box.addEventListener('change',function(e){var f=e.target;if(!f||!f.hasAttribute||!(f.hasAttribute('data-wa-file')||f.hasAttribute('data-wa-file-cam')))return;var file=f.files&&f.files[0],chat=wa.sel;if(!file||!chat||!mediaOn())return;waShrink(file,function(img,msg){if(!img){wa.err=msg;draw();return}if(wa.sel!==chat||!mediaOn())return;waPreview(img,chat)})});
function convs(){var h=hConvs(),ids={};h.forEach(function(c){ids[c.id]=1});return h.concat(inbox.list().filter(function(c){return !ids[c.id]&&(c.id!=='demo-1'||(demoOn()&&!h.length))}).map(function(c){return c.id==='demo-1'?Object.assign({},c,{customer:'عرض تجريبي'}):c}))}
var PS='margin:8px 0;padding:12px;border:1px solid #2a313a;border-radius:8px;background:#14181d;color:#f2f3f5;font-size:14px;line-height:1.7',BS='min-height:44px;margin-top:8px;padding:0 16px;border-radius:8px;border:1px solid #79c9eb;background:#0d0f12;color:#79c9eb;font:inherit;cursor:pointer';
function errPanel(){if(!hist.err)return '';return '<div class="wa-state wa-hist-err" role="alert" data-state="'+(hist.code==='OFFLINE'?'offline':hist.code==='NETWORK'?'network':hist.code==='GATED'?'gated':'error')+'" dir="rtl" style="'+PS+';border-color:#b91c1c"><div>'+escH(hist.err)+'</div><button type="button" id="waHistRetry" data-retry="load" style="'+BS+'">إعادة المحاولة</button></div>'}
function emptyPanel(){if(!(hist.loaded&&!hist.convs.length&&!hist.err))return '';return '<div class="wa-state" data-state="empty" dir="rtl" style="'+PS+'"><div>لا توجد محادثات قديمة محفوظة حتى الآن. المحادثات الجديدة تظهر هنا أول ما يوصل أي رسالة واتساب.</div><button type="button" id="waHistRetry" data-retry="load" style="'+BS+'">تحديث</button></div>'}
function histParts(){var st=hist.err?'error':hist.loaded?'ready':'loading',t=st==='ready'?hist.convs.length+' محادثة':st==='loading'?'جاري التحميل…':'';return {head:'<span class="wa-histst" id="waHistBar" data-state="'+st+'" role="status">'+t+'</span>',panel:errPanel()+emptyPanel()}}
/* UX300-SHARED-BEGIN (identical to backend/src/wa-metrics.js) */
var WA_TZ = 'Africa/Cairo';
var WA_TOPICS = [
  { id: 'avail', ar: 'توفر دواء', re: /متوفر|موجود|عندكم|متاح/ },
  { id: 'price', ar: 'سعر', re: /بكام|سعر|ثمن|كام/ },
  { id: 'delivery', ar: 'توصيل', re: /توصيل|ديليفري|دليفري|يوصل|عنوان/ },
  { id: 'order', ar: 'طلب / أوردر', re: /اوردر|طلب|اطلب|احجز/ },
  { id: 'rx', ar: 'روشتة', re: /روشت|وصفه|تذكره/ },
  { id: 'alt', ar: 'بديل', re: /بديل|مثيل/ },
  { id: 'hours', ar: 'مواعيد', re: /مواعيد|فاتح|مفتوح|بتقفلوا/ },
  { id: 'dose', ar: 'جرعة واستخدام', re: /جرعه|استخدام|اعراض|ينفع|مضاد/ }
];
function waNorm(s) {
  return String(s == null ? '' : s).replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
}
function waIsHandoff(text) { return /اتحول\s+(لل|ل)?صيدلي/.test(waNorm(text)); }
function waTopics(text) {
  var n = waNorm(text), out = [];
  for (var i = 0; i < WA_TOPICS.length; i++) if (WA_TOPICS[i].re.test(n)) out.push(WA_TOPICS[i].id);
  return out;
}
function waTs(v) { var n = Number(v) || 0; return n > 0 && n < 1e12 ? n * 1000 : n; }
var _waFmt = null;
function waParts(t) {
  if (!_waFmt) _waFmt = new Intl.DateTimeFormat('en-US', { timeZone: WA_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  var o = {};
  _waFmt.formatToParts(new Date(t)).forEach(function (p) { o[p.type] = p.value; });
  return { y: +o.year, mo: +o.month, d: +o.day, h: (+o.hour) % 24, mi: +o.minute, s: +o.second, wd: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[o.weekday] };
}
function waOffset(t) { var p = waParts(t); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000; }
function waDayStart(t) { var p = waParts(t), g = Date.UTC(p.y, p.mo - 1, p.d), s = g - waOffset(g); return g - waOffset(s); }
function waNextDay(t) { return waDayStart(waDayStart(t) + 30 * 3600000); }
function waDayKey(t) { var p = waParts(t); return p.y + '-' + (p.mo < 10 ? '0' : '') + p.mo + '-' + (p.d < 10 ? '0' : '') + p.d; }
function waKeyStart(key) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key)); return m ? waDayStart(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : null; }
function waPad(n) { return (n < 10 ? '0' : '') + n; }
function waClock(t) { var p = waParts(t); return waPad(p.h) + ':' + waPad(p.mi); }
function waDateTime(t) { var p = waParts(t); return waDayKey(t) + ' ' + waPad(p.h) + ':' + waPad(p.mi) + ':' + waPad(p.s); }
function waDur(ms) {
  if (ms == null || isNaN(ms)) return '—';
  if (ms < 1000) return 'أقل من ثانية';
  var s = Math.round(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (d) return d + ' يوم' + (h ? ' ' + h + ' س' : '');
  if (h) return h + ' س' + (m ? ' ' + m + ' د' : '');
  if (m) return m + ' د' + (r ? ' ' + r + ' ث' : '');
  return r + ' ث';
}
function waRange(preset, now) {
  var s = waDayStart(now);
  if (preset === 'today') return { from: s, to: Infinity };
  if (preset === '7d') return { from: waDayStart(s - 6 * 86400000 + 3600000), to: Infinity };
  if (preset === '30d') return { from: waDayStart(s - 29 * 86400000 + 3600000), to: Infinity };
  return { from: -Infinity, to: Infinity };
}
function waResponder(k) { return k === 'bot' ? 'bot' : (k === 'pharm' || k === 'out') ? 'pharm' : null; }
function waStats(items) {
  var n = items.length;
  if (!n) return { n: 0, min: null, median: null, mean: null, p90: null, max: null, maxItem: null };
  var a = items.slice().sort(function (x, y) { return x.d - y.d; }), sum = 0;
  for (var i = 0; i < n; i++) sum += a[i].d;
  return { n: n, min: a[0].d, median: n % 2 ? a[(n - 1) / 2].d : (a[n / 2 - 1].d + a[n / 2].d) / 2, mean: sum / n, p90: a[Math.ceil(0.9 * n) - 1].d, max: a[n - 1].d, maxItem: a[n - 1] };
}
// data = { customers:[{id,name}], events:[{c, k:'in'|'bot'|'pharm'|'out'|'sys', t, h?:1, tp?:[topicId]}] }
// o = { from, to, who:'all'|'bot'|'pharm', now }. Range filters the CUSTOMER message time (handoffs: the handoff time).
function waCompute(data, o) {
  o = o || {};
  var now = o.now || Date.now(), who = o.who === 'bot' || o.who === 'pharm' ? o.who : 'all';
  var from = o.from == null ? -Infinity : o.from, to = o.to == null ? Infinity : o.to;
  var names = {}, byC = {}, ids = [];
  (data.customers || []).forEach(function (c) { names[c.id] = c.name || c.id; });
  (data.events || []).forEach(function (e, i) {
    var t = waTs(e.t);
    if (!t) return;
    if (!byC[e.c]) { byC[e.c] = []; ids.push(e.c); }
    byC[e.c].push({ c: e.c, k: e.k, t: t, h: !!e.h, tp: e.tp || [], i: i });
  });
  var msgs = [], handoffs = [], firsts = [], waiting = [], custN = {}, newC = {}, convSet = {}, topics = {};
  var days = {}, hours = [], heat = [], totalMsgs = 0, inMsgs = 0, outMsgs = 0, h, w;
  for (h = 0; h < 24; h++) hours.push({ msgs: 0, inMsgs: 0, convs: {} });
  for (w = 0; w < 7; w++) { heat.push([]); for (h = 0; h < 24; h++) heat[w].push(0); }
  function nm(c) { return names[c] || c; }
  ids.forEach(function (c) {
    var ev = byC[c].sort(function (a, b) { return a.t - b.t || a.i - b.i; }), n = ev.length, nextRep = null, i, e, firstIn = null;
    for (i = 0; i < n; i++) { if (ev[i].k === 'in') { firstIn = ev[i]; break; } }
    for (i = n - 1; i >= 0; i--) {
      e = ev[i];
      if (waResponder(e.k)) nextRep = e;
      var inR = e.t >= from && e.t < to;
      if (inR && e.k !== 'sys') {
        convSet[c] = 1; totalMsgs++;
        var p = waParts(e.t), dk = waDayKey(e.t), dd = days[dk] || (days[dk] = { key: dk, msgs: 0, inMsgs: 0, convs: {}, custs: {} });
        dd.msgs++; dd.convs[c] = (dd.convs[c] || 0) + 1; hours[p.h].msgs++; hours[p.h].convs[c] = (hours[p.h].convs[c] || 0) + 1;
        if (e.k === 'in') { inMsgs++; dd.inMsgs++; dd.custs[c] = 1; hours[p.h].inMsgs++; heat[p.wd][p.h]++; } else outMsgs++;
      }
      if (e.k === 'in' && inR) {
        custN[c] = (custN[c] || 0) + 1;
        if (e === firstIn) newC[c] = 1;
        e.tp.forEach(function (id) { (topics[id] = topics[id] || {})[c] = (topics[id][c] || 0) + 1; });
        var rep = nextRep, it = { c: c, name: nm(c), t: e.t, rt: rep ? rep.t : null, d: rep ? rep.t - e.t : null, by: rep ? waResponder(rep.k) : null };
        msgs.push(it);
        if (e === firstIn) firsts.push(it);
      }
      if (e.h && inR) handoffs.push({ c: c, name: nm(c), t: e.t, rt: nextRep ? nextRep.t : null, d: nextRep && waResponder(nextRep.k) === 'pharm' ? nextRep.t - e.t : null, by: nextRep ? waResponder(nextRep.k) : null, pend: !(nextRep && waResponder(nextRep.k) === 'pharm') });
    }
  });
  function byT(a, b) { return a.t - b.t; }
  msgs.sort(byT); handoffs.sort(byT); firsts.sort(byT);
  // waiting-now: conversations whose last customer-facing message is from the customer (state at `now`, not range-bound)
  ids.forEach(function (c) {
    var ev = byC[c], i, firstWait = null;
    for (i = ev.length - 1; i >= 0; i--) {
      if (ev[i].k === 'sys') continue;
      if (ev[i].k === 'in') firstWait = ev[i]; else break;
    }
    if (firstWait) waiting.push({ c: c, name: nm(c), t: firstWait.t, d: Math.max(0, now - firstWait.t), by: null });
  });
  waiting.sort(function (a, b) { return b.d - a.d; });
  var answered = msgs.filter(function (m) { return m.rt != null; }), unans = msgs.filter(function (m) { return m.rt == null; });
  var scope = answered.filter(function (m) { return who === 'all' || m.by === who; });
  var scopeFirst = firsts.filter(function (m) { return m.rt != null && (who === 'all' || m.by === who); });
  var den = scope.length + unans.length, within = {};
  [1, 5, 15, 60].forEach(function (mn) {
    var l = scope.filter(function (m) { return m.d <= mn * 60000; });
    within[mn] = { n: l.length, den: den, pct: den ? Math.round((l.length / den) * 1000) / 10 : null, items: l };
  });
  var botL = answered.filter(function (m) { return m.by === 'bot'; }), phL = answered.filter(function (m) { return m.by === 'pharm'; });
  var hoAns = handoffs.filter(function (x) { return !x.pend; });
  var unansH = msgs.filter(function (m) { return m.by !== 'pharm'; });
  var custList = Object.keys(custN).map(function (c) { return { c: c, name: nm(c), n: custN[c], t: null, d: null }; });
  var dayList = [], ks = Object.keys(days).sort(), cur = isFinite(from) ? waDayStart(from) : (ks.length ? waKeyStart(ks[0]) : null);
  var last = isFinite(to) ? waDayStart(to - 1) : (isFinite(from) ? waDayStart(now) : (ks.length ? waKeyStart(ks[ks.length - 1]) : null)), guard = 0;
  while (cur !== null && last !== null && cur <= last && guard++ < 800) {
    var key = waDayKey(cur), d0 = days[key];
    dayList.push({ key: key, msgs: d0 ? d0.msgs : 0, inMsgs: d0 ? d0.inMsgs : 0, convs: d0 ? Object.keys(d0.convs).length : 0, custs: d0 ? Object.keys(d0.custs).length : 0, wd: waParts(cur + 3600000).wd });
    cur = waNextDay(cur);
  }
  var drill = { replies: scope, first: scopeFirst, bot: botL, pharm: phL, slowest: scope.length ? [waStats(scope).maxItem] : [], unanswered: unans, waiting: waiting, handoff: handoffs, handoffAns: hoAns, customers: custList,
    newC: custList.filter(function (x) { return newC[x.c]; }), returning: custList.filter(function (x) { return !newC[x.c]; }) };
  [1, 5, 15, 60].forEach(function (mn) { drill['w' + mn] = within[mn].items; });
  function cl(map) { return Object.keys(map).map(function (c) { return { c: c, name: nm(c), n: map[c] }; }); }
  Object.keys(days).forEach(function (k) { drill['d:' + k] = cl(days[k].convs); });
  hours.forEach(function (x, hh) { drill['h:' + hh] = cl(x.convs); });
  var topicList = WA_TOPICS.filter(function (t) { return topics[t.id]; }).map(function (t) { var c = topics[t.id]; drill['t:' + t.id] = cl(c); return { id: t.id, ar: t.ar, n: Object.keys(c).reduce(function (a, k2) { return a + c[k2]; }, 0), customers: Object.keys(c).length }; }).sort(function (a, b) { return b.n - a.n; });
  return {
    who: who, from: from, to: to, now: now,
    all: waStats(scope), first: waStats(scopeFirst), bot: waStats(botL), pharm: waStats(phL), handoff: waStats(hoAns),
    within: within, answered: answered.length, unanswered: unans.length, unansweredNoHuman: unansH.length, inMsgs: inMsgs,
    handoffs: { n: handoffs.length, answered: hoAns.length, pending: handoffs.length - hoAns.length },
    waiting: waiting.length,
    volume: { customers: custList.length, newC: drill.newC.length, returning: drill.returning.length, convs: Object.keys(convSet).length, msgs: totalMsgs, inMsgs: inMsgs, outMsgs: outMsgs },
    days: dayList, hours: hours.map(function (x) { return { msgs: x.msgs, inMsgs: x.inMsgs, convs: Object.keys(x.convs).length }; }), heat: heat, topics: topicList, drill: drill
  };
}
/* UX300-SHARED-END */
/* UX300: WhatsApp customer-service dashboard (read-only). Data = text-free events from GET /api/v1/inbox/history/metrics (same gate as the old chats: no PIN on staging/preview since UX400), kept in memory only. All times are shown in Africa/Cairo. */
var dash={open:false,data:null,busy:false,err:'',code:'',preset:'all',who:'all',from:'',to:'',drill:null,res:null};
var DWD=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
var DTITLE={first:'الرد الأول لكل محادثة',replies:'كل ردود الفريق',bot:'ردود البوت',pharm:'ردود الصيدلي',slowest:'أبطأ رد',unanswered:'رسائل عملاء بدون رد',waiting:'عملاء بانتظار الرد الآن',handoff:'كل التحويلات للصيدلي',handoffAns:'تحويلات رد عليها الصيدلي',customers:'العملاء اللي كتبوا',newC:'عملاء جدد',returning:'عملاء عائدون',w1:'ردود خلال دقيقة',w5:'ردود خلال 5 دقائق',w15:'ردود خلال 15 دقيقة',w60:'ردود خلال ساعة'};
var DCSS='.wd{direction:rtl;color:#f1f3f5;font-size:14px;line-height:1.6;--wd-in:#79c9eb;--wd-bot:#b8a6d7;--wd-ph:#69c6a8;--wd-bad:#e88e96;--wd-amb:#c5aa79}.wd *{box-sizing:border-box}'+
'.wd-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:0 0 10px}.wd-head h2{margin:0;font-size:20px;flex:1;min-width:180px}.wd button,.wd input{font:inherit}'+
'.wd-btn{min-height:44px;padding:0 16px;border-radius:10px;border:1px solid #2a313a;background:#14181d;color:#dce3ea;cursor:pointer;transition:background .2s,border-color .2s}.wd-btn:hover{background:#1b2026;border-color:#3a4857}.wd-btn:focus-visible,.wd [data-drill]:focus-visible{outline:2px solid #76b8d5;outline-offset:2px}'+
'.wd-bar{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;padding:10px 12px;margin:0 0 12px;background:#101216;border:1px solid #2a3037;border-radius:12px}.wd-seg{display:inline-flex;border:1px solid #2a313a;border-radius:10px;overflow:hidden}.wd-seg button{min-height:40px;padding:0 14px;border:0;background:#0d0f12;color:#a4adb7;cursor:pointer;transition:background .2s,color .2s}.wd-seg button+button{border-inline-start:1px solid #2a313a}.wd-seg button[aria-pressed=true]{background:#1c303b;color:#79c9eb;font-weight:600}'+
'.wd-bar label{display:inline-flex;align-items:center;gap:6px;color:#a4adb7}.wd-bar input[type=date]{height:40px;border:1px solid #2a313a;border-radius:8px;background:#0d0f12;color:#f2f3f5;padding:0 8px;color-scheme:dark}'+
'.wd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:10px;margin:0 0 14px}.wd-card{display:block;text-align:right;width:100%;padding:12px 14px;border-radius:14px;border:1px solid #2a3037;background:linear-gradient(180deg,#14181d,#101216);color:inherit;cursor:pointer;transition:transform .2s,border-color .2s,box-shadow .2s;animation:wd-up .5s both}.wd-card:hover{transform:translateY(-2px);border-color:#3a4857;box-shadow:0 8px 24px #0007}'+
'.wd-card .l{display:block;color:#a4adb7;font-size:13px}.wd-card .v{display:block;font-size:26px;font-weight:700;margin:2px 0;font-variant-numeric:tabular-nums}.wd-card .s{display:block;color:#808b96;font-size:12.5px}.wd-card.bot .v{color:var(--wd-bot)}.wd-card.ph .v{color:var(--wd-ph)}.wd-card.in .v{color:var(--wd-in)}.wd-card.bad .v{color:var(--wd-bad)}.wd-card.amb .v{color:var(--wd-amb)}'+
'.wd-sec{margin:0 0 14px;padding:14px;border-radius:14px;border:1px solid #2a3037;background:#101216}.wd-sec h3{margin:0 0 10px;font-size:16px}.wd-sec h3 small{color:#808b96;font-weight:400;margin-inline-start:8px}.wd-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;margin:0 0 14px}.wd-two>.wd-sec{margin:0}'+
'.wd-tw{overflow-x:auto}.wd table{border-collapse:collapse;width:100%;min-width:520px}.wd th,.wd td{padding:4px 6px;text-align:right;white-space:nowrap}.wd th{color:#808b96;font-weight:500;font-size:12.5px}.wd td button{width:100%;min-height:40px;border:0;border-radius:8px;background:transparent;color:inherit;cursor:pointer;text-align:right;font-variant-numeric:tabular-nums;transition:background .2s}.wd td button:hover{background:#1b2026}.wd td.rn{font-weight:600}.wd td.rn button{font-weight:600}'+
'.wd-w{display:grid;gap:8px}.wd-w button{display:grid;grid-template-columns:96px 1fr 120px;gap:10px;align-items:center;width:100%;min-height:44px;padding:4px 8px;border:0;border-radius:8px;background:transparent;color:inherit;cursor:pointer;text-align:right;transition:background .2s}.wd-w button:hover{background:#1b2026}.wd-track{height:10px;border-radius:6px;background:#1b2026;overflow:hidden;direction:ltr}.wd-fill{height:100%;border-radius:6px;background:linear-gradient(90deg,#387e9e,#79c9eb);transform-origin:left;animation:wd-x .8s cubic-bezier(.2,.8,.2,1) both}.wd-w .p{font-variant-numeric:tabular-nums;color:#a4adb7;text-align:left;direction:ltr}'+
'.wd svg{display:block;width:100%;height:auto;direction:ltr}.wd .ax{fill:#808b96;font-size:10px}.wd .gl{stroke:#232930;stroke-width:1}.wd-line{fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1;animation:wd-draw 1.2s cubic-bezier(.2,.8,.2,1) forwards}.wd-area{animation:wd-fade 1s .2s both}.wd-hit{fill:transparent;cursor:pointer}.wd-hit:hover,.wd-hit:focus{fill:rgba(121,201,235,.1);outline:0}.wd-bar-r{transform-box:fill-box;transform-origin:bottom;animation:wd-grow .7s cubic-bezier(.2,.8,.2,1) both}'+
'.wd-leg{display:flex;gap:14px;flex-wrap:wrap;color:#a4adb7;font-size:12.5px;margin:6px 0 0}.wd-leg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-inline-end:5px}'+
'.wd-heat{overflow-x:auto;direction:ltr}.wd-hr{display:grid;grid-template-columns:64px repeat(24,minmax(14px,1fr));gap:3px;margin:0 0 3px;min-width:560px;align-items:center}.wd-hr span.d{direction:rtl;text-align:right;color:#a4adb7;font-size:12px}.wd-hr i{display:block;aspect-ratio:1;border-radius:4px;background:#79c9eb;min-height:14px;transition:transform .15s}.wd-hr i:hover{transform:scale(1.25)}.wd-hr b{font-weight:400;color:#808b96;font-size:10px;text-align:center}'+
'.wd-tp{display:grid;gap:6px}.wd-tp button{display:grid;grid-template-columns:110px 1fr 70px;gap:10px;align-items:center;width:100%;min-height:40px;padding:2px 8px;border:0;border-radius:8px;background:transparent;color:inherit;cursor:pointer;text-align:right}.wd-tp button:hover{background:#1b2026}'+
'.wd-dr{scroll-margin-top:12px;animation:wd-up .35s both}.wd-dr ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}.wd-dr li{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;padding:8px 10px;border-radius:10px;background:#14181d;border:1px solid #232930}.wd-dr li .nm{font-weight:600;flex:1;min-width:120px}.wd-dr .t{color:#a4adb7;font-size:13px;direction:ltr;unicode-bidi:plaintext}.wd-dr .d{font-weight:700;font-variant-numeric:tabular-nums}.wd-tag{padding:1px 8px;border-radius:999px;font-size:12px;border:1px solid #2a3037}.wd-tag.bot{color:var(--wd-bot);background:#221d2a}.wd-tag.pharm{color:var(--wd-ph);background:#10231e}.wd-tag.none{color:var(--wd-bad);background:#29181c}'+
'.wd-dr li button{min-height:36px;padding:0 12px;border-radius:8px;border:1px solid #79c9eb;background:#0d0f12;color:#79c9eb;cursor:pointer}.wd-note{color:#808b96;font-size:12.5px;margin:8px 0 0}.wd-empty{padding:18px;text-align:center;color:#a4adb7}'+
'@keyframes wd-up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@keyframes wd-x{from{transform:scaleX(0)}to{transform:scaleX(1)}}@keyframes wd-grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}@keyframes wd-draw{to{stroke-dashoffset:0}}@keyframes wd-fade{from{opacity:0}to{opacity:1}}'+
'@media (prefers-reduced-motion:reduce){.wd *{animation:none!important;transition:none!important}.wd-line{stroke-dashoffset:0}}@media (max-width:520px){.wd-w button{grid-template-columns:78px 1fr 92px}.wd-card .v{font-size:22px}}';
function dNow(){return Date.now()}
function dCompute(){
  var r;if(dash.preset==='custom'){var f=dash.from?waKeyStart(dash.from):null,t=dash.to?waKeyStart(dash.to):null;r={from:f==null?-Infinity:f,to:t==null?Infinity:waNextDay(t)}}else r=waRange(dash.preset,dNow());
  dash.res=waCompute(dash.data,{from:r.from,to:r.to,who:dash.who,now:dNow()});return dash.res}
function dLoad(){if(dash.busy||!hOn())return;dash.busy=true;dash.err='';dash.code='';dashDraw();
  hGet('metrics').then(function(j){dash.data=j.data&&Array.isArray(j.data.events)?j.data:{customers:[],events:[]}}).catch(function(e){if(e&&e.code==='GATED'){dash.open=false;hSetErr(e);dash.busy=false;draw();return}dash.err=String((e&&e.message)||e);dash.code=(e&&e.code)||'SERVER'}).then(function(){dash.busy=false;if(dash.open)dashDraw()})}
function dClose(){dash.open=false;dash.drill=null;wa.f='';draw()}
function dN(v){return String(v)}
function dSmooth(p,top,base){if(!p.length)return '';var d='M'+p[0][0].toFixed(1)+' '+p[0][1].toFixed(1);function cy(y){return Math.max(top,Math.min(base,y)).toFixed(1)}
  for(var i=0;i<p.length-1;i++){var a=p[i-1]||p[i],b=p[i],c=p[i+1],e=p[i+2]||c;d+=' C'+(b[0]+(c[0]-a[0])/6).toFixed(1)+' '+cy(b[1]+(c[1]-a[1])/6)+','+(c[0]-(e[0]-b[0])/6).toFixed(1)+' '+cy(c[1]-(e[1]-b[1])/6)+','+c[0].toFixed(1)+' '+c[1].toFixed(1)}return d}
function dNice(m){if(m<=4)return 4;var p=Math.pow(10,Math.floor(Math.log(m)/Math.LN10)),f=m/p;return (f<=1?1:f<=2?2:f<=5?5:10)*p}
function dDayChart(days){
  if(!days.length)return '<div class="wd-empty">لا توجد رسائل في هذه الفترة.</div>';
  var W=640,H=220,L=34,R=10,T=14,B=26,n=days.length,mx=dNice(Math.max.apply(null,days.map(function(d){return d.msgs}).concat([1]))),iw=W-L-R,ih=H-T-B,base=T+ih;
  function X(i){return n===1?L+iw/2:L+iw*i/(n-1)}function Y(v){return base-ih*v/mx}
  var g='',i,pi=days.map(function(d,k){return [X(k),Y(d.inMsgs)]}),pa=days.map(function(d,k){return [X(k),Y(d.msgs)]});
  for(i=0;i<=4;i++){var gy=T+ih*i/4;g+='<line class="gl" x1="'+L+'" x2="'+(W-R)+'" y1="'+gy+'" y2="'+gy+'"/><text class="ax" x="'+(L-6)+'" y="'+(gy+3)+'" text-anchor="end">'+Math.round(mx*(4-i)/4)+'</text>'}
  var step=Math.max(1,Math.ceil(n/7)),lb='';for(i=0;i<n;i+=step)lb+='<text class="ax" x="'+X(i)+'" y="'+(H-8)+'" text-anchor="middle">'+days[i].key.slice(5)+'</text>';
  var area=n>1?dSmooth(pi,T,base)+' L'+X(n-1).toFixed(1)+' '+base+' L'+X(0).toFixed(1)+' '+base+' Z':'';
  var hw=n===1?iw:iw/(n-1),hits=days.map(function(d,k){return '<rect class="wd-hit" tabindex="0" role="button" data-drill="d:'+d.key+'" x="'+(X(k)-hw/2).toFixed(1)+'" y="'+T+'" width="'+hw.toFixed(1)+'" height="'+ih+'" aria-label="'+d.key+': '+d.inMsgs+' رسالة عملاء، '+d.custs+' عميل"><title>'+d.key+' — '+d.inMsgs+' رسالة عملاء · '+d.msgs+' إجمالي · '+d.custs+' عميل</title></rect>'}).join('');
  var dots=n<=31?pi.map(function(p){return '<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="3" fill="#79c9eb"/>'}).join(''):'';
  return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="الرسائل يومياً"><defs><linearGradient id="wdg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#79c9eb" stop-opacity=".45"/><stop offset="1" stop-color="#79c9eb" stop-opacity="0"/></linearGradient></defs>'+g+lb+(n>1?'<path class="wd-area" d="'+area+'" fill="url(#wdg)"/><path class="wd-line" pathLength="1" d="'+dSmooth(pa,T,base)+'" stroke="#808b96" stroke-width="1.5"/><path class="wd-line" pathLength="1" d="'+dSmooth(pi,T,base)+'" stroke="#79c9eb" stroke-width="2.5"/>':'<rect class="wd-bar-r" x="'+(X(0)-18)+'" y="'+Y(days[0].inMsgs)+'" width="36" height="'+(base-Y(days[0].inMsgs))+'" rx="6" fill="#79c9eb"/>')+dots+hits+'</svg>'+
  '<div class="wd-leg"><span><i style="background:#79c9eb"></i>رسائل العملاء</span><span><i style="background:#808b96"></i>كل الرسائل (عملاء + رد)</span></div>'}
function dHourChart(hs){
  var W=640,H=170,L=26,R=6,T=10,B=22,mx=dNice(Math.max.apply(null,hs.map(function(h){return h.inMsgs}).concat([1]))),iw=W-L-R,ih=H-T-B,base=T+ih,bw=iw/24,s='',i;
  for(i=0;i<=2;i++){var gy=T+ih*i/2;s+='<line class="gl" x1="'+L+'" x2="'+(W-R)+'" y1="'+gy+'" y2="'+gy+'"/><text class="ax" x="'+(L-5)+'" y="'+(gy+3)+'" text-anchor="end">'+Math.round(mx*(2-i)/2)+'</text>'}
  hs.forEach(function(h,k){var bh=ih*h.inMsgs/mx,x=L+bw*k+bw*.15;s+='<rect class="wd-bar-r" style="animation-delay:'+k*20+'ms" x="'+x.toFixed(1)+'" y="'+(base-bh).toFixed(1)+'" width="'+(bw*.7).toFixed(1)+'" height="'+bh.toFixed(1)+'" rx="3" fill="#79c9eb" opacity="'+(h.inMsgs?1:.25)+'"/><rect class="wd-hit" tabindex="0" role="button" data-drill="h:'+k+'" x="'+(L+bw*k).toFixed(1)+'" y="'+T+'" width="'+bw.toFixed(1)+'" height="'+ih+'" aria-label="الساعة '+k+': '+h.inMsgs+' رسالة، '+h.convs+' محادثة"><title>'+waPad(k)+':00 — '+h.inMsgs+' رسالة عملاء · '+h.convs+' محادثة</title></rect>';if(k%3===0)s+='<text class="ax" x="'+(L+bw*k+bw/2)+'" y="'+(H-6)+'" text-anchor="middle">'+waPad(k)+'</text>'});
  return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="الرسائل حسب الساعة (توقيت القاهرة)">'+s+'</svg>'}
function dHeat(heat){
  var mx=1,w,h,o='<div class="wd-hr"><span></span>';for(w=0;w<7;w++)for(h=0;h<24;h++)mx=Math.max(mx,heat[w][h]);
  for(h=0;h<24;h++)o+='<b>'+(h%3===0?waPad(h):'')+'</b>';o+='</div>';
  [6,0,1,2,3,4,5].forEach(function(wd){o+='<div class="wd-hr"><span class="d">'+DWD[wd]+'</span>';for(h=0;h<24;h++){var v=heat[wd][h];o+='<i style="opacity:'+(v?(.18+.82*v/mx).toFixed(2):.05)+'" title="'+DWD[wd]+' '+waPad(h)+':00 — '+v+' رسالة"></i>'}o+='</div>'});
  return '<div class="wd-heat" role="img" aria-label="أكثر الساعات ازدحاماً حسب اليوم">'+o+'</div>'}
function dCard(cls,key,l,v,s){return '<button type="button" class="wd-card '+cls+'" data-drill="'+key+'"><span class="l">'+l+'</span><span class="v">'+v+'</span><span class="s">'+s+'</span></button>'}
function dRow(key,label,st,slowKey){var c=function(k,v){return '<td><button type="button" data-drill="'+k+'">'+v+'</button></td>'};return '<tr><td class="rn"><button type="button" data-drill="'+key+'">'+label+'</button></td>'+c(key,st.n)+c(key,waDur(st.median))+c(key,waDur(st.mean))+c(key,waDur(st.p90))+c(slowKey||key,waDur(st.max))+'</tr>'}
function dDrillHtml(key,r){
  var list=(r.drill[key]||[]),title=DTITLE[key],m;
  if(!title){if(m=/^d:(.+)$/.exec(key))title='عملاء يوم '+m[1];else if(m=/^h:(\d+)$/.exec(key))title='عملاء الساعة '+waPad(+m[1])+':00 (توقيت القاهرة)';else if(m=/^t:(.+)$/.exec(key)){var tp=WA_TOPICS.filter(function(x){return x.id===m[1]})[0];title='موضوع: '+(tp?tp.ar:m[1])}else title=key}
  var seen=key==='waiting'||key==='unanswered'||/^w\d+$/.test(key)||key==='replies'||key==='first'||key==='bot'||key==='pharm'||key==='slowest'||key==='handoff'||key==='handoffAns';
  var rows=list.slice(0,200).map(function(x){var o='<li><span class="nm">'+escH(x.name)+'</span>';
    if(x.t!=null)o+='<span class="t">'+(key==='waiting'?'آخر رسالة: ':'')+waDateTime(x.t)+'</span>';
    if(x.n!=null&&x.t==null)o+='<span class="t">'+x.n+' رسالة</span>';
    if(key==='waiting')o+='<span class="d" style="color:#e88e96">ينتظر '+waDur(x.d)+'</span>';
    else if(x.d!=null)o+='<span class="d">'+waDur(x.d)+'</span><span class="wd-tag '+x.by+'">'+(x.by==='bot'?'البوت':'الصيدلي')+'</span>';
    else if(seen&&x.pend)o+='<span class="wd-tag none">لم يرد الصيدلي بعد</span>';
    else if(seen)o+='<span class="wd-tag none">بدون رد</span>';
    return o+'<button type="button" data-open-chat="'+escH(x.c)+'">فتح المحادثة</button></li>'}).join('');
  return '<div class="wd-sec wd-dr" id="wdDrill" tabindex="-1" role="region" aria-label="'+escH(title)+'"><h3>'+escH(title)+'<small>'+list.length+' عنصر</small> <button type="button" class="wd-btn" data-drill-close style="min-height:36px;margin-inline-start:8px">إغلاق</button></h3>'+(rows?'<ul>'+rows+'</ul>':'<div class="wd-empty">لا توجد عناصر.</div>')+(list.length>200?'<p class="wd-note">أول 200 عنصر فقط.</p>':'')+'</div>'}
function dashHtml(){
  var seg=function(attr,cur,opts){return '<span class="wd-seg" role="group">'+opts.map(function(o){return '<button type="button" '+attr+'="'+o[0]+'" aria-pressed="'+(cur===o[0])+'">'+o[1]+'</button>'}).join('')+'</span>'};
  var head='<div class="wd-head"><button type="button" class="wd-btn" id="wdBack" aria-label="الرجوع إلى المحادثات">→ المحادثات</button><h2 tabindex="-1" id="wdTitle">أداء خدمة العملاء — واتساب</h2><button type="button" class="wd-btn" id="wdRefresh"'+(dash.busy?' disabled':'')+'>'+(dash.busy?'جاري التحميل…':'تحديث')+'</button><button type="button" class="wd-btn" data-wa-lock>قفل</button></div>';
  if(!dash.data)return '<style>'+DCSS+'</style><div class="wd" dir="rtl">'+head+(dash.err?'<div class="wd-sec" role="alert" style="border-color:#b91c1c"><div>'+escH(dash.err)+'</div><button type="button" class="wd-btn" id="wdRefresh" style="margin-top:8px">إعادة المحاولة</button></div>':'<div class="wd-sec wd-empty" role="status">جاري تحميل المقاييس…</div>')+'</div>';
  var r=dCompute(),V=r.volume,bar='<div class="wd-bar" role="group" aria-label="فلاتر اللوحة">'+seg('data-wd-preset',dash.preset,[['today','اليوم'],['7d','7 أيام'],['30d','30 يوم'],['all','الكل'],['custom','مخصص']])+
    '<label>من <input type="date" id="wdFrom" value="'+escH(dash.from)+'"></label><label>إلى <input type="date" id="wdTo" value="'+escH(dash.to)+'"></label>'+seg('data-wd-who',dash.who,[['all','الكل'],['bot','البوت'],['pharm','الصيدلي']])+'<span style="color:#808b96;font-size:12.5px">التوقيت: القاهرة</span></div>';
  var cards='<div class="wd-grid">'+
    dCard('','first','الرد الأول (وسيط)',waDur(r.first.median),'متوسط '+waDur(r.first.mean)+' · '+r.first.n+' محادثة')+
    dCard('','replies','زمن الرد (وسيط)',waDur(r.all.median),'الأبطأ '+waDur(r.all.max)+' · '+r.all.n+' رد')+
    dCard('bot','bot','رد البوت (وسيط)',waDur(r.bot.median),r.bot.n+' رد')+
    dCard('ph','pharm','رد الصيدلي (وسيط)',waDur(r.pharm.median),r.pharm.n+' رد')+
    dCard('amb','handoffAns','من التحويل لرد الصيدلي',waDur(r.handoff.median),r.handoffs.n+' تحويل · '+r.handoffs.pending+' بدون رد صيدلي')+
    dCard('bad','unanswered','رسائل بدون رد',r.unanswered,'من '+r.inMsgs+' رسالة عميل')+
    dCard('bad','waiting','بانتظار الرد الآن',r.waiting,'محادثات آخر رسالة فيها من العميل')+
    dCard('in','customers','عملاء كتبوا',V.customers,'جدد '+V.newC+' · عائدون '+V.returning)+'</div>';
  var tbl='<div class="wd-sec"><h3>أزمنة الرد بالتفصيل<small>الحدّ الأدنى للقياس: ثانية</small></h3><div class="wd-tw"><table><thead><tr><th>النوع</th><th>العدد</th><th>الوسيط</th><th>المتوسط</th><th>أبطأ 10٪ (p90)</th><th>الأبطأ</th></tr></thead><tbody>'+
    dRow('first','الرد الأول لكل محادثة',r.first)+dRow('replies','كل الردود'+(r.who==='all'?'':r.who==='bot'?' (البوت)':' (الصيدلي)'),r.all,'slowest')+dRow('bot','البوت',r.bot)+dRow('pharm','الصيدلي',r.pharm)+dRow('handoffAns','التحويل ← رد الصيدلي',r.handoff)+'</tbody></table></div></div>';
  var wb='<div class="wd-sec"><h3>نسبة الردود في الوقت<small>من كل رسائل العملاء في الفلتر</small></h3><div class="wd-w">'+[1,5,15,60].map(function(m){var w=r.within[m];return '<button type="button" data-drill="w'+m+'"><span>خلال '+(m===60?'ساعة':m===1?'دقيقة':m+' دقائق')+'</span><span class="wd-track"><span class="wd-fill" style="display:block;width:'+(w.pct||0)+'%"></span></span><span class="p">'+(w.pct==null?'—':w.pct+'٪')+' · '+w.n+'/'+w.den+'</span></button>'}).join('')+'</div></div>';
  var vol='<div class="wd-sec"><h3>حجم المحادثات<small>عملاء '+V.customers+' · محادثات '+V.convs+' · رسائل '+V.msgs+'</small></h3>'+dDayChart(r.days)+'</div>';
  var hrs='<div class="wd-two"><div class="wd-sec"><h3>الرسائل حسب الساعة<small>توقيت القاهرة</small></h3>'+dHourChart(r.hours)+'</div><div class="wd-sec"><h3>أكثر الأوقات ازدحاماً</h3>'+dHeat(r.heat)+'</div></div>';
  var tmax=Math.max.apply(null,r.topics.map(function(t){return t.n}).concat([1])),top='<div class="wd-sec"><h3>أكثر المواضيع<small>تصنيف بالكلمات المفتاحية</small></h3>'+(r.topics.length?'<div class="wd-tp">'+r.topics.slice(0,8).map(function(t){return '<button type="button" data-drill="t:'+t.id+'"><span>'+t.ar+'</span><span class="wd-track"><span class="wd-fill" style="display:block;width:'+Math.round(100*t.n/tmax)+'%"></span></span><span class="p" style="text-align:left;direction:ltr;color:#a4adb7">'+t.n+' · '+t.customers+' عميل</span></button>'}).join('')+'</div>':'<div class="wd-empty">لا توجد مواضيع واضحة.</div>')+'</div>';
  var dr=dash.drill?dDrillHtml(dash.drill,r):'<div id="wdDrill"></div>';
  return '<style>'+DCSS+'</style><div class="wd" dir="rtl">'+head+bar+cards+dr+tbl+wb+vol+hrs+top+'<p class="wd-note">كل رقم قابل للضغط لعرض المحادثات وراءه. الأرقام من المحادثات المستوردة ومن الرسائل الحية؛ التوقيتات بالثواني تُحوَّل تلقائياً. العرض للقراءة فقط.</p></div>'}
function dashDraw(){box.innerHTML=dashHtml();var t=box.querySelector('#wdTitle');if(t&&dash.fresh){dash.fresh=false;t.focus()}}
function dDrillOnly(key){dash.drill=dash.drill===key?null:key;var el=box.querySelector('#wdDrill');if(!el)return;var tmp=document.createElement('div');tmp.innerHTML=dash.drill?dDrillHtml(dash.drill,dash.res):'<div id="wdDrill"></div>';el.replaceWith(tmp.firstChild);var n=box.querySelector('#wdDrill');if(dash.drill&&n){try{n.scrollIntoView({behavior:window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'nearest'})}catch(x){}n.focus({preventScroll:true})}}
function dOpen(){if(!hOn()||!hist.loaded)return;dash.open=true;dash.fresh=true;dash.drill=null;dashDraw();if(!dash.data)dLoad()}
box.addEventListener('click',function(e){var t=e.target;if(!t.closest)return;if(t.closest('#waDashOpen')){dOpen();return}if(!dash.open)return;
  if(t.closest('#wdBack')){dClose();return}if(t.closest('#wdRefresh')){dash.data=null;dLoad();return}
  var p=t.closest('[data-wd-preset]');if(p){dash.preset=p.dataset.wdPreset;dash.drill=null;dashDraw();return}
  var w=t.closest('[data-wd-who]');if(w){dash.who=w.dataset.wdWho;dash.drill=null;dashDraw();return}
  if(t.closest('[data-drill-close]')){dDrillOnly(dash.drill);return}
  var oc=t.closest('[data-open-chat]');if(oc){var id=oc.dataset.openChat;dash.open=false;wa.sel=id;wa.f='open';draw();hOpen(id);return}
  var d=t.closest('[data-drill]');if(d)dDrillOnly(d.dataset.drill)});
box.addEventListener('change',function(e){if(!dash.open||!e.target)return;if(e.target.id==='wdFrom'||e.target.id==='wdTo'){dash[e.target.id==='wdFrom'?'from':'to']=e.target.value;dash.preset='custom';dash.drill=null;dashDraw()}});
box.addEventListener('keydown',function(e){if(!dash.open)return;if(e.key==='Escape'){e.stopPropagation();e.preventDefault();dClose();return}var d=e.target&&e.target.closest&&e.target.closest('[data-drill]');if(d&&d.tagName!=='BUTTON'&&(e.key==='Enter'||e.key===' ')){e.preventDefault();dDrillOnly(d.dataset.drill)}},true);
/* UX241: bounded DOM (latest wa.lim messages, "رسائل أقدم" reveals more), scroll anchor kept across redraws, floating scroll-to-latest button */
var LIM0=80,LIMSTEP=80;
/* UX404: WhatsApp FAB: shows once scrolled up ~a third of a screen or when new incoming messages arrived below; badge = those messages; reaching the bottom clears it. Older history loads by itself near the top (position kept). */
function selCount(){var c=null;convs().forEach(function(x){if(x.id===wa.sel)c=x});return c&&c.messages?c.messages.length:0}
function latestBtn(){var ms=box.querySelector('#waMsgs'),b=box.querySelector('[data-wa-latest]');if(!ms||!b)return;var d=ms.scrollHeight-ms.scrollTop-ms.clientHeight;if(d<=40&&wa.newN){wa.newN=0;wa.seen=selCount();var n=b.querySelector('[data-wa-fab-n]');if(n){n.hidden=true;n.textContent=''}b.setAttribute('aria-label','انزل للأحدث')}var hide=!(wa.newN>0||d>Math.max(240,ms.clientHeight/3));if(b.hidden!==hide)b.hidden=hide}
/* UX404: scroll anchor = first message visible at the top; restoring it is exact even when off-screen rows only have estimated (content-visibility) heights */
function msgAnchor(m){var t=m.getBoundingClientRect().top,els=m.querySelectorAll('[data-mid]'),lo=0,hi=els.length-1,f=-1;while(lo<=hi){var mid=(lo+hi)>>1;if(els[mid].getBoundingClientRect().bottom>t){f=mid;hi=mid-1}else lo=mid+1}return f<0?null:{id:els[f].dataset.mid,y:els[f].getBoundingClientRect().top-t}}
function olderAuto(){var ms=box.querySelector('#waMsgs');if(!ms||wa.olq||ms.scrollTop>Math.max(300,ms.clientHeight*.6)||!ms.querySelector('[data-wa-older]'))return;wa.olq=1;requestAnimationFrame(function(){wa.olq=0;var m=box.querySelector('#waMsgs');if(!m||m.scrollTop>Math.max(300,m.clientHeight*.6)||!m.querySelector('[data-wa-older]'))return;wa.lim=(wa.lim||LIM0)+LIMSTEP;draw()})}
function focKey(){var a=document.activeElement;if(!a||!box.contains(a))return '';if(a.id)return '#'+a.id;if(a.dataset&&a.dataset.conv)return '[data-conv="'+a.dataset.conv+'"]';if(a.hasAttribute&&a.hasAttribute('data-wa-back'))return '[data-wa-back]';if(a.dataset&&a.dataset.waMenu)return 'menu:'+a.dataset.waMenu;if(a.closest&&a.closest('.wa-menu'))return 'mitem:';if(a.hasAttribute&&a.hasAttribute('data-wa-arch-open'))return '[data-wa-arch-open]';if(a.hasAttribute&&a.hasAttribute('data-wa-arch-close'))return '[data-wa-arch-close]';return ''}
function focGo(k){var el=null;if(k==='open'){var b=box.querySelector('[data-wa-back]');el=b&&b.offsetParent!==null?b:box.querySelector('#waMsgs')}else if(k&&k.indexOf('chat:')===0){var id=k.slice(5);el=Array.prototype.filter.call(box.querySelectorAll('[data-conv]'),function(x){return x.dataset.conv===id})[0]}else if(k&&k.indexOf('menu:')===0){var mid=k.slice(5);el=Array.prototype.filter.call(box.querySelectorAll('[data-wa-menu]'),function(x){return x.dataset.waMenu===mid})[0]}else if(k&&k.indexOf('mitem:')===0){el=box.querySelector('.wa-menu [role=menuitem]')}else if(k){try{el=box.querySelector(k)}catch(e){}}if(el&&el.focus)el.focus()}
/* UX414: smooth redraws. The screen is still rendered as one HTML string, but instead of replacing everything (box.innerHTML, which
   rebuilt every bubble, reloaded images, restarted entry animations and jolted scrolling every 4 s poll), the new markup is MORPHED into
   the live DOM: unchanged nodes are kept as they are, changed attributes/text are patched, new bubbles are inserted, removed ones dropped.
   Identity: id, data-mid (messages), data-conv (chat rows). Form fields keep their typed value and focus. Any error falls back to innerHTML. */
function waMKey(n){if(n.nodeType!==1)return null;if(n.id)return'#'+n.id;var a=n.getAttribute('data-mid');if(a!=null)return'm'+a;a=n.getAttribute('data-conv');if(a!=null)return'c'+a;if(n.hasAttribute('data-wa-item')){var cv=n.querySelector('[data-conv]');if(cv)return'w'+cv.getAttribute('data-conv')}return null}
/* the language layer (Arabic/English) keeps each label's Arabic source in data-nova-original<attr> and shows the translation: an unchanged
   source keeps the translated value as is; a changed source is written and its stale copy dropped so the layer re-translates it. */
var WA_MI18N=['placeholder','title','aria-label'];
function waMAttrs(f,t){var i,a,n,o;for(i=f.attributes.length-1;i>=0;i--){a=f.attributes[i].name;if(a.indexOf('data-nova-original')===0)continue;if(!t.hasAttribute(a))f.removeAttribute(a)}
for(i=0;i<WA_MI18N.length;i++){o='data-nova-original'+WA_MI18N[i];if(!t.hasAttribute(WA_MI18N[i])&&f.hasAttribute(o))f.removeAttribute(o)}
for(i=0;i<t.attributes.length;i++){a=t.attributes[i];n=a.name;if(WA_MI18N.indexOf(n)>=0){o='data-nova-original'+n;if(f.hasAttribute(o)){if(f.getAttribute(o)===a.value)continue;f.removeAttribute(o)}}if(f.getAttribute(n)!==a.value)f.setAttribute(n,a.value)}}
function waMNode(f,t){if(f.nodeType===3||f.nodeType===8){if(f.nodeValue!==t.nodeValue&&f.parentNode)f.parentNode.replaceChild(t,f);return}waMAttrs(f,t);var tg=f.tagName;if(tg==='INPUT'||tg==='TEXTAREA'||tg==='SELECT'){if(tg==='INPUT'&&f.type==='file')return;if(document.activeElement!==f){if(tg==='INPUT'&&(f.type==='checkbox'||f.type==='radio')){if(f.checked!==t.hasAttribute('checked'))f.checked=t.hasAttribute('checked')}else if(tg==='INPUT'){var v=t.getAttribute('value')||'';if(f.value!==v)f.value=v}else if(f.innerHTML!==t.innerHTML){f.innerHTML=t.innerHTML}}return}waMKids(f,t)}
function waMKids(fp,tp){var olds=Array.prototype.slice.call(fp.childNodes),news=Array.prototype.slice.call(tp.childNodes),keyed={},used=new Set(),i,k;
for(i=0;i<olds.length;i++){k=waMKey(olds[i]);if(k&&!keyed[k])keyed[k]=olds[i]}
var cur=fp.firstChild;
for(i=0;i<news.length;i++){var nn=news[i],nk=waMKey(nn),m=null;
while(cur&&used.has(cur))cur=cur.nextSibling;
if(nk){var c=keyed[nk];if(c&&!used.has(c)&&c.tagName===nn.tagName)m=c}
else if(cur&&waMKey(cur)==null&&cur.nodeType===nn.nodeType&&(nn.nodeType!==1||cur.tagName===nn.tagName))m=cur;
if(m){if(m!==cur)fp.insertBefore(m,cur);else cur=cur.nextSibling;used.add(m);waMNode(m,nn)}
else fp.insertBefore(nn,cur)}
for(i=0;i<olds.length;i++)if(!used.has(olds[i])&&olds[i].parentNode===fp)fp.removeChild(olds[i])}
function waMorph(el,html){var t=document.createElement('template');t.innerHTML=html;if(!el.firstChild){el.appendChild(t.content);return}try{waMKids(el,t.content)}catch(e){el.innerHTML=html}}
function draw(){if(dash.open){dashDraw();return}var fk=wa.f||focKey();wa.f='';var oi=box.querySelector('#waInput'),dv=(oi&&!oi.disabled&&oi.value)||wa.draft||'';wa.draft='';var cs=convs(),old=box.querySelector('#waMsgs'),fromBottom=null;if(old&&wa.drawn===wa.sel&&!old.querySelector('[data-chat-loading],[data-chat-error]')&&old.scrollHeight-old.scrollTop-old.clientHeight>40)fromBottom=old.scrollHeight-old.scrollTop;if(wa.stick){fromBottom=null;wa.stick=0}/* UX401: after a send land on the newest message */var anc=fromBottom!==null?msgAnchor(old):null;/* UX404: at bottom (or leaving the loading skeleton) => land at the bottom */var scn=selCount();var lPm=old&&wa.drawn===wa.sel&&!old.querySelector('[data-chat-loading],[data-chat-error]')?lMids(old):null;/* UX402 */if(wa.drawn!==wa.sel){wa.lim=LIM0;wa.seen=scn;wa.newN=0}else if(fromBottom===null){wa.seen=scn;wa.newN=0}else if(scn>(wa.seen||0)){var sc0=null;cs.forEach(function(x){if(x.id===wa.sel)sc0=x});wa.newN=sc0?sc0.messages.slice(wa.seen||0).filter(function(m){return m.dir==='in'}).length:0}var an=wa.anim||'';wa.anim='';if(an){wa.animK=an;wa.animT=performance.now()}wa.drawn=wa.sel;var lp=histParts(),lt=wa.top||0,lb=wa.back;wa.back='';var pa=vPlaying();waMorph(box,arBar()+U.renderWa(cs,{histHead:lp.head,notifHead:nHead(),histPanel:lp.panel,selected:wa.sel,query:wa.q,list:listMeta(),sendEnabled:sendOn(),mediaEnabled:mediaOn(),audioEnabled:!!(hist.audio&&mediaOn()),windowClosed:!!(histSel()&&hist.full[wa.sel]&&winClosed(wa.sel)),staleNote:!!(histSel()&&winStale(wa.sel)),chatLoading:!!(histSel()&&hist.pend[wa.sel]&&!hist.full[wa.sel]),chatError:(histSel()&&!hist.full[wa.sel]&&hist.oerr[wa.sel])||'',sendErr:wa.sel?wa.err:'',sendHint:histSel()?'جاري تحميل المحادثة…':(hist.loaded?'مسودة فقط — الإرسال متوقف':'جاري تحميل المحادثات…'),loading:!hist.loaded&&!hist.err,now:Date.now(),limit:wa.lim||LIM0,newCount:wa.newN||0,anim:an,mediaUrl:mUrl,mediaDims:dimGet,mediaFail:wa.mfail,quote:wa.quote,quotes:wa.qmap,emojiOpen:wa.emo,attachOpen:wa.att,hasText:!!dv,olderRemote:wa.sel?tOlderState(wa.sel):null}));vKeep(pa);if(!an&&wa.animK){var ael=performance.now()-wa.animT,art=box.querySelector('.wa-root');if(ael<200&&art&&art.dataset.view===(wa.animK==='open'?'chat':'list')){art.dataset.anim=wa.animK;art.style.setProperty('--wa-ad',(-ael).toFixed(1)+'ms')}else wa.animK=''}/* UX404: a redraw during the 200ms slide (chat data arriving) continues it, never restarts or cuts it */var ms=box.querySelector&&box.querySelector('#waMsgs');if(ms){wa.atEnd=fromBottom===null;if(fromBottom===null)ms.scrollTop=ms.scrollHeight;else{ms.scrollTop=Math.max(0,ms.scrollHeight-fromBottom);if(anc){var ae=null;Array.prototype.some.call(ms.querySelectorAll('[data-mid]'),function(x){if(x.dataset.mid===anc.id){ae=x;return true}return false});if(ae)ms.scrollTop+=ae.getBoundingClientRect().top-ms.getBoundingClientRect().top-anc.y}}latestBtn()}var wl=box.querySelector('#waList');if(wl){wl.scrollTop=lt;if(lb){var le=Array.prototype.filter.call(wl.querySelectorAll('[data-conv]'),function(x){return x.dataset.conv===lb})[0];if(le){le.classList.add('active');var lr=le.getBoundingClientRect(),wr=wl.getBoundingClientRect();if(lr.top<wr.top||lr.bottom>wr.bottom){wl.scrollTop+=lr.top<wr.top?lr.top-wr.top:lr.bottom-wr.bottom}}}}var ni=box.querySelector('#waInput');if(ni){var wv=dv&&!ni.disabled?dv:'';if(ni.value!==wv)ni.value=wv}waHasText();dFloat(false);if(!box.hidden)focGo(fk);lMark(lPm);nAfterDraw();if(hist.code==='GATED'&&!hAuthed())hLoginCard(hist.lockMsg||'')}
/* UX402: smooth live insert. Bubbles that arrived after the last one already on screen get data-live (CSS waPop slide-in, no flash).
   Older pages (prepended) never animate; a local tmp_ bubble that just got its server id is not re-animated. */
function lMids(el){var o={};Array.prototype.forEach.call(el.querySelectorAll('[data-mid]'),function(x){o[x.dataset.mid]=1});return o}
function lMark(pm){if(!pm)return;var ms=box.querySelector('#waMsgs');if(!ms)return;var els=Array.prototype.slice.call(ms.querySelectorAll('[data-mid]')),ids=els.map(function(x){return x.dataset.mid}),last=-1,now={},swap=false;ids.forEach(function(id,k){now[id]=1;if(pm[id])last=k});Object.keys(pm).forEach(function(id){if(id.indexOf('tmp_')===0&&!now[id])swap=true});var nw={};U.newIds(pm,ids.slice(last+1)).forEach(function(id){nw[id]=1});els.slice(last+1).forEach(function(x){if(nw[x.dataset.mid]&&x.dataset.status!=='sending'&&!(swap&&x.dataset.dir==='out')){x.setAttribute('data-live','');wa.liveN=(wa.liveN||0)+1}})}
/* UX405: incoming media (same gate as the chat history; no PIN on staging/preview). Bytes come from GET .../inbox/history/media?id=<message id> (KV cache). A failed load swaps in the Arabic fallback card and is remembered so redraws do not retry. */
var mBlob={},mBusy={};
/* UX418: remembered photo sizes (id -> [w,h]) so a photo's box is the right size before it loads; kept on this device, newest 400. */
var waDimK='nova.wa.dims',waDims=(function(){try{var o=JSON.parse(localStorage.getItem(waDimK)||'{}');return o&&typeof o==='object'?o:{}}catch(e){return {}}})();
function dimGet(id){var d=waDims[id];return d&&d[0]>0&&d[1]>0?d:null}
function dimSet(id,w,h){id=String(id||'');if(!id||!(w>0&&h>0))return false;var o=waDims[id];if(o&&o[0]===w&&o[1]===h)return false;waDims[id]=[w,h];var ks=Object.keys(waDims);if(ks.length>400)ks.slice(0,ks.length-400).forEach(function(k){delete waDims[k]});try{localStorage.setItem(waDimK,JSON.stringify(waDims))}catch(e){}return true}
/* a photo finished loading: remember its size, give it its real box, and keep the reading position (iOS Safari has no scroll anchoring) */
box.addEventListener('load',function(e){var im=e.target;if(!im||im.tagName!=='IMG'||!im.hasAttribute('data-wa-mimg'))return;var id=im.getAttribute('data-wa-mid');if(!id||String(im.currentSrc||im.src).indexOf('data:,')===0)return;var w=im.naturalWidth,h=im.naturalHeight;if(!(w>0&&h>0))return;dimSet(id,w,h);if(!im.classList.contains('wa-ph'))return;
var ms=document.getElementById('waMsgs');if(!ms)return;var atEnd=ms.scrollHeight-ms.scrollTop-ms.clientHeight<64,mr=ms.getBoundingClientRect(),anc=null,ay=0,ls=ms.querySelectorAll('.wa-msg[data-mid]');
for(var qi=0;qi<ls.length;qi++){var rr=ls[qi].getBoundingClientRect();if(rr.top>=mr.top-1){anc=ls[qi];ay=rr.top;break}}
im.classList.remove('wa-ph');im.classList.add('wa-dim');im.setAttribute('width',w);im.setAttribute('height',h);im.style.cssText='width:min(260px,68vw);aspect-ratio:'+(Math.round(Math.min(1.78,Math.max(0.75,w/h))*1000)/1000)+';height:auto';
if(atEnd)ms.scrollTop=ms.scrollHeight;else if(anc){var d=anc.getBoundingClientRect().top-ay;if(d)ms.scrollTop+=d}
if(typeof latestBtn==='function')latestBtn()},true);
function mUrl(id){if(!id)return 'data:,';if(mBlob[id])return mBlob[id];if(!mBusy[id]&&hOn()){mBusy[id]=1;fetch(hUrl()+'media?id='+encodeURIComponent(id),{method:'GET',headers:hHdr({}),cache:'no-store',credentials:'omit'}).then(function(r){if(!r.ok)throw new Error(r.status);return r.blob()}).then(function(b){mBlob[id]=URL.createObjectURL(b);delete mBusy[id];if(typeof draw==='function')draw()}).catch(function(){delete mBusy[id];wa.mfail[id]=1;if(typeof draw==='function')draw()})}return 'data:,'}
function mFind(id){var f=null;Object.keys(hist.full).some(function(k){return (hist.full[k].messages||[]).some(function(m){if(m.id===id){f=m;return true}return false})});return f}
box.addEventListener('error',function(e){var t=e.target;if(!t||!t.closest)return;if(t.getAttribute&&String(t.getAttribute('src')||'').indexOf('data:,')===0)return;/* S1-01: mUrl's 'data:,' placeholder (blob still loading) is not a failed media load */var el=t.closest('[data-wa-mimg],[data-wa-mplay]');if(!el)return;var id=el.dataset.waMid;if(!id||wa.mfail[id])return;wa.mfail[id]=1;var m=mFind(id),md=(m&&m.media)||{},w=el.closest('[data-wa-media]');if(w){var bb=w.closest('.wa-bubble');if(bb)bb.classList.remove('wa-mo-ov');var tmp=document.createElement('div');tmp.innerHTML=U.mediaMiss(md.type||w.dataset.waMedia,md.skipped||'error',md.filename);w.parentNode.replaceChild(tmp.firstChild,w)}},true);
box.addEventListener('scroll',function(e){if(e.target&&e.target.id==='waMsgs'){var sm=e.target;wa.atEnd=sm.scrollHeight-sm.scrollTop-sm.clientHeight<=40;latestBtn();olderAuto();dFloat(true)}else if(e.target&&e.target.id==='waList'){wa.top=e.target.scrollTop;var l=e.target;if(l.scrollHeight-l.scrollTop-l.clientHeight<200&&hMoreState()==='idle')hMore()}},{capture:true,passive:true});
/* UX408: ONE floating date chip (WhatsApp iOS): while the thread scrolls it shows the day of the first visible message, centred at the top,
   and fades ~1.2s after scrolling stops; it is hidden whenever an inline day chip is already in that top band, so two chips never stack. */
var dT=0;function dFloat(on){var ms=box.querySelector('#waMsgs'),f=ms&&ms.querySelector('[data-wa-dfloat]');if(!f)return;clearTimeout(dT);if(!on){f.removeAttribute('data-show');return}var top=ms.getBoundingClientRect().top,seps=ms.querySelectorAll('[data-date-sep]'),cur=null,band=false;for(var i=0;i<seps.length;i++){var r=seps[i].getBoundingClientRect();if(r.top<=top+8)cur=seps[i];if(r.bottom>top-2&&r.top<top+44)band=true}if(!cur||band||ms.scrollTop<4){f.removeAttribute('data-show')}else{f.firstChild.textContent=cur.textContent;f.setAttribute('data-show','')}dT=setTimeout(function(){f.removeAttribute('data-show')},1200)}
/* UX408: photos keep their real aspect ratio, so their height is known only once loaded: a thread that sat at the newest message stays there */
box.addEventListener('load',function(e){var t=e.target;if(!t||t.tagName!=='IMG'||!t.hasAttribute('data-wa-mimg'))return;var ms=box.querySelector('#waMsgs');if(ms&&ms.contains(t)&&wa.atEnd!==false){ms.scrollTop=ms.scrollHeight;latestBtn()}},true);
/* UX408: Send only when there is text (mic/camera otherwise), like WhatsApp iOS */
function waHasText(){var c=box.querySelector('[data-wa-composer]'),i=box.querySelector('#waInput');if(c)c.setAttribute('data-has-text',i&&!i.disabled&&i.value.trim()?'1':'0')}
box.addEventListener('input',function(e){if(e.target&&e.target.id==='waInput')waHasText()});
box.addEventListener('click',function(e){var t=e.target;if(!t||!t.closest)return;var x;
if(t.closest('[data-wa-home]')){if(document.documentElement.classList.contains('app-whatsapp'))return;var hb=document.querySelector('.nova-nav [data-page="sale"]')||document.querySelector('[data-page="sale"]');if(hb)hb.click();return}
if((x=t.closest('[data-wa-filter]'))){wa.filt=x.dataset.waFilter;wa.menu=null;wa.top=0;wa.f='[data-wa-filter="'+wa.filt+'"]';draw();return}
if(t.closest('[data-wa-more-chats]')){hMore();return}
if(t.closest('[data-wa-older-remote]')){if(wa.sel)tOlder(wa.sel);return}
if(t.closest('[data-wa-video],[data-wa-call][aria-disabled]')){e.preventDefault();return}});
/* UX408: pin/archive menu without a per-row ▾: right-click / context-menu key, or a long press on the row (touch) */
function rowMenu(id){wa.menu=wa.menu===id?null:id;wa.f=wa.menu?'mitem:':'chat:'+id;draw()}
box.addEventListener('contextmenu',function(e){var r=e.target&&e.target.closest&&e.target.closest('#waList [data-conv]');if(!r)return;e.preventDefault();rowMenu(r.dataset.conv)});
var rlp=null;box.addEventListener('touchstart',function(e){var r=e.target&&e.target.closest&&e.target.closest('#waList [data-conv]');clearTimeout(rlp&&rlp.t);rlp=null;if(!r||e.touches.length!==1)return;var p=e.touches[0],s={x:p.clientX,y:p.clientY,id:r.dataset.conv};s.t=setTimeout(function(){if(rlp===s){s.fired=1;rowMenu(s.id)}},550);rlp=s},{passive:true});
box.addEventListener('touchmove',function(e){if(!rlp||!e.touches.length)return;var p=e.touches[0];if(Math.abs(p.clientX-rlp.x)>10||Math.abs(p.clientY-rlp.y)>10){clearTimeout(rlp.t);rlp=null}},{passive:true});
box.addEventListener('touchend',function(e){if(rlp&&rlp.fired){e.preventDefault()}if(rlp)clearTimeout(rlp.t);rlp=null});
box.addEventListener('click',function(e){var mo=e.target.closest('[data-wa-media-open]');if(mo){U.openLightbox(document,mo.dataset.waMediaOpen,mo);return}if(e.target.closest('#novaAutoReplyBtn')){arCall('POST',{enabled:!ar.on});return}var rt=e.target.closest('#waHistRetry');if(rt){hist.loaded=false;hLoad();return}var rl=e.target.closest('[data-wa-reload]');if(rl){if(wa.sel){delete hist.oerr[wa.sel];hOpen(wa.sel);draw()}return}if(e.target.closest('[data-wa-back]')){wa.quote=null;wa.emo=wa.att=false;wa.anim='back';wa.back=wa.sel||'';wa.f=wa.sel?'chat:'+wa.sel:'';wa.sel=null;draw();return}if(e.target.closest('[data-wa-older]')){wa.lim=(wa.lim||LIM0)+LIMSTEP;draw();return}if(e.target.closest('[data-wa-latest]')){var m=box.querySelector('#waMsgs');if(m)m.scrollTop=m.scrollHeight;latestBtn();return}var mb=e.target.closest('[data-wa-menu]');if(mb){var mi=mb.dataset.waMenu;wa.menu=wa.menu===mi?null:mi;wa.f=wa.menu?'mitem:':'menu:'+mi;draw();return}var pb=e.target.closest('[data-wa-pin]');if(pb){var pi=pb.dataset.waPin;if(wa.pin[pi])delete wa.pin[pi];else wa.pin[pi]=1;wa.menu=null;wa.f='chat:'+pi;draw();return}var ab=e.target.closest('[data-wa-arch]');if(ab){var ai=ab.dataset.waArch;if(wa.arch[ai])delete wa.arch[ai];else wa.arch[ai]=1;wa.menu=null;wa.f=wa.showArch||wa.q?'chat:'+ai:'[data-wa-arch-open]';draw();return}if(e.target.closest('[data-wa-arch-open]')){wa.showArch=true;wa.menu=null;wa.top=0;wa.f='[data-wa-arch-close]';draw();return}if(e.target.closest('[data-wa-arch-close]')){wa.showArch=false;wa.menu=null;wa.top=0;wa.f='[data-wa-arch-open]';draw();return}if(wa.menu&&!e.target.closest('.wa-menu')){wa.menu=null;draw()}var b=e.target.closest('[data-conv]');if(b){wa.menu=null;if(wa.sel!==b.dataset.conv){wa.err='';wa.draft='';wa.quote=null;wa.emo=wa.att=false}if(wa.sel!==b.dataset.conv)wa.anim='open';wa.sel=b.dataset.conv;wa.f='open';hOpen(wa.sel);draw()}});
box.addEventListener('keydown',function(e){if(e.key==='Escape'&&wa.menu){e.preventDefault();wa.f='chat:'+wa.menu;wa.menu=null;draw();return}if(e.key==='Escape'&&wa.sel){var t=e.target;if(t&&t.id==='waSearch'&&t.value)return;e.preventDefault();wa.quote=null;wa.emo=wa.att=false;wa.anim='back';wa.f='chat:'+wa.sel;wa.sel=null;draw();return}if((e.key==='ArrowDown'||e.key==='ArrowUp')&&e.target&&e.target.closest&&e.target.closest('#waList')){var bs=Array.prototype.slice.call(box.querySelectorAll('#waList [data-conv]')),i=bs.indexOf(e.target.closest('[data-conv]'));if(i<0)return;e.preventDefault();var n=bs[e.key==='ArrowDown'?Math.min(i+1,bs.length-1):Math.max(i-1,0)];if(n)n.focus()}else if(e.key==='ArrowDown'&&e.target&&e.target.id==='waSearch'){var f=box.querySelector('#waList [data-conv]');if(f){e.preventDefault();f.focus()}}});
box.addEventListener('input',function(e){if(e.target&&e.target.id==='waSearch'){wa.q=e.target.value;var l=box.querySelector('#waList');if(l)l.innerHTML=U.chatListHtml(convs(),wa.sel,wa.q,Date.now(),false,listMeta());var cb=box.querySelector('#waSearchClear');if(cb)cb.hidden=!wa.q}});
box.addEventListener('click',function(e){var cb=e.target.closest&&e.target.closest('[data-wa-sclear]');if(!cb)return;wa.q='';var i=box.querySelector('#waSearch');if(i){i.value='';i.focus()}var l=box.querySelector('#waList');if(l)l.innerHTML=U.chatListHtml(convs(),wa.sel,'',Date.now(),false,listMeta());cb.hidden=true});
/* UX407: the composer is a plain div (no <form>, so iOS shows no prev/next form bar): send = Enter in #waInput or the send button. Pressing the button keeps the keyboard open. */
box.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229&&e.target&&e.target.id==='waInput'){e.preventDefault();waSubmit()}});box.addEventListener('mousedown',function(e){if(e.target&&e.target.closest&&e.target.closest('[data-wa-send]')&&document.activeElement&&document.activeElement.id==='waInput')e.preventDefault()});box.addEventListener('click',function(e){if(e.target&&e.target.closest&&e.target.closest('[data-wa-send]')){e.preventDefault();waSubmit()}});
function waSubmit(){if(!sendOn()||!wa.sel)return;var i=box.querySelector('#waInput'),t=i&&i.value.trim();if(!t)return;if(t.length>1000){wa.err='الرسالة طويلة. الحد الأقصى 1000 حرف.';draw();return}i.value='';wa.f='#waInput';var q=wa.quote;wa.quote=null;wa.emo=wa.att=false;wa.stick=1;if(histSel()){hSend(wa.sel,t,q);return}var lm=inbox.send(wa.sel,t,Date.now());if(q&&lm)wa.qmap[lm.id]=q;draw()}
/* UX401: WhatsApp reply/quote (hover reply button, swipe a bubble sideways, long-press on touch; quote bar above the composer, × cancels, Esc cancels; tapping a quote jumps to the original), emoji picker, attach menu (no file sending), voice-note player. Nothing here sends anything: only waSubmit does, on the pharmacist's explicit send. */
function waMsg(id){var c=null;convs().forEach(function(x){if(x.id===wa.sel)c=x});var f=null;(c&&c.messages||[]).some(function(m){if(String(m.id)===String(id)){f=m;return true}return false});return f}
function waQuote(id){if(!sendOn())return;var m=waMsg(id);if(!m||String(m.id).indexOf('tmp_')===0)return;wa.quote={id:m.id,dir:m.dir,kind:m.kind,text:m.text,media:m.media||null};wa.emo=wa.att=false;wa.f='#waInput';draw()}
function waUnquote(){wa.quote=null;var qb=box.querySelector('[data-wa-qbar]');if(qb&&qb.parentNode)qb.parentNode.removeChild(qb);var c=box.querySelector('[data-wa-composer]');if(c)c.style.borderTop='';var i=box.querySelector('#waInput');if(i&&!i.disabled)i.focus()}
function waJump(id){var ms=box.querySelector('#waMsgs');if(!ms)return;var el=Array.prototype.filter.call(ms.querySelectorAll('.wa-msg[data-mid]'),function(x){return x.dataset.mid===String(id)})[0];if(!el&&waMsg(id)){wa.lim=Math.max(wa.lim||LIM0,selCount());draw();ms=box.querySelector('#waMsgs');el=ms&&Array.prototype.filter.call(ms.querySelectorAll('.wa-msg[data-mid]'),function(x){return x.dataset.mid===String(id)})[0]}if(!el)return;var r=el.getBoundingClientRect(),mr=ms.getBoundingClientRect();ms.scrollTop+=r.top-mr.top-(mr.height-r.height)/2;el.classList.remove('wa-flash');void el.offsetWidth;el.classList.add('wa-flash');setTimeout(function(){el.classList.remove('wa-flash')},1500);latestBtn()}
function waPop(){var p=box.querySelector('[data-wa-emoji-panel]'),a=box.querySelector('[data-wa-attach-menu]'),be=box.querySelector('[data-wa-emoji][aria-expanded]'),ba=box.querySelector('[data-wa-attach][aria-expanded]');if(p)p.hidden=!wa.emo;if(a)a.hidden=!wa.att;if(be)be.setAttribute('aria-expanded',String(!!wa.emo));if(ba)ba.setAttribute('aria-expanded',String(!!wa.att))}
function waEmo(e){var i=box.querySelector('#waInput');if(!i||i.disabled)return;var a=i.selectionStart==null?i.value.length:i.selectionStart,z=i.selectionEnd==null?a:i.selectionEnd;if(i.value.length-(z-a)+e.length>1000)return;i.setRangeText(e,a,z,'end');i.dispatchEvent(new Event('input',{bubbles:true}));if(!(window.matchMedia&&matchMedia('(pointer:coarse)').matches))i.focus()}
function vFmt(s){s=Math.max(0,Math.round(Number(s)||0));return Math.floor(s/60)+':'+(s%60<10?'0':'')+(s%60)}
function vUi(a){var w=a&&a.closest&&a.closest('[data-wa-voice]');if(!w)return;var d=isFinite(a.duration)&&a.duration>0?a.duration:0,p=d?Math.min(1,a.currentTime/d):0;w.style.setProperty('--p',(p*100).toFixed(2)+'%');var b=w.querySelector('[data-wa-vplay]');if(b){b.setAttribute('aria-pressed',String(!a.paused));b.setAttribute('aria-label',a.paused?'تشغيل الرسالة الصوتية':'إيقاف الرسالة الصوتية مؤقتاً')}var t=w.querySelector('[data-wa-vdur]');if(t&&(d||!a.paused))t.textContent=vFmt(!a.paused||a.currentTime>0?a.currentTime:d);var tr=w.querySelector('[data-wa-vtrack]');if(tr)tr.setAttribute('aria-valuenow',String(Math.round(p*100)))}
function vPlaying(){var f=null;Array.prototype.some.call(box.querySelectorAll('audio[data-wa-mplay]'),function(a){if(!a.paused){f=a;return true}return false});return f}
/* a redraw (live poll) never cuts a playing voice note: the playing <audio> is moved into the new bubble in the same task */
function vKeep(a){if(!a)return;var n=Array.prototype.filter.call(box.querySelectorAll('audio[data-wa-mplay]'),function(x){return x.dataset.waMid===a.dataset.waMid})[0];if(n&&n!==a){n.parentNode.replaceChild(a,n);vUi(a)}}
['play','pause','ended','timeupdate','loadedmetadata','durationchange'].forEach(function(ev){box.addEventListener(ev,function(e){var a=e.target;if(a&&a.tagName==='AUDIO'&&a.closest&&a.closest('[data-wa-voice]')){if(ev==='ended'){a.currentTime=0}vUi(a)}},true)});
box.addEventListener('mousedown',function(e){var t=e.target&&e.target.closest&&e.target.closest('[data-wa-emo],[data-wa-emoji],[data-wa-qcancel]');if(t&&document.activeElement&&document.activeElement.id==='waInput')e.preventDefault()});
box.addEventListener('click',function(e){var t=e.target;if(!t||!t.closest)return;var x;
if((x=t.closest('[data-wa-reply]'))){e.preventDefault();waQuote(x.dataset.waReply);return}
if(t.closest('[data-wa-qcancel]')){e.preventDefault();waUnquote();return}
if((x=t.closest('[data-wa-quote-jump]'))){e.preventDefault();waJump(x.dataset.waQuoteJump);return}
if((x=t.closest('[data-wa-emo]'))){e.preventDefault();waEmo(x.dataset.waEmo);return}
if((x=t.closest('[data-wa-emoji]'))){e.preventDefault();if(x.getAttribute('aria-disabled')==='true')return;wa.emo=!wa.emo;wa.att=false;waPop();return}
if((x=t.closest('[data-wa-attach]'))){e.preventDefault();if(x.getAttribute('aria-disabled')==='true')return;wa.att=!wa.att;wa.emo=false;waPop();return}
if(t.closest('[data-wa-attach-menu]'))return;
if((x=t.closest('[data-wa-vplay]'))){var au=x.parentNode&&x.parentNode.querySelector('audio');if(!au)return;if(au.paused){Array.prototype.forEach.call(box.querySelectorAll('audio[data-wa-mplay]'),function(o){if(o!==au&&!o.paused)o.pause()});var pr=au.play();if(pr&&pr.catch)pr.catch(function(){})}else au.pause();vUi(au);return}
if((x=t.closest('[data-wa-vtrack]'))){var w=x.closest('[data-wa-voice]'),a2=w&&w.querySelector('audio'),r=x.getBoundingClientRect();if(!a2||!r.width)return;var p=getComputedStyle(x).direction==='rtl'?(r.right-e.clientX)/r.width:(e.clientX-r.left)/r.width;p=Math.max(0,Math.min(1,p));if(isFinite(a2.duration)&&a2.duration>0){a2.currentTime=p*a2.duration;vUi(a2)}return}
if((wa.emo||wa.att)&&!t.closest('[data-wa-emoji-panel]')){wa.emo=wa.att=false;waPop()}});
box.addEventListener('keydown',function(e){if(e.key!=='Escape'||box.hidden)return;if(wa.emo||wa.att){e.preventDefault();e.stopPropagation();var be=wa.emo?'[data-wa-emoji]':'[data-wa-attach]';wa.emo=wa.att=false;waPop();var b=box.querySelector(be);if(b)b.focus();return}if(wa.quote&&e.target&&e.target.id!=='waSearch'){e.preventDefault();e.stopPropagation();waUnquote()}},true);
/* touch: swipe a bubble sideways >=56px or hold it ~0.5s to reply (vertical moves stay native scrolling) */
var sw=null;
box.addEventListener('touchstart',function(e){sw=null;var t=e.target;if(!t||!t.closest||e.touches.length!==1||!sendOn())return;var m=t.closest('#waMsgs .wa-msg[data-mid]');if(!m||t.closest('[data-wa-vtrack],[data-wa-quote-jump]')||String(m.dataset.mid).indexOf('tmp_')===0)return;var p=e.touches[0],s={m:m,x:p.clientX,y:p.clientY,dx:0,on:false};s.lp=setTimeout(function(){if(sw===s&&!s.on){s.done=1;waQuote(m.dataset.mid)}},480);sw=s},{passive:true});
box.addEventListener('touchmove',function(e){var s=sw;if(!s||s.done||!e.touches.length)return;var p=e.touches[0],dx=p.clientX-s.x,dy=p.clientY-s.y;if(!s.on){if(Math.abs(dx)>8||Math.abs(dy)>8)clearTimeout(s.lp);if(Math.abs(dy)>8&&Math.abs(dy)>=Math.abs(dx)){sw=null;return}if(Math.abs(dx)>12){s.on=true;s.m.setAttribute('data-swipe','')}}if(s.on){s.dx=Math.max(-80,Math.min(80,dx));var b=s.m.querySelector('.wa-bubble');if(b)b.style.transform='translate3d('+s.dx+'px,0,0)'}},{passive:true});
function swEnd(e){var s=sw;sw=null;if(!s)return;clearTimeout(s.lp);if(!s.on)return;s.m.removeAttribute('data-swipe');var b=s.m.querySelector('.wa-bubble');if(b)b.style.transform='';if(e.type==='touchend'&&Math.abs(s.dx)>=56)waQuote(s.m.dataset.mid)}
box.addEventListener('touchend',swEnd,{passive:true});box.addEventListener('touchcancel',swEnd,{passive:true});
box.addEventListener('contextmenu',function(e){if(e.target&&e.target.closest&&e.target.closest('#waMsgs .wa-msg')&&window.matchMedia&&matchMedia('(pointer:coarse)').matches)e.preventDefault()});
/* UX406: new-message notifications (Web Push + in-app sound + per-chat/tab/title unread). Permission is requested ONLY from the «فعّل الإشعارات» button (never automatically, never in a loop). Mute = localStorage nova.wa.mute. Unread seen-times: U.createUnread (hashed chat ids only). Hooks for UX402: window.NovaWaNotify. */
var nt=U.createUnread((function(){try{return localStorage}catch(e){return null}})(),Date.now()),nHint='',nToastUntil=0,nToastTid=0,nAc=null,nLastSnd=0,nPushOn=false,nPushed={},nStat={sounds:0,observed:0,pushes:0,toasts:0,sys:0},nTitleOn=false;
function nDropToast(){var el=box.querySelector('[data-wa-notif-note]');if(el)el.remove()}
function nHideToast(){nToastUntil=0;clearTimeout(nToastTid);nToastTid=0;nDropToast()}
function nPaintToast(){nDropToast();clearTimeout(nToastTid);nToastTid=0;if(!nToastUntil||Date.now()>=nToastUntil||!nHint){nToastUntil=0;return}var root=box.querySelector('.wa-root')||box,t=document.createElement('div');t.className='wa-nnote wa-nnote-toast';t.setAttribute('data-wa-notif-note','');t.setAttribute('role','status');t.textContent=nHint;root.appendChild(t);nToastTid=setTimeout(nHideToast,Math.max(0,nToastUntil-Date.now()))}
function nArmToast(msg){if(msg)nHint=String(msg);if(!nHint){nHideToast();return}nToastUntil=Date.now()+3000}
function nShowToast(msg){nArmToast(msg);nPaintToast()}
function nMuted(){try{return localStorage.getItem('nova.wa.mute')==='1'}catch(e){return false}}
function nPerm(){try{return typeof Notification==='undefined'?'unsupported':String(Notification.permission||'default')}catch(e){return 'unsupported'}}
function nVis(){return !box.hidden&&!document.hidden}
function nU(c){if(!nt)return 0;return c&&wa.sel===c.id&&nVis()?0:nt.count(c)}
function nTotal(){var cs=convs(),ids={},n=0;cs.forEach(function(c){ids[c.id]=1;if(nU(c)>0)n++});Object.keys(nPushed).forEach(function(k){if(!ids[k]&&nt.count({id:k,messages:[]})>0)n++});return n}
function nHead(){return U.notifyHtml(nPerm(),nMuted())}
function nBeep(){if(nMuted())return false;var t0=Date.now();if(t0-nLastSnd<1500)return false;var C=window.AudioContext||window.webkitAudioContext;if(!C)return false;try{nAc=nAc||new C();if(nAc.state==='suspended'&&nAc.resume)nAc.resume();var t=nAc.currentTime,o=nAc.createOscillator(),g=nAc.createGain();o.type='sine';o.frequency.setValueAtTime(880,t);o.frequency.setValueAtTime(1320,t+0.09);g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(0.15,t+0.02);g.gain.exponentialRampToValueAtTime(0.0001,t+0.25);o.connect(g);g.connect(nAc.destination);o.start(t);o.stop(t+0.26);nLastSnd=t0;nStat.sounds++;return true}catch(e){return false}}
/* background + system notifications on => the Service Worker already alerted (system sound); visible => in-app sound */
function nAlert(fresh){if(!fresh||!fresh.length)return;var now=Date.now(),hid=document.hidden,g=nPerm()==='granted';if(!(hid&&g&&nPushOn))nToast(U.toastFor(fresh,{screenVisible:!box.hidden,docHidden:hid,selected:wa.sel}));var f=fresh.filter(function(x){return !(nPushed[x.id]&&now-nPushed[x.id]<60000)});if(!f.length)return;if(hid&&g&&nPushOn)return;if(hid&&g)nSys(f);nBeep()}
/* UX402: in-app toast (Arabic, one at a time, auto-hides after 7s, never for the chat already on screen) + browser Notification when the tab is in the background and Web Push is not subscribed. No Notification support => toast + title/tab badges only. */
var nToastT=0;
function nOpenChat(id){if(box.hidden)tab.click();if(id!=null&&hist.convs.some(function(c){return c.id===String(id)})){wa.sel=String(id);wa.anim='open';hOpen(wa.sel)}draw()}
function nToastHide(){if(nToastT)clearTimeout(nToastT);var el=document.getElementById('novaWaToast');if(el)el.hidden=true}
function nToast(items){if(!items||!items.length||!document.body)return;var el=document.getElementById('novaWaToast');if(!el){if(!document.getElementById('ux402-toast-css')){var st=document.createElement('style');st.id='ux402-toast-css';st.textContent=U.TOAST_CSS;document.head.appendChild(st)}el=document.createElement('div');el.id='novaWaToast';el.setAttribute('role','status');el.setAttribute('aria-live','polite');el.setAttribute('dir','rtl');el.addEventListener('click',function(e){var t=e.target,o=t.closest&&t.closest('[data-wa-toast-open]');if(o){var id=o.getAttribute('data-wa-toast-open');nToastHide();nOpenChat(id);return}if(t.closest&&t.closest('[data-wa-toast-x]'))nToastHide()});document.body.appendChild(el)}el.innerHTML=U.toastHtml(items);el.hidden=false;el.dataset.chat=String(items[items.length-1].id);nStat.toasts++;if(nToastT)clearTimeout(nToastT);nToastT=setTimeout(nToastHide,7000)}
function nSys(f){var c=U.notifContent(f);if(!c)return false;var o={body:c.body,tag:c.tag,data:{chat:c.chat,url:'/#wa'}};try{var n=new Notification(c.title,o);n.onclick=function(){try{window.focus()}catch(x){}nOpenChat(c.chat);try{n.close()}catch(x){}};nStat.sys++;return true}catch(e){/* Android Chrome: no constructor => via the service worker */}try{if(navigator.serviceWorker&&navigator.serviceWorker.ready)navigator.serviceWorker.ready.then(function(r){if(r&&r.showNotification){nStat.sys++;return r.showNotification(c.title,o)}}).catch(function(){})}catch(e){}return false}
function nObserve(){var r=nt.observe(convs());nStat.observed++;nAlert(r.fresh);return r}
function nPaint(){if(!tab.querySelector||!tab.appendChild)return 0;var n=nTotal(),b=tab.querySelector('[data-wa-tab-unread]');if(!b){b=document.createElement('span');b.className='nova-tab-badge';b.style.cssText=U.TAB_BADGE_CSS;b.setAttribute('data-wa-tab-unread','');b.setAttribute('aria-hidden','true');tab.appendChild(b)}b.hidden=!n;b.textContent=n?(n>99?'99+':String(n)):'';b.dataset.count=String(n);if(n)tab.setAttribute('title',n+' محادثة فيها رسائل جديدة');else tab.removeAttribute('title');var bg=document.hidden||(typeof document.hasFocus==='function'&&!document.hasFocus());if(bg&&n){document.title=U.titleBadge(document.title,n);nTitleOn=true}else if(nTitleOn||/^\(\d+\+?\)\s/.test(document.title)){document.title=U.titleBadge(document.title,0);nTitleOn=false}if(hist.loaded&&window.NovaWaBadge&&typeof window.NovaWaBadge.paint==='function')window.NovaWaBadge.paint(n);/* UX402: header WhatsApp badge = same live count */return n}
/* seen up to the newest message on screen (server clock may run ahead of this device) */
function nAfterDraw(){if(!nt)return;if(wa.sel&&nVis()){var te=document.getElementById('novaWaToast');if(te&&!te.hidden&&te.dataset.chat===wa.sel)nToastHide();var t=Date.now();convs().forEach(function(c){if(c.id===wa.sel)(c.messages||[]).forEach(function(m){if(Number(m.at)>t)t=Number(m.at)})});nt.markSeen(wa.sel,t)}nPaint();nPaintToast()}
function nB64(s){var t=String(s).replace(/-/g,'+').replace(/_/g,'/'),b=atob(t+'==='.slice((t.length+3)%4)),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u}
function nSub(fromTap){var hint=function(s){nHint=s;if(fromTap)nArmToast(s)};if(typeof navigator==='undefined'||!navigator.serviceWorker||!window.PushManager){hint('الإشعارات هتظهر والصفحة مفتوحة بس (المتصفح مش بيدعم إشعارات الخلفية).');draw();return Promise.resolve(false)}
return navigator.serviceWorker.ready.then(function(reg){return reg.pushManager.getSubscription().then(function(s){var stale=false;try{stale=!!s&&Date.now()-Number(localStorage.getItem('nova.wa.pushAt')||0)>43200000}catch(x){}if(s&&!stale)return s;return (s?Promise.resolve(s.unsubscribe()).catch(function(){}):Promise.resolve()).then(function(){return hGet('push/key')}).then(function(j){if(!j||!j.enabled||!j.publicKey){hint('إشعارات الخلفية لسه مش متفعلة على السيرفر. الصوت والعداد شغالين والصفحة مفتوحة.');return null}return reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:nB64(j.publicKey)})})})}).then(function(s){if(!s)return false;return fetch(hUrl()+'push/subscribe',{method:'POST',headers:hHdr({'Content-Type':'application/json',Accept:'application/json'}),body:JSON.stringify({subscription:s.toJSON?s.toJSON():s}),cache:'no-store',credentials:'omit'}).then(function(r){if(!r.ok)throw new Error('http');try{localStorage.setItem('nova.wa.pushAt',String(Date.now()))}catch(x){}nPushOn=true;nHint='';if(fromTap)nHideToast();return true})}).catch(function(){hint('تعذّر تفعيل إشعارات الخلفية دلوقتي. هنحاول تاني لما تفتح المحادثات.');return false}).then(function(ok){draw();return ok})}
function nAsk(){var st=nPerm();if(st==='unsupported'){nShowToast('المتصفح ده مش بيدعم الإشعارات. الصوت والعداد شغالين عادي.');return}if(st==='denied'){nShowToast('الإشعارات مقفولة من المتصفح. افتح إعدادات الموقع (علامة القفل جنب العنوان) واختار «السماح» للإشعارات، وبعدين حدّث الصفحة.');return}if(st==='granted'){nSub(true);return}
var done=function(r){r=String(r||nPerm());if(r==='granted'){nHideToast();draw();nSub(true)}else if(r==='denied'){nShowToast('اترفض الإذن. تقدر تفعّله بعدين من إعدادات الموقع في المتصفح.')}else{nShowToast('ما اتفعلتش. دوس الزرار تاني وقت ما تحب.')}};try{var p=Notification.requestPermission(done);if(p&&typeof p.then==='function')p.then(done,function(){done('default')})}catch(e){done('default')}}
box.addEventListener('click',function(e){if(!e.target.closest)return;if(!nAc&&!nMuted()){var C=window.AudioContext||window.webkitAudioContext;if(C)try{nAc=new C()}catch(x){}}if(e.target.closest('[data-wa-notify]')){if(nPerm()==='granted'){try{localStorage.setItem('nova.wa.mute',nMuted()?'0':'1')}catch(x){}wa.f='[data-wa-notify]';draw();if(nHint)nShowToast(nHint);return}nAsk();return}if(e.target.closest('[data-wa-mute]')){try{localStorage.setItem('nova.wa.mute',nMuted()?'0':'1')}catch(x){}wa.f='[data-wa-mute]';draw()}});
document.addEventListener('visibilitychange',nPaint);window.addEventListener('focus',function(){nAfterDraw()});window.addEventListener('blur',nPaint);
if(typeof navigator!=='undefined'&&navigator.serviceWorker&&navigator.serviceWorker.addEventListener)navigator.serviceWorker.addEventListener('message',function(e){var d=e&&e.data;if(!d||typeof d!=='object')return;if(d.type==='nova-wa-push'){nStat.pushes++;var ids=d.chat?[d.chat]:(Array.isArray(d.chats)?d.chats:[]);ids.forEach(function(id){id=String(id);if(!(wa.sel===id&&nVis()))nt.bump(id,d.chat?(Number(d.count)||1):1);nPushed[id]=Date.now()});if(!document.hidden)nBeep();nPaint();if(nVis())hPoll()}else if(d.type==='nova-wa-open'){if(box.hidden)tab.click();if(d.chat&&hist.convs.some(function(c){return c.id===d.chat})){wa.sel=String(d.chat);wa.anim='open';hOpen(wa.sel)}draw()}});
window.NovaWaNotify={unread:function(id){var c=null;convs().forEach(function(x){if(x.id===id)c=x});return nU(c||{id:id,messages:[]})},total:nTotal,observe:nObserve,bump:function(id,k){nt.bump(id,k);nPaint()},markSeen:function(id){nt.markSeen(id,Date.now());nPaint()},sound:nBeep,paint:nPaint,permission:nPerm,muted:nMuted,stats:nStat,live:function(){return !!hist.loaded},poll:hPoll,delay:function(){return hist.delay},polls:function(){return hist.polls||0},toast:nToast,notify:nSys};
/* UX402: self-scheduling poll (no setInterval pile-up): 4s on the conversations screen, 15s elsewhere, paused while the tab is hidden, backoff on errors */
function hSched(){if(typeof setTimeout!=='function')return;if(hist.timer)clearTimeout(hist.timer);var d=U.pollDelay({docHidden:document.hidden,screenHidden:box.hidden,notifyBg:hBgN(),fails:hist.fails});hist.delay=d==null?null:d;if(d==null){hist.timer=0;return}hist.timer=setTimeout(function(){hist.timer=0;var p=hPoll();(p&&typeof p.then==='function'?p:Promise.resolve()).then(hSched,hSched)},d)}
if(!hist.timer)hSched();document.addEventListener('visibilitychange',function(){if(!document.hidden)hPoll();hSched()});
tab.addEventListener('click',function(){box.hidden=false;wa.f='';draw();if(!hist.loaded)hLoad();else hPoll();hSched();if(nPerm()==='granted'&&!nPushOn)nSub();inbox.pullRemote().then(function(r){if(r&&r.count!=null)draw()});arCall('GET');var pos=document.querySelector('.pos-root');if(pos){pos.hidden=true;pos.style.display='none'}host.hidden=true;box.hidden=false;nav.querySelectorAll('.nova-tab').forEach(function(t){t.classList.toggle('active',t===tab)});document.body.dataset.activePage='inbox'});
nav.addEventListener('click',function(e){if(e.target.closest('[data-page]')){if(document.documentElement.classList.contains('app-whatsapp')){e.stopPropagation();return}box.hidden=true;tab.classList.remove('active');hSched()}},true)}
if(on){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot()}})()