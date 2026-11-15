// UX421: standalone pages layout check (fake/no live writes: every non-GET request is aborted, external hosts blocked).
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
const exe=[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].filter(Boolean).find(existsSync);
assert(exe,'Set CHROME_PATH');
const server=spawn(process.execPath,['scripts/dev-server.mjs','--port','8771'],{cwd:process.cwd(),stdio:'ignore'});
await new Promise(r=>setTimeout(r,700));
const pages=['sticker-studio','emergency-sales','purchases','supplier-compare'];
const views=[[1366,768],[390,844]];
let fail=0;const log=(ok,m)=>{console.log((ok?'PASS ':'FAIL ')+m);if(!ok)fail++};
const lum=c=>{const[a,b,d]=c.map(v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4});return .2126*a+.7152*b+.0722*d};
const browser=await chromium.launch({headless:true,executablePath:exe,args:['--no-sandbox']});
try{for(const p of pages)for(const[w,h]of views){
  const ctx=await browser.newContext({viewport:{width:w,height:h},locale:'ar-EG',hasTouch:w<500});
  await ctx.route('**/*',r=>{const q=r.request();const u=new URL(q.url());if(q.method()!=='GET'||u.hostname!=='127.0.0.1')return r.abort();return r.continue()});
  const pg=await ctx.newPage();
  await pg.goto(`http://127.0.0.1:8771/${p}.html`,{waitUntil:'load'});await pg.waitForTimeout(700);
  const r=await pg.evaluate(()=>{
    const de=document.documentElement;const out={};
    out.rtl=de.dir==='rtl'&&getComputedStyle(document.body).direction==='rtl';
    out.tokens=!!getComputedStyle(de).getPropertyValue('--nx-accent').trim();
    out.overflowX=de.scrollWidth-de.clientWidth;
    const small=[];for(const el of document.querySelectorAll('button,.btn,a[href],input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]),select')){const b=el.getBoundingClientRect();if(b.width<2||b.height<2||getComputedStyle(el).visibility==='hidden')continue;if(b.height<43.5||b.width<43.5)small.push((el.id||el.className||el.tagName)+':'+Math.round(b.width)+'x'+Math.round(b.height))}
    out.small=small.slice(0,8);out.smallN=small.length;
    out.brokenImgs=[...document.images].filter(i=>getComputedStyle(i).display!=='none'&&new URL(i.src||'about:blank',location.href).hostname===location.hostname&&i.complete&&i.naturalWidth===0&&i.src&&!i.src.includes('fonts')).length;
    const c=s=>{const m=s.match(/\d+(\.\d+)?/g).map(Number);return m.slice(0,3)};
    out.bodyBg=c(getComputedStyle(document.body).backgroundColor);out.bodyFg=c(getComputedStyle(document.body).color);
    return out});
  const [a,b]=[lum(r.bodyBg),lum(r.bodyFg)];const cr=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  const t=`${p} ${w}x${h}`;
  log(r.rtl,`${t} RTL`);log(r.tokens,`${t} tokens applied`);
  log(r.overflowX<=0,`${t} no horizontal overflow (${r.overflowX})`);
  log(r.brokenImgs===0,`${t} no broken images`);
  log(cr>=4.5,`${t} body contrast ${cr.toFixed(1)}:1`);
  log(r.smallN===0,`${t} touch targets >=44px${r.smallN?' small: '+r.small.join(', '):''}`);
  await pg.screenshot({path:`/tmp/ux421-${p}-${w}.png`});
  await ctx.close();
}}finally{await browser.close();server.kill()}
console.log(fail?`FAILED ${fail}`:'ALL PASS');process.exit(fail?1:0);
