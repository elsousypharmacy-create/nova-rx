import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'seller-search-'));
fs.writeFileSync(path.join(dir,'in.html'),'<!DOCTYPE html><html lang="ar" dir="rtl"><body><input id="mainSearchInput" value="Panadol"><div id="suggestionsBox"><div>لا توجد منتجات مطابقة</div></div></body></html>');
execFileSync('node',['tools/inject-supplier-ui.mjs',path.join(dir,'in.html'),path.join(dir,'out.html')]);
const html=fs.readFileSync(path.join(dir,'out.html'),'utf8');
const browser=await chromium.launch();
try{
 const context=await browser.newContext({viewport:{width:1280,height:800}});
 await context.addInitScript(()=>{localStorage.setItem('novaApiPin','test');localStorage.setItem('novaPurchasePrefsV1',JSON.stringify({days:31,level:'minimum',suppliers:['pharmaoverseas'],aumetSellers:[]}));});
 let searches=[],sellersFail=false,mutations=0;
 await context.route('**/scope-fixture',route=>route.fulfill({contentType:'text/html',body:html}));
 await context.route('**/api/**',async route=>{
  const url=new URL(route.request().url());let data;
  if(url.pathname.endsWith('/sellers')){if(sellersFail)return route.fulfill({status:503,json:{error:'session-expired'}});data={sellers:[{id:'one',name:'مخزن مختار'},{id:'two',name:'مخزن آخر'},{id:'locked',name:'مخزن مقفول',locked:true}]};}
  else if(url.pathname.endsWith('/search')){const b=route.request().postDataJSON();searches.push(b);data={suppliers:[{id:'pharmaoverseas',name:'أوفرسيز',state:'error',message:'خطأ تجريبي واضح'}],results:[{offers:b.supplierIds.includes('aumet')?['one','two'].map(id=>({offer:{supplierId:'aumet',supplierProductId:id,sellerId:id,sellerName:id==='one'?'مخزن مختار':'مخزن آخر',productName:'Panadol',unitPrice:40,publicPrice:50,stockStatus:'in_stock',currency:'EGP',lastUpdated:new Date().toISOString()}})):[]}]};}
  else{mutations++;return route.fulfill({status:500,json:{}});}
  await route.fulfill({json:data});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:8766/scope-fixture');await page.locator('.su-empty button').click();
 await page.getByText('لا توجد عروض من المخازن المحددة؛ راجع إعدادات المشتريات',{exact:true}).waitFor();
 assert(!(searches.at(-1).supplierIds.includes('aumet')));assert(await page.getByText('أوميت متوقف في اختيارات الموردين',{exact:true}).isVisible());
 assert(await page.getByText('أوفرسيز: خطأ تجريبي واضح',{exact:true}).isVisible(),'empty offers must retain supplier errors');
 await page.locator('[data-aumet-scope]').click();await page.locator('[data-seller-id=one]').waitFor();
 assert.equal(await page.locator('[data-seller-id=locked]').count(),0);
 await page.locator('[data-save-scope]').click();await page.getByText('اختَر مخزنًا واحدًا على الأقل',{exact:true}).waitFor();assert.equal(searches.length,1);
 await page.locator('[data-seller-id=one]').check();await page.locator('[data-back]').click();
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('novaPurchasePrefsV1')).aumetSellers),[],'cancel preserves selection');
 await page.locator('[data-aumet-scope]').click();await page.locator('[data-seller-id=one]').check();await page.locator('[data-save-scope]').click();
 await page.locator('.sp-row').waitFor();assert.equal(await page.locator('.sp-row').count(),1);assert(!(await page.locator('.sp-body').innerText()).includes('مخزن آخر'));
 assert.deepEqual(searches.at(-1).aumetSellerIds,['one']);assert.deepEqual(searches.at(-1).supplierIds,['pharmaoverseas','aumet']);
 const prefs=await page.evaluate(()=>JSON.parse(localStorage.getItem('novaPurchasePrefsV1')));assert.equal(prefs.days,31);assert.equal(prefs.level,'minimum');
 sellersFail=true;await page.locator('[data-aumet-scope]').click();await page.getByText('تعذر قراءة مخازن أوميت؛ الاختيارات المحفوظة لم تتغير. جدّد جلسة المورد ثم حاول تاني.',{exact:true}).waitFor();assert(await page.locator('[data-save-scope]').isDisabled());
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('novaPurchasePrefsV1')).aumetSellers),['one']);
 assert.equal(mutations,0);assert.deepEqual(errors,[]);
 console.log('PASS sale seller selection: disabled/empty scope visible, selection/research, strict filtering, cancel/error preserve prefs, no supplier mutations');
}finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true});}
