import { readDays, buildNeeds, distribute, filterOffers, offerKey, groupCart, numberOrNull, createOfferSearch } from './purchases-core.js';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => Number.isFinite(n) ? new Intl.NumberFormat('en-US',{maximumFractionDigits:2}).format(n) : '—';
const PREF='novaPurchasePrefsV1', DRAFT='novaPurchaseDraftV1';
let prefs={days:21,level:'ideal',suppliers:['aumet','pharmaoverseas'],aumetSellers:[]};
try{const p=JSON.parse(localStorage.getItem(PREF)||'null');if(p&&typeof p==='object')prefs={...prefs,...p};}catch{}
prefs.suppliers=Array.isArray(prefs.suppliers)?prefs.suppliers.filter(x=>['aumet','pharmaoverseas'].includes(x)):[];
prefs.aumetSellers=Array.isArray(prefs.aumetSellers)?prefs.aumetSellers.map(String):[];
let rawItems=[],items=[],sellers=[],offersByItem=new Map(),dashboardPin='',busy=false,generation=0,lastText='',pendingSellerIds=new Set();
let cartPlans=[],sentLines=new Set(),pendingStockLoad=false;
const provider=()=>window.NOVA_SUPPLIER_PROVIDER;
let offerCacheHits=0;
const offerSearch=createOfferSearch({request:async(query,opts)=>{const r=await provider().search(query,opts);return {rows:(r.results||[]).flatMap(x=>x.offers||[]),complete:opts.supplierIds.length>0&&opts.supplierIds.every(id=>(r.suppliers||[]).some(s=>s.id===id&&s.state==='ok'))};}});

function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('warning',error);}
function persist(){try{localStorage.setItem(PREF,JSON.stringify(prefs));}catch{status('تعذر حفظ الاختيارات على الجهاز',true);}}
function invalidate(){cartPlans=[];generation++;items.forEach(i=>{i.allocations=[];i.unallocated=i.qty;});render();}
function setBusy(value){busy=value;['load','distribute','days','minimum','ideal','openSettings'].forEach(id=>$(id).disabled=value);}
function levelView(){['minimum','ideal'].forEach(id=>$(id).setAttribute('aria-pressed',String(id===prefs.level)));}
function rebuild(){try{prefs.days=readDays($('days').value);$('days').value=prefs.days;items=buildNeeds(rawItems,prefs);offersByItem.clear();generation++;persist();render();}catch(e){status(e.message,true);}}
function visibleItems(){const q=$('search').value.trim().toLocaleLowerCase();return items.filter(i=>!q||`${i.name} ${i.nameEn||''} ${i.code||''}`.toLocaleLowerCase().includes(q));}
function supplierSelect(item,found){
 const choices=filterOffers(item,offersByItem.get(item.key)||[],prefs).filter(r=>r.eligible);
 if(!choices.length)return '';
 return `<select class="supplier-select" data-action="supplier" aria-label="مورد ${esc(item.name)}"><option value="">${item.allocations?.length>1?'مقسم على عدة عروض':'اختيار المورد'}</option>${choices.map(r=>`<option value="${esc(offerKey(r.offer))}" ${item.allocations?.length===1&&found&&offerKey(found)===offerKey(r.offer)?'selected':''}>${esc(r.offer.sellerName||supplierName(r.offer.supplierId))} · ${fmt(r.discount)}%</option>`).join('')}</select>`;
}
function render(){
 const view=visibleItems();$('count').textContent=`(${items.length})`;
 $('rows').innerHTML=view.length?view.map(i=>{
  const allocation=i.allocations?.[0],found=allocation?.offer;
  const warning=i.issue||(i.unallocated>0&&i.allocations?.length?'كمية متبقية بلا عرض':'');
  return `<tr data-key="${esc(i.key)}" class="${warning?'warning-row':''}"><td><input type="checkbox" data-action="select" aria-label="تحديد ${esc(i.name)}" ${i.selected?'checked':''} ${i.issue||busy?'disabled':''}></td><td><div class="product-name">${esc(i.name)}</div><div class="product-en">${esc(i.nameEn||'')}</div><small title="${esc(i.basis||i.issue||'')}">${esc(i.code||'')}</small></td><td>${fmt(numberOrNull(i.stock))}</td><td>${fmt(i.target)}</td><td><input class="qty" type="text" inputmode="numeric" data-action="qty" aria-label="الكمية المطلوبة ${esc(i.name)}" value="${esc(i.qty)}" ${i.issue||busy?'disabled':''}></td><td>${found?`${supplierSelect(i,found)}<small class="money">${fmt(allocation.price)} ج.م <span class="discount">${fmt(allocation.discount)}٪</span></small>${i.allocations.length>1?`<small>مقسم على ${fmt(i.allocations.length)} عروض</small>`:''}${allocation.quantityUnconfirmed?'<small class="warning">كمية المورد غير محددة</small>':''}`:`<small>${esc(i.issue||'اختَر عرضًا أو وزّع تلقائيًا')}</small>`}${warning?`<small class="warning">${esc(warning)}</small>`:''}</td><td><button class="row-action" data-action="offers" ${busy?'disabled':''}>العروض</button></td></tr>`;
 }).join(''):'<tr><td colspan="7" class="empty">'+(rawItems.length?'لا توجد نواقص مطابقة للاختيار الحالي.':'حدّث النواقص لقراءة مخزون الصيدلية.')+'</td></tr>';
 $('selectAll').disabled=busy;
 $('selectAll').checked=view.length>0&&view.every(i=>i.selected||i.issue);
 const groups=groupCart(items);$('groupCount').textContent=`${fmt(groups.length)} مجموعات`;
 $('groups').innerHTML=groups.length?groups.map(groupHtml).join(''):'<p class="empty">لم يتم توزيع أصناف بعد.</p>';
 $('total').textContent=groups.length?fmt(groups.reduce((sum,g)=>sum+g.total,0))+' ج.م':'— ج.م';
 $('review').disabled=!groups.length||busy;
}
function supplierName(id){return id==='aumet'?'أوميت':id==='pharmaoverseas'?'فارما أوفرسيز':id;}
function groupHtml(g){return `<section class="group"><h3>${esc(supplierName(g.supplierId))}</h3>${g.sellerName?`<small>${esc(g.sellerName)}</small>`:''}<ul>${g.lines.map(l=>`<li><span>${esc(l.name)}</span><b>${fmt(l.qty)} علبة</b><small>${l.cartState==='verified'?'✓ في سلة المورد':'تجهيز محلي'}</small></li>`).join('')}</ul><b>${fmt(g.total)} ج.م</b></section>`;}
function configValid(){if(!prefs.suppliers.length){status('اختَر موردًا واحدًا على الأقل من الإعدادات',true);return false;}if(prefs.suppliers.includes('aumet')&&!prefs.aumetSellers.length){status('حدّد مخازن أوميت المسموح بها أولًا',true);openSettings(false);return false;}return true;}
async function loadStock(){
 if(busy)return;
 if(!dashboardPin){pendingStockLoad=true;openSettings(false);$('dashboardPin').focus();$('sourceState').textContent='STOCK LIVE · محتاج رقم الداشبورد';status('اكتب رقم دخول الداشبورد في الخانة المفتوحة ثم احفظ؛ هيبدأ تحميل النواقص تلقائيًا.',true);return;}
 pendingStockLoad=false;
 try{prefs.days=readDays($('days').value);}catch(e){status(e.message,true);return;}
 setBusy(true);status('جارٍ قراءة النواقص من STOCK LIVE…');
 try{
  const result=await provider().purchasingStock(dashboardPin);
  if(!result.ok||!Array.isArray(result.items))throw new Error(result.error==='source-auth-required'?'اكتب رقم دخول الداشبورد في إعدادات الموردين لقراءة المخزون':result.error==='source-not-ready'?'مصدر المشتريات يحتاج تحديث السيرفر؛ لم يتم تحميل بيانات قديمة بدلًا منه':'تعذر قراءة مخزون الصيدلية');
  rawItems=result.items;rebuild();$('sourceState').textContent='STOCK LIVE · متصل';$('sourceState').parentElement.classList.add('ready');
  const date=new Date(result.sourceUpdatedAt||result.generatedAt);$('sourceTime').textContent=Number.isNaN(date.getTime())?'وقت تحديث المصدر غير متاح':'آخر تحديث المصدر '+date.toLocaleString('en-GB',{timeZone:'Africa/Cairo'});
  status(`تمت قراءة ${fmt(rawItems.length)} صنف؛ ${fmt(items.length)} بحاجة للطلب. راجع الكميات قبل التوزيع.`);
 }catch(e){if(e.message==='source-auth-required'){dashboardPin='';pendingStockLoad=true;openSettings(false);$('dashboardPin').focus();}const message=e.message==='pin-required'?'اكتب رقم موردين نوفا عند طلبه للاتصال':e.message==='source-auth-required'?'اكتب رقم دخول الداشبورد في إعدادات الموردين':e.message==='source-not-ready'?'مصدر المشتريات يحتاج تحديث السيرفر':e.message==='source-unavailable'?'تعذر الاتصال بمصدر المخزون؛ أعد المحاولة':e.message;status(message||'تعذر الاتصال بالمصدر',true);$('sourceState').textContent=e.message==='source-auth-required'?'STOCK LIVE · راجع رقم الداشبورد':e.message==='pin-required'?'STOCK LIVE · محتاج رقم موردين نوفا':'STOCK LIVE · تعذر التحديث';$('sourceState').parentElement.classList.remove('ready');}
 finally{setBusy(false);render();}
}
async function searchOffers(item){
 const result=await offerSearch.search(item.nameEn||item.name,{requestedQty:item.qty,supplierIds:prefs.suppliers});
 if(result.cached)offerCacheHits++;
 const rows=result.value.rows;offersByItem.set(item.key,rows);return rows;
}
function showProgress(done,total,name=''){
 const pct=total?Math.floor(done/total*100):0;
 $('progressRing').style.setProperty('--progress',pct+'%');$('progressRing').setAttribute('aria-valuenow',String(pct));
 $('progressPercent').textContent=pct+'%';$('progressCount').textContent=`تمت مراجعة ${done} من ${total} صنف`;$('progressProduct').textContent=name;
}
async function allocateAll(){
 if(busy||!configValid())return;if(!items.some(i=>i.selected)){status('حدّد الأصناف المطلوبة أولًا',true);return;}
 const token=++generation;setBusy(true);items.forEach(i=>{i.allocations=[];i.unallocated=i.qty;});render();
 const hitsBefore=offerCacheHits;
 let done=0,fail=0;const selected=items.filter(i=>i.selected&&!i.issue);$('stopDistribute').disabled=false;showProgress(0,selected.length);$('distributionProgress').hidden=false;
 try{for(const item of selected){
  status(`جارٍ مقارنة عروض الصنف ${fmt(done+1)} من ${fmt(selected.length)}…`);
  showProgress(done,selected.length,item.name);
  try{const rows=await searchOffers(item);if(token!==generation)return;Object.assign(item,distribute(item,rows,prefs));}catch{fail++;item.allocations=[];item.unallocated=item.qty;}
  done++;showProgress(done,selected.length,item.name);
  const scroll=$('rows').parentElement.scrollTop;render();$('rows').parentElement.scrollTop=scroll;
 }
 const remain=selected.filter(i=>i.unallocated>0).length;
 status(`تم توزيع ${fmt(selected.length-remain)} صنف. ${fmt(remain)} يحتاج اختيارًا أو مراجعة${fail?`؛ تعذر البحث عن ${fmt(fail)} صنف`:''}. القائمة لم تُرسل إلى الموردين.${offerCacheHits>hitsBefore?` تم استخدام ${fmt(offerCacheHits-hitsBefore)} عروض محفوظة خلال آخر دقيقتين.`:''}`,remain>0);
 }finally{setBusy(false);$('distributionProgress').hidden=true;render();}
}
async function openOffers(item){
 if(busy)return;setBusy(true);$('offerTitle').textContent=item.name;$('offerRows').textContent='جارٍ البحث…';$('offers').showModal();
 try{const rows=await searchOffers(item);const mapped=filterOffers(item,rows,prefs);$('offerRows').innerHTML=mapped.length?mapped.map((r,index)=>`<section class="offer"><b>${esc(r.offer.productName)}</b><p>${esc(supplierName(r.offer.supplierId))} · ${esc(r.offer.sellerName||'')}</p><p>${fmt(r.price)} ج.م · خصم ${fmt(r.discount)}٪ · ${r.offer.availableQuantity==null?'كمية التوفر غير محددة':`المتاح ${fmt(r.offer.availableQuantity)}`}</p>${r.reason?`<small class="warning">${esc(r.reason)}</small>`:''}<button data-offer="${index}" ${r.eligible?'':'disabled'}>اختيار هذا العرض</button></section>`).join(''):'لا توجد عروض مطابقة حاليًا.';
 $('offerRows').querySelectorAll('[data-offer]').forEach(button=>button.onclick=()=>{const row=mapped[Number(button.dataset.offer)],offer=row.offer;const available=numberOrNull(offer.availableQuantity);const qty=Math.min(item.qty,available===null?item.qty:Math.floor(available));if(qty<=0||qty<(numberOrNull(offer.minimumOrderQuantity)||1)){status('الكمية أقل من الحد الأدنى لطلب المورد',true);return;}item.allocations=[{...row,key:offerKey(offer),qty,quantityUnconfirmed:available===null,cartState:'local-draft'}];item.unallocated=item.qty-qty;item.selected=true;$('offers').close();render();});
 }catch{$('offerRows').textContent='تعذر قراءة عروض الموردين؛ لم تتغير الكميات.';}finally{setBusy(false);}
}
function renderSellers(){const q=$('sellerSearch').value.trim().toLocaleLowerCase();$('sellers').innerHTML=sellers.length?sellers.filter(s=>s.name.toLocaleLowerCase().includes(q)).map(s=>`<label class="check"><input type="checkbox" data-seller="${esc(s.id)}" ${pendingSellerIds.has(String(s.id))?'checked':''} ${s.locked?'disabled':''}>${esc(s.name)}${s.locked?'<small>غير متاح لحسابك</small>':''}</label>`).join(''):'لم تُقرأ مخازن حسابك بعد. جدّد جلسة أوميت ثم اضغط تحديث.';}
async function refreshSellers(){
 $('refreshSellers').disabled=true;
 try{const r=await provider().listSellers();sellers=(r.sellers||[]).map(s=>({...s,id:String(s.id)}));renderSellers();if(!sellers.length)status('قائمة المخازن غير متاحة في جلسة أوميت الحالية؛ جدّد الجلسة ثم أعد القراءة',true);}
 catch{status('تعذر قراءة مخازن أوميت؛ الاختيارات المحفوظة لم تتغير',true);}finally{$('refreshSellers').disabled=false;}
}
function openSettings(checkConnection=true){pendingSellerIds=new Set(prefs.aumetSellers);['aumet','pharmaoverseas'].forEach(id=>$('supplier-'+id).checked=prefs.suppliers.includes(id));$('dashboardPin').value=dashboardPin;renderSellers();$('settings').showModal();if(checkConnection)provider().listSuppliers().then(list=>{for(const s of list){const el=$(s.id==='aumet'?'aumetState':'pharmaState');el.textContent=s.state==='ok'?'متصل':'الجلسة تحتاج تجديد';}}).catch(()=>status('تعذر فحص اتصال الموردين',true));}
$('days').value=prefs.days;levelView();
$('days').addEventListener('change',rebuild);
['minimum','ideal'].forEach(level=>$(level).onclick=()=>{prefs.level=level;levelView();rebuild();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('distributionProgress').hidden){e.preventDefault();$('stopDistribute').click();}});
$('stopDistribute').onclick=()=>{generation++;$('stopDistribute').disabled=true;$('progressProduct').textContent='جارٍ إيقاف المقارنة…';status('تم إيقاف المقارنة؛ النتائج المكتملة محفوظة. جارٍ إنهاء البحث الحالي إن وُجد.');};
$('load').onclick=loadStock;$('distribute').onclick=allocateAll;$('search').oninput=render;
$('openSettings').onclick=()=>openSettings();$('refreshSellers').onclick=refreshSellers;$('sellerSearch').oninput=renderSellers;
$('sellers').addEventListener('change',e=>{const id=e.target.dataset.seller;if(!id)return;if(e.target.checked)pendingSellerIds.add(id);else pendingSellerIds.delete(id);});
$('saveSettings').onclick=()=>{prefs.aumetSellers=[...pendingSellerIds];prefs.suppliers=['aumet','pharmaoverseas'].filter(id=>$('supplier-'+id).checked);dashboardPin=$('dashboardPin').value.trim();$('dashboardPin').value='';persist();invalidate();$('settings').close();status('تم حفظ الموردين والمخازن؛ حدّث النواقص أو أعد التوزيع.');if(pendingStockLoad)loadStock();};
$('selectAll').onchange=()=>{visibleItems().forEach(i=>{if(!i.issue)i.selected=$('selectAll').checked;});render();};
$('rows').addEventListener('change',event=>{const row=event.target.closest('[data-key]');if(!row)return;const item=items.find(i=>i.key===row.dataset.key);if(event.target.dataset.action==='supplier'){const row=filterOffers(item,offersByItem.get(item.key)||[],prefs).find(r=>r.eligible&&offerKey(r.offer)===event.target.value);if(row){Object.assign(item,distribute(item,[row.offer],prefs));render();}return;}if(event.target.dataset.action==='select'){item.selected=event.target.checked;render();}if(event.target.dataset.action==='qty'){try{item.qty=readDays(event.target.value);item.allocations=[];item.unallocated=item.qty;render();}catch{status('اكتب كمية صحيحة أكبر من صفر',true);event.target.value=item.qty;}}});
$('rows').addEventListener('click',event=>{const button=event.target.closest('[data-action=offers]');if(button)openOffers(items.find(i=>i.key===button.closest('[data-key]').dataset.key));});
$('closeOffers').onclick=()=>$('offers').close();$('closeReview').onclick=()=>$('reviewDialog').close();
$('review').onclick=()=>{const groups=groupCart(items);$('reviewGroups').innerHTML=groups.map(groupHtml).join('');lastText=groups.map(g=>`${supplierName(g.supplierId)}${g.sellerName?' — '+g.sellerName:''}\n${g.lines.map(l=>`${l.name} × ${l.qty} — ${l.price} ج.م`).join('\n')}\nالإجمالي ${g.total} ج.م`).join('\n\n');$('savedState').textContent='';cartPlans=[];$('cartPlans').textContent='';$('cartStatus').textContent='';$('applyAumet').hidden=true;$('prepareAumet').disabled=!groups.length;$('reviewDialog').showModal();};
$('saveDraft').onclick=()=>{try{const groups=groupCart(items);localStorage.setItem(DRAFT,JSON.stringify({version:1,id:crypto.randomUUID(),savedAt:new Date().toISOString(),state:'local-draft',days:prefs.days,level:prefs.level,groups}));$('savedState').textContent='اتحفظت قائمة التجهيز في نوفا على الجهاز. لم تُضف إلى سلة المورد.';}catch{$('savedState').textContent='تعذر حفظ القائمة على الجهاز؛ انسخها قبل إغلاق الصفحة.';}};
$('copyDraft').onclick=async()=>{try{await navigator.clipboard.writeText(lastText);$('savedState').textContent='تم نسخ القائمة.';}catch{$('savedState').textContent='النسخ غير متاح في المتصفح الحالي.';}};
render();

const lineIdentity=l=>[l.offer.supplierId,l.offer.supplierProductId,l.offer.sellerId,l.qty,l.price].join('::');
const cartLine=l=>({supplierId:l.offer.supplierId,productId:String(l.offer.supplierProductId),sellerId:l.offer.sellerId==null?null:String(l.offer.sellerId),quantity:l.qty,price:l.price,query:items.find(i=>i.key===l.itemKey)?.nameEn||l.name});
const cartMessage=code=>({'cart-journal-unavailable':'سجل التنفيذ غير متاح؛ لم تتم الإضافة','cart-account-busy':'عملية سابقة غير محسومة عند المورد؛ تحقق من نتيجتها أولًا','cart-operation-pending':'هناك إضافة سابقة تحتاج التحقق؛ لا تكرر الطلب','cart-storage-unavailable':'تعذر حفظ حالة العملية على الجهاز؛ لم نبدأ إضافة جديدة','cart-session-required':'جلسة المورد تحتاج تجديدًا يدعم السلة','cart-payment-conflict':'هناك طريقة دفع مختلفة في السلة؛ راجعها داخل أوميت أولًا','cart-payment-unverified':'طريقة الدفع لهذا العرض غير مؤكدة؛ أضفه من أوميت مباشرة','cart-offer-changed':'عرض المورد أو السعر اتغير؛ أعد مقارنة العروض','cart-stock-changed':'الكمية المتاحة اتغيرت؛ راجع الكمية','cart-conflict':'السلة اتغيرت أثناء المراجعة؛ اقرأها من جديد','cart-plan-expired':'انتهت مدة المراجعة؛ اقرأ السلة من جديد','cart-session-changed':'الجلسة اتجددت؛ اقرأ السلة من جديد','cart-readback-unavailable':'لم نتمكن من تأكيد النتيجة؛ راجع سلة أوميت قبل أي محاولة جديدة','cart-upstream-error':'تعذرت الإضافة؛ راجع سلة أوميت قبل المحاولة'})[code]||'تعذر تأكيد سلة المورد؛ راجعها في حسابك';
function cartBusy(value){setBusy(value);['prepareAumet','applyAumet','closeReview'].forEach(id=>$(id).disabled=value);$('reviewDialog').onkeydown=e=>{if(value&&e.key==='Escape')e.preventDefault();};}
$('prepareAumet').onclick=async()=>{
 if(busy)return;cartPlans=[];$('applyAumet').hidden=true;$('cartPlans').textContent='';
 const lines=groupCart(items).flatMap(g=>g.lines).filter(l=>!sentLines.has(lineIdentity(l)));
 if(!lines.length){$('cartStatus').textContent='لا توجد أصناف جديدة للإضافة في هذه القائمة.';return;}
 cartBusy(true);
 try{for(const line of lines){$('cartStatus').textContent=`قراءة سلة ${supplierName(line.offer.supplierId)} ومراجعة ${line.name}…`;const item=items.find(i=>i.key===line.itemKey);const plan=await provider().prepareSupplierCart(line.offer.supplierId,cartLine(line));cartPlans.push({...plan,line});if(lines.length>1)await new Promise(r=>setTimeout(r,3100));}
 $('cartPlans').innerHTML=cartPlans.map(p=>`<p>${esc(p.line.name)}: في السلة ${fmt(p.before)} + المطلوب ${fmt(p.quantity)} = ${fmt(p.target)}</p>`).join('');$('cartStatus').textContent='راجع الكميات ثم أكد الإضافة لسلة كل مورد. تأكيد طلب الشراء خطوة منفصلة.';$('applyAumet').hidden=false;
 }catch(e){cartPlans=[];$('cartStatus').textContent=cartMessage(e.message);}finally{cartBusy(false);}
};
$('applyAumet').onclick=async()=>{
 if(busy||!cartPlans.length)return;cartBusy(true);let verified=0;
 try{for(const p of cartPlans){if(sentLines.has(lineIdentity(p.line)))continue;$('cartStatus').textContent=`جارٍ إضافة ومراجعة ${p.line.name}…`;const r=await provider().applyPreparedSupplierCart(p.line.offer.supplierId,cartLine(p.line),p);if(!r.ok||r.state!=='verified')throw new Error(r.error);sentLines.add(lineIdentity(p.line));const item=items.find(i=>i.key===p.line.itemKey);if(item)for(const a of item.allocations||[])if(a.key===p.line.key)a.cartState='verified';verified++;}
 render();$('reviewGroups').innerHTML=groupCart(items).map(groupHtml).join('');$('cartStatus').textContent=`تم التحقق من إضافة ${fmt(verified)} صنف إلى سلة حسابك عند الموردين. لم يتم تأكيد أي طلب شراء.`;cartPlans=[];$('applyAumet').hidden=true;
 }catch(e){$('cartStatus').textContent=`تم التحقق من ${fmt(verified)} صنف. ${cartMessage(e.message)}`;/* Keep signed plans for read-back retry; never calculate a new additive target. */}
 finally{cartBusy(false);}
};


// Checkout always reads the external account cart, including anything added outside NOVA.
let orderPlan=null,orderSupplier=null,orderInFlight=false,orderPending=false,orderLoad=0;
const orderKey=id=>'novaPendingSupplierOrder:'+id;
const orderError=code=>({
 'order-cart-empty':'سلة حسابك عند المورد فارغة. أضف الأصناف للسلة أولًا.',
 'order-extra-sellers':'سلة أوميت فيها مخازن خارج اختيارك؛ راجعها في أوميت أو عدّل اختيارات المخازن.',
 'order-cart-needs-review':'المورد طلب مراجعة بعض الأصناف؛ راجع سلة حسابك عنده.',
 'order-minimum-not-met':'إجمالي أحد المخازن أقل من الحد الأدنى للطلب.',
 'order-seller-unavailable':'أحد المخازن غير متاح للتنفيذ حاليًا.',
 'order-cart-changed':'السلة أو السعر أو الدفع اتغير بعد المراجعة؛ أغلق النافذة واقرأ السلة من جديد.',
 'cart-plan-expired':'انتهت مدة المراجعة؛ أغلق النافذة واقرأ السلة من جديد.',
 'cart-session-changed':'جلسة المورد اتجددت؛ أغلق النافذة واقرأ السلة من جديد.',
 'cart-account-busy':'هناك عملية سابقة غير محسومة لهذا المورد؛ راجع نتيجتها قبل طلب جديد.',
 'cart-operation-pending':'هذه العملية سبق إرسالها؛ استخدم التحقق من النتيجة، ولا تنشئ طلبًا جديدًا.',
 'cart-journal-unavailable':'سجل التنفيذ غير متاح؛ لم يُرسل الطلب.',
 'order-not-started':'الطلب لم يبدأ؛ يمكنك إغلاق النافذة وقراءة السلة من جديد.'
})[code]||'تعذّر تأكيد النتيجة. راجع طلبات حسابك عند المورد؛ لن نعيد إرسال طلب الشراء تلقائيًا.';
function orderView(cart){return `<h3>${esc(supplierName(cart.supplierId))}</h3><p>السلة: ${esc(cart.cartId)}</p><ul>${cart.lines.map(l=>`<li>${esc(l.name)} — ${fmt(l.quantity)} × ${fmt(l.unitPrice)} = ${fmt(l.total)} ${esc(cart.currency)} ${l.seller?' · '+esc(l.seller):''}</li>`).join('')}</ul><p>الإجمالي النهائي: <strong>${fmt(cart.total)} ${esc(cart.currency)}</strong></p><p>الضريبة: ${fmt(cart.tax)} · الخصم: ${fmt(cart.discount)}</p><p>طريقة الدفع المسجلة: ${esc(cart.payment)}</p><p>التوصيل: ${esc(cart.delivery)}</p>`;}
function orderControls(){
 $('submitSupplierOrder').disabled=orderInFlight||orderPending||!orderPlan||!$('orderConfirmed').checked||(orderSupplier==='pharmaoverseas'&&!$('orderTerms').checked);
 $('closeOrder').disabled=orderInFlight;$('checkSupplierOrder').disabled=orderInFlight;
 $('orderConfirmed').disabled=orderInFlight||orderPending;$('orderTerms').disabled=orderInFlight||orderPending;
}
async function openOrder(supplier){
 if(busy||orderInFlight)return;
 const loading=++orderLoad;orderSupplier=supplier;orderPlan=null;orderPending=false;$('orderConfirmed').checked=false;$('orderTerms').checked=false;$('orderTermsLabel').hidden=supplier!=='pharmaoverseas';$('checkSupplierOrder').hidden=true;$('orderCart').textContent='جارٍ قراءة السلة الفعلية…';$('orderStatus').textContent='';$('orderTitle').textContent='مراجعة طلب '+supplierName(supplier);$('orderDialog').showModal();orderControls();
 try{
  const saved=JSON.parse(localStorage.getItem(orderKey(supplier))||'null');
  if(saved){orderPlan=saved.plan;orderPending=true;$('orderCart').innerHTML=orderView(saved.cart);$('checkSupplierOrder').hidden=false;$('orderStatus').textContent='هناك محاولة تنفيذ سابقة. سنقرأ نتيجتها فقط؛ لن نرسل طلب شراء جديدًا.';}
  else{const result=await provider().previewSupplierOrder(supplier,prefs.aumetSellers);if(loading!==orderLoad)return;if(!result.ok)throw new Error(result.error);orderPlan=result;$('orderCart').innerHTML=orderView(result.cart);}
 }catch(e){if(loading!==orderLoad)return;$('orderCart').textContent='';$('orderStatus').textContent=orderError(e.message);}finally{orderControls();}
}
function orderReceipt(result){
 const ids=(result.orderIds||[]).map(String).join('، ');
 if(result.ok&&result.state==='verified'){
  localStorage.removeItem(orderKey(orderSupplier));orderPlan=null;orderPending=false;$('checkSupplierOrder').hidden=true;
  $('orderStatus').textContent=`تم تنفيذ الطلب والتحقق منه عند ${supplierName(orderSupplier)}. رقم الطلب: ${ids}. الإجمالي ${fmt(result.total)} ${result.currency}.`;
 }else{$('orderStatus').textContent=`${orderError(result.error)}${ids?' أرقام مستلمة تحتاج تحقق: '+ids:''}`;$('checkSupplierOrder').hidden=false;}
}
$('openSupplierCarts').onclick=()=>$('supplierCarts').showModal();$('closeSupplierCarts').onclick=()=>$('supplierCarts').close();
document.querySelectorAll('[data-review-order]').forEach(b=>b.onclick=()=>openOrder(b.dataset.reviewOrder));
$('closeOrder').onclick=()=>{if(!orderInFlight){orderLoad++;orderPlan=null;$('orderDialog').close();}};$('orderDialog').addEventListener('cancel',e=>{if(orderInFlight)e.preventDefault();else{orderLoad++;orderPlan=null;}});
$('orderConfirmed').onchange=orderControls;$('orderTerms').onchange=orderControls;
$('submitSupplierOrder').onclick=async()=>{
 if($('submitSupplierOrder').disabled||!orderPlan||orderPending)return;orderInFlight=true;orderControls();
 try{
  // Stored before transmission: refresh/reopening can only check this original operation.
  localStorage.setItem(orderKey(orderSupplier),JSON.stringify({plan:orderPlan,cart:orderPlan.cart}));orderPending=true;
  $('orderStatus').textContent='جارٍ إرسال الطلب والتحقق من رقم المورد…';
  orderReceipt(await provider().applySupplierOrder({plan:orderPlan.plan,signature:orderPlan.signature,confirmed:true,termsAccepted:$('orderTerms').checked}));
 }catch(e){
  if(['cart-plan-expired','order-cart-changed','cart-session-changed','order-confirmation-required','order-terms-required','order-cart-empty','order-minimum-not-met','order-extra-sellers'].includes(e.message)){localStorage.removeItem(orderKey(orderSupplier));orderPending=false;orderPlan=null;}
  $('orderStatus').textContent=orderError(e.message);$('checkSupplierOrder').hidden=!orderPending;
 }finally{orderInFlight=false;orderControls();}
};
$('checkSupplierOrder').onclick=async()=>{
 if(orderInFlight||!orderPlan)return;orderInFlight=true;orderControls();
 try{const r=await provider().supplierOrderStatus({plan:orderPlan.plan,signature:orderPlan.signature});if(r.state==='not-started'||r.state==='failed'){localStorage.removeItem(orderKey(orderSupplier));orderPending=false;orderPlan=null;$('checkSupplierOrder').hidden=true;$('orderStatus').textContent=orderError('order-not-started');}else orderReceipt(r);}
 catch(e){$('orderStatus').textContent=orderError(e.message);}finally{orderInFlight=false;orderControls();}
};
