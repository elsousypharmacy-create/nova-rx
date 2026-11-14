// QA loop 82 audit (local only, fake data, non-GET blocked). PW_MODULE=<playwright-core/index.mjs> CHROME_BIN=/usr/bin/chromium node tools/qa/qa-loop-82.mjs
const { chromium } = await import(''+(process.env.PW_MODULE||'playwright')+'');
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..','..'); const OUT=ROOT+'/.nova/qa/qa-loop-82'; fs.mkdirSync(OUT,{recursive:true});
const T={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json'};
const srv=http.createServer((q,s)=>{let p=decodeURIComponent(new URL(q.url,'http://x').pathname);if(p==='/')p='/index.html';if(p==='/purchases')p='/purchases.html';if(p==='/emergency/stock.json'){s.writeHead(200,{'content-type':'application/json'});fs.createReadStream(ROOT+'/data/emergency-stock.json').pipe(s);return}const f=path.resolve(ROOT,'.'+p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){log.http404.push(p);s.writeHead(404).end('nf');return}s.writeHead(200,{'content-type':T[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(s)});
const log={http404:[],blocked:[],res:{}};
await new Promise(r=>srv.listen(0,'127.0.0.1',r)); const BASE='http://127.0.0.1:'+srv.address().port;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(const [vp,size] of [['d',{width:1366,height:768}],['m',{width:390,height:844}]]){
 const b=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/chromium',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:size,locale:'ar-EG',isMobile:vp==='m',hasTouch:vp==='m'});
 await ctx.route('**/*',r=>{const m=r.request().method(),u=r.request().url();if(m!=='GET'&&m!=='HEAD'&&m!=='OPTIONS'){log.blocked.push(m+' '+u.slice(0,80));return r.abort()}if(!u.startsWith(BASE)&&!u.startsWith('data:')&&!u.startsWith('blob:'))return r.abort();return r.continue()});
 const page=await ctx.newPage(); const R=log.res[vp]={errs:[],tabs:{},notes:[]};
 page.on('pageerror',e=>R.errs.push('pageerror: '+e.message.slice(0,150)));
 page.on('console',m=>{if(m.type()==='error'&&!/ERR_FAILED|Failed to load resource: net::/.test(m.text()))R.errs.push('console: '+m.text().slice(0,150))});
 page.on('response',r=>{if(r.status()>=400)R.errs.push('HTTP '+r.status()+' '+r.url().replace(BASE,'').slice(0,80))});
 page.on('dialog',d=>{R.notes.push('dialog: '+d.message().slice(0,60));d.accept().catch(()=>{})});
 await page.goto(BASE+'/',{waitUntil:'load'}); await sleep(2500);
 const shot=async n=>page.screenshot({path:`${OUT}/${vp}-${n}.png`}).catch(()=>{});
 const tabs=await page.$$eval('.nova-nav .nova-tab',e=>e.map(x=>({t:x.textContent.trim(),id:x.id,p:x.dataset.page||'',h:x.getAttribute('href')||'',vis:!!x.offsetParent})));
 R.tabList=tabs;
 for(const t of tabs){ if(t.h==='/purchases'){ continue }
  const sel=t.p?`.nova-tab[data-page="${t.p}"]`:'#'+t.id;
  try{await page.click(sel,{timeout:3000})}catch(e){R.tabs[t.t]='CLICK FAIL '+e.message.slice(0,60);continue}
  await sleep(500);
  const info=await page.evaluate(()=>({len:document.body.innerText.trim().length,nf:/Not found|404/i.test(document.body.innerText),ov:document.documentElement.scrollWidth>innerWidth+2,url:location.href}));
  R.tabs[t.t]=info; if(['البيع','الفواتير','المنتجات','العملاء','التقارير','الإعدادات','المحادثات'].includes(t.t)&&(vp==='d'||['البيع','المحادثات','التقارير'].includes(t.t)))await shot(t.t.length+'-'+t.t.replace(/\W/g,'')||t.t);
 }
 // purchases
 const pp=await ctx.newPage(); const pr=await pp.goto(BASE+'/purchases'); await sleep(800);
 R.purchases={status:pr.status(),len:(await pp.evaluate(()=>document.body.innerText.trim().length)),ov:await pp.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2)}; await pp.screenshot({path:`${OUT}/${vp}-purchases.png`}); await pp.close();
 // header buttons
 await page.click('.nova-tab[data-page="sale"]'); await sleep(300);
 for(const id of ['novaWaBtn','btnRefreshApp']){ if(id==='btnRefreshApp')continue; try{await page.click('#'+id,{timeout:3000});await sleep(700);R.notes.push(id+' clicked → '+await page.evaluate(()=>location.pathname+' tab='+(document.querySelector('.nova-tab.active')||{}).textContent+' len='+document.body.innerText.length))}catch(e){R.notes.push(id+' FAIL '+e.message.slice(0,80))}}
 await shot('wa'); R.notes.push('nav visible after wa: '+await page.evaluate(()=>!!document.querySelector('.nova-tab[data-page="sale"]')&&location.href)); await page.goto(BASE+'/',{waitUntil:'load'}); await sleep(1000);
 // quick sale + barcode
 const prods=await page.evaluate(()=>{try{const k=Object.keys(localStorage);return k.slice(0,15)}catch(e){return []}}); R.lsKeys=prods;
 const inp='#mainSearchInput'; await page.focus(inp).catch(()=>{});
 R.notes.push('mode before: '+await page.evaluate(()=>(document.getElementById('searchModeTag')||{}).textContent));

 const cart=()=>page.evaluate(()=>[...document.querySelectorAll('tbody tr')].filter(x=>x.offsetParent&&x.innerText.trim()).map(x=>x.innerText.replace(/\s+/g,' ').slice(0,60)));
 const toast=()=>page.evaluate(()=>[...document.querySelectorAll('.toast')].map(e=>e.innerText.replace(/\s+/g,' ')).join(' / '));
 const sug=()=>page.evaluate(()=>{const b=document.getElementById('suggestionsBox');return b&&b.classList.contains('open')?b.innerText.replace(/\s+/g,' ').slice(0,100):'(closed)'});
 const scen=async(label,txt,enter=true,delay=5)=>{await page.fill(inp,'');await page.keyboard.type(txt,{delay});await sleep(450);const sg=await sug();if(enter)await page.keyboard.press('Enter');await sleep(500);R.notes.push(label+' ['+txt+'] sugg='+sg+' | toast='+await toast()+' | cart='+JSON.stringify(await cart()))};
 await scen('barcode exact','30017213');
 await scen('barcode again (qty++?)','30017213');
 await scen('arabic digits barcode','٣٠٠١٨٦٥٨');
 await scen('unknown barcode','9999999999999');
 await scen('partial code no enter','3001',false); await shot('partial');
 await page.keyboard.press('Escape'); await sleep(200);
 await scen('name arabic','جافيسكون');
 await scen('name latin lower','gaviscon');
 await scen('name arabic generic','باراسيتامول');
 await scen('single char','ك');
 await scen('whitespace barcode',' 30017213 ');
 await scen('barcode w/ newline-like tab','30017213\t',false);
 await shot('barcode');
 R.notes.push('checkout disabled='+await page.evaluate(()=>document.getElementById('btnCheckout')?.disabled));
 // F-keys
 for(const k of ['F2','F4']){await page.keyboard.press(k);await sleep(300);R.notes.push(k+' → cart='+(await cart()).length+' toast='+await toast()+' dialogs='+R.notes.filter(n=>n.startsWith('dialog')).length)}
 await shot('afterkeys');
 R.noHScroll=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2);
 await b.close();
}
console.log(JSON.stringify(log,null,1)); fs.writeFileSync(''+ROOT+'/.nova/qa/qa-loop-82-raw.json',JSON.stringify(log,null,1)); srv.close();
