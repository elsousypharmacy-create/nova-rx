
(()=>{const $=id=>document.getElementById(id),panel=$('novaAiPanel'),status=$('novaAiStatus'),table=$('novaAiTable'),tbody=table.querySelector('tbody');
$('novaAiLaunch').onclick=()=>document.getElementById('novaLabelsPanel').classList.add('open');{const sl=document.getElementById('btnSaleLabels');if(sl)sl.onclick=()=>document.getElementById('novaLabelsPanel').classList.add('open')}$('novaAiClose').onclick=()=>panel.classList.remove('open');
function field(v){const input=document.createElement('input');input.value=v==null?'':String(v);return input}
$('novaAiRun').onclick=async()=>{
const files=Array.from($('novaAiFiles').files||[]);
if(!files.length||files.length>4){status.textContent='اختار من 1 إلى 4 صور';return}
if(files.some(f=>!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>4*1024*1024)){status.textContent='الملفات لازم تكون صور JPG/PNG/WebP وأقل من 4MB لكل صورة';return}
status.textContent='جاري التحليل...';$('novaAiRun').textContent='تحليل الفاتورة';$('novaAiRun').disabled=true;table.hidden=true;$('novaAiExport').hidden=true;
try{
const images=await Promise.all(files.map(f=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({mimeType:f.type,data:String(reader.result).split(',')[1]});reader.onerror=reject;reader.readAsDataURL(f)})));
const response=await fetch('/api/ai/purchase',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({images})});
const result=await response.json();if(!response.ok)throw Error(result.error||'فشل الاتصال');
tbody.replaceChildren();for(const item of result.items||[]){const tr=document.createElement('tr');for(const key of ['name','quantity','unit_price','discount','batch','expiry','notes']){const td=document.createElement('td');td.append(field(item[key]));tr.append(td)}tbody.append(tr)}
table.hidden=false;$('novaAiExport').hidden=false;$('novaAiSupplier').textContent='المورد: '+(result.supplier||'غير واضح');
status.textContent='تم استخراج '+(result.items||[]).length+' صنف. راجع كل البيانات قبل أي اعتماد.';
}catch(e){status.textContent='تعذر التحليل: '+e.message+' — اضغط «إعادة المحاولة».';$('novaAiRun').textContent='إعادة المحاولة'}finally{$('novaAiRun').disabled=false}
};
$('novaAiExport').onclick=()=>{const rows=[['الصنف','الكمية','سعر الوحدة','الخصم','التشغيلة','الصلاحية','ملاحظات'],...Array.from(tbody.rows,r=>Array.from(r.querySelectorAll('input'),i=>i.value))];const csv='\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='nova-purchase-review.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
})();
