import { readAppHtml } from '../lib/app-html.mjs'; // PERF-02: index.html + split app/ files
import {readFileSync} from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const h=readAppHtml(process.env.NOVA_UX_HTML||'index.html','utf8');const source=h.slice(h.indexOf('      function refreshChange()'),h.indexOf('      function updateChangeDue('));
const fields={checkoutCreditHint:{hidden:true},inputCreditAmount:{value:'',setAttribute(){}},checkoutAddCustomer:{},checkoutAllocation:{},inputCashReceived:{value:'40'},inputCardAmount:{value:'60'}};
let plan={ok:true,change:0};const state={checkoutPaymentMethod:'split',attachedCustomer:null};
const ctx={state,recalculateFinancials:()=>({grandTotal:100}),currentTenderPlan:()=>plan,elements:{displayChangeDue:{},btnConfirmPayment:{},modalAmountDue:{}},dueForMethod:t=>({due:t,rounding:0}),novaEn:()=>false,document:{getElementById:id=>fields[id]},localStorage:{getItem:()=> 'ar'},formatMoney:x=>x.toFixed(2)};
vm.createContext(ctx);vm.runInContext(source+';this.refresh=refreshChange;',ctx);ctx.refresh();
assert.equal(fields.inputCreditAmount.disabled,true);assert.equal(fields.checkoutCreditHint.hidden,false);assert.match(fields.checkoutAddCustomer.textContent,/ربط عميل/);assert.match(fields.checkoutAllocation.textContent,/100.00.*0.00/);
state.attachedCustomer={id:'fake'};ctx.refresh();assert.equal(fields.inputCreditAmount.disabled,false);assert.equal(fields.checkoutCreditHint.hidden,true);
fields.inputCashReceived.value='20';plan={ok:false,error:'short'};ctx.refresh();assert.equal(ctx.elements.btnConfirmPayment.disabled,true);assert.match(fields.checkoutAllocation.textContent,/80.00.*20.00/);
plan={ok:false,error:'credit-needs-customer'};state.attachedCustomer=null;ctx.refresh();assert.equal(ctx.elements.btnConfirmPayment.disabled,true);
state.paymentSubmitting=true;plan={ok:true,change:0};ctx.refresh();assert.equal(ctx.elements.btnConfirmPayment.disabled,true);
// Real async submission wrapper; deferred lock reproduces rapid double tap/Enter race.
const wrapper=h.slice(h.indexOf('      function confirmPayment()'),h.indexOf('      function confirmPaymentCore()'));
const attrs=o=>Object.assign(o,{_a:{},setAttribute(k,v){this._a[k]=v},removeAttribute(k){delete this._a[k]}});
let resolveLock,calls=0,confirmed=0;const modal={classList:{contains:()=>true}};
const c={state:{},elements:{btnConfirmPayment:attrs({disabled:false,textContent:'تأكيد البيع (Enter)'}),checkoutModal:modal},window:{novaStock:{withLock:fn=>{calls++;return new Promise(resolve=>{resolveLock=()=>{fn();resolve()}})}}},confirmPaymentCore:()=>confirmed++,ensureOffersReady:async()=>true,ensureControlledCapture:async()=>true,ensureCreditApproval:async()=>true,ensureDiscountApproval:async()=>true,refreshChange(){},showToast(){},novaEn:()=>false};
vm.createContext(c);vm.runInContext(wrapper+';this.submit=confirmPayment;',c);
const first=c.submit();c.submit();await new Promise(r=>setTimeout(r,0));assert.equal(calls,1);assert.equal(c.elements.btnConfirmPayment.textContent,'جاري حفظ الفاتورة…','saving label while the guard is active');assert.equal(c.elements.btnConfirmPayment._a['aria-busy'],'true');resolveLock();await first;assert.equal(confirmed,1);assert.equal(c.state.paymentSubmitting,false);
assert.equal(c.elements.btnConfirmPayment.textContent,'تأكيد البيع (Enter)','label restored after saving');assert.equal(c.elements.btnConfirmPayment._a['aria-busy'],undefined,'busy flag cleared');
// Shape checks are intentionally NOT claimed as viewport tests.
const modalHtml=h.slice(h.indexOf('<!-- CHECKOUT MODAL -->'),h.indexOf('<!-- RECEIPT SLIP MODAL -->'));
assert.ok(modalHtml.indexOf('checkout-amount-display')<modalHtml.indexOf('class="modal-body"'));
assert.ok(modalHtml.indexOf('checkoutAllocation')>modalHtml.indexOf('class="modal-footer"'));
assert.match(h,/#checkoutModal \.modal-body\{min-height:0;overflow-y:auto/);
assert.match(modalHtml,/تأكيد البيع \(Enter\)/);assert.doesNotMatch(modalHtml,/Confirm & Print/);
console.log('PASS UX12/13 tender summary, credit gating, short tender, async duplicate submission guard, DOM structure (viewport NOT tested)');
