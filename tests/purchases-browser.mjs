import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const stamp=new Date().toISOString();
let searchCalls=0;
const stock=Array.from({length:4},(_,i)=>({id:String(i+1),code:String(1201+i),name:`صنف اختباري ${i+1}`,nameEn:`Testdrug${i+1} 500mg 20 tabs`,stock:2,minStock:4,idealStock:10,dailySales:null,observedDays:0}));
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({viewport:{width:1280,height:800}});
 await context.addInitScript(()=>{localStorage.setItem('novaApiPin','test-pin');localStorage.setItem('novaPurchasePrefsV1',JSON.stringify({days:21,level:'ideal',suppliers:['aumet'],aumetSellers:['one','two']}));});
 await context.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;let data;
  if(path==='/api/purchases/stock')data={ok:true,schemaVersion:1,sourceUpdatedAt:stamp,items:stock};
  else if(path==='/api/suppliers/status')data={suppliers:[{id:'aumet',state:'ok'},{id:'pharmaoverseas',state:'ok'}]};
  else if(path==='/api/suppliers/sellers')data={sellers:[{id:'one',name:'مخزن تجريبي أ'},{id:'excluded',name:'مخزن مستبعد'},{id:'two',name:'مخزن تجريبي ب'}]};
  else if(path==='/api/purchases/aumet-cart/preview'){const line=route.request().postDataJSON();data={ok:true,plan:JSON.stringify(line),signature:'synthetic',before:2,quantity:line.quantity,target:2+line.quantity};}
  else if(path==='/api/purchases/aumet-cart/apply'){data={ok:true,state:'verified'};}
  else if(path==='/api/suppliers/search'){
   const body=route.request().postDataJSON();searchCalls++;assert.deepEqual(body.supplierIds,['aumet']);assert.deepEqual(body.aumetSellerIds,['one','two']);
   data={suppliers:[{id:'aumet',state:'ok'}],results:[{offers:[['one',3,50],['excluded',100,10],['two',20,60]].map(([seller,qty,price])=>({offer:{supplierId:'aumet',sellerId:seller,sellerName:{one:'مخزن تجريبي أ',two:'مخزن تجريبي ب',excluded:'مخزن مستبعد'}[seller],supplierProductId:seller+body.query,productName:body.query,availableQuantity:qty,unitPrice:price,publicPrice:100,stockStatus:'in_stock',currency:'EGP',lastUpdated:stamp}}))}]};
  }else return route.fulfill({status:404,body:'{}'});
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:8766/purchases.html');await page.locator('#load').click();await page.locator('#settings').waitFor({state:'visible'});assert((await page.locator('#sourceState').innerText()).includes('محتاج رقم الداشبورد'));await page.locator('#dashboardPin').fill('synthetic-owner-pin');await page.locator('#saveSettings').click();await page.waitForFunction(()=>document.querySelectorAll('#rows [data-action=qty]').length===4);
 assert.equal(await page.locator('[data-action=qty]').first().inputValue(),'8');
 await page.locator('#days').fill('٢٣');await page.locator('#days').press('Tab');assert.equal(await page.locator('[data-action=qty]').first().inputValue(),'8');
 await page.locator('#selectAll').check();await page.locator('#distribute').click();await page.locator('#distributionProgress').waitFor({state:'visible'});assert(/^[0-9]+%$/.test(await page.locator('#progressPercent').innerText()));await page.waitForFunction(()=>!document.getElementById('distribute').disabled,{timeout:30000});
 assert.equal(await page.locator('#groups .group').count(),2);assert(!(await page.locator('#groups').innerText()).includes('مخزن مستبعد'));assert.equal(await page.locator('.supplier-select').count(),4);assert(!(await page.locator('.supplier-select').first().innerText()).includes('مخزن مستبعد'));assert.equal(searchCalls,4);assert(await page.locator('#distributionProgress').isHidden());assert(!/[٠-٩]/.test(await page.locator('#groups').innerText()));assert.equal(await page.locator('.nova-topbar nav a').count(),7);
 await page.locator('#review').click();assert((await page.locator('#reviewDialog').innerText()).includes('لم تُرسل'));await page.locator('#saveDraft').click();assert((await page.locator('#savedState').innerText()).includes('لم تُضف'));
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('novaPurchaseDraftV1')));assert.equal(saved.state,'local-draft');assert.equal(saved.groups.length,2);await page.locator('#prepareAumet').click();await page.waitForFunction(()=>!document.getElementById('prepareAumet').disabled,{timeout:40000});assert(!(await page.locator('#applyAumet').isHidden()));await page.locator('#applyAumet').click();await page.waitForFunction(()=>!document.getElementById('applyAumet').disabled,{timeout:30000});assert((await page.locator('#cartStatus').innerText()).includes('تم التحقق'));assert(await page.locator('#applyAumet').isHidden());await page.locator('#closeReview').click();
 await page.locator('#openSettings').click();await page.locator('#refreshSellers').click();await page.locator('[data-seller=two]').waitFor();await page.locator('[data-seller=two]').uncheck();await page.locator('#settings .close').click();
 await page.locator('#openSettings').click();assert(await page.locator('[data-seller=two]').isChecked());await page.locator('[data-seller=two]').uncheck();await page.locator('#saveSettings').click();assert.equal(await page.locator('#groups .group').count(),0);
 await page.locator('#openSettings').click();await page.locator('[data-seller=two]').check();await page.locator('#saveSettings').click();await page.locator('#distribute').click();await page.waitForFunction(()=>!document.getElementById('distribute').disabled,{timeout:30000});
 assert.equal(searchCalls,4,'redistribution reuses fresh offers without a second supplier roundtrip');assert((await page.locator('#status').innerText()).includes('آخر دقيقتين'));
 const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:innerHeight,scrollHeight:document.documentElement.scrollHeight}));assert.equal(geometry.width,geometry.scrollWidth);assert.equal(geometry.height,geometry.scrollHeight);const reviewRect=await page.locator('#review').boundingBox();assert(reviewRect.y+reviewRect.height<=geometry.height,'cart review action stays visible with long grouped contents');
 fs.mkdirSync('reports/purchasing',{recursive:true});await page.evaluate(()=>{const badge=document.createElement('div');badge.textContent='اختبار الواجهة • بيانات توضيحية';badge.style.cssText='position:fixed;top:4px;left:50%;transform:translateX(-50%);z-index:99999;background:#344354;color:white;border-radius:5px;padding:3px 10px;font:12px Tahoma;pointer-events:none';document.body.appendChild(badge);});await page.screenshot({path:'reports/purchasing/tablet.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'reports/purchasing/phone.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 fs.writeFileSync('reports/purchasing/browser.json',JSON.stringify({result:'PASS',syntheticData:true,geometry,checks:['free-form Arabic days','read-only stock','real seller ids filtering','highest discount','split allocation','draft truthful status','cancel settings','invalidate allocations','tablet and phone layout'],errors},null,2));
 console.log('PASS purchasing browser workflow (synthetic data)');
}finally{await browser.close();}
