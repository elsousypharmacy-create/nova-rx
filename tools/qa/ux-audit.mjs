// UX audit of the LIVE Phase 10 app (read-only). Usage: node tools/qa/ux-audit.mjs
// Fake data only; every non-GET request is aborted (no live writes).
import { chromium } from "playwright";
import fs from 'node:fs';
const BASE = process.env.UX_BASE || 'https://nova-rx-preview.elsousypharmacy.workers.dev';
const OUT = '.nova/qa/ux-phase10';
fs.mkdirSync(OUT, { recursive: true });
const VIEWPORTS = { desktop: { width: 1366, height: 768 }, mobile: { width: 390, height: 844 } };
const TABS = [['sale','البيع'],['invoices','الفواتير'],['products','المنتجات'],['customers','العملاء'],['reports','التقارير'],['settings','الإعدادات']];
const PAGES = [['purchases','/purchases'],['whatsapp','/whatsapp-inbox.html'],['stickers','/sticker-studio.html']];
const SKIP = /^(English|Arabic|العربية|عربي|Use key|Clear key)$|حذف|مسح الكل|خروج|تأكيد|إتمام البيع|حفظ|delete|logout|reset|إعادة ضبط/i;
const result = { base: BASE, date: new Date().toISOString(), screens: [], unreachable: [], blockedWrites: [] };

function lum(c){const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2])}
const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};

const MEASURE = () => {
  const parse = s => { const m = s.match(/rgba?\(([^)]+)\)/); if(!m) return null; const p=m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0],p[1],p[2],p.length>3?p[3]:1]; };
  const bgOf = el => { let bg=[8,9,11]; const chain=[]; for(let e=el;e;e=e.parentElement){const c=parse(getComputedStyle(e).backgroundColor); if(c&&c[3]>0) chain.push(c); if(c&&c[3]>=1) break;} for(const c of chain.reverse()){bg=bg.map((v,i)=>i<3?Math.round(c[i]*c[3]+v*(1-c[3])):v);} return bg; };
  const vis = e => { const r=e.getBoundingClientRect(); const s=getComputedStyle(e); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0'; };
  const arabic=/[؀-ۿ]/, latin=/[A-Za-z]/;
  const els=[...document.querySelectorAll('body *')].filter(e=>vis(e)&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim().length>1));
  const contrast=[], small=[], rtl={arabicLtr:0,leftAligned:0,mixed:0,total:0,samples:[]};
  const L=c=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2])};
  for(const e of els){
    const s=getComputedStyle(e), txt=[...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ').trim();
    const fg=parse(s.color); if(!fg) continue; const bg=bgOf(e);
    const f2=fg.slice(0,3).map((v,i)=>Math.round(v*fg[3]+bg[i]*(1-fg[3])));
    const a=L(f2),b=L(bg), r=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    const fs_=parseFloat(s.fontSize);
    const desc=e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(e.className&&typeof e.className==='string'?'.'+e.className.trim().split(/\s+/)[0]:'');
    const large=fs_>=24||(fs_>=18.66&&parseInt(s.fontWeight)>=700);
    contrast.push({d:desc,t:txt.slice(0,24),r:+r.toFixed(2),ok:r>=(large?3:4.5),fs:fs_});
    if(fs_<12) small.push({d:desc,t:txt.slice(0,24),fs:fs_});
    if(arabic.test(txt)){rtl.total++; if(s.direction==='ltr'){rtl.arabicLtr++; if(rtl.samples.length<5)rtl.samples.push('ltr:'+desc+':'+txt.slice(0,20));} if(s.textAlign==='left'&&e.children.length===0&&e.getBoundingClientRect().width>120){rtl.leftAligned++; if(rtl.samples.length<8)rtl.samples.push('left:'+desc+':'+txt.slice(0,20));} if(latin.test(txt))rtl.mixed++;}
  }
  const fails=contrast.filter(c=>!c.ok);
  const buttons=[...document.querySelectorAll('button,a[href],[role=button],input,select')].filter(vis);
  const tiny=buttons.filter(b=>{const r=b.getBoundingClientRect();return r.width<44||r.height<44}).length;
  const overflowX=document.documentElement.scrollWidth>window.innerWidth+2;
  return {
    html:{dir:document.documentElement.dir,lang:document.documentElement.lang,bodyDir:getComputedStyle(document.body).direction},
    title:document.title, textEls:contrast.length,
    minContrast:contrast.length?Math.min(...contrast.map(c=>c.r)):null,
    contrastFails:fails.length, worstContrast:fails.sort((a,b)=>a.r-b.r).slice(0,6),
    minFont:small.length?Math.min(...small.map(s=>s.fs)):Math.min(...contrast.map(c=>c.fs)), smallFont:small.length, smallSamples:small.slice(0,5),
    rtl, interactive:buttons.length, tapTargetsUnder44:tiny, overflowX,
    font:getComputedStyle(document.body).fontFamily.slice(0,40), bodyFs:getComputedStyle(document.body).fontSize
  };
};

async function clickAll(page, label, rec){
  const n = await page.evaluate(()=>[...document.querySelectorAll('button,[role=button]')].filter(e=>{const r=e.getBoundingClientRect();if(!(r.width>0&&r.height>0)||getComputedStyle(e).visibility==='hidden'||e.disabled)return false;const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!t&&(e===t||e.contains(t))}).length);
  rec.buttons={visible:n,clicked:0,skipped:0,errors:[]};
  const url0 = page.url();
  for(let i=0;i<Math.min(n,25);i++){
    const h = await page.evaluateHandle(i=>[...document.querySelectorAll('button,[role=button]')].filter(e=>{const r=e.getBoundingClientRect();if(!(r.width>0&&r.height>0)||getComputedStyle(e).visibility==='hidden'||e.disabled)return false;const t=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!t&&(e===t||e.contains(t))})[i],i);
    const el=h.asElement(); if(!el) continue;
    const t=((await el.innerText().catch(()=>''))||'').trim().slice(0,25);
    if(SKIP.test(t)||/^(البيع|الفواتير|المنتجات|العملاء|التقارير|الإعدادات)$/.test(t)){rec.buttons.skipped++;continue}
    const before=pageErrs.length;
    try{ await el.click({timeout:1000,trial:false}); rec.buttons.clicked++; await page.waitForTimeout(120);}catch(e){ rec.buttons.errors.push((t||'?')+': '+e.message.split('\n')[0].slice(0,80)); }
    if(pageErrs.length>before) rec.buttons.errors.push((t||'?')+': pageerror '+pageErrs.at(-1).slice(0,80));
    await page.keyboard.press('Escape').catch(()=>{});
    if(page.url()!==url0){ await page.goto(url0,{waitUntil:'domcontentloaded'}).catch(()=>{}); await page.waitForTimeout(800); }
  }
}
let pageErrs=[];
const browser = await chromium.launch();
for (const [vp,size] of Object.entries(VIEWPORTS)) {
  const ctx = await browser.newContext({ viewport: size, locale: 'ar-EG', isMobile: vp==='mobile', hasTouch: vp==='mobile' });
  await ctx.route('**/*', r => { const m=r.request().method(); if(m!=='GET'&&m!=='HEAD'&&m!=='OPTIONS'){ result.blockedWrites.push(`${vp} ${m} ${r.request().url().slice(0,100)}`); return r.abort(); } return r.continue(); });
  const page = await ctx.newPage();
  page.on('dialog', d => d.dismiss().catch(()=>{}));
  let cur=null;
  const log = (k,v)=>cur&&cur[k].push(v);
  page.on('console', m => { if(m.type()==='error') log('consoleErrors', m.text().slice(0,200)); });
  page.on('pageerror', e => { pageErrs.push(e.message); log('pageErrors', e.message.slice(0,200)); });
  page.on('requestfailed', r => log('failedRequests', `${r.method()} ${r.url().slice(0,100)} ${r.failure()?.errorText}`));
  page.on('response', r => { if(r.status()>=400) log('failedRequests', `${r.status()} ${r.url().slice(0,100)}`); });
  const mk=(name)=>({viewport:vp,screen:name,consoleErrors:[],pageErrors:[],failedRequests:[]});
  const shot = async (name, rec)=>{ await page.screenshot({path:`${OUT}/${vp}-${name}.png`,fullPage:true,type:'png'}).catch(async()=>{await page.screenshot({path:`${OUT}/${vp}-${name}.png`})}); rec.screenshot=`${OUT}/${vp}-${name}.png`; };
  const load = async (path)=>{ const resp=await page.goto(BASE+path,{waitUntil:'networkidle',timeout:45000}).catch(e=>({status:()=>0,err:e.message})); await page.waitForTimeout(1500); return resp; };

  // SPA tabs
  for (const [id,label] of TABS) {
    cur = mk(id); pageErrs=[];
    await load('/');
    const tab = page.locator(`button.nova-tab[data-page="${id}"]`);
    if (!(await tab.count())) { result.unreachable.push(`${vp}/${id}: nav tab missing`); continue; }
    try { await tab.click({timeout:3000}); } catch(e){ cur.navError=e.message.split('\n')[0]; }
    await page.waitForTimeout(900);
    Object.assign(cur, await page.evaluate(MEASURE));
    await shot(id, cur);
    await clickAll(page, id, cur);
    result.screens.push(cur);
  }
  // sale flow tap count (no final confirm; writes are blocked anyway)
  cur = mk('sale-flow'); pageErrs=[]; await load('/');
  await page.locator('button.nova-tab[data-page="sale"]').click({timeout:3000}).catch(()=>{}); await page.waitForTimeout(500);
  const flow = { taps:0, steps:[] };
  const tap = async (desc, fn)=>{ try{ await fn(); flow.taps++; flow.steps.push('✔ '+desc); await page.waitForTimeout(250);}catch(e){flow.steps.push('✘ '+desc+' — '+e.message.split('\n')[0].slice(0,70));return false} return true};
  const search = page.locator('#mainSearchInput');
  if (await search.count()) {
    await tap('نقر على حقل البحث', ()=>search.click({timeout:2000}));
    await search.fill('pan').catch(()=>{}); flow.steps.push('كتابة نص البحث (لا تُحسب كنقرة)');
    await page.waitForTimeout(800);
    const hit = page.locator('#suggestionsBox .suggestion-item').first();
    if (await hit.count()) await tap('اختيار أول نتيجة', ()=>hit.click({timeout:2000}));
    else flow.steps.push('✘ لا توجد نتيجة بحث ظاهرة لإضافة صنف');
  } else flow.steps.push('✘ حقل البحث غير موجود في شاشة البيع');
  const quick = page.getByRole('button',{name:/دواء بدون اسم/}).first();
  if (!(await page.locator('tbody tr').count()) && await quick.count()) await tap('إضافة صنف سريع «دواء بدون اسم»', ()=>quick.click({timeout:2000}));
  await tap('إتمام الدفع (F9)', ()=>page.getByRole('button',{name:/إتمام الدفع|F9/}).first().click({timeout:2000}));
  flow.steps.push('طريقة الدفع «نقدي» محددة افتراضياً — لا نقرة إضافية');
  flow.steps.push('الخطوة التالية: «تأكيد وطباعة الإيصال» — لم تُنفَّذ (كتابة على الخادم)');
  flow.tapsToConfirm = flow.taps + 1;
  cur.saleFlow = flow; await shot('sale-flow', cur); result.screens.push(cur);
  await page.keyboard.press('Escape');

  // standalone pages
  for (const [id,path] of PAGES) {
    cur = mk(id); pageErrs=[];
    const resp = await load(path);
    const st = resp.status ? resp.status() : 0;
    const body = await page.evaluate(()=>document.body.innerText.slice(0,80)).catch(()=> '');
    if (st>=400 || st===0 || /^(404|not found)/i.test(body.trim())) { result.unreachable.push(`${vp}/${id}: ${path} → HTTP ${st}`); continue; }
    Object.assign(cur, await page.evaluate(MEASURE));
    await shot(id, cur); await clickAll(page, id, cur);
    result.screens.push(cur);
  }
  fs.mkdirSync(".nova/qa",{recursive:true}); fs.writeFileSync(".nova/qa/ux-audit-raw.json", JSON.stringify(result,null,1));
  await ctx.close();
}
await browser.close();
fs.mkdirSync('.nova/qa',{recursive:true});
fs.writeFileSync('.nova/qa/ux-audit-raw.json', JSON.stringify(result,null,1));
console.log(`screens=${result.screens.length} unreachable=${result.unreachable.length} blockedWrites=${result.blockedWrites.length}`);
