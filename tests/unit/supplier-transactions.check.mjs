import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {createSupplierOrders} from '../../worker/procurement/provider/supplier-orders.js';
import {createSupplierCartService} from '../../worker/procurement/provider/supplier-cart-service.js';
function database(){const s=new DatabaseSync(':memory:');s.exec(fs.readFileSync('worker/procurement/migrations/0001_supplier_operations.sql','utf8'));return {prepare(sql){return {bind(...p){return {async run(){return {meta:{changes:Number(s.prepare(sql).run(...p).changes)}};},async first(){return s.prepare(sql).get(...p)||null;}};}};}};}
const saved={code:'saved',saveTime:'2026-01-01',entries:[{product:{code:'5'},quantity:999}]};
let current={code:'active',entries:[{entryNumber:0,product:{code:'5',name:'Test product'},quantity:2,basePrice:{value:40},totalPrice:{value:80}}],totalPrice:{value:80,currencyIso:'EGP'},subTotal:{value:80},totalTax:{value:0},totalDiscounts:{value:0},paymentType:{code:'ACCOUNT'}};
let writes=0,orderPosts=0,lose=false,cartPosts=0;
const store={load:async id=>({savedAt:'fixed-session',session:id==='aumet'?{authorization:'fixture',sellers:[{id:'7'}],cartRequestTemplate:{method:'POST',path:'/api/v2/cart/9/items',body:{entity_id:8,payment_method_id:1}}}:{accessToken:'fixture'}})};
const hub={search:async()=>({results:[{offers:[{offer:{supplierId:'pharmaoverseas',supplierProductId:'5',unitPrice:40,stockStatus:'in_stock'}}]}]})};
const fetch=async(url,opts)=>{
 const u=new URL(url);
 if(opts.method==='GET'&&u.pathname.endsWith('/carts'))return Response.json({carts:[saved,...(current?[current]:[])]});
 if(opts.method==='POST'&&u.pathname.endsWith('/carts')){cartPosts++;current={code:'new-active',entries:[]};return Response.json(current);}
 if(opts.method==='PATCH'&&u.pathname.endsWith('/entries/0')){writes++;current.entries[0].quantity=JSON.parse(opts.body).quantity;return Response.json({statusCode:'success'});}
 if(opts.method==='POST'&&u.pathname.endsWith('/entries')){writes++;assert(u.pathname.includes('/orgUsers/current/'));assert.equal(u.searchParams.get('code'),'5');assert.equal(opts.headers['Content-Type'],'application/x-www-form-urlencoded');current.entries.push({entryNumber:0,product:{code:'5',name:'Test product'},quantity:Number(u.searchParams.get('quantity')),basePrice:{value:40},totalPrice:{value:120}});return Response.json({statusCode:'success'});}
 if(opts.method==='POST'&&u.pathname.endsWith('/orders')){orderPosts++;assert(u.pathname.includes('/orgUsers/current/'));assert.equal(u.searchParams.get('termsChecked'),'true');if(lose)throw Error('lost-response');return Response.json({code:'ORDER-1'});}
 if(opts.method==='GET'&&u.pathname.endsWith('/orders/ORDER-1'))return Response.json({code:'ORDER-1'});
 throw Error('Unexpected request '+opts.method+' '+u.pathname);
};
const options={store,hub,secret:'unit-only',db:database(),fetch};
const carts=createSupplierCartService(options),line={productId:'5',quantity:3,price:40,query:'Test product'};
let plan=await carts.preview('pharmaoverseas',line);assert.equal(plan.before,2,'saved cart ignored');assert.equal(plan.target,5);assert.equal(writes,0);assert.equal((await carts.apply('pharmaoverseas',plan)).state,'verified');assert.equal(current.entries[0].quantity,5);assert.equal(writes,1);await createSupplierCartService(options).apply('pharmaoverseas',plan);assert.equal(writes,1,'receipt replay across service instances');
current=null;plan=await carts.preview('pharmaoverseas',line);assert.equal(cartPosts,0);assert.equal((await carts.apply('pharmaoverseas',plan)).state,'verified');assert.equal(cartPosts,1);assert.equal(writes,2);assert.equal(current.entries[0].quantity,3);
current={...current,totalPrice:{value:120,currencyIso:'EGP'},subTotal:{value:120},totalTax:{value:0},totalDiscounts:{value:0},paymentType:{code:'ACCOUNT'}};
const orders=createSupplierOrders(options);
let order=await orders.preview({supplierId:'pharmaoverseas'});assert.equal(orderPosts,0);await assert.rejects(orders.apply({...order,confirmed:false}),/order-confirmation-required/);await assert.rejects(orders.apply({...order,confirmed:true,termsAccepted:false}),/order-terms-required/);assert.equal(orderPosts,0);
current.totalPrice.value=121;await assert.rejects(orders.apply({...order,confirmed:true,termsAccepted:true}),/order-cart-changed/);assert.equal(orderPosts,0);current.totalPrice.value=120;
order=await orders.preview({supplierId:'pharmaoverseas'});const result=await orders.apply({...order,confirmed:true,termsAccepted:true});assert.equal(result.state,'verified');assert.deepEqual(result.orderIds,['ORDER-1']);await createSupplierOrders(options).apply({...order,confirmed:true,termsAccepted:true});assert.equal(orderPosts,1);
// A lost response after submission blocks ALL new mutations for that supplier.
await new Promise(r=>setTimeout(r,2));order=await orders.preview({supplierId:'pharmaoverseas'});lose=true;const unknown=await orders.apply({...order,confirmed:true,termsAccepted:true});assert.equal(unknown.state,'unknown');const retry=await orders.preview({supplierId:'pharmaoverseas'});await assert.rejects(createSupplierOrders(options).apply({...retry,confirmed:true,termsAccepted:true}),/cart-(?:operation-pending|account-busy)/);assert.equal(orderPosts,2);
assert.equal((await orders.status(order)).state,'unknown');assert.equal(orderPosts,2);
// Aumet selected-seller scope, cart changes, exact response IDs and read-back.
let aumetPosts=0,total=100;
const aOptions={...options,db:database(),fetch:async(url,opts)=>{const p=new URL(url).pathname;
 if(opts.method==='GET'&&p==='/api/v2/cart/9/items')return Response.json({data:{buyer:{id:8},currency:{symbol:'EGP'},total,subTotal:100,vat:0,discount:0,sellers:[{id:70001,entity:{id:7,name:'fixture seller'},seller_total:100,minimum_order_value_area:{limit:'20'},items:[{quantity:2,unit_price:50,total:100,is_selected:1,payment_method_id:1,entityProduct:{id:5,product:{label:{name:'fixture drug'}}}}]}]}});
 if(opts.method==='POST'&&p==='/api/v2/order'){aumetPosts++;const b=JSON.parse(opts.body);assert.equal(b.entity_id,8);assert.equal(b.sellers[0].entity_id,70001);return Response.json({data:[{id:123}]});}
 if(opts.method==='GET'&&p==='/api/v2/order/123')return Response.json({data:{id:123}});throw Error('unexpected Aumet request');}};
const aOrders=createSupplierOrders(aOptions);await assert.rejects(aOrders.preview({supplierId:'aumet',aumetSellerIds:[]}),/order-extra-sellers/);const ap=await aOrders.preview({supplierId:'aumet',aumetSellerIds:['7']});assert.equal(ap.cart.lines[0].name,'fixture drug');assert.equal(aumetPosts,0);const ar=await aOrders.apply({...ap,confirmed:true});assert.equal(ar.state,'verified');assert.deepEqual(ar.orderIds,['123']);await aOrders.apply({...ap,confirmed:true});assert.equal(aumetPosts,1);
console.log('PASS both supplier transactions: saved/active carts, absolute quantity, creation after approval, terms, price conflict, order IDs/read-back, persistent dedup/unknown lock');
