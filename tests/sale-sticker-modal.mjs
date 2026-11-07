import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

// One-screen sticker flow: all medicines visible, one "review and print" button,
// print from a hidden frame (no popup), text shrinks to fit, clipped text is never printed.
const root=process.cwd();
const candidates=[process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].filter(Boolean);
const executablePath=candidates.find(existsSync);
assert(executablePath,'Set CHROME_PATH to an installed Chromium browser');
const server=spawn(process.execPath,['scripts/dev-server.mjs','--port','8766'],{cwd:root,stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const check=(name,cond)=>{assert(cond,name);console.log('PASS '+name)};
const VIEWPORTS=[
  {name:'desktop',width:1280,height:860},
  {name:'tablet-landscape',width:1180,height:820},
  {name:'mobile',width:390,height:844},
];
const FIELDS={dose:'قرص',frequency:'مرتين يوميًا',duration:'٣ أيام',instructions:'بعد الأكل'};
const toastText=page=>page.$eval('#novaLabelsPanel',el=>el.querySelector('.nlx-toast')?.textContent||'');

async function openModal(page){
  await page.goto('http://127.0.0.1:8766/index.html#sale',{waitUntil:'domcontentloaded'});
  await sleep(900);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('nova:invoice-completed',{detail:{id:777,customer:'أحمد علي',items:[{name:'Panadol Extra'},{name:'Augmentin 1g'}]}})));
  await sleep(400);
}

async function fillCard(page,index,name,over={}){
  const card=`#nlMedicineList .med-card:nth-child(${index})`;
  const vals={name,...FIELDS,...over};
  for(const [field,value] of Object.entries(vals)){
    await page.fill(`${card} [data-field="${field}"]`,value);
    await page.dispatchEvent(`${card} [data-field="${field}"]`,'input');
  }
}

async function answerSafety(page){
  await page.click('input[name="nlPregnancy"][value="no"]');
  await page.click('input[name="nlBreastfeeding"][value="no"]');
}

async function geometry(page){
  return page.evaluate(()=>{
    const box=s=>{const el=document.querySelector(s);if(!el)return null;const b=el.getBoundingClientRect();return{top:b.top,bottom:b.bottom,w:b.width,h:b.height,sw:el.scrollWidth,cw:el.clientWidth}};
    const shown=s=>{const el=document.querySelector(s);if(!el)return false;const b=el.getBoundingClientRect();const st=getComputedStyle(el);return b.width>0&&b.height>0&&st.display!=='none'&&st.visibility!=='hidden'};
    return{
      sheet:box('#novaLabelsPanel .labels-sheet'),bar:box('#novaLabelsPanel .action-bar'),btn:box('#nlPrintAll'),
      barShown:shown('#novaLabelsPanel .action-bar'),btnShown:shown('#nlPrintAll'),
      stepper:shown('#novaLabelsPanel .stepper'),tabs:shown('#nlMedTabs'),approval:shown('#novaLabelsPanel .approval'),
      cards:[...document.querySelectorAll('#nlMedicineList .med-card')].filter(c=>c.getBoundingClientRect().height>0).length,
      moreOpen:!!document.querySelector('#novaLabelsPanel .nl-more')?.open,
      rtl:getComputedStyle(document.querySelector('#novaLabelsPanel .labels-sheet')).direction==='rtl',
    };
  });
}

async function runFlow(page,vp,errors){
  const L=vp.name;
  check(`${L}: modal opens from the sale flow`,await page.$eval('#novaLabelsPanel',el=>el.classList.contains('open')));
  const g0=await geometry(page);
  check(`${L}: no stepper, no tabs, no separate approval box`,!g0.stepper&&!g0.tabs&&!g0.approval);
  check(`${L}: preview and advanced settings collapsed by default`,g0.moreOpen===false);
  check(`${L}: sheet fits viewport`,g0.sheet.w<=vp.width+2&&g0.sheet.h<=vp.height+2);
  check(`${L}: print button visible and at least 44px high`,g0.btnShown&&g0.btn.h>=44);
  check(`${L}: RTL`,g0.rtl);

  await page.click('#nlAddMedicine');
  check(`${L}: every medicine has its own visible card`,(await geometry(page)).cards===2);
  check(`${L}: blocked button explains why (safety)`,(await page.$eval('#nlBarWhy',e=>e.textContent)).includes('الحمل والرضاعة'));
  await page.click('#nlPrintAll',{force:true});
  check(`${L}: blocked click shows the reason`,(await toastText(page)).includes('الحمل والرضاعة'));

  await answerSafety(page);
  check(`${L}: blocked button explains why (incomplete medicines)`,(await page.$eval('#nlBarWhy',e=>e.textContent)).includes('تحتاج مراجعة'));
  check(`${L}: button label counts the medicines`,(await page.$eval('#nlPrintLabel',e=>e.textContent)).includes('دوائين'));
  await page.click('#nlPrintAll',{force:true});
  check(`${L}: incomplete medicines block printing`,(await toastText(page)).includes('أكمل'));

  await fillCard(page,1,'Panadol Extra');
  check(`${L}: one incomplete left, reason updates`,(await page.$eval('#nlBarWhy',e=>e.textContent)).includes('دواء واحد'));
  await fillCard(page,2,'Augmentin 1g');
  check(`${L}: nothing blocks the button`,(await page.$eval('#nlBarWhy',e=>e.textContent))===''&&await page.$eval('#nlPrintAll',e=>!e.classList.contains('is-blocked')));

  // Print: one tap is the approval; no popup is opened
  await page.evaluate(()=>{window.__opens=0;window.open=()=>{window.__opens++;return null};window.__printEvents=[];window.addEventListener('nova:sticker-print',e=>window.__printEvents.push(e.detail))});
  await page.click('#nlPrintAll');
  await page.waitForFunction(()=>window.__printEvents.length>0,null,{timeout:6000});
  check(`${L}: printing started for both medicines`,(await page.evaluate(()=>window.__printEvents[0].count))===2);
  check(`${L}: no popup window used`,(await page.evaluate(()=>window.__opens))===0);
  check(`${L}: the print tap approved the review`,await page.$eval('#nlPharmacistApproval',e=>e.checked));
  check(`${L}: print frame holds one label per medicine`,await page.evaluate(()=>document.getElementById('nlPrintFrame').contentDocument.querySelectorAll('.label').length===2));
  check(`${L}: editing a medicine revokes the approval`,await (async()=>{await page.fill('#nlMedicineList .med-card:nth-child(1) [data-field="dose"]','نصف قرص');await page.dispatchEvent('#nlMedicineList .med-card:nth-child(1) [data-field="dose"]','input');return page.$eval('#nlPharmacistApproval',e=>!e.checked)})());

  // Long text: shrinks when it can, refuses when it cannot (never prints clipped text)
  const long=n=>'يؤخذ بعد الأكل مع كوب ماء '.repeat(n).trim();
  await fillCard(page,1,'Panadol Extra',{instructions:long(2)});
  check(`${L}: long text shows a card hint`,await page.$eval('#nlMedicineList .med-card:nth-child(1)',c=>c.textContent.includes('النص طويل')));
  await page.evaluate(()=>{window.__printEvents=[]});
  await page.click('#nlPrintAll');
  await page.waitForFunction(()=>window.__printEvents.length>0,null,{timeout:6000});
  const shrunk=await page.evaluate(()=>{const i=document.getElementById('nlPrintFrame').contentDocument.querySelector('.instruction');return parseFloat(i.style.fontSize||'7')});
  check(`${L}: long text is shrunk, not refused`,shrunk<7&&shrunk>=4.8);

  await fillCard(page,1,'Panadol Extra',{instructions:long(10)});
  await page.evaluate(()=>{window.__printEvents=[]});
  await page.click('#nlPrintAll');
  await sleep(1500);
  check(`${L}: text too long even when shrunk is refused with a clear message`,(await toastText(page)).includes('مقاسًا أكبر')&&(await page.evaluate(()=>window.__printEvents.length))===0);
  check(`${L}: refused print leaves no frame behind`,await page.evaluate(()=>!document.getElementById('nlPrintFrame')));

  // Settings are one link away
  await page.click('#nlOpenSettings');
  check(`${L}: size link opens the print settings`,await page.$eval('.nl-print-settings',e=>e.open&&!!e.querySelector('#nlPreset')));
  await page.selectOption('#nlPreset','100x50');
  await page.evaluate(()=>{window.__printEvents=[]});
  await page.click('#nlPrintAll');
  await page.waitForFunction(()=>window.__printEvents.length>0,null,{timeout:6000});
  check(`${L}: a bigger size prints the long text`,true);
  check(`${L}: size summary in the bar follows the choice`,(await page.$eval('#nlSizeBrief',e=>e.textContent)).includes('100'));
  await page.selectOption('#nlPreset','50x30');

  const g1=await geometry(page);
  check(`${L}: no horizontal clipping`,g1.sheet.sw<=g1.sheet.cw+2);
  check(`${L}: action bar still visible`,g1.barShown);
  if(L==='desktop') await page.screenshot({path:'reports/sale-sticker-modal.png'}).catch(()=>{});
  await page.keyboard.press('Escape');
  check(`${L}: Escape closes the modal`,await page.$eval('#novaLabelsPanel',el=>!el.classList.contains('open')));
  check(`${L}: no page errors`,errors.length===0);
}

let browser;
try{
  await sleep(700);
  browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
  for(const vp of VIEWPORTS){
    const context=await browser.newContext({viewport:{width:vp.width,height:vp.height},locale:'ar-EG',hasTouch:vp.name!=='desktop'});
    await context.addInitScript(()=>{window.confirm=()=>true});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await openModal(page);
    await runFlow(page,vp,errors);
    await context.close();
  }
  console.log('ALL SALE-STICKER-MODAL CHECKS PASSED');
}catch(e){
  console.error('FAIL',e.message);
  process.exitCode=1;
}finally{
  if(browser) await browser.close();
  server.kill();
}
