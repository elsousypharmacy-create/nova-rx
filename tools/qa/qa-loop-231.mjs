// QA loop 231: WhatsApp inbox + old chats (FIX46) deep audit. Local, fake data, non-GET blocked, history API mocked.
// PW_MODULE=<playwright-core/index.mjs> node tools/qa/qa-loop-231.mjs
const { chromium } = await import(''+(process.env.PW_MODULE||'playwright')+'');
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..','..'); const OUT=ROOT+'/.nova/qa/qa-loop-231'; fs.mkdirSync(OUT,{recursive:true});
const T={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json'};
const log={http404:[],blocked:[],res:{}};
const srv=http.createServer((q,s)=>{let p=decodeURIComponent(new URL(q.url,'http://x').pathname);if(p==='/')p='/index.html';if(p==='/purchases')p='/purchases.html';if(p==='/emergency/stock.json')p='/data/emergency-stock.json';const f=path.resolve(ROOT,'.'+p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){log.http404.push(p);s.writeHead(404).end('nf');return}s.writeHead(200,{'content-type':T[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(s)});
await new Promise(r=>srv.listen(0,'127.0.0.1',r)); const BASE='http://127.0.0.1:'+srv.address().port; const origin=BASE;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const PIN='test-pin-1234567';
const now=Date.now(), D=86400000;
const names=['منى التجريبية','أحمد محمود عبد الرحمن السيد الشاذلي الإسكندراني صاحب الطلبية الكبيرة','Sara Ibrahim','خالد','نورهان','محمد علي','هدى','ياسر','سلمى','عمر','ليلى','حسن','رانيا','طارق','دعاء','مصطفى','إيمان','كريم','آية','وليد','سمر','باسم'];
const LONG='أهلاً بحضرتك، بخصوص الدواء اللي سألت عنه: متوفر عندنا بسعرين حسب الشركة المصنعة، والسعر الأول 45 جنيه والتاني 62 جنيه، ولو حابب نجهزه لحضرتك ونوصله للمنزل قولنا العنوان ورقم الموبايل ونبعت الطلب في أقرب وقت ممكن إن شاء الله، وبرجاء تأكيد الروشتة لو الدواء من الأدوية المقيدة. ';
const CONVS=names.map((n,i)=>({id:'wa_2010000000'+String(i).padStart(2,'0'),customer:n,updatedAt:now-i*D*0.7-i*1000,count:i===0?320:6,last:{id:'h_last'+i,dir:i%2?'in':'out',kind:i%3===0?'bot':i%3===1?'in':'pharm',text:i===1?LONG:'متوفر بـ 30 جنيه يا فندم '+i,at:now-i*D*0.7,status:'delivered'}}));
function full(id){const i=CONVS.findIndex(c=>c.id===id);const n=i===0?320:8;const msgs=[];for(let k=0;k<n;k++){const day=Math.floor(k/12);const at=now-(Math.ceil(n/12)-day)*D+k*60000;const kind=k%7===3?'sys':k%2===0?'in':(k%4===1?'bot':'pharm');msgs.push({id:'h_'+id+'_'+k,dir:kind==='in'?'in':'out',kind,text:kind==='sys'?'اتحوّل للصيدلي':(k%9===0?LONG+LONG:'رسالة رقم '+k+' عندكم بنادول؟'),at,status:kind==='in'||kind==='sys'?null:'delivered'})}
 return{id,customer:CONVS[i].customer,updatedAt:msgs[msgs.length-1].at,messages:msgs}}
const SEED=()=>{};
const stepsOut={}; let document_back_needed=false;
for(const [vp,size] of [['d',{width:1366,height:768}],['m',{width:390,height:844}]]){
 const b=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:size,locale:'ar-EG',isMobile:vp==='m',hasTouch:vp==='m'});
 const hist=[];
 await ctx.route('**/*',r=>{const q=r.request(),m=q.method(),u=q.url();
  if(u.includes('/api/v1/inbox/history/')){hist.push(u.replace(/^https?:\/\/[^/]+/,''));const pin=q.headers()['x-nova-pin'];const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'};
   if(m==='OPTIONS')return r.fulfill({status:204,headers:cors});
   if(pin!==PIN)return r.fulfill({status:401,headers:cors,contentType:'application/json',body:JSON.stringify({ok:false,code:'PIN_INVALID',message_ar:'رقم PIN غير صحيح.'})});
   const body=u.includes('/conversations')?{ok:true,conversations:CONVS}:{ok:true,conversation:full(new URL(u).searchParams.get('id'))};
   return setTimeout(()=>r.fulfill({status:200,headers:cors,contentType:'application/json',body:JSON.stringify(body)}),250)}
  if(m!=='GET'&&m!=='HEAD'&&m!=='OPTIONS'){log.blocked.push(m+' '+u.slice(0,80));return r.abort()}
  if(!u.startsWith(BASE)&&!u.startsWith('data:')&&!u.startsWith('blob:'))return r.abort();return r.continue()});
 document_back_needed=vp==='m'; const page=await ctx.newPage(); const R=log.res[vp]={errs:[],steps:{},tabs:{},perf:{}};
 page.on('pageerror',e=>R.errs.push('pageerror: '+e.message.slice(0,150)));
 page.on('console',m=>{if(m.type()==='error'&&!/ERR_FAILED|Failed to load resource: net::/.test(m.text()))R.errs.push('console: '+m.text().slice(0,150))});
 page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/inbox/history/'))R.errs.push('HTTP '+r.status()+' '+r.url().replace(BASE,'').slice(0,80))});
 await page.addInitScript(()=>{window.__cls=0;try{new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__cls+=e.value}).observe({type:'layout-shift',buffered:true})}catch(e){}});
 await page.goto(BASE+'/',{waitUntil:'load'}); await sleep(1500);
 const shot=async n=>page.screenshot({path:`${OUT}/${vp}-${n}.png`}).catch(()=>{});
 // smoke: tabs
 const tabs=await page.$$eval('.nova-tab',els=>els.map(e=>({t:e.textContent.trim(),p:e.dataset.page||e.id})));
 R.tabList=tabs;console.error(JSON.stringify(tabs));
 for(const t of tabs){if(t.p==="novaPurchasesNav"){R.tabs[t.t]="link (checked via request)";continue}const sel=t.p&&t.p.startsWith('nova')?'#'+t.p:`.nova-tab[data-page="${t.p}"]`;const t0=Date.now();try{await page.click(sel,{timeout:3000})}catch(e){R.tabs[t.t]='click-fail';continue}await sleep(250);R.tabs[t.t]=await page.evaluate(()=>({len:document.body.innerText.length,nf:/Not found|404/.test(document.body.innerText),ov:document.documentElement.scrollWidth>innerWidth+2}))}
 // purchases page
 const pr=await page.request.get(BASE+'/purchases.html'); R.purchases=pr.status();
 // open WA
 await page.click('.nova-tab[data-page="sale"]').catch(()=>{});
 let t0=Date.now(); await page.click('#novaWaBtn'); await page.waitForSelector('#novaInboxView:not([hidden]) .wa-root'); R.perf.openInbox=Date.now()-t0; await sleep(300);
 await shot('wa-locked');
 R.steps.locked=await page.evaluate(()=>{const v=document.getElementById('novaInboxView');const bar=v.querySelector('#waHistBar').getBoundingClientRect();const root=v.querySelector('.wa-root').getBoundingClientRect();const inp=v.querySelector('#waHistPin');const ir=inp.getBoundingClientRect();const bt=v.querySelector('#waHistForm button').getBoundingClientRect();
  return{pageScrollH:document.documentElement.scrollHeight,vh:innerHeight,barH:Math.round(bar.height),rootTop:Math.round(root.top),rootBottom:Math.round(root.bottom),pinH:Math.round(ir.height),btnH:Math.round(bt.height),pinType:inp.type,autofocus:document.activeElement===inp,demoChat:v.querySelector('.wa-chat')?.innerText.slice(0,40),root:[Math.round(root.width),Math.round(root.height)]}});
 // wrong PIN
 await page.fill('#waHistPin','wrong-pin-000000'); t0=Date.now(); await page.click('#waHistForm button[type=submit]'); await page.waitForSelector('.wa-lock-err'); R.perf.wrongPin=Date.now()-t0; await shot('wa-wrong-pin');
 R.steps.wrong={msg:await page.textContent('.wa-lock-err'),focus:await page.evaluate(()=>document.activeElement.id||document.activeElement.tagName),pinVal:await page.inputValue('#waHistPin')};
 // enter key submit with empty
 await page.fill('#waHistPin',''); await page.press('#waHistPin','Enter'); await sleep(200); R.steps.empty=await page.textContent('.wa-lock-err').catch(()=>null);
 // right PIN via Enter
 await page.fill('#waHistPin',PIN); t0=Date.now(); await page.press('#waHistPin','Enter');
 await sleep(40); R.steps.busy=await page.evaluate(()=>document.querySelector('#waHistForm button')?.textContent);
 await page.waitForSelector('#novaInboxView [data-conv^="wa_2010"]'); R.perf.loadList=Date.now()-t0; await sleep(300); await shot('wa-list');
 R.steps.list=await page.evaluate(()=>{const v=document.getElementById('novaInboxView');const l=v.querySelector('#waList');const items=[...v.querySelectorAll('.wa-chat')];const ch=items[1];const nm=ch.querySelector('.wa-name').getBoundingClientRect();const pv=ch.querySelector('.wa-preview').getBoundingClientRect();
  return{n:items.length,listScrollH:l.scrollHeight,listH:l.clientHeight,pageScrollH:document.documentElement.scrollHeight,vh:innerHeight,pageOv:document.documentElement.scrollWidth>innerWidth+2,bar:v.querySelector('#waHistBar').innerText.slice(0,60),firstTime:items[0].querySelector('.wa-ctime').textContent,secTime:items[3].querySelector('.wa-ctime').textContent,longNameW:Math.round(nm.width),previewW:Math.round(pv.width),chatH:Math.round(items[0].getBoundingClientRect().height),emptyMain:!!v.querySelector('.wa-main .wa-empty'),mainVisible:getComputedStyle(v.querySelector('.wa-main')).display}});
 // scroll list then click chat #14
 await page.evaluate(()=>{document.getElementById('waList').scrollTop=600}); await sleep(100);
 const before=await page.evaluate(()=>document.getElementById('waList').scrollTop);
 await page.click('[data-conv="wa_201000000012"]'); await sleep(90); await shot('wa-chat-loading'); R.steps.loadingState=await page.evaluate(()=>({msgs:document.querySelectorAll('#waMsgs [data-mid]').length,spinner:!!document.querySelector('#waMsgs .wa-loading,[aria-busy=true]')})); await page.waitForSelector('[data-mid^="h_wa_201000000012"]'); if(document_back_needed) await page.click('[data-wa-back]');
 t0=Date.now(); await page.click('[data-conv="wa_201000000011"]'); await page.waitForSelector('[data-mid^="h_wa_201000000011"]'); R.perf.openSmallChat=Date.now()-t0; await sleep(300);
 R.steps.listScroll={before,after:await page.evaluate(()=>document.getElementById('waList')?.scrollTop??'hidden')}; await shot('wa-chat-small');
 if(vp==='m'){ await page.click('[data-wa-back]'); await sleep(200); R.steps.backScroll=await page.evaluate(()=>({listTop:document.getElementById('waList').scrollTop,active:!!document.querySelector('.wa-chat.active'),view:document.querySelector('.wa-root').dataset.view})); await shot('wa-back');}
 // open big chat
 t0=Date.now(); await page.click('[data-conv="wa_201000000000"]'); await page.waitForSelector('[data-mid="h_wa_201000000000_319"]',{timeout:5000}).catch(()=>{}); R.perf.openBigChat=Date.now()-t0; await sleep(500);
 R.steps.big=await page.evaluate(()=>{const m=document.getElementById('waMsgs');const seps=[...m.querySelectorAll('.wa-date span')].map(s=>s.textContent);const bub=[...m.querySelectorAll('.wa-bubble')];const widths=bub.map(b=>b.getBoundingClientRect().width);const main=document.querySelector('.wa-main').getBoundingClientRect();
  const sticky=getComputedStyle(m.querySelector('.wa-date')).position;
  const head=document.querySelector('.wa-head');const hr=head.getBoundingClientRect();
  return{msgs:m.querySelectorAll('[data-mid]').length,scrollTop:Math.round(m.scrollTop),scrollH:m.scrollHeight,clientH:m.clientHeight,atBottom:Math.abs(m.scrollHeight-m.clientHeight-m.scrollTop)<3,seps:seps.slice(0,4).concat(['…',seps.length]),dateSticky:sticky,maxBubbleW:Math.round(Math.max(...widths)),mainW:Math.round(main.width),headText:head.innerText.slice(0,60),headH:Math.round(hr.height),headSubtitle:!!head.querySelector('small,.wa-sub'),composerDisabled:document.getElementById('waInput').disabled,pageScrollH:document.documentElement.scrollHeight,vh:innerHeight,rootBottom:Math.round(document.querySelector('.wa-root').getBoundingClientRect().bottom)}});
 await shot('wa-chat-big');
 // scroll up in the big chat then wait for a re-draw (e.g. search typing doesn't redraw). Check scroll preserved when other chat clicked & back
 if(vp==='d'){
  await page.evaluate(()=>{document.getElementById('waMsgs').scrollTop=2000}); await sleep(100);
  // click same chat again => redraw
  await page.click('[data-conv="wa_201000000000"]'); await sleep(300);
  R.steps.reclickScroll=await page.evaluate(()=>({top:Math.round(document.getElementById('waMsgs').scrollTop),atBottom:Math.abs(document.getElementById('waMsgs').scrollHeight-document.getElementById('waMsgs').clientHeight-document.getElementById('waMsgs').scrollTop)<3}));
 }
 // search
 if(vp==='m'){await page.click('[data-wa-back]'); await sleep(200)}
 await page.fill('#waSearch','سا'); await sleep(200); R.steps.search1=await page.evaluate(()=>[...document.querySelectorAll('.wa-chat .wa-name')].map(n=>n.textContent.slice(0,15)));
 await shot('wa-search');
 await page.fill('#waSearch','Sara'); await sleep(150); R.steps.searchLatin=await page.evaluate(()=>document.querySelectorAll('.wa-chat').length);
 await page.fill('#waSearch','أحمد'); await sleep(150); R.steps.searchHamza=await page.evaluate(()=>document.querySelectorAll('.wa-chat').length);
 await page.fill('#waSearch','احمد'); await sleep(150); R.steps.searchNoHamza=await page.evaluate(()=>document.querySelectorAll('.wa-chat').length);
 await page.fill('#waSearch','zzzz'); await sleep(150); await shot('wa-search-empty'); R.steps.searchNone=await page.evaluate(()=>document.querySelector('#waList').innerText);
 await page.fill('#waSearch',''); await sleep(100);
 // search then click chat: is query kept?
 await page.fill('#waSearch','منى'); await sleep(100); await page.click('.wa-chat'); await sleep(300);
 R.steps.searchKept=await page.evaluate(()=>({val:document.getElementById('waSearch')?.value??'hidden',n:document.querySelectorAll('.wa-chat').length}));
 // keyboard: tab order / focus after click / Escape
 R.steps.focusAfterChatClick=await page.evaluate(()=>document.activeElement.tagName+'#'+document.activeElement.id);
 await page.keyboard.press('Escape'); await sleep(150); R.steps.escape=await page.evaluate(()=>({view:document.querySelector('.wa-root')?.dataset.view,focus:document.activeElement.tagName}));
 R.steps.a11y=await page.evaluate(()=>{const v=document.getElementById('novaInboxView');return{searchLabel:!!(v.querySelector('#waSearch').getAttribute('aria-label')||v.querySelector('label[for=waSearch]')),chatAriaCurrent:!!v.querySelector('.wa-chat[aria-current]'),backAria:v.querySelector('[data-wa-back]')?.getAttribute('aria-label'),listRole:v.querySelector('#waList').getAttribute('role'),msgsLive:v.querySelector('#waMsgs')?.getAttribute('aria-live'),lockBtnAria:v.querySelector('#waHistLock')?.getAttribute('aria-label'),msgsRole:v.querySelector('#waMsgs')?.getAttribute('role'),headingCount:v.querySelectorAll('h1,h2,h3').length}});
 // lock
 await page.click('#waHistLock'); await page.waitForSelector('#waHistForm'); await sleep(200); await shot('wa-relocked');
 R.steps.afterLock={txt:await page.evaluate(()=>/منى التجريبية/.test(document.getElementById('novaInboxView').innerText)),pin:await page.evaluate(()=>sessionStorage.getItem('novaHistPin')),view:await page.evaluate(()=>document.querySelector('.wa-root').dataset.view),ls:await page.evaluate(()=>JSON.stringify(localStorage).includes('بنادول'))};
 // header buttons smoke
 R.header=await page.$$eval('#novaWaBtn,#btnRefreshApp',els=>els.map(e=>[e.id,Math.round(e.getBoundingClientRect().width),Math.round(e.getBoundingClientRect().height)]));
 R.cls=await page.evaluate(()=>+window.__cls.toFixed(4)); R.hist=hist.length;
 await ctx.close(); await b.close();
}
fs.writeFileSync(ROOT+'/.nova/qa/qa-loop-231-raw.json',JSON.stringify(log,null,1)); srv.close();
console.log(JSON.stringify(log,null,1));
