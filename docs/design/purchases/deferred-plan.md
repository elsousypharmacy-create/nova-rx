# Deferred Purchases Plan: PO Partial Receipt & GS1 DataMatrix Camera Scan

**Status:** PLAN ONLY — Needs Owner (Ahmed) Approval Before Implementation  
**Author:** Gemini (`agy-b`)  
**Date:** 2026-11-19  
**Design Context:** `docs/design/purchases/README.md`, `docs/design/purchases/research.md`, `docs/design/purchases/after/03-receive.png` .. `05-ledger.png`, `docs/design/purchases/html/03-receive.html` .. `05-ledger.html`

---

## 0. Owner Decisions Needed (Required Before Any Code Is Written)

Before implementing either feature, Ahmed's explicit decision is needed on the following questions:

1. **PO Creation Source in the `طلب` Tab:**
   - When the pharmacist builds a shortage distribution in `purchases.html` / `purchases.js` (`راجع الطلب` → `#reviewDialog`) and clicks `حفظ قائمة نوفا` (`#saveDraft` at `purchases.js:254`, currently writing to `localStorage['novaPurchaseDraftV1']`), should we add a one-tap action **«إنشاء أمر شراء للاستلام»** that creates an open local Purchase Order in `nova.purchase.orders` (per supplier group) and marks it `sent` (`مُرسل` / `مفتوح`) so it appears immediately under `طلبات معلّقة` in the `استلام` tab — without touching any external supplier cart?
   - *Recommendation:* **Yes** (local-only PO creation from the approved NOVA draft, zero supplier network calls).

2. **Discrepancy Policy on Partial / Over-Receipt Against a PO:**
   - When a received invoice against a PO has **shortages** (`الواصل الآن < الباقي`), **over-receipts** (`الزيادة > 0`), **unordered items** (`خارج الطلبية`), or **unit cost changes** (`سعر الشراء ≠ سعر الطلبية`), should the receipt:
     - **(A) Non-blocking warn + flag (Recommended):** Allow confirming the receipt, keep remaining quantities open on the PO (`state: 'partial'`), and tag the receipt with a discrepancy badge (`فرق: X ناقص` / `فرق: زيادة` / `فرق سعر`) so it filters under `فيها فرق` in `سجل الفواتير` (`after/05-ledger.png`)?
     - **(B) Require a short reason/checkbox on over-receipt or unordered items** while keeping partial under-receipts friction-free?

3. **Multi-Batch Split for the Same PO Item in One Invoice:**
   - If a supplier delivers 10 boxes of an ordered item split across two batches (`تشغيلة A` × 6 and `تشغيلة B` × 4) on the same invoice, `purchase-orders.js:101` (`keys[l.code + '\u0000' + l.lot]`) and `receipt-operations.js:42` (`incoming.reduce(...)`) already support multiple lines with the same `code` and different `lot`. Should the invoice dialog provide a **«+ تقسيم لتشغيلة تانية»** action on a PO-linked line card?
   - *Recommendation:* **Yes**, allow duplicating a PO line for a second batch/expiry while summing both lines against the PO's ordered quantity.

4. **GS1 DataMatrix Camera Decoder Strategy (Zero Paid Services, Offline-First PWA):**
   - Native `window.BarcodeDetector` supports `'data_matrix'` on Android Chrome ( via Google Play Services) and macOS/iOS 17.4+ Safari in some contexts, **but iOS Safari/WebKit (`getSupportedFormats()`) is inconsistent or missing `data_matrix` on many iPhones/iPads**, and desktop Chromium on Linux/Windows lacks native `data_matrix` decoding.
   - Which fallback option does Ahmed approve?
     - **(A) Native `BarcodeDetector` first + lazy-loaded self-hosted OSS WASM fallback (`zxing-wasm` reader-only, MIT license, ~380 KB gzipped, loaded *only* when the pharmacist taps «امسح باركود العلبة» and `BarcodeDetector` lacks `data_matrix`) + USB/Bluetooth keyboard-wedge scanner support (Recommended — works 100% on iPhone, iPad, Android, and desktop offline).**
     - **(B) Native `BarcodeDetector` + USB/Bluetooth keyboard-wedge only (zero third-party library/WASM bytes; camera button shows a clear hint on unsupported browsers while 1D/2D hardware scanners still parse GS1 strings).**

5. **Unknown GTIN Auto-Binding During Invoice Receive:**
   - When a pharmacist scans a GS1 DataMatrix on a pack (e.g. Saudi SFDA / EDA pack with `(01) 06281001234567`) and that 14-digit GTIN (or its 13-digit stripped EAN) is **not yet linked** to the product in the local catalog, should selecting the product manually in that line card offer a checkbox **«ربط هذا الباركود بالصنف»** to save the GTIN alias locally (`nova-rx-barcode-aliases-v1`) for future scans?
   - *Recommendation:* **Yes** (saves repeated typing on every subsequent box of that medicine).

---

## Part (A) — Receive Against a Purchase Order with Partial Receipt

### A.1 Current Architecture & Existing Modules in Repo

Today, NOVA Rx has three partially connected layers for purchase orders and receipts:

1. **PO & Ledger Engine (`purchase-orders.js`, `stock-ledger.js`, `purchases-po.js`):**
   - `purchase-orders.js` (`window.NovaPurchaseOrders`) manages `localStorage['nova.purchase.orders']`.
   - Supported states (`purchase-orders.js:6`): `'draft' | 'sent' | 'accepted' | 'partial' | 'received' | 'closed-short' | 'cancelled'`.
   - `store.receive(id, grn, { confirmed: true, by })` (`purchase-orders.js:87-129`) validates `{ ref, invoice?, lines: [{ code, lot, expiry, qty, cost }] }`, appends `kind: 'receive'` movements to `stock-ledger.js` (`nova.stock.ledger`), increments `po.lines[i].received += l.qty`, appends to `po.grns`, and transitions `po.state` to `'received'` (if `po.lines.every(l => l.received >= l.qty)`) or `'partial'` (if any line still has `received < qty`).
   - `store.closeRemaining(id, { id: requestId, reason, version }, { confirmed: true, by })` (`purchase-orders.js:64-83`) cancels the unfulfilled remainder of a `'partial'` PO (`line.cancelledQty = Math.max(0, line.qty - line.received)`), records `po.closure`, and transitions `po.state` to `'closed-short'`.
   - `purchases-po.js` provides a legacy developer modal (`#poDialog` in `purchases.html:34`) with raw CSV textareas (`#poLines`, `#grnLines`) rather than the redesigned card UI.

2. **Receipt Operations & Atomic Journal (`receipt-operations.js`):**
   - `window.NovaReceiptOperations` coordinates atomic multi-key writes across `KEYS` (`receipt-operations.js:4-5`):
     - `receipts`: `'nova-rx-receipts-v1'`
     - `orders`: `'nova.purchase.orders'`
     - `lots`: `'nova-rx-lots-v1'`
     - `ledger`: `'nova.stock.ledger'`
     - `journal`: `'nova.receipt-transaction-v1'`
   - `review(po, lines)` (`receipt-operations.js:37-52`) computes per-code comparison: `{ code, name, ordered, prior, quantity, remaining, excess, unordered, expectedCost, costs, costChanged }`.
   - `correct(storage, request, context)` (`receipt-operations.js:53-130`) applies post-receipt audited quantity adjustments under `stock.adjust` permission and updates `po.lines[i].received` and `po.state`.

3. **Receiving View & Invoice Dialog (`index.html:11946-12480`):**
   - `pendingPOs()` (`index.html:12003`) reads `nova.purchase.orders` where `state` is in `['sent', 'accepted', 'partial']`.
   - Clicking `استلم` (`[data-rcv-po]` at `index.html:12200, 12468-12474`) opens `#rcvForm` pre-populated with remaining lines (`l.qty - (l.received || 0) > 0`).
   - `applyReceipt(receipt)` (`index.html:11970-12002`) runs `store.receive(receipt.poId, grn, ...)` and `window.novaStock.addLot(line, receipt.id + '/' + index)`.

### A.2 Gaps Between Existing Code and the Redesigned Purchases Flow (`PUR-01..03`)

1. **No user-friendly way to create/select a PO from the redesigned hub:**
   - Creating a PO currently requires opening the hidden CSV modal `#poDialog` in `purchases.html:34`.
   - In `#rcvForm` (`04-invoice-form.html`), if the pharmacist clicks `+ استلام فاتورة` directly instead of clicking `استلم` on a PO card, there is no PO selector (`ربط بطلبية معلّقة`) to link the invoice to an open PO for that supplier.
2. **Line cards in `#rcvForm` do not show per-line PO context on mobile (`390x844`):**
   - `#rcvReview` (`index.html:12018-12027`) renders a wide 7-column `<table>` (`الصنف | المطلوب | سبق استلامه | الواصل الآن | الباققي | الزيادة | سعر الشراء`) at the bottom of the dialog, which overflows horizontally on `390x844` and separates the ordered/remaining hint from the item card where the pharmacist is typing.
   - Inside each `.rcv-line` card, the pharmacist cannot see `المطلوب: 10 · سبق استلامه: 4 · الباقي: 6` or `آخر سعر / سعر الطلبية: 48.50 ج.م` (`04-invoice-form.html:87`) directly under the quantity and price fields.
3. **Partial delivery where a line is NOT delivered in the current box (`qty = 0` or omitted):**
   - When a PO has 5 items and the supplier sends a partial shipment containing only 3 items, the pharmacist must either delete the other 2 cards or set their quantity to `0` without being forced to enter a fake expiry date (`MM/YY`) for items that did not arrive in this box.
   - Currently, `openForm` pre-fills all remaining PO lines (`index.html:12470`), and every line in `#rcvForm` requires a product + positive integer `qty >= 1` + valid `MM/YY` expiry (`index.html:12385-12390`). If a pharmacist wants to skip an unshipped line without losing visibility that it was part of the PO, deleting the card removes it from sight, whereas setting `qty = 0` fails validation (`اكتب كمية صحيحة بالعلب`).
4. **Discrepancy summary (`فرق: 2 ناقص`) for `سجل الفواتير` (`05-ledger.html:54`):**
   - `purchase-orders.js:103-121` only records `warnings` for `over-receipt`, `unordered`, `cost-differs`, `expired`, `short-expiry`, and `invoice-vs-grn`/`invoice-vs-po`. It does **not** record a structured discrepancy summary on the saved receipt in `nova-rx-receipts-v1` when an invoice is a partial delivery (`shortQty > 0`), over-delivery (`excessQty > 0`), or has a price difference (`costDiffCount > 0`), which `PUR-03` (`سجل الفواتير`) needs for the `فيها فرق` filter chip and badge (`فرق: 2 ناقص`).

### A.3 Backward-Compatible Data Shape & State Machine

#### 1. PO Status Mapping (UI vs Storage in `nova.purchase.orders`)

To preserve 100% backward compatibility with `purchase-orders.js`, `po-sync-wire.js`, and `backend/src/sync.js:386`, internal storage keeps `STATES = ['draft', 'sent', 'accepted', 'partial', 'received', 'closed-short', 'cancelled']` and maps them to the three user-facing buckets requested:

| User-Facing Status | Internal `po.state` | Arabic Badge Label | Meaning |
|---|---|---|---|
| **Open (`مفتوح`)** | `'sent'` or `'accepted'` | `مفتوح · مستني الاستلام` | Order confirmed/sent; `0` boxes received so far (`grns.length === 0`). |
| **Partial (`استلام جزئي`)** | `'partial'` | `وصل جزء (X من Y علبة)` | At least one GRN received (`grns.length > 0`), and at least one line still has `received + (cancelledQty || 0) < qty`. Remainder stays open. |
| **Closed (`مكتمل / مغلق`)** | `'received'`, `'closed-short'`, `'cancelled'` | `مكتمل` / `مكتمل مع إلغاء الباقي` / `ملغي` | Every line has `received >= qty` (`received`), or remaining quantities were explicitly cancelled with an audited reason (`closed-short`), or cancelled before any receipt (`cancelled`). |

#### 2. Backward-Compatible Receipt Shape in `nova-rx-receipts-v1`

Existing receipts in `localStorage['nova-rx-receipts-v1']` have the shape:
```json
{
  "id": "RCV-...",
  "at": "2026-11-19T14:00:00.000Z",
  "date": "2026-11-19",
  "supplier": "فارما أوفرسيز",
  "invoice": "10310",
  "poId": "PO-1",
  "pending": false,
  "by": "u1",
  "poState": "partial",
  "warnings": ["cost-differs"],
  "lines": [
    {
      "key": "6281001234567",
      "code": "6281001234567",
      "name": "كونكور 5 مجم (Concor 5mg)",
      "qty": 4,
      "lot": "RCV-.../1",
      "autoLot": true,
      "expiry": "2028-11-30",
      "cost": 27
    }
  ],
  "corrections": []
}
```

We extend this shape **additively** (all new fields optional; readers handle missing fields gracefully):
```json
{
  "id": "RCV-...",
  "at": "2026-11-19T14:00:00.000Z",
  "date": "2026-11-19",
  "supplier": "فارما أوفرسيز",
  "invoice": "10310",
  "poId": "PO-1",
  "pending": false,
  "draft": false,
  "by": "u1",
  "poState": "partial",
  "warnings": ["short-receipt", "cost-differs"],
  "discrepancy": {
    "hasDiff": true,
    "shortBoxes": 2,
    "shortLines": 1,
    "excessBoxes": 0,
    "unorderedLines": 0,
    "costDiffLines": 1,
    "labelAr": "فرق: 2 ناقص"
  },
  "poSnapshot": [
    {
      "code": "6281001234567",
      "name": "كونكور 5 مجم",
      "ordered": 6,
      "priorReceived": 0,
      "receivedNow": 4,
      "remainingAfter": 2,
      "expectedCost": 25,
      "actualCost": 27
    }
  ],
  "lines": [
    {
      "key": "6281001234567",
      "code": "6281001234567",
      "name": "كونكور 5 مجم (Concor 5mg)",
      "qty": 4,
      "orderedQty": 6,
      "priorReceivedQty": 0,
      "expectedCost": 25,
      "lot": "BATCH-99",
      "autoLot": false,
      "expiry": "2028-11-30",
      "cost": 27,
      "gtin": "06281001234567",
      "serial": null
    }
  ]
}
```

#### 3. Migration & Compatibility of Old Receipts and Old POs

- **Zero destructive migration:** No existing key is renamed or wiped.
- **Old receipts without `discrepancy` or `poSnapshot`:**
  - Helper `NovaReceiptOperations.describeDiscrepancy(receipt, orders)` computes the discrepancy object on the fly for older receipts:
    1. If `receipt.discrepancy` is present, use it.
    2. Else if `Array.isArray(receipt.corrections) && receipt.corrections.length > 0`, derive net correction delta (`فرق: تعديل كمية`).
    3. Else if `Array.isArray(receipt.warnings) && receipt.warnings.length > 0`, map `over-receipt` → `فرق: زيادة`, `cost-differs` → `فرق: تغير السعر`, `unordered` → `فرق: صنف خارج الطلبية`.
    4. Else if `receipt.poId` and `receipt.poState === 'partial'`, show `استلام جزئي`.
    5. Otherwise `hasDiff: false` (`تم الاستلام`).
- **Old receipts loader invariants:**
  - `receipts()` in `index.html:11956` (`read(RK).filter(r => r && Array.isArray(r.lines))`) continues to load all old receipts unchanged.
  - Draft receipts (if saved via `حفظ مسودة`) use `draft: true, pending: false` and **never** call `applyReceipt` or `novaStock.addLot` until the pharmacist reopens the draft and clicks `تأكيد الاستلام وإضافة للمخزون`. `all` confirmed receipts filter `!r.pending && !r.draft`.

### A.4 Backend Impact Behind Existing Flags

- **Default flag state:** `novaBackend.enabled` is OFF by default (`CURRENT.md:17`), and backend sync routes require `NOVA_SYNC=1` + `NOVA_SALES_WRITES=1` (`backend/src/sync.js:312, 379, 383`).
- **`po-sync-wire.js` & `backend/src/sync.js` (`entity === 'purchase_order'`):**
  - **Gap found in `backend/src/sync.js:386` & `404`:** `purchase-orders.js:6` defines state `'closed-short'` (added in Issue #550), and `po-sync-wire.js:110` pushes `po.state` verbatim (`'closed-short'`). However, `backend/src/sync.js:386` currently validates `const validStates = ['draft', 'sent', 'accepted', 'partial', 'received', 'cancelled'];` (missing `'closed-short'`) and `backend/src/migrations/0003_sales_finance.sql:109` has `CHECK (status IN ('draft','sent','received','cancelled'))`.
  - **Fix in Backend Plan (behind existing `NOVA_SYNC=1` flag, no schema drop/table rewrite):**
    - Add `'closed-short'` to `validStates` in `backend/src/sync.js:386` and map `'closed-short': 'received'` in `statusMap` (`backend/src/sync.js:404`) so the `purchase_orders` SQL row marks `status = 'received'` while `sync_ledger` and `change_feed` (`payload_json`) preserve the full `{ key, po }` snapshot including `state: 'closed-short'` and `po.closure` for syncing to other devices.
    - In `po-sync-wire.js:62-76`, preserve `cancelledQty: Number(ln.cancelledQty || 0)` in `cloneLines()` and `closure: po.closure || null` in `snapshot` so remote devices see the exact open/cancelled remainder.
- **`receipt-sync-wire.js` & `backend/src/sync.js` (`entity === 'stock_receipt'`):**
  - `receipt-sync-wire.js:130` (`afterReceive(po, grn)`) already converts each received GRN line into base units and enqueues `{ id: receiptId, op: 'receipt', poId, ref, lines }`.
  - Multiple partial receipts against the same `po.id` have distinct `grn.ref` (the supplier invoice number), so `receiptId(po, grn, devId)` (`receipt-sync-wire.js:60-66`) produces a unique idempotency key per partial delivery and increments `inventory_batches.qty_on_hand` additively (`ON CONFLICT DO UPDATE SET qty_on_hand = qty_on_hand + excluded.qty_on_hand` at `backend/src/sync.js:233`). No D1 migration is required.

### A.5 UI Flow Per Screen (`390x844` Mobile & `1280x800` Tablet/Desktop)

#### Screen 1: `طلب` Tab (`purchases.html` / `after/01-talab.png`) → Creating a Local PO
1. Pharmacist reviews distributed shortages in `#reviewDialog` (`مراجعة قائمة التجهيز`).
2. Alongside `حفظ قائمة نوفا`, a button **«حفظ كطلبية معلّقة للاستلام»** creates one local PO per supplier group in `nova.purchase.orders` via `NovaPurchaseOrders.createStore` and transitions it to `'sent'` (with explicit `window.confirm('تأكيد حفظ الطلبية محليًا لمتابعة استلامها؟ لن يُرسل شيء للمورد.')`).
3. Toast: `تم حفظ الطلبية PO-X للمتابعة في تبويب الاستلام`.

#### Screen 2: `استلام` Tab (`after/03-receive.png` & `#receiving`)
1. **KPI Strip:**
   - `استلامات اليوم` (`0.00` · `X فاتورة · بالجنيه`)
   - `طلبات معلّقة` (`pos.length` — counts all POs with `state` in `['sent', 'accepted', 'partial']`)
   - `أصناف مفيش` (shortage count waiting to be ordered)
2. **Open / Partial Purchase Orders List (`طلبيات مستنية الاستلام`):**
   - When `pos.length > 0`, cards appear above the recent receipts list:
     - Header: Supplier name (`فارما أوفرسيز`) + status badge:
       - If `state === 'sent' | 'accepted'`: blue chip **`مفتوح`**
       - If `state === 'partial'`: amber chip **`استلام جزئي · باقي N علبة`**
     - Meta: `PO-1 · 19/11/2026 · 4 أصناف`
     - Progress bar: `got / ordered علبة` (`pct%`)
     - Actions:
       - Primary: **`استلم على الطلبية`** (`[data-rcv-po="PO-1"]`) → opens `#rcvForm` linked to `PO-1`.
       - Secondary: **`التفاصيل`** (`[data-rcv-order="PO-1"]`) → opens PO detail modal showing per-line `المطلوب | المستلم | الباقي | ملغي من الباقي`, linked invoices (`فواتير الاستلام`), and **`إلغاء الكمية الباقية`** (`[data-rcv-close-rest]`) when `state === 'partial'`.

#### Screen 3: `استلام فاتورة` Dialog (`after/04-invoice-form.png` / `#rcvForm`)
1. **Linking to a PO:**
   - **Path A (from PO card):** Clicking `استلم على الطلبية` opens `#rcvForm` with `st.poId = po.id`, supplier `<select id="rcvSup">` locked to `po.supplier`, and a header pill **`مرتبط بطلبية PO-1 · باقي X علبة`** (with an `إلغاء الربط` link if the pharmacist wants to switch to a free manual invoice).
   - **Path B (from `+ استلام فاتورة`):** When the pharmacist picks a supplier in `#rcvSup` that has one or more open/partial POs in `nova.purchase.orders`, an optional selector bar appears under `#rcvSup`:
     - **`ربط بطلبية معلّقة (اختياري):`** `<select id="rcvPoSelect">` listing `بدون ربط (فاتورة حرة)` and each open/partial PO (`PO-1 · 19/11/2026 · باقي 14 علبة`). Choosing a PO populates the remaining lines.
2. **Per-Line Card in PO-Receive Mode (`.rcv-line`):**
   - Each card pre-fills with a remaining PO line (`code`, `name`, `qty = remaining`, `cost = poLine.cost`).
   - **PO Context Strip inside the card:**
     - Under `الكمية`: chip **`المطلوب: 10 · سبق استلامه: 4 · الباقي: 6`**
     - Under `سعر العلبة`: `<small class="hint-small">سعر الطلبية: 48.50 ج.م</small>` (or `آخر سعر: 48.50 ج.م` from past receipts/lots when not linked to a PO, matching `04-invoice-form.html:87`).
   - **Skipping an item that did not arrive in this delivery (`لم يصل في هذه الفاتورة`):**
     - Each PO-linked line card has a toggle button **`لم يصل اليوم (0)`** (or setting `الكمية` to `0`).
     - When `qty === 0` on a PO-linked line:
       - The card collapses into a muted 1-line bar: **`كونكور 5 مجم — لم يصل في هذه الفاتورة (يبقى 6 علبة معلّقة في الطلبية)`** with a **`+ وصل منه`** button to restore it.
       - Expiry (`MM/YY`) is **not** required for `qty === 0` skipped lines, and they are excluded from `grn.lines` on submit (so `po.lines[i].received` adds `0`, keeping the full remaining quantity open on the PO).
       - At least **one** line in the invoice must have `qty >= 1` and a valid `MM/YY` expiry to enable `تأكيد الاستلام وإضافة للمخزون`.
   - **Splitting a line across multiple batches (`+ تشغيلة تانية لنفس الصنف`):**
     - A link button inside the card duplicates the item row with the remaining balance so the pharmacist can enter two batch numbers and two expiry dates for the same PO item.
3. **Live Discrepancy Banner & Review Summary (`#rcvReview`):**
   - Responsive card/list on mobile (`390x844`) and table on desktop (`>780px`), computed by `NovaReceiptOperations.review(po, activeLines)`:
     - **Shortage (`remaining > 0`):** Amber badge `باقي X علبة ستظل مفتوحة في الطلبية PO-1`.
     - **Over-receipt (`excess > 0`):** Warn badge `زيادة +X علبة عن المطلوب`.
     - **Unordered item (`unordered === true`):** Warn badge `صنف خارج الطلبية الأصلية`.
     - **Price difference (`costChanged === true`):** Warn badge `سعر الفاتورة (52.00 ج.م) يختلف عن سعر الطلبية (48.50 ج.م)`.

#### Screen 4: `سجل الفواتير` Tab (`after/05-ledger.png`)
1. Filter chips: **`الكل`** | **`مسودات · N`** | **`فيها فرق · M`**.
2. Invoices with `discrepancy.hasDiff === true` display the amber status pill from `discrepancy.labelAr`:
   - `فرق: 2 ناقص` (when `shortBoxes === 2`)
   - `فرق: +3 زيادة` (when `excessBoxes === 3`)
   - `فرق: تغير السعر` (when `costDiffLines > 0`)
   - `فرق: صنف إضافي` (when `unorderedLines > 0`)
3. Tapping an invoice card opens the detail sheet showing the `poSnapshot` / `reviewTable` comparison (`المطلوب | الواصل | الفرق | السعر`) and links to `الطلبية الأصلية (PO-1)`.

---

## Part (B) — GS1 DataMatrix Camera Scan & Hardware Scanner Fallback

### B.1 GS1 DataMatrix Specification & Egyptian / Saudi Pack Realities

Pharmaceutical packs in Saudi Arabia (SFDA RSD / DTTS track-and-trace) and Egypt (EDA GS1 track-and-trace rollout) carry a 2D **GS1 DataMatrix** (ECC 200) symbol encoding four standard Application Identifiers (AIs):

| AI | Name | Format | Length | Fixed / Variable | Notes |
|---|---|---|---|---|---|
| **`01`** | **GTIN** | `N2 + N14` | 14 digits | **Fixed** (no FNC1/GS after it) | Often starts with `0` + 13-digit EAN-13 (e.g. `06281001234567` in KSA `628`, or `06221000002001` in Egypt `622`). Check digit is Modulo-10. |
| **`17`** | **Expiry Date** | `N2 + N6` (`YYMMDD`) | 6 digits | **Fixed** (no FNC1/GS after it) | `YY` = `2000 + YY`. **`DD = 00` rule:** GS1 allows day `00` (`261100`), which means the **last day of month `MM`** (`2026-11-30`). Some packs specify an exact day (`261115` → `2026-11-15`). |
| **`10`** | **Batch / Lot Number** | `N2 + X..20` | 1–20 chars | **Variable** (terminated by `<GS>` or end-of-string) | ASCII printable characters (`A-Z`, `0-9`, `-`, `/`, `.`). Must terminate at ASCII `0x1D` (`\u001d`) if another AI follows. |
| **`21`** | **Serial Number** | `N2 + X..20` | 1–20 chars | **Variable** (terminated by `<GS>` or end-of-string) | Unique pack serial number for SFDA/EDA aggregation. Terminates at `\u001d` if another AI (such as `10` or `17`) follows. |
| **`11` / `30` / `240` / `710..714`** | Prod Date / Count / National HRN | Various | Various | `11` is fixed (6 digits); others variable | Occasionally present on imported European/Gulf packs (`11` = YYMMDD production date; skip without corrupting `10`/`17`/`01`). |

#### Real-World Egyptian & Saudi Pack Realities That the Parser Must Handle

1. **Variable AI Ordering:**
   - While `(01)...(17)...(10)...<GS>(21)...` is common, many manufacturers print `(01)...(21)...<GS>(17)...(10)...` or `(01)...(10)...<GS>(17)...(21)...`. Because `10` and `21` are variable-length, any AI following `10` or `21` is preceded by a Group Separator.
2. **Symbology Identifier Prefixes & Separator Variants:**
   - Camera decoders and USB/Bluetooth scanners emit different prefixes and separators:
     - ISO/IEC 15424 symbology prefix: `]d2` (GS1 DataMatrix), `]C1` (GS1-128), `]e0` (GS1 DataBar), or leading `FNC1` (`\u001d` / `\u00e8`).
     - Group Separator (`<GS>`) variants: ASCII `0x1D` (`\u001d`), literal ``, `[FNC1]`, `<GS>`, `|`, or space when a keyboard-wedge scanner translates `0x1D`.
     - Human-readable HRI / parenthesized strings (copied or emitted by some scanners): `(01)06281001234567(17)281100(10)BATCH12(21)SN998877`.
3. **Arabic Keyboard Layout Corruption on USB/Bluetooth Keyboard-Wedge Scanners:**
   - **Critical Pharmacy Reality in Egypt/KSA:** When the Windows/Android/iPad OS keyboard language is currently set to **Arabic** while a USB or Bluetooth HID barcode scanner "types" keystrokes rapidly:
     - Digits may arrive as Arabic-Indic (`٠١٢٣٤٥٦٧٨٩`), or
     - Latin letters in batch/serial numbers (`BATCH10`) are mapped to the corresponding physical Arabic keys on a standard Arabic QWERTY keyboard (e.g., `b` → `لا`, `a` → `ش`, `t` → `ف`, `c` → `ؤ`, `h` → `أ`), and `/` or `-` can shift.
     - Furthermore, some HID scanners swallow `0x1D` (`<GS>`) in browser `<input>` elements because `<input type="text">` strips control characters below `0x20`!
   - **Mitigation in Our Design:**
     - Normalize Arabic-Indic (`٠-٩`) and Eastern (`۰-۹`) digits to ASCII `0-9`.
     - Intercept hardware scanner bursts at the `keydown` level (`window.addEventListener('keydown', ...)` when inter-keystroke delta `< 35ms`): read `KeyboardEvent.code` (`KeyA` → `'A'`, `Digit1` → `'1'`, `Minus` → `'-'`) and detect `event.keyCode === 29` / `ctrlKey + ]` (`0x1D` `<GS>`) **before** the browser `<input>` strips `0x1D` or translates `KeyB` to `'لا'`!
4. **Egyptian Local 1D Barcodes vs GS1-14:**
   - Many Egyptian local packs still use 1D **EAN-13** (`622...`), **EAN-8**, or internal 4–7 digit pharmacy codes (`code: '2001'` in `purchases-core.js:351`) without a 2D DataMatrix.
   - The same scan flow (`امسح باركود العلبة` or hardware wedge) must seamlessly accept both **2D GS1 DataMatrix** (filling Product + Batch + Expiry) and **1D EAN-13 / EAN-8 / Code-128** (filling Product and moving focus to Quantity/Expiry).

### B.2 Camera Decoding Options Comparison

| Criteria | Option 1: Native `BarcodeDetector` API Only | Option 2: Native `BarcodeDetector` + Self-Hosted `zxing-wasm` (Reader-Only) Fallback | Option 3: Pure-JS `@zxing/library` | Option 4: `html5-qrcode` |
|---|---|---|---|---|
| **License** | Web Standard (W3C) | **MIT** (`zxing-wasm` / `zxing-cpp`) | **Apache-2.0** | **Apache-2.0** |
| **Bundle Size** | **0 KB** | **~8 KB** JS wrapper + **~380 KB** `.wasm` (lazy-loaded **only** on camera button click when native fails) | ~135 KB min+gzip JS | ~160 KB min+gzip JS (wraps old `@zxing/library`) |
| **DataMatrix Reliability on Tiny Curved Blister/Carton Packs** | High (where OS provides it) | **Very High** (`zxing-cpp` C++ engine handles low-contrast, inverted, and damaged ECC 200 DataMatrix at 15–30 fps) | **Low–Medium** (JS port struggles with dense 26×26 pharmaceutical DataMatrix and tilted packs) | **Low–Medium** (same underlying JS ZXing port) |
| **iOS / iPadOS Safari & PWA Support** | **Partial / Unreliable** (missing or disabled in many iOS Safari & Homescreen PWA builds) | **100% Supported** (WebAssembly + `getUserMedia` works in iOS Safari & standalone PWA since iOS 14.3+) | Works in Safari, poor DataMatrix decode rate | Works in Safari, poor DataMatrix decode rate |
| **Android Chrome Support** | **Yes** (via Play Services) | **Yes** (uses native `BarcodeDetector` first; falls back to WASM on Huawei/AOSP devices without Play Services) | Yes | Yes |
| **Desktop Chrome / Edge (Linux/Windows)** | **No** (`data_matrix` unsupported on desktop Linux/Windows Chromium) | **100% Supported** via WASM fallback | Supported | Supported |
| **Offline / PWA (`sw.js`)** | 100% Offline (OS-level) | **100% Offline** when `/vendor/zxing-reader.wasm` is served from same-origin Worker static assets & cached in `sw.js` (`NEVER` loaded from a third-party CDN at runtime) | 100% Offline | 100% Offline |

> **Recommendation for Owner Approval:** **Option 2 (Native `BarcodeDetector` first + lazy-loaded self-hosted `zxing-wasm` reader-only fallback)**, or **Option 1** if Ahmed prefers zero new binary assets in the Worker bundle. In both cases, our pure-JS GS1 AI parser (`gs1-parser.js`, ~3 KB, zero dependencies) and the `keydown` USB/Bluetooth keyboard-wedge interceptor work identically.

### B.3 GS1 Parser Design (`gs1-parser.js`)

A pure, zero-dependency UMD/ESM module (`/gs1-parser.js`, exposed as `window.NovaGS1` and `module.exports` for Node unit tests):

1. **`parseGS1(rawInput, options = { now: new Date() })`:**
   - Strips leading symbology identifiers (`]d2`, `]C1`, `]e0`, `]Q3`) and leading `<GS>` (`\u001d`).
   - Normalizes Arabic-Indic digits (`٠-٩`, `۰-۹`) to ASCII `0-9`.
   - If the input uses parenthesized HRI format (`(01)06281001234567(17)261100(10)LOT1...`), parses bracketed AIs directly.
   - Otherwise walks the unbracketed GS1 element string left-to-right:
     - **`01` (Fixed 14 digits):** Extracts `gtin14`, validates Modulo-10 check digit (`validGtinCheckDigit(gtin14)`), and derives `gtin13` (if `gtin14.startsWith('0')`, `gtin14.slice(1)`), `gtin12`, and `gtin8`.
     - **`17` (Fixed 6 digits `YYMMDD`):**
       - `year = 2000 + Number(YY)`, `month = Number(MM)`, `day = Number(DD)`.
       - Validates `month >= 1 && month <= 12`.
       - If `day === 0`, computes last day of month (`new Date(Date.UTC(year, month, 0)).getUTCDate()`).
       - Else validates `day` against the actual calendar days in `(year, month)` (including leap-year February 29).
       - Produces `expiryIso` (`'YYYY-MM-DD'`), `expiryMmYy` (`'MM/YY'` for the PUR-01 input field), and `isExpired` (compared against `options.now`).
     - **`10` (Variable up to 20 chars):** Reads until `\u001d` (`<GS>`) or end-of-string.
       - *Heuristic safeguard for keyboard-wedge scanners that stripped `0x1D`:** Only when an optional flag `allowSeparatorlessHeuristic: true` is passed (or when `(17)YYMMDD` with valid month/day + `(01)14-digit-valid-check-digit` is unambiguously embedded at the tail), splits without false-positives; otherwise requires `<GS>` or ends at string boundary.
     - **`21` (Variable up to 20 chars):** Reads until `\u001d` (`<GS>`) or end-of-string.
     - **Other Fixed AIs (`11`, `12`, `13`, `15`, `16` = 6 digits; `02` = 14 digits; `20` = 2 digits):** Skips their exact fixed length so a subsequent `(17)` or `(10)` is still parsed cleanly.
     - **Plain 1D Barcode Fallback:** If the string is 8, 12, 13, or 14 digits (or an internal alphanumeric SKU) without GS1 AIs, returns `{ kind: '1d', raw, gtin14: pad14(raw), barcodeCandidates: [raw, strippedLeadingZero, padded14] }`.

### B.4 Mapping GTIN to Catalog (`index.html` & `purchases-core.js`)

In NOVA Rx, product records use:
- `p.barcode` (13-digit EAN-13 in `DEMO_PRODUCTS`, e.g. `'6281001234567'` at `index.html:3026`, or internal code in `emergency/stock.json`)
- `p.gtin` (13-digit or 14-digit in `purchases-core.js:351`, `emergency-core.js:76`)
- `p.barcodes` (optional array of alternate barcodes at `index.html:3258`)
- `p.code` / `p.id`

When `NovaGS1.parseGS1(raw)` returns `gtin14` (e.g. `'06281001234567'`), our catalog resolver `NovaGS1.resolveProduct(parsed, catalog, aliasStore)` checks in strict priority order:
1. Exact match on `gtin14` (`'06281001234567'`) against `p.barcode`, `p.gtin`, `p.barcodes[]`, `p.code`.
2. If `gtin14.startsWith('0')`, exact match on `gtin13 = gtin14.slice(1)` (`'6281001234567'`) — **matches all 13-digit Egyptian (`622`) and Saudi (`628`) EAN-13 barcodes in `DEMO_PRODUCTS` and `stock.json`**.
3. Leading-zero stripped match (`gtin14.replace(/^0+/, '')`).
4. Local user-saved barcode alias table (`localStorage['nova-rx-barcode-aliases-v1']`, `{ [gtin14]: productKey }`) if the pharmacist previously linked a new manufacturer pack GTIN to an existing catalog item.
5. If still unmatched: keeps the parsed `lot` (`التشغيلة`) and `expiryMmYy` (`الصلاحية`) pre-filled in a target line card, focuses the `الصنف` search box (`[data-f="q"]`), and displays a warn toast/message: **`تم قراءة التشغيلة والصلاحية · اختَر الصنف لربط الباركود (06281001234567)`**.

### B.5 UI Flow in `#rcvForm` (`04-invoice-form.html:68`)

1. **Trigger Button in `#rcvForm`:**
   - Dashed full-width button above the items list (`04-invoice-form.html:68`):
     **`▦ امسح باركود العلبة — يملأ الصنف والتشغيلة والصلاحية`** (`#rcvScanBtn`)
2. **Camera Scanner Sheet (`#rcvScanModal`):**
   - Clicking `#rcvScanBtn` opens a compact camera overlay at the top of the dialog:
     - Live `<video playsinline muted>` viewfinder with a central DataMatrix/Barcode target frame.
     - Torch/flash toggle (`🔦 إضاءة`) when `track.getCapabilities().torch` is supported.
     - Camera switch (`تبديل الكاميرا`) defaulting to `facingMode: { ideal: 'environment' }`.
     - Manual / paste input fallback (`أو الصق / امسح بالقارئ الخارجي هنا`) so hardware scanners or test fixtures work even without a camera.
     - Close button (`إغلاق الكاميرا ×`).
3. **Auto-Fill & Increment Rules on Scan:**
   - When a GS1 DataMatrix or 1D barcode is decoded (via camera or USB/Bluetooth keyboard wedge while `#rcvForm` is open):
     - **Case 1 — Same Product + Same Batch (`lot`) + Same Expiry (`exp`) already exists in `#rcvLines`:**
       - If the scan includes a **Serial (`AI 21`)** that was **already scanned in this invoice** (`st.scannedSerials.has(gtin14 + ':' + serial)`):
         - Reject duplicate pack scan with a warning toast/beep: **`تم مسح هذه العلبة بالفعل (سيريال: SN...)`** (prevents double-counting the same physical box if held in front of the camera!).
       - Otherwise, increment `qty` by `+1` on that existing card (or focus `qty` if the pharmacist prefers entering box count directly), flash a green highlight on the card, and show toast: **`+1 كونكور 5 مجم · تشغيلة BATCH12 · صلاحية 11/28`**.
     - **Case 2 — Empty first card or new Product / new Batch:**
       - Populate the first empty `.rcv-line` card (or append a new card via `addLine()`):
         - `الصنف`: matched product name (`data-ok="1"`)
         - `التشغيلة`: `parsed.batch` (from AI `10`)
         - `الصلاحية`: `parsed.expiryMmYy` (`MM/YY`, from AI `17`)
         - `الكمية`: if linked to a PO and this is the first scan of that PO line, keep the PO's remaining quantity (or set to `1` for unlinked invoices) and focus `الكمية` (`[data-f="qty"]`) with its text selected so the pharmacist can immediately type `10` if receiving 10 boxes of the same batch.
     - **Case 3 — Expired Pack (`parsed.isExpired === true`):**
       - Still fills the card so the pharmacist sees what was scanned, immediately highlights `[data-err]` in red (`الصلاحية منتهية (الشهر ده عدّى)`), keeps `تأكيد الاستلام` disabled, and sounds/shows a warning alert.

### B.6 Privacy & Security Guarantees

1. **100% On-Device Video Processing:**
   - Camera frames from `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })` are processed strictly in local memory (`BarcodeDetector.detect(video)` or local WebAssembly `ImageData` buffer).
   - **Zero network transmission:** No frame, image, or barcode string is ever uploaded to any external API, cloud service, or backend route.
2. **Immediate Camera Teardown:**
   - Closing `#rcvScanModal`, confirming/closing `#rcvForm`, pressing `Escape`, or `document.visibilitychange` (`document.hidden === true`) immediately calls `stream.getTracks().forEach(t => t.stop())` and releases the camera indicator light.
3. **Permission Denial Graceful Fallback:**
   - If camera permission is denied (`NotAllowedError` / `NotFoundError`), `#rcvScanModal` does not crash: it shows **`الكاميرا غير متاحة أو لم يتم السماح بها — يمكنك المسح بقارئ الباركود USB/بلوتوث مباشرة أو كتابة الكود`** and focuses the hardware-scanner input.

---

## Part (C) — Verification, Test Plan & GS1 Fixture Strings

### C.1 Unit Tests (`tests/unit/gs1-parser.check.mjs` & `tests/unit/po-partial-receive.check.mjs`)

#### Mandatory GS1 Test Fixtures (`tests/unit/gs1-parser.check.mjs`)

| # | Fixture Scenario | Raw Input String | Expected Parsed Output |
|---|---|---|---|
| **F1** | **Standard Saudi SFDA pack** (`01` + `17` + `10` `<GS>` + `21`) | `01062810012345671728113010BATCH12A\u001d21SN99887766` | `gtin14: '06281001234567'`, `gtin13: '6281001234567'`, `expiryIso: '2028-11-30'`, `expiryMmYy: '11/28'`, `batch: 'BATCH12A'`, `serial: 'SN99887766'`, `validCheckDigit: true` |
| **F2** | **Egyptian EDA pack with `DD = 00` (last day of month) & `]d2` prefix** | `]d201062210000020011727020010EG-LOT-09\u001d21100200300` | `gtin14: '06221000002001'`, `gtin13: '6221000002001'`, `expiryIso: '2027-02-28'`, `expiryMmYy: '02/27'`, `batch: 'EG-LOT-09'`, `serial: '100200300'` |
| **F3** | **Leap year February `DD = 00` (`280200`)** | `01062810012345681728020010LEAP28` | `expiryIso: '2028-02-29'`, `expiryMmYy: '02/28'`, `batch: 'LEAP28'` |
| **F4** | **Variable AI first (`01` + `21` `<GS>` + `10` `<GS>` + `17`)** | `010628100123456921SER-001\u001d10LOT-77\u001d17290615` | `gtin13: '6281001234569'`, `serial: 'SER-001'`, `batch: 'LOT-77'`, `expiryIso: '2029-06-15'`, `expiryMmYy: '06/29'` |
| **F5** | **HRI parenthesized format** | `(01)06281001234570(17)301200(10)GLUC-500(21)ABC12345` | `gtin13: '6281001234570'`, `expiryIso: '2030-12-31'`, `expiryMmYy: '12/30'`, `batch: 'GLUC-500'`, `serial: 'ABC12345'` |
| **F6** | **Pack with Production Date AI `11` before `17`** | `0106281001234571112501011728010110LIP20` | Skips `11` (`250101`), extracts `expiryIso: '2028-01-01'`, `batch: 'LIP20'` |
| **F7** | **Arabic-Indic digits & Arabic keyboard-wedge keymap** | `٠١٠٦٢٨١٠٠١٢٣٤٥٦٧١٧٢٨١١٠٠١٠LOT55` | Normalizes digits → `gtin13: '6281001234567'`, `expiryMmYy: '11/28'`, `batch: 'LOT55'` |
| **F8** | **Expired pack (`17` = `240500` when `now` = `2026-11-19`)** | `01062810012345671724050010OLDLOT` | `expiryIso: '2024-05-31'`, `expiryMmYy: '05/24'`, `isExpired: true` |
| **F9** | **Invalid GTIN Modulo-10 check digit or invalid month `17281300`** | `01062810012345601728130010BAD` | Flags `validCheckDigit: false` and `expiryError: 'invalid-month'` |
| **F10** | **1D EAN-13 fallback** | `6281001234567` | `kind: '1d'`, resolves `PRD001` (`كونكور 5 مجم`), `batch: ''`, `expiryMmYy: ''` |

#### PO Partial Receipt Unit Tests (`tests/unit/po-partial-receive.check.mjs`)
1. **Partial Delivery 1 of 2:** PO created with 2 items (`A × 10 @ 25 ج.م`, `B × 8 @ 30 ج.م`). First receipt delivers `A × 6 @ 25 ج.م` and skips `B` (`qty = 0`).
   - Assert PO state is `'partial'`, `A.received === 6` (remaining `4`), `B.received === 0` (remaining `8`).
   - Assert receipt saved in `nova-rx-receipts-v1` has `discrepancy.hasDiff === true`, `discrepancy.shortBoxes === 12`, `discrepancy.labelAr === 'فرق: 12 ناقص'`.
2. **Partial Delivery 2 of 2 (Completing the PO):** Second receipt delivers `A × 4` (split across 2 batches: `LOT1 × 2` and `LOT2 × 2`) and `B × 8`.
   - Assert PO state transitions to `'received'`, `A.received === 10`, `B.received === 8`, ledger `onHand('A') === 10`, `onHand('B') === 8`.
3. **Discrepancy Flags (Over-receipt, Unordered item, Cost change):**
   - Receipt with `A × 12` (ordered 10) flags `excessBoxes: 2` (`فرق: +2 زيادة`).
   - Receipt with `A × 10 @ 28 ج.م` (ordered @ 25 ج.م) flags `costDiffLines: 1` (`فرق: تغير السعر`).
4. **Backward Compatibility Migration Check:**
   - Old receipts from `nova-rx-receipts-v1` without `discrepancy` or `poSnapshot` load without error and render valid status chips in `سجل الفواتير`.

### C.2 Browser / Playwright Tests (`390x844` & `1280x800`, Non-GET Blocked)

- `tests/ux/receiving-po-partial.mjs`:
  - At `390x844` (mobile RTL) and `1280x800`, seed a local PO, open `استلام`, verify `طلبات معلّقة` count and open PO card, tap `استلم`, mark one line `لم يصل اليوم (0)` and partial-receive the other, verify `#rcvReview` and confirm, assert PO stays in `طلبات معلّقة` as `وصل جزء` with updated progress bar, and verify `سجل الفواتير` shows `فرق: X ناقص` under the `فيها فرق` filter.
- `tests/ux/receiving-gs1-scan.mjs`:
  - At `390x844`, inject a mock `window.BarcodeDetector` (and test keyboard-wedge burst `keydown` dispatch with `\u001d` separators), click `امسح باركود العلبة`, emit Fixture F1 (`01062810012345671728113010BATCH12A\x1d21SN99887766`), assert `كونكور 5 مجم`, `11/28`, and `BATCH12A` populate automatically, verify duplicate serial `SN99887766` is rejected on re-scan while a new serial `SN99887767` increments `الكمية` to `2`.

---

## Part (D) — Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **iOS Safari / PWA lacks native `BarcodeDetector('data_matrix')`** | Camera button wouldn't decode 2D packs on iPhones if relying solely on native API. | Feature-detect `BarcodeDetector.getSupportedFormats()` for `'data_matrix'`; lazy-load self-hosted WASM reader (if approved by Ahmed) and always provide hardware keyboard-wedge + manual input in the same sheet. |
| **USB/Bluetooth scanner in Arabic OS keyboard layout mangles batch letters and strips `<GS>` (`0x1D`)** | Batch `LOT1` becomes `مخف1` and variable-length AI `10` eats AI `17` if `<GS>` is lost by `<input>`. | Global capture-phase `keydown` listener detects rapid scanner bursts (`<35ms`/char), maps `KeyboardEvent.code` (`KeyA..KeyZ`, `Digit0..Digit9`) independent of OS language layout, and captures control key `0x1D` (`GS`) before the browser `<input>` drops it. |
| **Same pack scanned twice while held in front of camera** | Accidental double quantity (`qty` jumps from 1 to 5 in one second). | Track `(gtin14 + ':' + serial)` in the active dialog session (`st.scannedSerials`) to block duplicate serial scans, plus a 1200ms cooldown debounce for identical unserialized codes. |
| **Crash or storage quota error mid-receive between `nova.purchase.orders`, `nova-rx-lots-v1`, and `nova-rx-receipts-v1`** | PO `received` count could drift from stock lots. | Continue using `st.pending = true` + `novaStock.hasReceiptLine(receipt.id + '/' + index)` idempotent replay markers (`index.html:11966-11999`) and `NovaReceiptOperations` lock (`navigator.locks.request('nova-rx-stock')`). |
| **`backend/src/sync.js` rejecting `'closed-short'` PO snapshots when backend sync flag is enabled** | A PO whose remainder was cancelled locally would return `SYNC_PO_INVALID` on push. | Add `'closed-short'` to `validStates` in `backend/src/sync.js:386` and map it in `statusMap` (`sync.js:404`) in PR-2. |

---

## Part (E) — Task Split into Small PRs with Estimates

To keep each PR focused, independently reviewable, and within the 3-PR limit, the implementation is split into **4 small sequential PRs** (only after Ahmed's approval):

| PR | ID & Title | Scoped Files | Tests & Evidence | Estimate |
|---|---|---|---|---|
| **PR 1** | **`[PUR-GS1-1]` Pure GS1 DataMatrix / 1D parser + catalog GTIN resolver** | `gs1-parser.js` (new), `tests/unit/gs1-parser.check.mjs` (new), `.github/workflows/purchasing-checks.yml` (or run inside existing unit step) | Node unit test covering Fixtures F1–F10 (Saudi SFDA, Egyptian EDA, `DD=00`, leap year, variable AI order, HRI parentheses, Arabic digits, check-digit validation, 14→13 digit catalog resolution). Zero UI/artifact changes. | **~1.5 hrs** (15–20 turns) |
| **PR 2** | **`[PUR-PO-1]` PO partial-receive data model, skipped lines (`qty=0`), discrepancy summary & backend `'closed-short'` sync compatibility** | `receipt-operations.js`, `purchase-orders.js`, `po-sync-wire.js`, `backend/src/sync.js`, `tests/unit/po-partial-receive.check.mjs` (new), `tests/unit/receipt-operations.check.cjs` | Unit tests for `describeDiscrepancy()`, multi-batch PO line aggregation, `qty=0` skipped PO lines, backward-compatible loading of old `nova-rx-receipts-v1` records, and backend `sync.js` acceptance of `'closed-short'`. | **~2 hrs** (25–30 turns) |
| **PR 3** | **`[PUR-PO-2]` PO partial-receive UI in `طلب` / `استلام` / `#rcvForm` / `سجل الفواتير`** | `index.html`, `purchases.html`, `purchases.js`, `worker/live/nova-rx-preview.<tag>.js`, `tests/unit/artifact-<tag>.check.mjs`, `tests/ux/receiving-po-partial.mjs` (new) | Playwright `390x844` + `1280x800` screenshots in `qa/screens/PUR-PO-2/`: creating local PO from shortage draft, linking PO in `#rcvForm`, per-card PO context (`المطلوب / الباقي / سعر الطلبية`), `لم يصل اليوم (0)` toggle, `+ تشغيلة تانية`, and `فرق: X ناقص` chip in `سجل الفواتير`. | **~3 hrs** (35–45 turns) |
| **PR 4** | **`[PUR-GS1-2]` Camera scanner modal + keyboard-wedge GS1 hook in `#rcvForm`** | `index.html` (and optional `/vendor/zxing-reader.wasm` if Option 2 approved), `worker/live/nova-rx-preview.<tag>.js`, `tests/unit/artifact-<tag>.check.mjs`, `tests/ux/receiving-gs1-scan.mjs` (new) | Playwright `390x844` test + screenshots in `qa/screens/PUR-GS1-2/`: `امسح باركود العلبة` modal, mocked camera `BarcodeDetector` + hardware keyboard-wedge burst scan, auto-fill item + batch + `MM/YY` expiry, duplicate serial (`AI 21`) protection, and unknown-GTIN alias binding. | **~2.5 hrs** (30–40 turns) |
