import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser=await chromium.launch();
try{
 const context=await browser.newContext({viewport:{width:1280,height:800}});
 await context.addInitScript(()=>localStorage.setItem('novaApiPin','test-pin'));
 let submits=0,previews=0,checks=0;
 const cart={supplierId:'pharmaoverseas',cartId:'synthetic-cart',lines:[{productId:'5',name:'صنف تجريبي من سلة المورد',quantity:3,unitPrice:40,total:120}],total:120,currency:'EGP',tax:0,discount:0,payment:'ACCOUNT',delivery:'عنوان توصيل تجريبي'};
 await context.route('**/api/purchases/orders/**',async route=>{
  const path=new URL(route.request().url()).pathname;let data;
  if(path.endsWith('/preview')){previews++;data={ok:true,plan:'synthetic-plan',signature:'synthetic-signature',cart};}
  if(path.endsWith('/apply')){submits++;const b=route.request().postDataJSON();assert.equal(b.confirmed,true);assert.equal(b.termsAccepted,true);await new Promise(r=>setTimeout(r,500));data={ok:false,state:'unknown',error:'order-outcome-unknown',orderIds:['TEST-1']};}
  if(path.endsWith('/status')){checks++;data={ok:true,state:'verified',supplierId:'pharmaoverseas',orderIds:['TEST-1'],total:120,currency:'EGP'};}
  await route.fulfill({json:data});
 });
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:8766/purchases.html');await page.locator('#openSupplierCarts').click();await page.locator('#supplierCarts [data-review-order=pharmaoverseas]').click();await page.getByText('صنف تجريبي من سلة المورد',{exact:false}).waitFor();
 assert(await page.locator('#submitSupplierOrder').isDisabled());await page.locator('#orderConfirmed').check();assert(await page.locator('#submitSupplierOrder').isDisabled());await page.locator('#orderTerms').check();assert(await page.locator('#submitSupplierOrder').isEnabled());assert.equal(submits,0);
 await page.locator('#submitSupplierOrder').click();assert(await page.locator('#submitSupplierOrder').isDisabled());await page.getByText('أرقام مستلمة تحتاج تحقق:',{exact:false}).waitFor();assert.equal(submits,1);assert(await page.locator('#submitSupplierOrder').isDisabled());
 await page.reload();await page.locator('#openSupplierCarts').click();await page.locator('#supplierCarts [data-review-order=pharmaoverseas]').click();await page.locator('#checkSupplierOrder').waitFor({state:'visible'});assert.equal(previews,1,'reopen retains original operation');assert(await page.locator('#submitSupplierOrder').isDisabled());await page.locator('#checkSupplierOrder').click();await page.getByText('تم تنفيذ الطلب والتحقق منه',{exact:false}).waitFor();assert.equal(submits,1);assert.equal(checks,1);
 assert.equal(await page.evaluate(()=>localStorage.getItem('novaPendingSupplierOrder:pharmaoverseas')),null);assert.deepEqual(errors,[]);
 fs.mkdirSync('reports/purchasing',{recursive:true});await page.screenshot({path:'reports/purchasing/order-synthetic.png'});await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'reports/purchasing/order-phone-synthetic.png'});
 console.log('PASS supplier checkout UI: approval/terms gate, one submit, uncertain outcome/reload uses status only, receipt and mobile fit (synthetic)');
}finally{await browser.close();}
