// QA loop 203: design & smoothness audit (local, fake data, non-GET blocked). PW_MODULE=<playwright-core/index.mjs> node tools/qa/qa-loop-203.mjs
const { chromium } = await import(''+(process.env.PW_MODULE||'playwright')+'');
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..','..'); const OUT=ROOT+'/.nova/qa/qa-loop-203'; fs.mkdirSync(OUT,{recursive:true});
const T={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json'};
const log={http404:[],blocked:[],res:{}};
const srv=http.createServer((q,s)=>{let p=decodeURIComponent(new URL(q.url,'http://x').pathname);if(p==='/')p='/index.html';if(p==='/purchases')p='/purchases.html';if(p==='/emergency/stock.json')p='/data/emergency-stock.json';const f=path.resolve(ROOT,'.'+p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){log.http404.push(p);s.writeHead(404).end('nf');return}s.writeHead(200,{'content-type':T[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(s)});
await new Promise(r=>srv.listen(0,'127.0.0.1',r)); const BASE='http://127.0.0.1:'+srv.address().port;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(const [vp,size] of [['d',{width:1366,height:768}],['m',{width:390,height:844}]]){
 const b=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:size,locale:'ar-EG',isMobile:vp==='m',hasTouch:vp==='m'});
 await ctx.route('**/*',r=>{const m=r.request().method(),u=r.request().url();if(m!=='GET'&&m!=='HEAD'&&m!=='OPTIONS'){log.blocked.push(m+' '+u.slice(0,80));return r.abort()}if(!u.startsWith(BASE)&&!u.startsWith('data:')&&!u.startsWith('blob:'))return r.abort();return r.continue()});
 const page=await ctx.newPage(); const R=log.res[vp]={errs:[],tabs:{},notes:[],perf:{}};
 page.on('pageerror',e=>R.errs.push('pageerror: '+e.message.slice(0,150)));
 page.on('console',m=>{if(m.type()==='error'&&!/ERR_FAILED|Failed to load resource: net::/.test(m.text()))R.errs.push('console: '+m.text().slice(0,150))});
 page.on('response',r=>{if(r.status()>=400)R.errs.push('HTTP '+r.status()+' '+r.url().replace(BASE,'').slice(0,80))});
 page.on('dialog',d=>{d.accept().catch(()=>{})});
 await page.addInitScript(()=>{window.__cls=0;window.__lt=[];try{new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__cls+=e.value}).observe({type:'layout-shift',buffered:true});new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt.push(Math.round(e.duration))}).observe({type:'longtask',buffered:true})}catch(e){}});
 const t0=Date.now(); await page.goto(BASE+'/',{waitUntil:'load'}); R.perf.load=Date.now()-t0; await sleep(2000);
 const shot=async n=>page.screenshot({path:`${OUT}/${vp}-${n}.png`}).catch(()=>{});
 const tabs=await page.$$eval('.nova-nav .nova-tab',e=>e.map(x=>({t:x.textContent.trim(),id:x.id,p:x.dataset.page||'',h:x.getAttribute('href')||''})));
 R.tabList=tabs;
 for(const t of tabs){ if(t.h==='/purchases')continue;
  const sel=t.p?`.nova-tab[data-page="${t.p}"]`:'#'+t.id;
  const t1=Date.now();
  try{await page.click(sel,{timeout:3000})}catch(e){R.tabs[t.t]='CLICK FAIL';continue}
  await page.waitForFunction(()=>true); const lat=Date.now()-t1; await sleep(500);
  const info=await page.evaluate(()=>{const v=[...document.querySelectorAll('.nova-page-view')].find(x=>x.offsetParent);
   const small=[...document.querySelectorAll('button,a,input,select')].filter(x=>x.offsetParent&&(x.getBoundingClientRect().height<30&&x.getBoundingClientRect().height>0)).length;
   const lowc=[...document.querySelectorAll('body *')].filter(x=>x.offsetParent&&x.children.length===0&&x.textContent.trim()&&parseFloat(getComputedStyle(x).fontSize)<11).length;
   return{len:document.body.innerText.trim().length,nf:/Not found|404/i.test(document.body.innerText),ov:document.documentElement.scrollWidth>innerWidth+2,small,tiny:lowc,cls:+window.__cls.toFixed(4),lt:window.__lt.slice(),empties:[...document.querySelectorAll('.empty,.nova-empty,[class*=empty]')].filter(x=>x.offsetParent).map(x=>x.innerText.trim().slice(0,40)).slice(0,3)}});
  info.lat=lat; R.tabs[t.t]=info; await shot(t.p||t.id);
 }
 const pp=await ctx.newPage(); const pr=await pp.goto(BASE+'/purchases'); await sleep(900);
 R.purchases={status:pr.status(),len:await pp.evaluate(()=>document.body.innerText.trim().length),ov:await pp.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),btns:await pp.evaluate(()=>[...document.querySelectorAll('button')].filter(x=>x.offsetParent).length)}; await pp.screenshot({path:`${OUT}/${vp}-purchases.png`}); await pp.close();
 await page.click('.nova-tab[data-page="sale"]'); await sleep(300);
 const hb=await page.$$eval('.header-actions button,.header-actions a,#novaWaBtn,#btnRefreshApp,.nova-new-sale',e=>e.map(x=>({id:x.id,t:(x.textContent||'').trim().slice(0,20),title:x.title||x.getAttribute('aria-label')||'',w:Math.round(x.getBoundingClientRect().width),h:Math.round(x.getBoundingClientRect().height)})));
 R.headerButtons=hb;
 try{await page.click('#novaWaBtn',{timeout:3000});await sleep(700);R.notes.push('wa → '+await page.evaluate(()=>location.pathname+' len='+document.body.innerText.length));await shot('wa')}catch(e){R.notes.push('wa FAIL')}
 await page.goto(BASE+'/',{waitUntil:'load'}); await sleep(1200);
 // interaction latency: type a search & measure suggestions
 await page.focus('#mainSearchInput').catch(()=>{});
 const t2=Date.now(); await page.keyboard.type('gav',{delay:0});
 await page.waitForSelector('#suggestionsBox.open',{timeout:3000}).catch(()=>{}); R.perf.suggest=Date.now()-t2; await sleep(300); await shot('suggest');
 await page.keyboard.press('Enter'); await sleep(400); await shot('cart');
 // scroll jank on products
 await page.click('.nova-tab[data-page="products"]'); await sleep(500);
 R.perf.scroll=await page.evaluate(async()=>{const el=[...document.querySelectorAll('.nova-page-view,.table-wrap,main')].find(x=>x.scrollHeight>x.clientHeight+10)||document.scrollingElement;let fr=[],last=performance.now();return await new Promise(res=>{let n=0;function f(t){fr.push(t-last);last=t;el.scrollTop+=40;if(++n<40)requestAnimationFrame(f);else res({max:Math.round(Math.max(...fr)),avg:+(fr.reduce((a,c)=>a+c,0)/fr.length).toFixed(1),scrollable:el.scrollHeight>el.clientHeight})}requestAnimationFrame(f)})});
 R.perf.cls=await page.evaluate(()=>+window.__cls.toFixed(4)); R.perf.longtasks=await page.evaluate(()=>window.__lt);
 R.noHScroll=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2);
 await b.close();
}
fs.writeFileSync(ROOT+'/.nova/qa/qa-loop-203-raw.json',JSON.stringify(log,null,1)); srv.close();
