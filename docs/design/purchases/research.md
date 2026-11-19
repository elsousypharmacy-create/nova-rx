# Purchases redesign — research notes (2026-11-19)

Compared the NOVA Rx purchases redesign against documented flows in Odoo, Zoho Inventory,
Square for Retail, Lightspeed Retail and the Saudi SFDA drug track & trace (DTTS) system.

## Practices that matter for a mobile/tablet pharmacy

1. **Scan to add / scan to receive.** Square, Lightspeed and Odoo all let staff add or count items
   by barcode (camera or scanner); scanning the same item again increments qty.
   Sources: https://squareup.com/help/us/en/article/6110-manage-inventory-with-the-retail-pos-app ,
   https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/barcode/operations/receipts_deliveries.html ,
   https://x-series-support.lightspeedhq.com/hc/en-us/articles/25534190380187-Receiving-stock-orders-with-Lightspeed-Scanner-X-Series
2. **Batch + expiry per line, required for tracked items.** Odoo refuses to validate a receipt
   without a lot; Zoho lets one line split into several batches, each with its own expiry.
   Sources: https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/product_management/product_tracking/expiration_dates.html ,
   https://www.zoho.com/us/inventory/help/purchase-orders/bills.html
3. **GS1 DataMatrix auto-fill.** Gulf/KSA drug packs carry GS1 DataMatrix with (01) GTIN, (17) expiry
   YYMMDD, (10) batch, (21) serial; pharmacies "accept" received units by scanning it. One scan can
   fill item + batch + expiry. Sources: https://sfda.gov.sa/sites/default/files/2021-03/DrugBarcodingSpecificationsEN.pdf ,
   https://www.sfda.gov.sa/sites/default/files/2021-05/System-EN.pdf ,
   https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/barcode/operations/gs1_usage.html
4. **Receive against the order, partial receipt keeps the remainder open.** Zoho (Receive all /
   Partial receive), Square (Receive all / per-line receive), Lightspeed (multiple deliveries per PO),
   Odoo (backorder: Ask/Always/Never).
   Sources: https://www.zoho.com/us/inventory/help/purchase-orders/purchase-receive.html ,
   https://squareup.com/help/us/en/article/8258-create-purchase-orders-with-square-for-retail ,
   https://x-series-support.lightspeedhq.com/hc/en-us/articles/35422373976859-What-s-new-with-partially-received-orders-multiple-deliveries ,
   https://www.odoo.com/documentation/20.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/operation_type.html
5. **Discrepancy flags.** Lightspeed alerts when counted ≠ ordered; Square marks lines Damaged /
   Won't fulfill; Odoo 3-way matching flags bill "Exception" when bill ≠ PO/receipt.
   Sources: Lightspeed scanner link above; Square PO link above;
   https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/purchase/manage_deals/control_bills.html
6. **Draft save.** Square "Save to complete the draft later"; Zoho "Save as Draft / In transit";
   Square warns that leaving a receive screen loses unsaved scans.
7. **Cost-change indicator.** Square's receive confirmation shows unit cost up/down vs last receipt and margin.
8. **Confirm step is final → explicit review.** Lightspeed/Lightspeed X warn receiving is permanent and
   show a review of quantities and prices before commit.

## What changed in the mockups
- 04 invoice form: added a dashed "امسح باركود العلبة" button (fills item + batch + expiry from GS1),
  expiry now required (*), "آخر سعر" hint under unit price, "إلغاء" replaced with "حفظ مسودة"
  (close × still cancels), missing-hint lists expiry.
- 05 ledger: filter chips (الكل / مسودات / فيها فرق) and a discrepancy status ("فرق: 2 ناقص").
- Unchanged: tabs hub, auto-loaded needs, session banner with button, receiving empty state.

## Deferred (not in PUR-01..03, needs data-model work / Ahmed's OK)
- Receive against a specific order with per-line ordered vs received + partial remainder.
- Full GS1 DataMatrix parsing via camera on device (PUR tasks only add the hook if a scanner util exists).
- Multi-batch split per line.
