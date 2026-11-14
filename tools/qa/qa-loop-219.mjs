// QA loop 219: returns & refunds deep audit (local, fake data, non-GET blocked). PW_MODULE=<playwright-core/index.mjs> node tools/qa/qa-loop-219.mjs
const { chromium } = await import(''+(process.env.PW_MODULE||'playwright')+'');
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..','..'); const OUT=ROOT+'/.nova/qa/qa-loop-219'; fs.mkdirSync(OUT,{recursive:true});
const T={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json'};
const log={http404:[],blocked:[],res:{}};
const srv=http.createServer((q,s)=>{let p=decodeURIComponent(new URL(q.url,'http://x').pathname);if(p==='/')p='/index.html';if(p==='/purchases')p='/purchases.html';if(p==='/emergency/stock.json')p='/data/emergency-stock.json';const f=path.resolve(ROOT,'.'+p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){log.http404.push(p);s.writeHead(404).end('nf');return}s.writeHead(200,{'content-type':T[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(s)});
await new Promise(r=>srv.listen(0,'127.0.0.1',r)); const BASE='http://127.0.0.1:'+srv.address().port;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const SEED=()=>{const now=new Date().toISOString();const mk=(id,n,pay,lines,total,extra)=>Object.assign({id,number:n,at:now,customer:'',payment:pay,lines,subtotal:total,discount:0,vat:0,total,received:total,change:0,source:'STOCK LIVE'},extra||{});
 localStorage.setItem('nova-rx-sales-v1',JSON.stringify([
  mk('s1','S-1001','cash',[{name:'جافيسكون سائل 150 مل نعناع',barcode:'',price:144,qty:2,discount:0},{name:'بنادول إكسترا 24 قرص',barcode:'',price:45.5,qty:3,discount:5}],423.5),
  mk('s2','S-1002','card',[{name:'أوجمنتين 1 جم 14 قرص (Augmentin 1gm 14 tabs) شريط مزدوج اسم طويل جدا للاختبار',barcode:'',price:210,qty:1,discount:0}],210),
  mk('s3','S-1003','credit',[{name:'فيتامين د 50000',barcode:'',price:80,qty:4,discount:0}],320,{customer:'أحمد محمود',customerId:'c1'}),
  mk('s4','S-1004','mixed',[{name:'كونجستال',barcode:'',price:30,qty:5,discount:0}],150)]))};
for(const [vp,size] of [['d',{width:1366,height:768}],['m',{width:390,height:844}]]){
 const b=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:size,locale:'ar-EG',isMobile:vp==='m',hasTouch:vp==='m'});
 await ctx.route('**/*',r=>{const m=r.request().method(),u=r.request().url();if(m!=='GET'&&m!=='HEAD'&&m!=='OPTIONS'){log.blocked.push(m+' '+u.slice(0,80));return r.abort()}if(!u.startsWith(BASE)&&!u.startsWith('data:')&&!u.startsWith('blob:'))return r.abort();return r.continue()});
 const page=await ctx.newPage(); const R=log.res[vp]={errs:[],steps:{},notes:[],perf:{}};
 page.on('pageerror',e=>R.errs.push('pageerror: '+e.message.slice(0,150)));
 page.on('console',m=>{if(m.type()==='error'&&!/ERR_FAILED|Failed to load resource: net::/.test(m.text()))R.errs.push('console: '+m.text().slice(0,150))});
 page.on('response',r=>{if(r.status()>=400)R.errs.push('HTTP '+r.status()+' '+r.url().replace(BASE,'').slice(0,80))});
 page.on('dialog',d=>{R.notes.push('native dialog: '+d.type()+' '+d.message().slice(0,60));d.accept().catch(()=>{})});
 await page.addInitScript(()=>{window.__cls=0;try{new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__cls+=e.value}).observe({type:'layout-shift',buffered:true})}catch(e){}});
 await page.addInitScript(`(${SEED.toString()})();`.replace('(()=>','(()=>')); 
 await page.goto(BASE+'/',{waitUntil:'load'}); await sleep(1800);
 const shot=async n=>page.screenshot({path:`${OUT}/${vp}-${n}.png`}).catch(()=>{});
 await page.click('.nova-tab[data-page="invoices"]'); await sleep(500); await shot('invoices');
 R.steps.inv=await page.evaluate(()=>({rows:document.querySelectorAll('[data-return]').length,ov:document.documentElement.scrollWidth>innerWidth+2,btns:[...document.querySelectorAll('[data-return],[data-reprint]')].slice(0,2).map(x=>{const r=x.getBoundingClientRect();return[x.textContent.trim(),Math.round(r.width),Math.round(r.height)]})}));
 // open return dialog
 const t0=Date.now(); await page.click('[data-return="s1"]'); await page.waitForSelector('.nova-return-overlay'); R.perf.openDlg=Date.now()-t0; await sleep(300); await shot('dlg-open');
 R.steps.dlg=await page.evaluate(()=>{const b=document.querySelector('.nova-return-overlay [role=dialog]');const r=b.getBoundingClientRect();const f=document.activeElement;
  const inputs=[...b.querySelectorAll('input,button,select,summary')].filter(x=>x.offsetParent).map(x=>{const q=x.getBoundingClientRect();return[x.id||x.dataset.retIdx||x.textContent.trim().slice(0,12),Math.round(q.width),Math.round(q.height)]});
  const xb=b.querySelector('.nova-dlg-x').getBoundingClientRect();
  return{box:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)],vh:innerHeight,scroll:b.scrollHeight>b.clientHeight,focus:f&&(f.id||f.tagName),small:inputs.filter(i=>i[2]<40),closeBtn:[Math.round(xb.width),Math.round(xb.height)],closeSide:xb.left<r.left+r.width/2?'left':'right',labelForReason:!!b.querySelector('label[for=novaRetReason]'),qtyAria:[...b.querySelectorAll('[data-ret-idx]')].map(i=>i.getAttribute('aria-label')||''),title:b.querySelector('h3').textContent,amountEmpty:b.querySelector('#novaRetAmount').textContent}});
 // empty confirm
 await page.click('#novaRetOk'); await sleep(150); R.steps.emptyMsg=await page.textContent('#novaRetMsg'); await shot('dlg-empty-err');
 // qty typing over max
 await page.fill('[data-ret-idx="0"]','5'); await sleep(100); R.steps.overMsg={amt:await page.textContent('#novaRetAmount')};
 await page.fill('[data-ret-idx="0"]','1'); await sleep(100); R.steps.amt1=await page.textContent('#novaRetAmount');
 await page.fill('[data-ret-idx="0"]','1.5'); await sleep(100); R.steps.frac=await page.textContent('#novaRetAmount');
 await page.fill('[data-ret-idx="0"]','-1'); await sleep(100); R.steps.neg=await page.textContent('#novaRetAmount');
 await page.fill('[data-ret-idx="0"]','1'); 
 await page.click('[data-ret-chip]'); await sleep(100); await page.click('#novaRetAll'); await sleep(100); R.steps.all=await page.textContent('#novaRetAmount'); await shot('dlg-filled');
 R.steps.cxOpen=await page.evaluate(()=>{document.querySelector('#novaCancelBox summary').click();return 1}); await sleep(200); await shot('dlg-cancelbox');
 R.steps.cxFields=await page.evaluate(()=>[...document.querySelectorAll('#novaCancelBox input,#novaCancelBox select,#novaCancelBox button')].map(x=>{const q=x.getBoundingClientRect();const cs=getComputedStyle(x);return[x.id,Math.round(q.width),Math.round(q.height),cs.backgroundColor,cs.color,x.getAttribute('aria-label')||'']}));
 // cancel w/o fields
 await page.click('#novaCxOk'); await sleep(150); R.steps.cxMsg=await page.textContent('#novaRetMsg');
 // escape closes + focus restore
 await page.keyboard.press('Escape'); await sleep(200); R.steps.escClosed=(await page.$('.nova-return-overlay'))===null; R.steps.focusAfter=await page.evaluate(()=>{const a=document.activeElement;return a?(a.dataset.return?'return-btn':a.tagName+'#'+a.id):'none'});
 // tab trap test
 await page.click('[data-return="s2"]'); await sleep(250);
 R.steps.tabTrap=await page.evaluate(async()=>{const seen=new Set();const ov=document.querySelector('.nova-return-overlay');let outside=0;for(let i=0;i<14;i++){const a=document.activeElement;if(!ov.contains(a))outside++;seen.add(a&&(a.id||a.tagName));}return{outside}});
 for(let i=0;i<14;i++){await page.keyboard.press('Tab')}; R.steps.tabTrap2=await page.evaluate(()=>({inside:document.querySelector('.nova-return-overlay').contains(document.activeElement),el:document.activeElement.tagName+'#'+document.activeElement.id}));
 await page.keyboard.press('Escape'); await sleep(200);
 // long-name row dlg
 await page.click('[data-return="s2"]'); await sleep(250); await shot('dlg-longname');
 R.steps.longName=await page.evaluate(()=>{const b=document.querySelector('.nova-return-overlay [role=dialog]');return{ov:b.scrollWidth>b.clientWidth+1,h:b.scrollHeight>b.clientHeight}});
 await page.click('#novaRetCancel'); await sleep(200);
 // real partial return on s1
 await page.click('[data-return="s1"]'); await sleep(250); await page.fill('[data-ret-idx="1"]','1'); await page.fill('#novaRetReason','عيب/تالف'); const t1=Date.now(); await page.click('#novaRetOk'); await page.waitForSelector('.nova-return-overlay',{state:'detached'}); R.perf.confirm=Date.now()-t1; await sleep(400); await shot('inv-after-partial');
 R.steps.afterPartial=await page.evaluate(()=>{const tr=[...document.querySelectorAll('tr')].find(x=>x.textContent.includes('S-1001'));const r=window.novaSales.returns();return{row:tr&&tr.innerText.replace(/\s+/g,' ').slice(0,200),ret:r.map(x=>[x.amount,x.method,x.reason]),toast:!!document.querySelector('.nova-toast,[role=status]:not(:empty)')}});
 // reopen to see availability, and return the rest
 await page.click('[data-return="s1"]'); await sleep(250); await shot('dlg-reopen');
 R.steps.reopen=await page.evaluate(()=>[...document.querySelectorAll('.nova-return-overlay [data-ret-idx]')].map(i=>[i.max,i.disabled]));
 await page.click('#novaRetAll'); await page.fill('#novaRetReason','رجوع العميل'); await page.click('#novaRetOk'); await sleep(400);
 R.steps.afterFull=await page.evaluate(()=>{const tr=[...document.querySelectorAll('tr')].find(x=>x.textContent.includes('S-1001'));const btn=tr&&tr.querySelector('[data-return]');return{row:tr&&tr.innerText.replace(/\s+/g,' ').slice(0,200),retBtnDisabled:btn&&btn.disabled,sum:window.novaSales.returnedAmount('s1')}});
 await page.click('[data-return="s1"]'); await sleep(250); await shot('dlg-fully-returned');
 R.steps.fullyDlg=await page.evaluate(()=>({disabled:[...document.querySelectorAll('.nova-return-overlay [data-ret-idx]')].every(i=>i.disabled),all:document.querySelector('#novaRetAll').disabled,ok:document.querySelector('#novaRetOk').disabled}));
 await page.keyboard.press('Escape'); await sleep(200);
 // credit sale return
 await page.click('[data-return="s3"]'); await sleep(250); R.steps.creditNote=await page.evaluate(()=>document.querySelector('.nova-return-overlay p').textContent); await shot('dlg-credit'); await page.keyboard.press('Escape'); await sleep(200);
 // cancel flow full w/ approval
 await page.click('[data-return="s4"]'); await sleep(250); await page.click('#novaCancelBox summary'); await page.fill('#novaRetReason','خطأ في الصرف'); await page.fill('#novaCxBy','سارة'); await page.selectOption('#novaCxRole','manager'); await page.fill('#novaCxApprover','سارة'); await page.click('#novaCxOk'); await sleep(150); R.steps.selfApprove=await page.textContent('#novaRetMsg');
 await page.fill('#novaCxApprover','منى'); await page.click('#novaCxOk'); await sleep(400); await shot('inv-cancelled');
 R.steps.afterCancel=await page.evaluate(()=>{const tr=[...document.querySelectorAll('tr')].find(x=>x.textContent.includes('S-1004'));return{row:tr&&tr.innerText.replace(/\s+/g,' ').slice(0,200),overlay:!!document.querySelector('.nova-return-overlay')}});
 // reports reflect returns
 await page.click('.nova-tab[data-page="reports"]'); await sleep(600); await shot('reports');
 R.steps.reports=await page.evaluate(()=>({txt:document.body.innerText.replace(/\s+/g,' ').match(/مرتجعات[^]{0,80}/g)?.slice(0,4),ov:document.documentElement.scrollWidth>innerWidth+2}));
 // Sale tab: toast / feedback; other tabs smoke
 const tabs=await page.$$eval('.nova-nav .nova-tab',e=>e.map(x=>({t:x.textContent.trim(),id:x.id,p:x.dataset.page||'',h:x.getAttribute('href')||''})));
 R.smoke={};
 for(const t of tabs){ if(t.h==='/purchases')continue; const sel=t.p?`.nova-tab[data-page="${t.p}"]`:'#'+t.id; const t1=Date.now();
  try{await page.click(sel,{timeout:3000})}catch(e){R.smoke[t.t]='CLICK FAIL';continue} const lat=Date.now()-t1; await sleep(450);
  R.smoke[t.t]=await page.evaluate(()=>({len:document.body.innerText.trim().length,nf:/Not found|404/i.test(document.body.innerText),ov:document.documentElement.scrollWidth>innerWidth+2})); R.smoke[t.t].lat=lat; await shot('smoke-'+(t.p||t.id)); }
 // WA button + conversations with mocked history
 await page.route('**/api/v1/inbox/history/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,chats:[{id:'c1',name:'عميل تجريبي',phone:'+200000000000',last:'شكرًا',at:new Date().toISOString(),messages:[{dir:'in',text:'عايز أرجّع علبة',at:new Date().toISOString()},{dir:'out',text:'تمام',at:new Date().toISOString()}]}]})}));
 try{await page.click('#novaWaBtn',{timeout:3000});await sleep(900);R.notes.push('wa → '+await page.evaluate(()=>location.pathname+' len='+document.body.innerText.length));await shot('wa')}catch(e){R.notes.push('wa FAIL')}
 // purchases
 const pp=await ctx.newPage(); const pr=await pp.goto(BASE+'/purchases'); await sleep(900); R.purchases={status:pr.status(),len:await pp.evaluate(()=>document.body.innerText.trim().length),ov:await pp.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2)}; await pp.screenshot({path:`${OUT}/${vp}-purchases.png`}); await pp.close();
 R.perf.cls=await page.evaluate(()=>+window.__cls.toFixed(4));
 await b.close();
}
fs.writeFileSync(ROOT+'/.nova/qa/qa-loop-219-raw.json',JSON.stringify(log,null,1)); srv.close();
