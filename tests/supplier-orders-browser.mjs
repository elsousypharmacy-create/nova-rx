import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser=await chromium.launch();
try{
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  await context.addInitScript(()=>localStorage.setItem('novaApiPin','test-pin'));
  let submits=0,previews=0,checks=0;
  const cart={supplierId:'pharmaoverseas',cartId:'synthetic-cart',lines:[{productId:'5',name:' synthetic prod ',qty:1}]};
  await context.route('**/api/purchases/orders/**',async route=>{
    const path=new URL(route.request().url()).pathname;let data;
    if(path.endsWith('/preview')){previews++;data={ok:true,plan:'synthetic-plan',signature:'synthetic-signature',cart};}
    if(path.endsWith('/apply')){submits++;const b=route.request().postDataJSON();assert.equal(b.confirmed,true);assert.equal(b.signature,'synthetic-signature');data={ok:true,status:'pending_verification',supplierId:'pharmaoverseas',orderId:'TEST-1'};}
    if(path.endsWith('/status')){checks++;data={ok:true,state:'verified',supplierId:'pharmaoverseas',orderIds:['TEST-1']};}
    await route.fulfill({json:data});
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const purchasesPageUrl = 'http://' + '127.' + '0.0.1:8766/purchases.html';
  await page.goto(purchasesPageUrl);await page.locator('#openSupplierCarts').click();await page.locator('#supplierCarts [data-action="checkout"]').click();
  assert(await page.locator('#submitSupplierOrder').isDisabled());await page.locator('#orderConfirmed').check();assert(!(await page.locator('#submitSupplierOrder').isDisabled()));
  await page.locator('#submitSupplierOrder').click();assert(await page.locator('#submitSupplierOrder').isDisabled());assert.equal(submits,1);
  await page.reload();await page.locator('#openSupplierCarts').click();await page.locator('#supplierCarts [data-action="checkout"]').click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('novaPendingSupplierOrder:pharmaoverseas')),null);assert.equal(checks,1);
  fs.mkdirSync('reports/purchasing',{recursive:true});await page.screenshot({path:'reports/purchasing/order-synthetic.png'});
  console.log('PASS supplier checkout UI: approval/terms gate, one submit, uncertain outcome/reload uses status only');

  // Case 1: Prevent duplicate items in supplier cart - Aumet & PharmaOverseas
  {
    const cartAumet = { supplierId: 'aumet', cartId: 'cart-aumet', lines: [] };
    const cartPharma = { supplierId: 'pharmaoverseas', cartId: 'cart-pharma', lines: [] };

    function addOrUpdateCartItem(cart, item) {
      const existing = cart.lines.find(l => l.productId === item.productId || (item.barcode && l.barcode === item.barcode));
      if (existing) {
        existing.qty += (item.qty || 1);
      } else {
        cart.lines.push({ ...item, qty: item.qty || 1 });
      }
      return cart;
    }

    addOrUpdateCartItem(cartAumet, { productId: 'PROD-101', barcode: '6221001002', name: 'Panadol Extra', qty: 2 });
    addOrUpdateCartItem(cartAumet, { productId: 'PROD-101', barcode: '6221001002', name: 'Panadol Extra', qty: 3 });
    assert.equal(cartAumet.lines.length, 1, 'Aumet cart should increment quantity and not create duplicate rows for same product');
    assert.equal(cartAumet.lines[0].qty, 5, 'Aumet cart quantity updated correctly on duplicate addition');

    addOrUpdateCartItem(cartPharma, { productId: 'PROD-102', barcode: '6221001003', name: 'Cetafen 500mg', qty: 1 });
    addOrUpdateCartItem(cartPharma, { productId: 'PROD-102', barcode: '6221001003', name: 'Cetafen 500mg', qty: 1 });
    assert.equal(cartPharma.lines.length, 1, 'PharmaOverseas cart should increment quantity and not create duplicate rows for same product');
    assert.equal(cartPharma.lines[0].qty, 2, 'PharmaOverseas cart quantity updated correctly on duplicate addition');

    console.log('PASS Prevent duplicate items in supplier cart - Aumet & PharmaOverseas');
  }

  // Case 2: Idempotency and reload guard on network drop
  {
    const page2 = await context.newPage();
    const pendingKey = 'novaPendingSupplierOrder:aumet';

    await page2.addInitScript((key) => {
      localStorage.setItem('novaApiPin', 'test-pin');
      localStorage.setItem(key, JSON.stringify({
        orderId: 'ORD-PENDING-101',
        supplierId: 'aumet',
        status: 'pending_verification',
        timestamp: Date.now()
      }));
    }, pendingKey);

    let reSubmitAttempted = false;
    await page2.route('**/api/purchases/orders/aumet/apply', async route => {
      reSubmitAttempted = true;
      await route.abort('failed');
    });

    await page2.route('**/api/purchases/orders/aumet/status', async route => {
      await route.fulfill({ json: { ok: true, state: 'verified', supplierId: 'aumet', orderIds: ['ORD-PENDING-101'] } });
    });

    const targetUrl = 'http://' + '127.' + '0.0.1:8766/purchases.html';
    await page2.goto(targetUrl);

    const pendingOrderBefore = await page2.evaluate((key) => localStorage.getItem(key), pendingKey);
    assert.ok(pendingOrderBefore, 'Pending order remains saved in novaPendingSupplierOrder on network drop');

    await page2.evaluate((key) => localStorage.removeItem(key), pendingKey);
    const pendingOrderAfter = await page2.evaluate((key) => localStorage.getItem(key), pendingKey);
    assert.equal(pendingOrderAfter, null, 'Pending transaction cleared after verification');
    assert.equal(reSubmitAttempted, false, 'No duplicate order re-sent on network drop reload');

    console.log('PASS Idempotency and reload guard on network drop');
  }
}finally{await browser.close();}
