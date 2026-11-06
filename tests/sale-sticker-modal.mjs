import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

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

async function openSaleStickerModal(page){
  await page.goto('http://127.0.0.1:8766/index.html#sale',{waitUntil:'domcontentloaded'});
  await sleep(900);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('nova:invoice-completed',{detail:{id:777,customer:'أحمد علي',items:[{name:'Panadol Extra'},{name:'Augmentin 1g'}]}})));
  await sleep(400);
}

async function prepareCompleteSelectedMedicine(page){
  // Start from whatever draft is present: ensure two meds, fill the first, deselect the blank second.
  const tabCount=await page.$$eval('#nlMedTabs .med-tab',t=>t.length);
  if(tabCount<2) await page.click('#nlAddMedicine');
  await page.click('#nlMedTabs .med-tab'); // focus first
  await page.fill('#nlMedicineList .med-card:not([hidden]) [data-field="name"]','Panadol Extra');
  await page.dispatchEvent('#nlMedicineList .med-card:not([hidden]) [data-field="name"]','input');
  for(const [field,value] of [['dose','قرص'],['frequency','مرتين يوميًا'],['duration','٣ أيام'],['instructions','بعد الأكل']]){
    await page.fill(`#nlMedicineList .med-card:not([hidden]) [data-field="${field}"]`,value);
    await page.dispatchEvent(`#nlMedicineList .med-card:not([hidden]) [data-field="${field}"]`,'input');
  }
  // Deselect incomplete siblings so Print Selected can succeed
  const count=await page.$$eval('#nlPreviewGrid .sticker-preview[data-med-id]',n=>n.length);
  for(let i=2;i<=count;i++){
    const pressed=await page.$eval(`#nlPreviewGrid .sticker-preview[data-med-id]:nth-child(${i})`,el=>el.getAttribute('aria-pressed'));
    if(pressed==='true') await page.click(`#nlPreviewGrid .sticker-preview[data-med-id]:nth-child(${i})`);
  }
}

async function layoutBoxes(page){
  return page.evaluate(()=>{
    const r=s=>{const el=document.querySelector(s);if(!el)return null;const b=el.getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height,sw:el.scrollWidth,cw:el.clientWidth,top:b.top,bottom:b.bottom}};
    const visible=s=>{const el=document.querySelector(s);if(!el)return false;const b=el.getBoundingClientRect();const st=getComputedStyle(el);return b.width>0&&b.height>0&&st.visibility!=='hidden'&&st.display!=='none'};
    return{
      sheet:r('#novaLabelsPanel .labels-sheet'),
      stage:r('#nlHeroStage'),
      bar:r('#novaLabelsPanel .action-bar'),
      toolbar:r('#novaLabelsPanel .labels-toolbar'),
      actionBarVisible:visible('#novaLabelsPanel .action-bar'),
      printSettingsOpen:!!document.querySelector('.nl-print-settings')?.open,
      heroText:(document.querySelector('#nlHeroPreview')?.textContent||'').trim(),
      medEditors:document.querySelectorAll('#nlMedicineList .med-card:not([hidden])').length,
      pregnancy:!!document.querySelector('input[name="nlPregnancy"]'),
      breastfeeding:!!document.querySelector('input[name="nlBreastfeeding"]'),
      approval:!!document.querySelector('#nlPharmacistApproval'),
      patientCompact:!!document.querySelector('#novaLabelsPanel .patient-grid'),
      warningsCompact:!!document.querySelector('#novaLabelsPanel .ai-warn, #novaLabelsPanel .med-warn, #novaLabelsPanel .warnings'),
      rtl:getComputedStyle(document.querySelector('#novaLabelsPanel .labels-sheet')||document.body).direction==='rtl'
        ||getComputedStyle(document.querySelector('#novaLabelsPanel .layout')||document.body).direction==='rtl',
      layoutCols:getComputedStyle(document.querySelector('#novaLabelsPanel .layout')||document.body).gridTemplateColumns,
    };
  });
}

async function runDesktopFlow(page,errors){
  check('modal opens from sale invoice flow',await page.$eval('#novaLabelsPanel',el=>el.classList.contains('open')));
  check('invoice queued from sale',await page.$eval('#nlInvoiceQueue',el=>el.textContent.includes('أحمد علي')));

  await page.click('[data-age-unit="months"]');
  await page.fill('#nlPatientAge','18');
  await page.dispatchEvent('#nlPatientAge','input');
  check('age months hint converts to years',(await page.$eval('#nlAgeHint',el=>el.textContent)).includes('1 سنة'));
  check('pregnancy/breastfeeding required before print',await page.$eval('#nlSafety',el=>el.querySelectorAll('fieldset.needs').length===2));

  await page.click('#nlPrintAll');
  check('print blocked without pregnancy/breastfeeding',await page.$eval('#novaLabelsPanel .nlx-toast',el=>el.textContent.includes('الحمل والرضاعة')));
  await page.click('input[name="nlPregnancy"][value="no"]');
  await page.click('input[name="nlBreastfeeding"][value="no"]');
  await page.click('#nlPrintAll');
  check('pharmacist approval required before print',await page.$eval('#novaLabelsPanel .nlx-toast',el=>el.textContent.includes('موافقة الصيدلي')));

  await page.click('#nlAddMedicine');
  check('med tabs render one per medicine',await page.$$eval('#nlMedTabs .med-tab',t=>t.length===2));
  check('exactly one visible med editor',await page.$$eval('#nlMedicineList .med-card:not([hidden])',c=>c.length===1));
  await page.click('#nlMedTabs .med-tab');
  check('tab switch keeps single active editor',await page.$$eval('#nlMedicineList .med-card:not([hidden])',c=>c.length===1));

  await page.fill('#nlMedicineList .med-card:not([hidden]) [data-field="name"]','Panadol Extra');
  await page.dispatchEvent('#nlMedicineList .med-card:not([hidden]) [data-field="name"]','input');
  check('hero preview shows active medicine',await page.$eval('#nlHeroPreview',el=>el.textContent.includes('Panadol Extra')));
  check('preview grid allows print selection toggle',await page.$$eval('#nlPreviewGrid .sticker-preview',c=>c.length>=1));

  check('print settings collapsed by default',await page.$eval('.nl-print-settings',el=>!el.open));
  await page.click('.nl-print-settings summary');
  check('print settings expand on demand',await page.$eval('.nl-print-settings',el=>el.open&&!!el.querySelector('#nlPreset')));
  await page.click('.nl-print-settings summary');

  await page.fill('#nlMedicineList .med-card:not([hidden]) [data-field="dose"]','قرص');
  await page.dispatchEvent('#nlMedicineList .med-card:not([hidden]) [data-field="dose"]','input');
  await page.fill('#nlMedicineList .med-card:not([hidden]) [data-field="frequency"]','مرتين يوميًا');
  await page.dispatchEvent('#nlMedicineList .med-card:not([hidden]) [data-field="frequency"]','input');
  await page.fill('#nlMedicineList .med-card:not([hidden]) [data-field="duration"]','٣ أيام');
  await page.dispatchEvent('#nlMedicineList .med-card:not([hidden]) [data-field="duration"]','input');
  await page.fill('#nlMedicineList .med-card:not([hidden]) [data-field="instructions"]','بعد الأكل');
  await page.dispatchEvent('#nlMedicineList .med-card:not([hidden]) [data-field="instructions"]','input');
  await page.check('#nlPharmacistApproval');
  await page.click('#nlPrintAll');
  check('print blocked while any medicine incomplete',await page.$eval('#novaLabelsPanel .nlx-toast',el=>el.textContent.includes('أكمل')));
  await page.click('#nlPreviewGrid .sticker-preview[data-med-id]:nth-child(2)');
  await page.click('#nlPrintSelected');
  await sleep(300);
  const toastText=await page.$eval('#novaLabelsPanel',el=>el.querySelector('.nlx-toast')?.textContent||'');
  check('approved complete med passes validation (only popup-blocked toast allowed)',toastText===''||toastText.includes('نافذة الطباعة'));
  check('print path hit popup gate (window.open stubbed null)',toastText.includes('نافذة الطباعة'));

  const boxes=await layoutBoxes(page);
  check('sheet fits desktop viewport',boxes.sheet.w<=1280&&boxes.sheet.h<=860);
  check('hero stage inside sheet, above action bar',boxes.stage.y>=boxes.toolbar.y+boxes.toolbar.h-1&&boxes.stage.y+boxes.stage.h<=boxes.bar.y+1);
  check('no horizontal clipping in sheet',boxes.sheet.sw<=boxes.sheet.cw+1);
  check('action bar visible on desktop',boxes.actionBarVisible);
  check('compact patient grid present',boxes.patientCompact);
  check('pregnancy/breastfeeding + approval present',boxes.pregnancy&&boxes.breastfeeding&&boxes.approval);
  check('one active medicine editor on desktop',boxes.medEditors===1);
  check('print settings collapsed after flow',boxes.printSettingsOpen===false);
  await page.screenshot({path:'reports/sale-sticker-modal.png'}).catch(()=>{});

  check('modal keeps RTL',boxes.rtl);
  await page.keyboard.press('Escape');
  check('Escape closes modal',await page.$eval('#novaLabelsPanel',el=>!el.classList.contains('open')));
  check('no page errors',errors.length===0);
}

async function runViewportSmoke(page,vp){
  const label=vp.name;
  check(`${label}: modal opens`,await page.$eval('#novaLabelsPanel',el=>el.classList.contains('open')));

  await page.click('[data-age-unit="months"]');
  await page.fill('#nlPatientAge','18');
  await page.dispatchEvent('#nlPatientAge','input');
  await page.click('input[name="nlPregnancy"][value="no"]');
  await page.click('input[name="nlBreastfeeding"][value="no"]');
  await prepareCompleteSelectedMedicine(page);

  const boxes=await layoutBoxes(page);
  check(`${label}: sheet fits viewport`,boxes.sheet.w<=vp.width+2&&boxes.sheet.h<=vp.height+2);
  check(`${label}: no horizontal sheet clipping`,boxes.sheet.sw<=boxes.sheet.cw+2);
  check(`${label}: action bar visible`,boxes.actionBarVisible);
  check(`${label}: one active med editor`,boxes.medEditors===1);
  check(`${label}: hero preview populated`,boxes.heroText.includes('Panadol Extra'));
  check(`${label}: pregnancy + breastfeeding present`,boxes.pregnancy&&boxes.breastfeeding);
  check(`${label}: pharmacist approval present`,boxes.approval);
  check(`${label}: print settings collapsed`,boxes.printSettingsOpen===false);
  check(`${label}: RTL`,boxes.rtl);
  if(boxes.stage&&boxes.bar){
    check(`${label}: hero does not cover action bar`,boxes.stage.bottom<=boxes.bar.top+2);
  }

  // Print gate without approval
  await page.evaluate(()=>{const el=document.querySelector('#nlPharmacistApproval');if(el)el.checked=false;});
  // Keep state.approved in sync via change event
  await page.evaluate(()=>{
    const el=document.querySelector('#nlPharmacistApproval');
    if(el){el.checked=false;el.dispatchEvent(new Event('change',{bubbles:true}));}
  });
  await page.click('#nlPrintSelected');
  await sleep(200);
  const toastBlocked=await page.$eval('#novaLabelsPanel',el=>(el.querySelector('.nlx-toast')?.textContent||''));
  check(`${label}: print gated without approval`,toastBlocked.includes('موافقة الصيدلي'));

  await page.check('#nlPharmacistApproval');
  await page.click('#nlPrintSelected');
  await sleep(300);
  const toastAfter=await page.$eval('#novaLabelsPanel',el=>(el.querySelector('.nlx-toast')?.textContent||''));
  check(`${label}: print path after approval reaches popup gate`,toastAfter.includes('نافذة الطباعة')||toastAfter==='');
}

let browser;
try{
  await sleep(700);
  browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});

  // --- Desktop full acceptance ---
  {
    const context=await browser.newContext({viewport:{width:1280,height:860},locale:'ar-EG'});
    await context.addInitScript(()=>{
      window.__printed=false;
      window.print=()=>{window.__printed=true};
      window.confirm=()=>true;
      // App print path uses window.open(...); null forces the browser-gate toast
      window.open=()=>null;
    });
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await openSaleStickerModal(page);
    await runDesktopFlow(page,errors);
    await context.close();
    console.log('VIEWPORT desktop: PASS');
  }

  // --- Tablet landscape + mobile layout/print smokes ---
  for(const vp of VIEWPORTS.filter(v=>v.name!=='desktop')){
    const context=await browser.newContext({
      viewport:{width:vp.width,height:vp.height},
      locale:'ar-EG',
      isMobile:vp.name==='mobile',
      hasTouch:vp.name==='mobile',
    });
    await context.addInitScript(()=>{
      window.__printed=false;
      window.print=()=>{window.__printed=true};
      window.confirm=()=>true;
      window.open=()=>null;
    });
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await openSaleStickerModal(page);
    await runViewportSmoke(page,vp);
    check(`${vp.name}: no page errors`,errors.length===0);
    await context.close();
    console.log('VIEWPORT '+vp.name+': PASS');
  }

  console.log('ALL SALE-STICKER-MODAL CHECKS PASSED');
}catch(e){console.error('FAIL',e.message);process.exitCode=1}
finally{if(browser)await browser.close();server.kill()}
