
/* UX44: on phones the discount card lives inside the totals block as a collapsible row; desktop keeps the original footer layout. */
(function(){
 var mq=window.matchMedia('(max-width:640px)');
 function sync(){
  var dc=document.getElementById('discountControls'),tb=document.querySelector('.totals-breakdown'),ft=document.querySelector('.invoice-footer'),tg=document.getElementById('btnDiscountToggle');
  if(!dc||!tb||!ft||!tg)return;
  if(mq.matches){ if(dc.parentNode!==tb)tg.after(dc); }
  else{ if(dc.parentNode!==ft)ft.insertBefore(dc,tb); dc.classList.remove('open'); tg.setAttribute('aria-expanded','false'); }
 }
 document.addEventListener('DOMContentLoaded',function(){
  var tg=document.getElementById('btnDiscountToggle');
  if(tg)tg.addEventListener('click',function(){var dc=document.getElementById('discountControls');var o=!dc.classList.contains('open');dc.classList.toggle('open',o);tg.setAttribute('aria-expanded',String(o));});
  sync();
 });
 if(mq.addEventListener)mq.addEventListener('change',sync);
})();
