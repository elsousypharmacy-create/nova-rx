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
let browser;
try{
  await sleep(700);
  browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1280,height:860},locale:'ar-EG'});
  await context.addInitScript(()=>{window.print=()=>{window.__printed=true};window.confirm=()=>true;window.open=()=>null});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8766/index.html#sale',{waitUntil:'domcontentloaded'});
  await sleep(1200);

  // open via sale invoice flow event
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('nova:invoice-completed',{detail:{id:777,customer:'أحمد علي',items:[{name:'Panadol Extra'},{name:'Augmentin 1g'}]}})));
  await sleep(400);
  check('modal opens from sale invoice flow',await page.$eval('#novaLabelsPanel',el=>el.classList.contains('open')));
  check('invoice queued from sale',await page.$eval('#nlInvoiceQueue',el=>el.textContent.includes('أحمد علي')));

  // patient block: age years/months + pregnancy/breastfeeding
  await page.click('[data-age-unit="months"]');
  await page.fill('#nlPatientAge','18');
  await page.dispatchEvent('#nlPatientAge','input');
  check('age months hint converts to years',(await page.$eval('#nlAgeHint',el=>el.textContent)).includes('1 سنة'));
  check('pregnancy/breastfeeding required before print',await page.$eval('#nlSafety',el=>el.querySelectorAll('fieldset.needs').length===2));

  // print blocked without safety + approval
  await page.click('#nlPrintAll');
  check('print blocked without pregnancy/breastfeeding',await page.$eval('#novaLabelsPanel .nlx-toast',el=>el.textContent.includes('الحمل والرضاعة')));
  await page.click('input[name="nlPregnancy"][value="no"]');
  await page.click('input[name="nlBreastfeeding"][value="no"]');
  await page.click('#nlPrintAll');
  check('pharmacist approval required before print',await page.$eval('#novaLabelsPanel .nlx-toast',el=>el.textContent.includes('موافقة الصيدلي')));

  // one active medicine editor with tabs
  await page.click('#nlAddMedicine');
  check('med tabs render one per medicine',await page.$$eval('#nlMedTabs .med-tab',t=>t.length===2));
  check('exactly one visible med editor',await page.$$eval('#nlMedicineList .med-card:not([hidden])',c=>c.length===1));
  await page.click('#nlMedTabs .med-tab');
  check('tab switch keeps single active editor',await page.$$eval('#nlMedicineList .med-card:not([hidden])',c=>c.length===1));

  // fill active med, large preview updates
  await page.fill('#nlMedicineList .med-card:not([hidden]) [data-field="name"]','Panadol Extra');
  await page.dispatchEvent('#nlMedicineList .med-card:not([hidden]) [data-field="name"]','input');
  check('hero preview shows active medicine',await page.$eval('#nlHeroPreview',el=>el.textContent.includes('Panadol Extra')));
  check('preview grid allows print selection toggle',await page.$$eval('#nlPreviewGrid .sticker-preview',c=>c.length>=1));

  // print settings collapsed until needed
  check('print settings collapsed by default',await page.$eval('.nl-print-settings',el=>!el.open));
  await page.click('.nl-print-settings summary');
  check('print settings expand on demand',await page.$eval('.nl-print-settings',el=>el.open&&!!el.querySelector('#nlPreset')));
  await page.click('.nl-print-settings summary');

  // approval gate passes → print window attempted
  await page.fill('#nlMedicineList .med-card:not([hidden]) [data-field="dose"]','قرص');
  await page.dispatchEvent('#nlMedicineList .med-card:not([hidden]) [data-field="dose"]','input');
  await page.fill('#nlMedicineList .med-card:not([hidden]) [data-field="frequency"]','مرتين يوميًا');
  await page.dispatchEvent('#nlMedicineList .med-card:not([hidden]) [data-field="frequency"]','input');
  await page.fill('#nlMedicineList .med-card:not([hidden]) [data-field="duration"]','٣ أيام');
  await page.dispatchEvent('#nlMedicineList .med-card:not([hidden]) [data-field="duration"]','input');
  await page.fill('#nlMedicineList .med-card:not([hidden]) [data-field="instructions"]','بعد الأكل');
  await page.dispatchEvent('#nlMedicineList .med-card:not([hidden]) [data-field="instructions"]','input');
  await page.check('#nlPharmacistApproval');
  // printAll must still block on the incomplete second medicine
  await page.click('#nlPrintAll');
  check('print blocked while any medicine incomplete',await page.$eval('#novaLabelsPanel .nlx-toast',el=>el.textContent.includes('أكمل')));
  // deselect the blank medicine, then print only the selected (complete) one
  await page.click('#nlPreviewGrid .sticker-preview[data-med-id]:nth-child(2)');
  await page.click('#nlPrintSelected');
  await sleep(300);
  const toastText=await page.$eval('#novaLabelsPanel',el=>el.querySelector('.nlx-toast')?.textContent||'');
  check('approved complete med passes validation (only popup-blocked toast allowed)',toastText===''||toastText.includes('نافذة الطباعة'));

  // desktop overlap / clipping checks
  const boxes=await page.evaluate(()=>{
    const r=s=>{const el=document.querySelector(s);if(!el)return null;const b=el.getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height,sw:el.scrollWidth,cw:el.clientWidth}};
    return{sheet:r('#novaLabelsPanel .labels-sheet'),stage:r('#nlHeroStage'),bar:r('#novaLabelsPanel .action-bar'),toolbar:r('#novaLabelsPanel .labels-toolbar')};
  });
  check('sheet fits desktop viewport',boxes.sheet.w<=1280&&boxes.sheet.h<=860);
  check('hero stage inside sheet, above action bar',boxes.stage.y>=boxes.toolbar.y+boxes.toolbar.h-1&&boxes.stage.y+boxes.stage.h<=boxes.bar.y+1);
  check('no horizontal clipping in sheet',boxes.sheet.sw<=boxes.sheet.cw+1);
  await page.screenshot({path:'reports/sale-sticker-modal.png'});

  // RTL + close behavior
  check('modal keeps RTL',await page.$eval('#novaLabelsPanel .labels-sheet',el=>getComputedStyle(el).direction==='rtl'||getComputedStyle(document.querySelector('#novaLabelsPanel .layout')).direction==='rtl'));
  await page.keyboard.press('Escape');
  check('Escape closes modal',await page.$eval('#novaLabelsPanel',el=>!el.classList.contains('open')));
  check('no page errors',errors.length===0);
  console.log('ALL SALE-STICKER-MODAL CHECKS PASSED');
}catch(e){console.error('FAIL',e.message);process.exitCode=1}
finally{if(browser)await browser.close();server.kill()}
