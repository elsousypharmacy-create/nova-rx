// PUR-08 unit check: verifies B-01..B-03, S-02..S-07, and P-01..P-05 across index.html, purchases.html, purchases.css, purchases.js, purchases-history.js, and purchases-history.css.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAppHtml } from '../lib/app-html.mjs'; // PERF-02: index.html + split app/ files

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const indexHtml = readAppHtml(path.join(ROOT, 'index.html'));
const purchasesHtml = fs.readFileSync(path.join(ROOT, 'purchases.html'), 'utf8');
const purchasesCss = fs.readFileSync(path.join(ROOT, 'purchases.css'), 'utf8');
const purchasesJs = fs.readFileSync(path.join(ROOT, 'purchases.js'), 'utf8');
const historyJs = fs.readFileSync(path.join(ROOT, 'purchases-history.js'), 'utf8');
const historyCss = fs.readFileSync(path.join(ROOT, 'purchases-history.css'), 'utf8');

// B-01: .rcv-dlg scrolls as a whole at <=780px; .rcv-grid has overflow:visible and no nested scroll trap
assert.ok(indexHtml.includes('.rcv-dlg{max-height:none;height:100%;border-radius:0;overflow-y:auto}'), 'B-01: .rcv-dlg scrolls as a whole on mobile');
assert.ok(indexHtml.includes('.rcv-dlg .rcv-grid{overflow:visible;min-height:0;flex:0 0 auto}'), 'B-01: .rcv-grid does not trap line items in a nested scroll box');

// B-02: #rcvInv marked required, triggers sum() on input, and sum() pushes رقم الفاتورة to miss[]
assert.ok(indexHtml.includes('<label for="rcvInv"><span>رقم الفاتورة <b class="rcv-req" aria-hidden="true">*</b></span><input id="rcvInv" dir="ltr" autocomplete="off" aria-required="true"'), 'B-02: #rcvInv label has required marker and aria-required');
assert.ok(indexHtml.includes("ov.querySelector('#rcvInv').addEventListener('input', function () { msg(''); sum(); });"), 'B-02: #rcvInv input listener re-runs sum()');
assert.ok(indexHtml.includes("if (!ov.querySelector('#rcvInv').value.trim()) miss.push('رقم الفاتورة');"), 'B-02: empty #rcvInv is listed in ناقص and disables #rcvOk');

// B-03: mobile needs table ::before labels match current column order
assert.ok(purchasesCss.includes("tbody td:nth-child(3):before{content:'الرصيد / المستهدف'}"), 'B-03: 3rd column mobile label is الرصيد / المستهدف');
assert.ok(purchasesCss.includes("tbody td:nth-child(4):before{content:'البيع اليومي'}"), 'B-03: 4th column mobile label is البيع اليومي');
assert.ok(purchasesCss.includes("tbody td:nth-child(5):before{content:'المطلوب'}"), 'B-03: 5th column mobile label is المطلوب');

// S-02: hide مراجعة الاستلام reviewTable when invoice has no PO
assert.ok(indexHtml.includes('.rcv-review:empty{display:none}'), 'S-02: empty #rcvReview is hidden');
assert.ok(indexHtml.includes("ov.querySelector('#rcvReview').innerHTML = po ? reviewTable(po, lines) : '';"), 'S-02: reviewTable only renders when po is present');

// S-03: stage visibility rules apply on mobile as well as desktop
assert.ok(purchasesCss.includes('.purchase-flow{display:none!important}'), 'S-03: .purchase-flow hidden across viewports');
assert.ok(purchasesCss.includes('main:has(#rows td.empty) .controls #distribute{display:none!important}'), 'S-03: #distribute hidden when rows are empty');
assert.ok(purchasesCss.includes('.table-wrap table:has(tbody td.empty) thead{display:none!important}'), 'S-03: thead hidden when rows are empty');
assert.ok(purchasesCss.includes('.workspace:has(.cart #groups>.empty) .cart{display:none!important}'), 'S-03: empty cart hidden across viewports');

// S-04: embedded receiving links to سجل الفواتير instead of duplicating 50-row table, and fmtDate uses Arabic month names
assert.ok(indexHtml.includes("var AR_M = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];"), 'S-04: fmtDate uses Arabic months');
assert.ok(indexHtml.includes('data-rcv="history">عرض سجل الفواتير</button>'), 'S-04: embedded receiving links to سجل الفواتير');
assert.ok(purchasesJs.includes('if(TABS[e.data.novaPurchasesTab])showTab(e.data.novaPurchasesTab,{focus:true});'), 'S-04: purchases hub handles postMessage tab switch to history');

// S-05: supplier checkbox cards stack to 1 column on narrow screens and never wrap mid-word
assert.ok(purchasesCss.includes('dialog#settings .qs-sup .check{white-space:nowrap}'), 'S-05: supplier checkbox label does not wrap mid-word');
assert.ok(purchasesCss.includes('@media(max-width:520px){dialog#settings .qs-sup{grid-template-columns:1fr}}'), 'S-05: supplier checkbox cards stack to 1 column on narrow screens');

// S-06: correction/review tables stack rows on mobile <=700px instead of 650px min-width
assert.ok(!indexHtml.includes('.rcv-review-scroll table{min-width:650px}'), 'S-06: 650px min-width removed on mobile review/correction tables');
assert.ok(indexHtml.includes('.rcv-review-scroll tbody td[data-label]::before{content:attr(data-label)'), 'S-06: stacked mobile cells show data-label headings');
assert.ok(indexHtml.includes('data-label="الكمية الصحيحة"'), 'S-06: openCorrection cells have data-label');

// S-07: pending receipts section has .rcv-sec-h, .rcv-count, .rcv-pos, and consistent naming with history
assert.ok(indexHtml.includes('<div class="rcv-sec-h"><h2>استلامات تحتاج استكمال</h2><span class="rcv-count">'), 'S-07: pending receipts section uses .rcv-sec-h and .rcv-count');
assert.ok(indexHtml.includes('<span class="rcv-tag" data-state="partial">مسودة · يحتاج استكمال</span>'), 'S-07: pending receipt card links مسودة and يحتاج استكمال');
assert.ok(historyJs.includes("(item.raw && item.raw.pending ? ' · يحتاج استكمال' : '')"), 'S-07: history detail sheet clarifies pending draft state');

// P-01..P-05: tap targets >=32px, mobile offers button text/icon, sticky tabs offset, Arabic file input, focus trap + restore
assert.ok(indexHtml.includes('html body button.nx-i,html body #novaPageView button.nx-i,html body #novaPageView .nova-page-header button.nx-i{width:32px!important;height:32px!important;min-width:32px!important;min-height:32px!important'), 'P-01: .nx-i is 32x32px circle');
assert.ok(historyCss.includes('min-width: 32px;\n  min-height: 32px;'), 'P-01: checkboxes on purchases page are >=32x32px');
assert.ok(purchasesJs.includes('<label class="row-select-label"><input type="checkbox" data-action="select"'), 'P-01: row checkboxes wrapped in 44x44 .row-select-label');
assert.ok(purchasesJs.includes('<span class="row-action-txt">العروض</span>'), 'P-02: offers button has visible label on mobile');
assert.ok(purchasesCss.includes('.row-action.ico-edit::before{content:"";width:16px;height:16px'), 'P-02: offers button icon available across viewports');
assert.ok(purchasesCss.includes('@media(max-width:800px){.nova-topbar{z-index:6}.pur-tabs{top:var(--pur-topbar-h,92px);z-index:5}}'), 'P-03: sticky .pur-tabs offset below .nova-topbar on mobile');
assert.ok(purchasesHtml.includes("var a=n.querySelector('[aria-current]')") && purchasesJs.includes("document.querySelector('.nova-topbar nav [aria-current]')"), 'P-03: topbar active nav centering matches <summary aria-current>');
assert.ok(indexHtml.includes('<label for="novaAiFiles" class="rcv-btn">اختَر صور الفاتورة<input id="novaAiFiles"') && indexHtml.includes('id="novaAiFileCount"'), 'P-04: styled Arabic file input in #novaAiPanel');
assert.ok(indexHtml.includes("else if (e.key === 'Tab')") && indexHtml.includes('prevFocus.focus()'), 'P-05: focus trap and focus restore in #rcvForm');

console.log('PASS PUR-08 unit check: B-01..B-03, S-02..S-07, P-01..P-05');
