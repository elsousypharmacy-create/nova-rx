import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root=process.cwd();
const candidates=[
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].filter(Boolean);
const executablePath=candidates.find(existsSync);
assert(executablePath,'Set CHROME_PATH to an installed Chromium browser');
const server=spawn(process.execPath,['scripts/dev-server.mjs','--port','8765'],{cwd:root,stdio:'ignore'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const base='http://127.0.0.1:8765/sticker-studio.html';
const draftKey='nova.stickerStudio.draft.v1';
const results=[];
const check=(name,condition)=>{assert(condition,name);results.push(name);console.log(`PASS ${name}`)};
let browser;
try{
  await sleep(500);
  browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1180,height:820},locale:'ar-EG'});
  await context.addInitScript(()=>{window.print=()=>{window.__printed=true};window.confirm=()=>true});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  const seed=async(count=1,patient={})=>{
    await page.evaluate(({draftKey,count,patient})=>{
      const medications=Array.from({length:count},(_,i)=>({id:`med-${i+1}`,name:`دواء ${i+1}`,dose:`${i+1} مل`,frequency:'مرتين يوميًا',duration:'٥ أيام',instructions:'حسب تعليمات الصيدلي',warnings:[],selected:true,editRevision:0}));
      localStorage.setItem(draftKey,JSON.stringify({patient:{name:'مريض تجريبي',phone:'',age:'6',ageUnit:'years',weight:'20',pregnancy:'',breastfeeding:'',...patient},medications,approved:false,selectedInvoice:null}));
    },{draftKey,count,patient});
    await page.reload();
  };
  await check('default age is six years',await page.locator('#patientAge').inputValue()==='6');
  await check('default age unit is years',await page.locator('#ageUnit').inputValue()==='years');
  await check('pregnancy has no default',await page.locator('input[name="pregnancy"]:checked').count()===0);
  await check('breastfeeding has no default',await page.locator('input[name="breastfeeding"]:checked').count()===0);

  await seed(1);
  await check('one label renders',await page.locator('.sticker-preview').count()===1);
  await seed(6);
  await check('six labels render on one page',await page.locator('.sticker-preview').count()===6);
  await check('next pager disabled at six labels',await page.locator('#stickerNext').isDisabled());
  await seed(7);
  await check('seven labels show six initially',await page.locator('.sticker-preview').count()===6);
  await page.locator('#stickerNext').click();
  await check('seven labels show one on page two',await page.locator('.sticker-preview').count()===1);
  await check('page two counter',await page.locator('#stickerPageCount').textContent()==='2 / 2');
  await page.locator('#stickerPrev').click();
  await check('pager returns to first six',await page.locator('.sticker-preview').count()===6);
  await seed(12);
  await page.locator('#stickerNext').click();
  await check('twelve labels show six on page two',await page.locator('.sticker-preview').count()===6);
  await check('twelve labels disable next on page two',await page.locator('#stickerNext').isDisabled());

  await seed(2,{pregnancy:'no',breastfeeding:'no'});
  const second=page.locator('[data-med-id="med-2"]');
  await second.click();
  await check('sticker click deselects',await second.getAttribute('aria-pressed')==='false');
  await second.focus();
  await page.keyboard.press('Enter');
  await check('keyboard reselects sticker',await second.getAttribute('aria-pressed')==='true');
  await second.click();
  await page.locator('#pharmacistApproval').check();
  let popupPromise=context.waitForEvent('page');
  await page.locator('#printSelected').click();
  let popup=await popupPromise;
  await popup.waitForSelector('.label');
  await check('selected print contains only selected sticker',await popup.locator('.label').count()===1);
  await popup.close();
  popupPromise=context.waitForEvent('page');
  await page.locator('#printAll').click();
  popup=await popupPromise;
  await popup.waitForSelector('.label');
  await check('print all includes deselected sticker',await popup.locator('.label').count()===2);
  await popup.close();
  await page.locator('[data-id="med-1"] [data-field="dose"]').fill('تعديل يدوي');
  await check('medication edit revokes approval',!(await page.locator('#pharmacistApproval').isChecked()));
  await page.locator('#printAll').click();
  await check('revoked approval blocks printing',(await page.locator('.toast').textContent()).includes('موافقة الصيدلي'));

  await seed(1);
  let aiRequest;
  await page.route('**/api/ai/medication-label',async route=>{
    aiRequest=route.request().postDataJSON();
    await sleep(350);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({dose:'جرعة AI',frequency:'مرة',duration:'يوم',instructions:'تعليمات AI'})});
  });
  await page.locator('[data-action="ai"]').click();
  await page.locator('[data-id="med-1"] [data-field="dose"]').fill('تعديل أثناء التوليد');
  await sleep(650);
  await check('AI payload preserves unanswered pregnancy as null',aiRequest.patient.pregnancy===null);
  await check('AI payload preserves unanswered breastfeeding as null',aiRequest.patient.breastfeeding===null);
  await check('late AI response preserves manual edit',await page.locator('[data-id="med-1"] [data-field="dose"]').inputValue()==='تعديل أثناء التوليد');
  await check('stale AI response explains preservation',(await page.locator('[data-id="med-1"]').textContent()).includes('حُفظت تعديلاتك'));

  await page.unroute('**/api/ai/medication-label');
  await page.route('**/api/ai/medication-label',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'خدمة الذكاء الاصطناعي غير متاحة'})}));
  const beforeError=await page.locator('.app').boundingBox();
  await page.locator('[data-action="ai"]').click();
  await page.waitForSelector('[data-id="med-1"] .status.err');
  const afterError=await page.locator('.app').boundingBox();
  await check('AI error keeps fixed workspace height',Math.abs(beforeError.height-afterError.height)<1);
  await check('AI error preserves medicine name',await page.locator('[data-id="med-1"] [data-field="name"]').inputValue()==='دواء 1');
  await page.reload();
  await check('refresh preserves medication draft',await page.locator('.sticker-preview').count()===1);
  await check('refresh preserves manual dose',await page.locator('[data-id="med-1"] [data-field="dose"]').inputValue()==='تعديل أثناء التوليد');
  await check('refresh requires renewed approval',!(await page.locator('#pharmacistApproval').isChecked()));

  await seed(6,{pregnancy:'no',breastfeeding:'no'});
  await page.waitForFunction(()=>[...document.images].every(image=>image.complete&&image.naturalWidth>0));
  await check('pharmacy logo loads in header and every sticker',await page.evaluate(()=>[...document.images].every(image=>image.naturalWidth>0)));
  await check('complete medication editor fits without internal clipping',await page.locator('[data-id="med-1"]').evaluate(card=>card.scrollHeight<=card.clientHeight+1));
  await mkdir(path.join(root,'reports','sticker-studio'),{recursive:true});
  for(const [width,height] of [[1024,768],[1180,820],[1366,768],[1440,900],[390,844]]){
    await page.setViewportSize({width,height});
    await sleep(150);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
    await check(`no horizontal overflow at ${width}x${height}`,!overflow);
    await check(`label content fits at ${width}x${height}`,await page.locator('.preview-grid .label-inner').evaluateAll(labels=>labels.every(label=>label.scrollHeight<=label.clientHeight+1&&label.scrollWidth<=label.clientWidth+1)));
    await page.screenshot({path:path.join(root,'reports','sticker-studio',`${width}x${height}.png`),fullPage:true});
  }
  await check('zero browser page errors',errors.length===0);
  console.log(`\n${results.length} browser checks passed`);
}finally{
  if(browser)await browser.close();
  server.kill('SIGTERM');
}
