/* Default supplier provider for the app: talks to the NOVA Worker (same origin).
   Only defined when no other provider exists (tests inject their own).
   The PIN is asked once and kept in this browser only. No supplier passwords here:
   supplier logins are done by a separate secure job and never reach the app. */
(function () {
  'use strict';
  if (window.NOVA_SUPPLIER_PROVIDER) return;

  var KEY = 'novaApiPin';

  function getPin(forceAsk) {
    var pin = null;
    try { pin = localStorage.getItem(KEY); } catch (e) { pin = null; }
    if (!pin || forceAsk) {
      pin = window.prompt('رقم PIN الموردين');
      if (pin) { try { localStorage.setItem(KEY, pin); } catch (e) { /* ignore */ } }
    }
    return pin;
  }

  function call(path, options, retried) {
    var pin = getPin(false);
    if (!pin) return Promise.reject(new Error('pin-required'));
    var init = Object.assign({ headers: {} }, options || {});
    init.headers = Object.assign({ 'X-Nova-Pin': pin, 'Content-Type': 'application/json' }, init.headers);
    return fetch(path, init).then(function (res) {
      if (res.status === 401 && !retried) {
        try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
        return call(path, options, true);
      }
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || ('http-' + res.status));
        return data;
      });
    });
  }

  function mapState(s) {
    if (s === 'ok') return 'ok';
    if (s === 'expired') return 'error';
    return 'off';
  }

  var cartInflight = new Map();
  function cartKey(line){return JSON.stringify([line.supplierId,line.productId,line.sellerId,line.quantity,line.price]);}
  function pendingCarts(){try{return JSON.parse(localStorage.getItem('novaPendingSupplierCartsV1')||'{}');}catch(e){throw new Error('cart-storage-unavailable');}}
  function savePending(value){try{localStorage.setItem('novaPendingSupplierCartsV1',JSON.stringify(value));}catch(e){throw new Error('cart-storage-unavailable');}}
  // Saved Aumet warehouse selection (per browser). Empty means none selected, never "all".
  function selectedAumetSellers(){
    try{var saved=JSON.parse(localStorage.getItem('novaPurchasePrefsV1')||'null');return saved&&Array.isArray(saved.aumetSellers)?saved.aumetSellers.map(String):[];}catch(e){return [];}
  }
  function withSelection(supplier,line){return supplier==='aumet'?Object.assign({},line,{aumetSellerIds:selectedAumetSellers()}):line;}
  function prepareCart(supplier,line){
    line=Object.assign({},line,{supplierId:supplier});var saved=pendingCarts()[cartKey(line)];
    return saved?Promise.resolve(saved):call('/api/purchases/'+supplier+'-cart/preview',{method:'POST',body:JSON.stringify(withSelection(supplier,line))});
  }
  async function applyPreparedCart(supplier,line,plan){
    line=Object.assign({},line,{supplierId:supplier});var key=cartKey(line),saved=pendingCarts();
    if(saved[key]&&saved[key].signature!==plan.signature)throw new Error('cart-operation-pending');
    saved[key]=plan;savePending(saved); // Persist BEFORE the first possible mutation.
    var result;
    try{result=await call('/api/purchases/'+supplier+'-cart/apply',{method:'POST',body:JSON.stringify({plan:plan.plan,signature:plan.signature})});}
    catch(e){if(e.message==='cart-operation-pending'){result=await call('/api/purchases/'+supplier+'-cart/status',{method:'POST',body:JSON.stringify({plan:plan.plan,signature:plan.signature})});}else{if(['cart-plan-expired','cart-offer-changed','cart-stock-changed','cart-conflict','cart-session-changed','cart-payment-unverified','cart-payment-conflict'].indexOf(e.message)!==-1){var latest=pendingCarts();if(latest[key]&&latest[key].signature===plan.signature){delete latest[key];savePending(latest);}}throw e;}}
    if(result.ok&&result.state==='verified'){var latest=pendingCarts();delete latest[key];savePending(latest);}
    return result;
  }
  function supplierCartAdd(line, confirmAddition) {
    var key=cartKey(line);if(cartInflight.has(key))return cartInflight.get(key);
    var task=(async function(){
      var plan=await prepareCart(line.supplierId,line);if(!plan.ok)throw new Error(plan.error||'cart-preview-failed');
      if(!confirmAddition(plan))return {ok:false,state:'cancelled'};
      return applyPreparedCart(line.supplierId,line,plan);
    })();cartInflight.set(key,task);task.then(function(){cartInflight.delete(key);},function(){cartInflight.delete(key);});return task;
  }

  window.NOVA_SUPPLIER_PROVIDER = {
    // Only the provider writes purchase preferences; the DOM layer must not touch storage directly.
    savePurchasePrefs: function(value){
      if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('prefs-invalid');
      var clean={};
      Object.keys(value).forEach(function(k){
        var v=value[k],t=typeof v;
        if(t==='string'||t==='boolean'||(t==='number'&&isFinite(v)))clean[k]=v;
        else if(Array.isArray(v)&&v.every(function(x){return typeof x==='string'||typeof x==='number';}))clean[k]=v.slice();
      });
      localStorage.setItem('novaPurchasePrefsV1',JSON.stringify(clean));
    },
    previewSupplierOrder: function(supplierId,aumetSellerIds){return call('/api/purchases/orders/preview',{method:'POST',body:JSON.stringify({supplierId:supplierId,aumetSellerIds:aumetSellerIds||[]})});},
    supplierOrderStatus: function(plan){return call('/api/purchases/orders/status',{method:'POST',body:JSON.stringify(plan)});},
    applySupplierOrder: function(plan){return call('/api/purchases/orders/apply',{method:'POST',body:JSON.stringify(plan)});},
    addToSupplierCart: supplierCartAdd,
    prepareSupplierCart: prepareCart,
    applyPreparedSupplierCart: applyPreparedCart,
    previewSupplierCart: function (supplier,line) { return call('/api/purchases/'+supplier+'-cart/preview', {method:'POST',body:JSON.stringify(withSelection(supplier,line))}); },
    applySupplierCart: function (supplier,plan) { return call('/api/purchases/'+supplier+'-cart/apply', {method:'POST',body:JSON.stringify(plan)}); },
    previewAumetCart: function (line) { return call('/api/purchases/aumet-cart/preview', {method:'POST',body:JSON.stringify(withSelection('aumet',line))}); },
    applyAumetCart: function (plan) { return call('/api/purchases/aumet-cart/apply', {method:'POST',body:JSON.stringify(plan)}); },
    listSellers: function () { return call('/api/suppliers/sellers', { method: 'GET' }); },
    purchasingStock: function (dashboardPin) { return call('/api/purchases/stock', { method: 'POST', body: JSON.stringify({ dashboardPin: dashboardPin || '' }) }); },
    search: function (query, opts) {
      var prefs={suppliers:['aumet','pharmaoverseas'],aumetSellers:[]};
      try{var saved=JSON.parse(localStorage.getItem('novaPurchasePrefsV1')||'null');if(saved)prefs=Object.assign(prefs,saved);}catch(e){}
      var sellers=Array.isArray(prefs.aumetSellers)?prefs.aumetSellers.map(String):[];
      var suppliers=opts&&Array.isArray(opts.supplierIds)?opts.supplierIds:(Array.isArray(prefs.suppliers)?prefs.suppliers:[]);
      suppliers=suppliers.filter(function(id){return id!=='aumet'||sellers.length>0;});
      return call('/api/suppliers/search', {
        method: 'POST',
        body: JSON.stringify({ query: query, requestedQty: (opts && opts.requestedQty) || 1, supplierIds: suppliers, aumetSellerIds: sellers }),
      });
    },
    listSuppliers: function () {
      return call('/api/suppliers/status', { method: 'GET' }).then(function (r) {
        return (r.suppliers || []).map(function (s) {
          return {
            id: s.id,
            name: s.name,
            state: mapState(s.state),
            available: true,
            message: s.state === 'expired' ? 'الجلسة انتهت' : '',
          };
        });
      });
    },
    testSupplier: function (id) {
      return call('/api/suppliers/status', { method: 'GET' }).then(function (r) {
        var s = (r.suppliers || []).filter(function (x) { return x.id === id; })[0];
        return { ok: !!s && s.state === 'ok', message: s && s.state === 'ok' ? 'الاتصال سليم' : 'الجلسة منتهية أو غير مربوطة' };
      });
    },
    connectSupplier: function () {
      return Promise.resolve({ ok: false, message: 'إضافة مورد جديد بتتم بالتواصل معانا (محتاج ربط مخصوص)' });
    },
  };
})();

