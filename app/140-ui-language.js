
/* UI language controller: text labels only; medicine/customer records are never translated */
(function(){
 const langKey='nova-rx-language';
 const arToEn={
 'صيدلية السوسي':'Elsousy Pharmacy','د. أحمد السوسي':'Dr. Ahmed Elsousy','نظام نقاط البيع':'Point of Sale',
 'البيع':'Sales','الفواتير':'Invoices','المنتجات':'Products','العملاء':'Customers','التقارير':'Reports','الإعدادات':'Settings','نسخة تجريبية':'Demo',
 'المنتجات والمخزون':'Products & Inventory','الاسم':'Name','الهاتف':'Phone','المستوى':'Tier','الزيارات':'Visits','النقاط':'Points','المديونية':'Balance Due','سداد':'Pay','المبلغ':'Amount','طريقة الدفع':'Payment method','نقدي':'Cash','بطاقة':'Card','تأكيد السداد':'Confirm payment',
 'الصنف':'Product','الباركود':'Barcode','السعر':'Price','الرصيد':'Stock','العبوة':'Packaging','التصنيف':'Category',
 'رقم الفاتورة':'Invoice No.','التاريخ':'Date','العميل':'Customer','القيمة':'Amount','الأصناف':'Items',
 'عدد الأصناف':'Products','إجمالي الوحدات':'Total Units','مخزون منخفض (أقل من 30)':'Low Stock (under 30)',
 'قيمة المخزون بسعر البيع':'Retail Stock Value','إجمالي الزيارات':'Total Visits','نقاط الولاء':'Loyalty Points','العملاء النشطون':'Active Customers',
 'عدد الفواتير':'Invoice Count','إجمالي القيمة':'Total Value','متوسط الفاتورة':'Average Invoice','الأصناف المباعة':'Units Sold',
 'مبيعات تجريبية':'Demo Sales','فواتير تجريبية':'Demo Invoices',
 'توزيع قيمة الفواتير التجريبية حسب العميل':'Demo Invoice Value by Customer',
 'البيانات التجريبية':'Demo Records','المظهر':'Appearance','بيانات النظام':'System Data','النسخة':'Version','المزامنة والصلاحيات':'Sync & Permissions',
 'المظهر: Black Edition، خط Cairo، مناسب للتابلت':'Black Edition · Cairo font · Landscape tablet layout.',
 'المنتجات والعملاء والفواتير الحالية بيانات تجريبية محلية داخل التطبيق.':'Current products, customers, and invoices are local demo data.',
 'NOVA Rx PWA · نسخة أولية للتجربة. لا تعتمد عليها في معاملات العملاء الحقيقية.':'NOVA Rx PWA · Prototype only. Do not use for real customer transactions.',
 'لم يتم ربط قاعدة بيانات أو نظام مستخدمين أو صلاحيات موظفين بعد.':'No database, user accounts, or staff permissions are connected yet.',
 'قائمة الأصناف المتاحة في بيانات العرض — بدون تعديل المخزون الحقيقي':'Demo product catalog — does not change actual inventory',
 'دليل العملاء التجريبي — إدارة بيانات العملاء الفعلية ستتطلب قاعدة بيانات':'Demo customer directory — real records require a database',
 'فواتير سابقة من بيانات العرض — ليست سجل مبيعات محفوظًا':'Sample invoices — not a persisted sales ledger',
 'مؤشرات توضيحية محسوبة من فواتير العملاء التجريبية فقط':'Illustrative metrics from demo customer invoices only',
 'فواتير هذا الجهاز أولًا، ثم فواتير سابقة من بيانات العرض (تجريبية)':'This device\'s invoices first, then sample invoices (demo data)',
 'فواتير هذا الجهاز (تتزامن مع الأجهزة الأخرى عند تفعيل المزامنة)':'Invoices on this device (synced to other devices when sync is on)',
 'لا توجد فواتير محفوظة بعد — أتمّ عملية بيع وستظهر هنا':'No saved invoices yet — complete a sale and it will appear here',
 'مبيعات هذا الجهاز':'This device\'s sales', 'مبيعات هذا الجهاز أولًا، وبعدها مؤشرات توضيحية من بيانات العرض':'This device\'s sales first, then illustrative metrics from demo data',
 'لا توجد مبيعات محفوظة بعد — التقارير الحقيقية تظهر بعد أول عملية بيع':'No saved sales yet — real reports appear after the first sale',
 'الأكثر مبيعًا (من فواتير هذا الجهاز)':'Top sellers (from this device\'s invoices)',
 'بيانات العرض التجريبية':'Demo data',
 'تعذر حفظ الفاتورة على هذا الجهاز — صوّر الإيصال قبل المتابعة.':'Could not save the invoice on this device — photograph the receipt before continuing.',
 'فواتير محفوظة':'Saved Invoices','إجمالي المبيعات':'Total Sales','مبيعات اليوم':'Today\'s Sales','فواتير اليوم':'Today\'s Invoices','كل المبيعات المحفوظة':'All Saved Sales',
 'المشتريات':'Purchases','المرتجع':'Returned','إجراء':'Action','مرتجع / إلغاء':'Return / Void','إغلاق':'Close','تأكيد المرتجع':'Confirm return','مرتجعات اليوم':'Today\'s Returns','صافي اليوم':'Net Today','إجمالي المرتجعات':'Total Returns','صافي المبيعات':'Net Sales',
 'اختر الكمية المرتجعة لكل صنف. المبلغ يرجع بنفس طريقة الدفع الأصلية':'Choose the returned quantity for each item. The refund goes back through the original payment method','سبب المرتجع (مطلوب)':'Return reason (required)','مبلغ الإرجاع:':'Refund amount:','اكتب سبب المرتجع':'Enter a return reason','اختر كمية واحدة على الأقل':'Pick at least one unit','الكمية أكبر من المتاح للإرجاع':'Quantity exceeds what can be returned','تعذر حفظ المرتجع على هذا الجهاز':'Could not save the return on this device','الدفع':'Payment','نقدي':'Cash','بطاقة':'Card','عميل نقدي':'Walk-in Customer',
 'الحسابات والمزامنة والأجهزة واللغة':'Accounts, sync, devices and language','استيكرات الأدوية':'Medicine stickers','تصميم وطباعة استيكرات الأدوية':'Design and print medicine stickers','طباعة استيكرات الأدوية':'Print medicine stickers',
 'Customer Search Mode':'وضع البحث عن عميل','Product / Barcode Scan Mode':'وضع البحث عن منتج أو باركود',
 'New Sale':'فاتورة جديدة','Clear Invoice':'مسح الفاتورة','Keyboard Shortcuts':'اختصارات الكيبورد','Held Invoices':'الفواتير المعلقة','Held':'معلقة','Hold Current Invoice':'تعليق الفاتورة الحالية','Add Loyalty':'إضافة عميل','Clear':'مسح الفاتورة','Help':'مساعدة','Refresh':'تحديث',
 'Customer':'عميل','Product':'منتج','Product & Description':'المنتج والوصف','Barcode':'الباركود','Price':'السعر','Quantity':'الكمية','Discount':'الخصم','Total':'الإجمالي',
 'Invoice is Empty':'الفاتورة فارغة','Scan product barcode or type medicine name in the search bar above.':'امسح الباركود أو ابحث باسم الدواء في الأعلى.',
 'Overall Invoice Discount':'خصم الفاتورة','No negative total floor':'الإجمالي لا يقل عن صفر','Subtotal':'المجموع الفرعي','Discount Applied':'الخصم المطبق',
 'VAT (14% Included)':'ضريبة القيمة المضافة (14% متضمنة)','Complete Sale':'إتمام البيع',
 'Add / Switch Customer':'إضافة أو تغيير العميل','Search History':'بحث في السجل',
 'Payment Method':'طريقة الدفع','Cash':'نقدي','Card':'بطاقة','Split':'مختلط',
 'Amount Due':'المبلغ المستحق','Cash Received':'المبلغ المستلم','Change Due':'الباقي',
 'Cancel':'إلغاء','Confirm Payment':'تأكيد الدفع','Print Receipt':'طباعة الإيصال',
 'New Sale / Reset':'فاتورة جديدة','No customer selected':'لم يتم اختيار عميل',
 'Customer Profile':'ملف العميل','Loyalty Number':'ملف العميل','Purchase History':'سجل المشتريات',
 'No items found':'لا توجد أصناف','items':'أصناف'
 };
 const enToAr={};for(const [ar,en] of Object.entries(arToEn)){if(/[\u0600-\u06FF]/.test(ar)&&!/[\u0600-\u06FF]/.test(en))enToAr[en]=ar;else if(!/[\u0600-\u06FF]/.test(ar)&&/[\u0600-\u06FF]/.test(en))enToAr[ar]=en;}
 const arOverrides={'Sales':'البيع','Invoices':'الفواتير','Products':'المنتجات','Customers':'العملاء','Reports':'التقارير','Settings':'الإعدادات','Demo':'نسخة تجريبية','Point of Sale':'نظام نقاط البيع','Elsousy Pharmacy':'صيدلية السوسي','Dr. Ahmed Elsousy':'د. أحمد السوسي','Name':'الاسم','Phone':'الهاتف','Visits':'الزيارات','Points':'النقاط','Amount':'القيمة','Date':'التاريخ','Stock':'الرصيد','Category':'التصنيف','Total Amount Payable':'إجمالي المستحق','Exact':'بالضبط','Cancel (Esc)':'إلغاء (Esc)','Walk-in Customer (No loyalty attached)':'عميل عابر','No loyalty attached':'بدون رقم عميل'};
 Object.assign(enToAr,arOverrides);
 /* Directional dictionaries. arToEn mixes both directions, so English mode used to turn English words into Arabic (mixed text). */
 const toEn={};
 for(const [k,v] of Object.entries(arToEn)){
  const kAr=/[\u0600-\u06FF]/.test(k),vAr=/[\u0600-\u06FF]/.test(v);
  if(kAr&&!vAr){if(!(k in toEn))toEn[k]=v}
  else if(!kAr&&vAr){if(!(v in toEn))toEn[v]=k}
 }
 const enExtra={
"تعذر قراءة بيانات الاستلام. راجع مساحة التخزين ثم أعد المحاولة.":"Receipt data could not be read. Check storage space and retry.",
"مراجعة الاستلام":"Review receipt",
"مراجعة فروق الاستلام":"Review receipt differences",
"سبق استلامه":"Previously received",
"الواصل الآن":"Arriving now",
"الباقي":"Remaining",
"الزيادة":"Excess",
"خارج الطلبية":"Outside this order",
"سعر الطلبية":"Order price",
"تفاصيل الطلبية":"Order details",
"الطلبية الأصلية":"Original order",
"حركة المخزون وسجل التعديل":"Stock movements and audit history",
"تصحيح الكميات":"Correct quantities",
"الصلاحية":"Expiry",
"الكمية الحالية":"Current quantity",
"الكمية الصحيحة":"Correct quantity",
"الفرق":"Difference",
"سبب التصحيح":"Correction reason",
"مراجعة وتأكيد التصحيح":"Review and confirm correction",
"الاستلام الأصلي":"Original receipt",
"الكمية المضافة":"Quantity added",
"التصحيحات":"Corrections",
"لا توجد تصحيحات.":"No corrections.",
"فواتير الاستلام":"Receipt invoices",
"المنتظر":"Pending",
"ملغي من الباقي":"Cancelled remainder",
"لم يتم الاستلام بعد.":"Nothing received yet.",
"الكمية الناقصة ما زالت منتظرة.":"The remaining quantity is still pending.",
"إلغاء الكمية الباقية":"Cancel remaining quantity",
"سبب إلغاء الباقي":"Reason for cancelling the remainder",
"تأكيد إلغاء الباقي":"Confirm cancellation of remainder",
"تم إنهاء الطلبية وإلغاء الباقي":"Order closed and remainder cancelled",
"تم تسجيل تصحيح الاستلام":"Receipt correction saved",
"راجع الكميات الصحيحة. سيتم تسجيل حركة فرق مرتبطة بالفاتورة.":"Review the correct quantities. A linked adjustment will be recorded.",
"اكتب سبب التعديل.":"Enter the reason for the change.",
"اكتب كميات صحيحة أكبر من أو تساوي صفر.":"Enter whole quantities of zero or greater.",
"لم تتغير أي كمية.":"No quantities changed.",
"سجل دخول مستخدم لديه صلاحية الإجراء من الإعدادات.":"Sign in through Settings with permission for this action.",
"الصنف محجوز في فاتورة بيع. أكملها أو ألغها أولًا.":"The item is reserved in a sale. Complete or cancel that sale first.",
"الكمية المتبقية لا تسمح بالتصحيح بعد حركات البيع أو التحويل.":"Remaining stock cannot cover this correction after sales or transfers.",
"الفاتورة اتعدلت من شاشة أخرى. افتح التصحيح من جديد.":"The invoice changed in another window. Reopen the correction.",
"الطلبية اتغيرت. افتح تفاصيلها من جديد.":"The order changed. Reopen its details.",
"أكمل حفظ الاستلام قبل التصحيح.":"Finish saving the receipt before correcting it.",
"حالة الطلبية اتغيرت. افتحها من جديد.":"The order status changed. Reopen it.",
"أكمل الاستلام المتوقف قبل إلغاء الكمية الباقية.":"Resume the interrupted receipt before cancelling the remainder.",
"تعذر إكمال الحفظ. أعد المحاولة لاستكمال نفس العملية.":"Saving could not finish. Retry to resume this operation.",
"خصم بالجنيه":"Discount (EGP)","مسح الفاتورة":"Clear invoice","تأكيد البيع (Enter)":"Confirm sale (Enter)","جاري حفظ الفاتورة…":"Saving invoice…","بطاقة بنكية (F10)":"Bank card (F10)","البطاقة محاكاة فقط — لا يُخصم مبلغ بنكي. تأكيد البيع يحفظ الفاتورة، وبعده تختار الطباعة.":"Card payment is simulated; no bank debit. Confirm saves the sale, then choose whether to print.","الاسم (مطلوب)":"Name (required)","رقم الهاتف (مطلوب)":"Phone (required)","من 9 إلى 15 رقمًا؛ الأرقام العربية مقبولة، ولا يمكن تكرار رقم مسجّل.":"9–15 digits; Arabic digits are accepted. An existing phone number cannot be reused.",

 'حالات تانية ▾':'More conditions ▾','أقل ▴':'Less ▴','حساسية':'Allergies','أمراض مزمنة':'Chronic conditions','حالات خاصة':'Special cases','أسبرين ومسكنات':'Aspirin & painkillers','سلفا':'Sulfa','مضاد حيوي تاني':'Other antibiotic','ربو':'Asthma','غدة درقية':'Thyroid','صرع':'Epilepsy','جلوكوما':'Glaucoma','سيولة دم':'Blood thinner','مناعة ضعيفة':'Weak immunity','علاج كيماوي':'Chemotherapy','كبير سن':'Elderly','قبل عملية':'Before surgery','بيسوق':'Drives','مش بيبلع أقراص':'Cannot swallow pills','أدوية مزمنة':'Chronic medicines',
 'مثال: 4':'e.g. 4','مش عارف الوزن':'Weight unknown','بانتظار بيانات العميل':'Waiting for customer data','تحذير — المس':'Warning — tap','اطلعت':'Reviewed',
 'مين العميل؟':'Who is the customer?','بالغ':'Adult','طفل':'Child','حامل':'Pregnant','مرضعة':'Breastfeeding',
  'حالة المريض':'Patient condition','اختياري — للذكاء الاصطناعي':'Optional — for the AI','إجمالي المستحق':'Total Amount Payable','بالضبط':'Exact','إلغاء (Esc)':'Cancel (Esc)','بدون رقم عميل':'No loyalty attached','اختياري. الذكاء الاصطناعي هيراعيها في الجرعات والتحذيرات، وهيحدّث التعليمات لوحده بعد ما تخلص كتابة.':'Optional. The AI takes it into account for doses and warnings, and refreshes the instructions by itself after you stop typing.','معلومة':'Info',
  'مثال: التهاب حلق، حساسية بنسلين، ضغط مرتفع…':'Example: sore throat, penicillin allergy, high blood pressure…',
  'حساسية بنسلين':'Penicillin allergy','ضغط':'Blood pressure','سكر':'Diabetes','قلب':'Heart','كلى':'Kidney','كبد':'Liver','معدة':'Stomach',
  'الجرعات اقتراحات من الذكاء الاصطناعي — راجعها قبل الطباعة':'Doses are AI suggestions — review them before printing',
  'الذكاء الاصطناعي هيراعيها في الجرعات والتحذيرات، وهيحدّث التعليمات لوحده بعد ما تخلص كتابة.':'The AI takes it into account for doses and warnings, and refreshes the instructions by itself when you stop typing.',
  'الجرعة':'Dose','التكرار':'Frequency','المدة':'Duration','التعليمات':'Instructions','الحالة':'Status',
  'جاهز':'Ready','ناقص':'Missing','ناقصة':'Missing','تحذير':'Warning','فشل':'Failed','جاري التوليد':'Generating',
  '↻ توليد تاني':'↻ Generate again','👁 معاينة الاستيكرات':'👁 Preview stickers','إخفاء معاينة الاستيكرات':'Hide sticker preview','👁 معاينة الاستيكر':'👁 Preview sticker',
  'لا توجد نتائج مطابقة':'No matching results',
  'F1 اختصارات':'F1 Shortcuts','امسح الباركود أو اكتب الاسم':'Scan the barcode or type the name','Enter لإضافة':'Enter to add','Enter للدفع':'Enter to pay','إخفاء':'Hide','إخفاء النصائح':'Hide tips','اضغط لنسخ رقم الفاتورة':'Tap to copy invoice number','رقم عملية البيع، اضغط للنسخ':'Sale number, tap to copy','إخفاء نصائح البدء':'Hide getting-started tips','عرض اختصارات الكيبورد (F1)':'Show keyboard shortcuts (F1)',
  'الباقي:':'Change:','عميل عابر':'Walk-in customer','فاتورة عميل عابر. تقدر تربط عميل في أي وقت.':'Walk-in invoice. You can attach a customer at any time.',
  'ربط عميل (F3)':'Attach customer (F3)','تسجيل عميل (F3)':'Register customer (F3)','اختيار عميل (F3)':'Choose customer (F3)','اختيار عميل':'Choose customer','الوردية':'Shift','الأدوات':'Tools','تقرير اليوم':"Today's report",'رصيد قليل':'Low stock','أقرب صلاحية':'Nearest expiry','مصروف من الدرج':'Drawer expense','اصرف من الدرج':'Pay from the drawer','عدّ الدرج':'Count the drawer','قفل الوردية':'Close the shift','السبب / رقم الإيصال':'Reason / receipt ref','فلوس':'Money','مخزون':'Stock','موردين':'Suppliers','عملاء':'Customers','قانوني ورقابة':'Legal & control','موظفين':'Staff','استلام فاتورة مورد':'Receive a supplier invoice','النواقص وطلبيات الموردين':'Shortages & supplier orders','مشتريات سابقة':'Past purchases','آخر شراء:':'Last purchase:','أدوية مزمنة:':'Chronic medicines:','إعادة صرف آخر فاتورة':'Refill last invoice','رقم العميل قبل الدفع':'Customer number before payment',
  'سجّل رقم العميل، أو اضغط Enter بدون رقم للتخطي.':'Enter the customer number, or press Enter with no number to skip.',
  'متابعة بالرقم':'Continue with number','تخطي · عميل نقدي':'Skip · cash customer','رجوع للفاتورة':'Back to invoice',
  'إضافة رقم العميل (اختياري)':'Add customer number (optional)','تعليق':'Hold','المجموع الفرعي (':'Subtotal (',
  'استيكرات الأدوية':'Medicine labels','طباعة استيكرات الأدوية':'Print medicine labels','✦ استيكرات الأدوية':'✦ Medicine labels',
  '✦ قراءة فاتورة مشتريات':'✦ Read purchase invoice','استلام بضاعة':'Receive goods','الأصناف':'Items','عرض تجريبي':'Demo view','الصنف':'Item','الكمية (علب)':'Quantity (boxes)','رقم التشغيلة':'Lot number','تاريخ الانتهاء':'Expiry date','سعر التكلفة (اختياري)':'Cost price (optional)','تأكيد الاستلام':'Confirm receipt','لغة الواجهة':'Interface language','اختر لغة العرض':'Choose display language','عربي':'Arabic',
  'التنقل الرئيسي':'Main navigation','متصل':'Online','حالة الاتصال':'Connection status','إعادة تحميل الصفحة':'Reload page',
  'رقم عملية البيع':'Sale number','فاتورة جديدة (F2)':'New sale (F2)','إضافة أو تغيير العميل (F3)':'Add or change customer (F3)',
  'إضافة أو تغيير العميل':'Add or change customer','عرض اختصارات الكيبورد':'View keyboard shortcuts','المزيد من الإجراءات':'More actions','الفواتير المعلقة':'Held Invoices','مقاس الورق':'Paper width','مسح الأصناف (F4)':'Clear Line Items (F4)','إزالة العميل':'Remove customer','بحث':'Search','بحث في الصفحة':'Search this page',
  'رقم موبايل العميل':'Customer mobile number','اسم العميل (اختياري)':'Customer name (optional)','اسم العميل الجديد':'New customer name',
  'مراجعة فاتورة مشتريات بالذكاء الاصطناعي':'AI purchase invoice review','مراحل العمل':'Steps','المريض والأدوية':'Patient and medicines',
  'اختياري':'Optional','وحدة العمر':'Age unit','كجم':'kg','أدوية الاستيكرات':'Label medicines','يحتاج مراجعة':'Needs review',
  'لا تخمن الجرعة':'Do not guess the dose','اكتب فقط التعليمات المؤكدة':'Write confirmed instructions only','معاينة الاستيكر':'Label preview',
  'صنف غير دوائي':'Non-medical item','مستبعد من الطباعة':'Excluded from printing','أُرسل للطباعة':'Sent to printer',
  'اطلعت على التحذير':'Warning reviewed','تضمين في الطباعة':'Include in print','استبعاد من الطباعة':'Exclude from print',
  'دواء بدون اسم':'Unnamed medicine','مراجعة وطباعة':'Review and print','عدد النسخ':'Copies',
  'ابحث في المنتجات السابقة...':'Search past purchases...','البحث في المنتجات السابقة':'Search past purchases',
  'رجوع للبيع':'Back to Sale','الفواتير والمرتجعات':'Invoices & Returns','العملاء والمديونيات':'Customers & Credit','التنقل السريع':'Quick navigation',
  '🔐 مفاتيح API والتكاملات':'🔐 API keys & integrations','قراءة فاتورة مشتريات':'Read purchase invoice','مفاتيح API والتكاملات':'API keys & integrations','إدارة المفاتيح':'Manage keys','توليد تاني':'Generate again','معاينة الاستيكرات':'Preview stickers','معاينة الاستيكر':'Preview sticker','⚙️ إدارة المفاتيح':'⚙️ Manage keys',
  'إدارة مفاتيح Gemini وواتساب وربط الصيدلية من مكان واحد. لا تُحفظ المفاتيح في المتصفح.':'Manage Gemini, WhatsApp and pharmacy keys in one place. Keys are not stored in the browser.',
  'التشغيلات والصلاحية':'Lots & Expiry','حظر بيع الصنف المنتهي تلقائيًا وتنبيه قرب انتهاء الصلاحية حسب المدة المحددة.':'Block selling expired stock by default and warn before expiry within the configured window.','تنبيه قرب الانتهاء (بالأيام)':'Near-expiry warning (days)',
  '+ إضافة صنف':'+ Add product','تعديل الصنف':'Edit product','تعديل بيانات الصنف':'Edit product details','حفظ التعديلات':'Save changes','اسم الصنف':'Product name','السعر (ج.م)':'Price (EGP)','التصنيف / الرف':'Category / Shelf',
  'بيانات الصيدلية':'Pharmacy profile','اسم الصيدلية':'Pharmacy name','اسم الصيدلي / المالك':'Pharmacist / Owner','اسم الفرع':'Branch name','رقم الهاتف':'Phone number','العنوان (اختياري)':'Address (optional)','رسالة أسفل الإيصال (اختياري)':'Receipt footer note (optional)','حفظ بيانات الصيدلية':'Save pharmacy profile','استعادة الافتراضي':'Restore defaults',
  'استيراد جدول أصناف':'Import CSV/Excel','استيراد أصناف من ملف':'Import products from file','تحميل قالب جاهز':'Download CSV template','تأكيد الاستيراد':'Confirm import','معالج البدء السريع (3 خطوات)':'Quick setup wizard (3 steps)','ابحث في الإعدادات…':'Search settings…','ابحث في الإعدادات':'Search settings','عرض كل الأقسام':'All sections','انتقال سريع':'Quick jump','معالج البدء السريع':'Quick setup wizard','تصنيفات الأدوات':'Tool categories','اختياري — يتفعل تلقائيًا عند ربط الموردين.':'Optional — activates when suppliers are connected.'
 };
 for(const [k,v] of Object.entries(enExtra))if(!(k in toEn))toEn[k]=v;
 /* UX-P29..P38 labels (operations menu, stock page, settings sections, receiving page) */
 const enUx={'تم رفض العبوة: منتهية الصلاحية':'Pack refused: expired','المحادثات':'Chats','رصيد قائمة الأصناف':'Product-list stock','الرصيد من قائمة الأصناف ناقص المبيعات (الصنف ده مالوش تشغيلات مسجلة).':'Stock = product list minus sales (no lots recorded for this item).','0 أصناف':'0 items','محفظة / إنستاباي / فوري':'Wallet / InstaPay / Fawry','طريقة الدفع الإلكتروني':'E-payment method','محفظة موبايل':'Mobile wallet','إنستاباي':'InstaPay','فوري':'Fawry','رقم العملية (من رسالة التحويل)':'Transaction number (from the transfer message)','مثال: 123456789':'e.g. 123456789','حذف صنف من الفاتورة':'Delete item','خصم كبير':'Large discount','تقريب:':'Rounding:','لوحة المالك':'Owner dashboard','مبيعات النهارده':'Today sales','كاش الدرج المتوقع':'Expected drawer cash','الآجل برا':'Credit outstanding','أصناف قربت تخلص صلاحيتها':'Items near expiry','آخر نسخة احتياطية':'Last backup','افتح النسخ الاحتياطي':'Open backup','التنبيهات':'Alerts','نواقص':'Shortages','لا يوجد':'None','مفيش نسخة':'No backup','مفيش نسخة احتياطية متسجلة':'No backup recorded','محتاج تاخد نسخة دلوقتي':'Back up now','مستحقات الموردين':'Supplier dues','فواتير: ':'Invoices: ',' | مقارنة بالأسبوع اللي فات: ':' | vs same day last week: ','مبيعات كاش: ':'Cash sales: ',' | مصروف: ':' | Paid out: ',' تشغيلة قربت':' lots',' صنف ناقص':' items','القيمة بالتكلفة: ':'Value at cost: ','رصيد صفر: ':'Out of stock: ','متأخر: ':'Overdue: ','سجل العمليات الحساسة':'Sensitive operations log','مين عمل إيه وإمتى — متابعة ضد التلاعب':'Who did what and when — anti-tampering','إجمالي الفترة:':'Period total:','أكتر حد عمل إلغاءات/مرتجعات:':'Most cancellations/returns by:','اكتب جزء من الاسم...':'Type part of a name...','الشخص (منفّذ أو معتمد)':'Person (executor or approver)','التفاصيل':'Details','النوع':'Type','الوقت':'Time','مين':'Who','الكل':'All','إلغاء فاتورة':'Invoice cancel','تسوية مخزون':'Stock adjustment','تعديل استلام':'Receipt correction','تغيير حد ائتمان':'Credit limit change','خصم على صنف':'Line discount','صرف / دفعة مورد':'Cash-out / supplier payment','طباعة السجل':'Print log','فرق تقفيل شيفت':'Shift close difference','مرتجع مبيعات':'Sales return','مرتجع مورد':'Supplier return','مصروف':'Expense','مفيش عمليات حساسة مطابقة للفلاتر دي.':'No sensitive operations match these filters.','المزيد':'More','التنقل الرئيسي (موبايل)':'Main navigation (mobile)','النسخ الاحتياطي الكامل':'Full backup','اعمل نسخة دلوقتي':'Back up now','استرجاع من نسخة':'Restore from a backup','آخر نسخة: لسه ما اتعملتش نسخة':'Last backup: none yet','احفظ الملف على فلاشة أو ارفعه على جوجل درايف':'Save the file to a USB stick or upload it to Google Drive','دفتر الأدوية المراقبة':'Controlled drugs register','إظهار الرقم القومي (مدير)':'Show national IDs (manager)','طباعة الدفتر':'Print register','من تاريخ':'From','إلى تاريخ':'To','التاريخ والوقت':'Date & time','المريض':'Patient','الرقم القومي':'National ID','الطبيب':'Doctor','الروشتة':'Prescription','إجراءات':'Actions','لا توجد قيود في الفترة المحددة.':'No entries in this period.','النواقص':'Shortages','العمليات':'Operations','استلام الطلبيات':'Receiving','المخزون':'Stock','طلب النواقص من الموردين':'Order shortages from suppliers','استلام فاتورة ودخولها المخزون':'Receive an invoice into stock','الأرصدة والصلاحيات والجرد':'Balances, expiry and counts',
  'ابحث بالاسم أو الباركود…':'Search by name or barcode…','بحث في المخزون':'Search stock','أدوات المخزون':'Stock tools','قراءة فاتورة مشتريات':'Read purchase invoice','صفحة استلام الطلبيات':'Receiving page','استلام بضاعة':'Receive goods',
  'تجهيز الصيدلية':'Pharmacy setup','عام':'General','الحسابات والصلاحيات':'Accounts and permissions','الطابعات والأجهزة':'Printers and devices','التشغيلات والصلاحية':'Lots and expiry','الموردين':'Suppliers','الربط والمفاتيح':'Connection and keys','عن النظام':'About','أقسام الإعدادات':'Settings sections',
  'استلم فاتورة المورد وأضفها للمخزون بالتشغيلة والصلاحية.':'Receive the supplier invoice into stock with lot and expiry.','قراءة فاتورة بالصورة':'Read invoice from photo','استلام فاتورة':'Receive invoice','استلامات النهارده':'Received today','طلبيات مستنية':'Pending orders','من صفحة المشتريات':'from the purchases page','استلامات الشهر':'This month','لسه مفيش':'None yet',
  'طلبيات مستنية الاستلام':'Orders waiting to be received','آخر الاستلامات':'Latest receipts','لسه مفيش استلامات':'No receipts yet','مفيش طلبيات مستنية. الطلبيات اللي بتتأكد من صفحة المشتريات هتظهر هنا.':'No pending orders. Orders confirmed on the purchases page appear here.','لما المندوب يوصل، اضغط «استلام فاتورة» واكتب الأصناف، أو صوّر الفاتورة.':'When the delivery arrives, press «Receive invoice» and enter the items, or photograph the invoice.',
  'التاريخ':'Date','المورد':'Supplier','رقم الفاتورة':'Invoice no.','الأصناف':'Items','الإجمالي':'Total','استلم':'Receive','مستني':'Waiting','وصل جزء':'Partly received','الفترة':'Period',
  'الفاتورة':'Invoice','سجل العميل':'Customer history','رجوع للكاشير':'Back to cashier','جارٍ تحميل المحادثات…':'Loading conversations…','تعذر تحميل المحادثات خلال 10 ثوانٍ.':'Could not load conversations within 10 seconds.','إعادة المحاولة':'Retry','تعذر تحميل النواقص خلال 15 ثانية.':'Could not load shortages within 15 seconds.','تعذر تحميل شاشة الاستلام خلال 15 ثانية.':'Could not load receiving screen within 15 seconds.','أوفلاين':'Offline','غير متصل بالإنترنت':'Offline','بدون إنترنت':'Offline'};
 for(const [k,v] of Object.entries(enUx))if(!(k in toEn))toEn[k]=v;
 const arExtra={'CHECKOUT':'إتمام الدفع','NET TOTAL':'الإجمالي النهائي','F9 / Pay':'F9 / دفع','items)':'صنف)',
  'Added to invoice:':'تمت الإضافة للفاتورة:','Scanned product added:':'تمت إضافة المنتج بالباركود:','Barcode match added:':'تمت الإضافة بالباركود:','Product added:':'تمت إضافة المنتج:',
  'Customer skipped (Walk-in). Switched to Product Scan mode.':'تم تخطي العميل (عميل عابر). تم التحويل لبحث المنتجات.','No customer found. Searching medicines instead.':'لا يوجد عميل بهذا البحث. جارٍ البحث عن الأدوية.',
  'Customer attached:':'تم ربط العميل:','Customer detached. Operating in Walk-in mode.':'تم فصل العميل. الفاتورة لعميل عابر.','Invalid quantity. Enter a number from 1 to 999.':'كمية غير صالحة. اكتب رقمًا من 1 إلى 999.',
  'Quantity cannot exceed 999.':'الكمية لا تزيد عن 999.','Item removed from invoice.':'تم حذف الصنف من الفاتورة.','Invoice cleared.':'تم مسح الفاتورة.','Cannot checkout an empty invoice.':'لا يمكن الدفع لفاتورة فاضية.',
  'Enter a valid cash amount covering the total due.':'اكتب مبلغًا نقديًا يغطي المطلوب.','Payment confirmed & Invoice completed!':'تم الدفع واكتملت الفاتورة!','New sale ready. Scan barcode or search medicine.':'فاتورة جديدة جاهزة. امسح الباركود أو ابحث عن دواء.',
  'Unable to save held invoices on this device.':'تعذر حفظ الفواتير المعلقة على هذا الجهاز.','Add products before holding an invoice.':'أضف أصنافًا قبل تعليق الفاتورة.','Held invoice limit reached (50).':'وصلت لحد الفواتير المعلقة (50).',
  'Invoice held on this device.':'تم تعليق الفاتورة على هذا الجهاز.','Held invoice restored.':'تمت استعادة الفاتورة المعلقة.','Customer search active. Existing line items remain intact.':'بحث العميل شغّال. الأصناف الحالية كما هي.',
  'Search to select a replacement customer.':'ابحث لاختيار عميل بديل.','Re-added from history at current price:':'أُعيدت الإضافة من السجل بالسعر الحالي:','Discount cannot be negative. The value is ignored.':'لا يمكن أن يكون الخصم بالسالب. تم تجاهل القيمة.','Percent discount cannot exceed 100%. Using 100%.':'نسبة الخصم لا تتجاوز 100%. تم استخدام 100%.','Discount is larger than the invoice total. The total is set to zero.':'الخصم أكبر من إجمالي الفاتورة. الإجمالي أصبح صفرًا.','No products found matching':'لا توجد منتجات مطابقة','No customers found. Press':'لا يوجد عميل بهذا البحث. اضغط','to skip and switch to Product Scan.':'للتخطي والانتقال لبحث المنتجات.','Walk-in Customer':'عميل عابر','Start New Sale (F2)':'فاتورة جديدة (F2)',
  'Skips customer and switches to Product Scan mode':'يتخطى العميل وينتقل لوضع مسح المنتج','Barcode Scan':'مسح الباركود',
  'Directly adds product & switches to Product mode':'يضيف المنتج مباشرة وينتقل لوضع المنتج',
  'Opens this window (shortcuts)':'فتح هذه النافذة (الاختصارات)','(on empty search with items on the invoice)':'(على بحث فارغ والفاتورة بها أصناف)',
  'Opens checkout; then Enter confirms payment and Enter starts a new sale':'فتح نافذة الدفع؛ ثم Enter لتأكيد الدفع وEnter لفاتورة جديدة',
  '(no arrow selection)':'(بدون تحديد بالأسهم)','Adds the first suggestion':'يضيف أول صنف في الاقتراحات',
  'before the name or':'قبل الاسم أو','after it':'بعده','Set quantity (e.g. *3 Panadol)':'تحديد الكمية (مثال: *3 بانادول)',
  'Switch last line unit (box → strip → tab), remembered per product':'تبديل وحدة آخر صنف (علبة ← شريط ← حبة) ويُتذكّر لكل صنف','Percent discount / fixed discount':'خصم بالنسبة % / خصم بمبلغ ثابت','(or C) inside checkout':'داخل الدفع',
  'Card / Credit / Cash':'بطاقة / آجل / نقدي',
  'Start New Sale (resets invoice & focuses search)':'فاتورة جديدة (تمسح الفاتورة وتركّز على البحث)',
  'Add Loyalty / Switch customer search without resetting items':'إضافة عميل / تبديل البحث عن عميل بدون مسح الأصناف',
  '(on blank customer search)':'(في بحث العميل الفارغ)','(anytime)':'(في أي وقت)','Arrow Up / Down':'السهم لأعلى / لأسفل',
  'Navigate autocomplete suggestion dropdown':'التنقل في قائمة الاقتراحات','(on selected item)':'(على الصنف المحدد)',
  'Adds product or attaches customer':'يضيف المنتج أو يربط العميل','Clear current invoice line items':'مسح أصناف الفاتورة الحالية',
  'Open Checkout / Payment dialog':'فتح نافذة الدفع','Dismiss dropdowns and close open modals':'إغلاق القوائم والنوافذ المفتوحة','Got it (Esc)':'تمام (Esc)',
  'More actions':'المزيد من الإجراءات','Clear Line Items (F4)':'مسح الأصناف (F4)','Close':'إغلاق','Switch between medicine and customer search':'التبديل بين البحث عن دواء وعميل','Switch search mode':'تبديل وضع البحث','Language':'اللغة',
  'Print':'طباعة','Reprint Copy':'إعادة طباعة نسخة','Download PDF':'تحميل PDF','Printer Ready':'الطابعة متصلة','Printer Offline':'الطابعة غير متصلة','Printer: browser print':'الطابعة غير معروفة','Check power/cable and retry':'تحقق من التوصيل أو البلوتوث ثم أعد المحاولة','Printer Disconnected':'الطابعة غير متصلة','Reconnect & Retry':'إعادة التوصيل والمحاولة','Paper width':'مقاس الورق','Printer disconnected — check power/cable and retry':'الطابعة غير متصلة — تحقق من التوصيل أو البلوتوث ثم أعد المحاولة'};
 for(const [k,v] of Object.entries(arExtra)){if(!(k in enToAr))enToAr[k]=v;if(!(v in toEn))toEn[v]=k;}
 /* Exact mixed-language markup strings: [English, Arabic] */
 const mixedText={
  'Complete Sale & Payment / إنهاء الفاتورة':['Complete Sale & Payment','إتمام البيع والدفع'],
  'اختر عميلاً لإتمام البيع الآجل':['Select a customer to complete the credit sale','اختر عميلاً لإتمام البيع الآجل'],
  'F10 / F11 / F12 (أو C)':['F10 / F11 / F12 (or C)','F10 / F11 / F12 (أو C)'],'Cash / نقدي (F12)':['Cash (F12)','نقدي (F12)'],'بطاقة بنكية (F10)':['Bank card (F10)','بطاقة بنكية (F10)'],'Credit / آجل (F11)':['Credit (F11)','آجل (F11)'],'Start New Sale (F2 / Enter)':['Start New Sale (F2 / Enter)','فاتورة جديدة (F2 / Enter)'],
  'Cash / نقدي':['Cash','نقدي'],'Mada / بطاقة':['Mada / Card','مدى / بطاقة'],'Split / مختلط':['Split','مختلط'],'Credit / آجل':['Credit','آجل'],'Card (mock) / بطاقة':['Card (mock)','بطاقة (تجريبية)'],'Credit / آجل (يحتاج عميلاً)':['Credit (needs a customer)','آجل (يحتاج عميلاً)'],
  'Transaction Receipt / إيصال الدفع':['Transaction Receipt','إيصال الدفع'],
  'اختصارات الكيبورد ودليل الكاشير':['Keyboard Shortcuts & POS Manual','اختصارات الكيبورد ودليل الكاشير'],
  'Keyboard Shortcuts & POS Manual':['Keyboard Shortcuts & POS Manual','اختصارات الكيبورد ودليل الكاشير'],
  'View اختصارات الكيبورد':['View keyboard shortcuts','عرض اختصارات الكيبورد'],
  'View Keyboard Shortcuts':['View keyboard shortcuts','عرض اختصارات الكيبورد'],
  'Confirm & Print Receipt (Enter)':['Confirm & Print Receipt (Enter)','تأكيد وطباعة الإيصال (Enter)']
 };
 const arabicSource=new Set(Object.keys(arToEn).filter(x=>/[\u0600-\u06FF]/.test(x)));
 const englishSource=new Set(Object.keys(enToAr));
 const preserved=new WeakMap();
 const phraseCache={};
 function translateText(text,lang){
  const trimmed=text.trim();if(!trimmed)return text;
  if(lang==='en'&&text.includes('ج.م'))text=text.split('ج.م').join('EGP');
  if(lang==='ar'&&text.includes('EGP'))text=text.replace(/\bEGP\b/g,'ج.م');
  const mixed=mixedText[trimmed];if(mixed)return text.replace(trimmed,mixed[lang==='en'?0:1]);
  const dict=lang==='en'?toEn:enToAr;
  if(dict[trimmed])return text.replace(trimmed,dict[trimmed]);
  let next=text;
  // Longer UI phrases first, but do not translate user/product data (UX441: sorted list built once per language, not per text node)
  const phr=phraseCache[lang]||(phraseCache[lang]=Object.entries(dict).filter(e=>e[0].length>=7).sort((a,b)=>b[0].length-a[0].length));
  for(let i=0;i<phr.length;i++){
   const a=phr[i][0];
   if(next.includes(a))next=next.split(a).join(phr[i][1]);
  }
  return next;
 }
 function uiText(node){
  const parent=node.parentElement;
  if(!parent)return false;
  if(parent.closest('script,style,option,.nova-data-table tbody,.cust-name,.nx-rail-name,#novaCustChipName,.cust-phone,.sugg-primary,.sugg-sub,.past-item-row,.past-inv-card,.offer-item,.invoice-table tbody,#receiptSlipContent'))return false;
  return true;
 }
 let busy=false;
 function apply(){
  if(busy)return;busy=true;
  const lang=localStorage.getItem(langKey)==='en'?'en':'ar';
  const dir=lang==='ar'?'rtl':'ltr';
  document.documentElement.lang=lang;document.documentElement.dir=dir;
  document.body.classList.toggle('lang-ar',lang==='ar');
  document.body.classList.toggle('lang-en',lang==='en');
  document.querySelectorAll('#novaPageView [dir]').forEach(el=>{if(el.getAttribute('dir')!==dir)el.setAttribute('dir',dir)});
  document.querySelectorAll('.nova-lang-btn').forEach(b=>{b.classList.toggle('active',b.dataset.lang===lang);b.setAttribute('aria-pressed',String(b.dataset.lang===lang))});
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
  for(const node of nodes){
   if(!uiText(node))continue;
   let source=preserved.get(node);
   if(source===undefined){source=node.nodeValue;preserved.set(node,source)}
   const val=translateText(source,lang);
   if(node.nodeValue!==val)node.nodeValue=val;
  }
  document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(el=>{
   for(const attr of ['placeholder','title','aria-label']){
    if(!el.hasAttribute(attr))continue;
    const key='novaOriginal'+attr.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());let original=el.dataset[key];
    if(original===undefined){original=el.getAttribute(attr);el.dataset[key]=original}
    const extra={
      'Search customer by name or phone... (Press Enter to skip)':lang==='ar'?'ابحث باسم العميل أو رقمه... (Enter للتخطي)':'Search customer by name or phone... (Enter to skip)',
      'Scan barcode or type medicine name...':lang==='ar'?'امسح الباركود أو اكتب اسم الدواء...':'Scan barcode or type medicine name...',
      'Search product name or scan barcode...':lang==='ar'?'ابحث عن دواء أو امسح الباركود...':'Search product name or scan barcode...',
      'بحث بالاسم أو الرقم أو الباركود':lang==='en'?'Search by name, number, or barcode':'بحث بالاسم أو الرقم أو الباركود',
      'تحديث التطبيق':lang==='en'?'Refresh app':'تحديث التطبيق',
      'التنقل الرئيسي':lang==='en'?'Main navigation':'التنقل الرئيسي',
      'المحادثات (واتساب)':lang==='en'?'Conversations (WhatsApp)':'المحادثات (واتساب)'
    };
    const waM=/^المحادثات \(واتساب\) — (\d+) غير مقروء$/.exec(original);
    if(waM)extra[original]=lang==='en'?'Conversations (WhatsApp) — '+waM[1]+' unread':original;
    el.setAttribute(attr,extra[original]||translateText(original,lang));
   }
  });
  busy=false;
 }
 let scheduled=false;
 const observer=new MutationObserver(()=>{if(busy||scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;apply()})});
 observer.observe(document.body,{childList:true,subtree:true,characterData:true});
 /* Delegated: the settings page renders these buttons after load, so per-button listeners never bound. */
 document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('.nova-lang-btn');if(!b)return;try{localStorage.setItem(langKey,b.dataset.lang)}catch(_){}apply();try{window.dispatchEvent(new CustomEvent('nova:lang-change',{detail:{lang:b.dataset.lang}}))}catch(_){}const t=document.querySelector('.nova-tab.active');if(t&&t.dataset.page&&t.dataset.page!=='sale')setTimeout(()=>{t.click();apply()},0)});
 apply();
})();
