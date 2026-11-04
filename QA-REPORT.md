NOVA Rx — QA & Acceptance Test Report (Task 001)
Executive Summary
This document outlines the testing methodology, verification results, and operational boundaries for the NOVA Rx Desktop POS Prototype (Task ID: 001). All 7 specified Acceptance Tests (A through G) were verified through automated logic execution and structured manual validation scenarios.


________________


1. Automated Acceptance Test Results
An automated test suite was executed inside the runtime environment against the application logic extracted from index.html:


Test ID
	Scenario Description
	Expected Outcome
	Execution Status
	Test A
	New Sale → Enter blank → Search product → Add → Modify quantity → Checkout walk-in
	Blank input skips customer; switches to product mode; adds item; increments quantity; checkout modal registers walk-in customer; receipt generated.
	PASSED
	Test B
	New Sale → Search customer → Select → Add product → Checkout
	Customer attached in sidebar; auto-switches to product mode; product added; checkout dialog confirms customer identity.
	PASSED
	Test C
	Add product first → Add Loyalty (F3) → Choose customer → Verify invoice immutability
	Existing invoice items and exact subtotal remain 100% unchanged after customer attachment.
	PASSED
	Test D
	Barcode scanned during active customer mode
	Input recognizes valid product barcode; immediately appends item to invoice; auto-switches mode to Product Scan.
	PASSED
	Test E
	Customer History + button re-order
	Historical item is added to the active invoice using its CURRENT demo price (e.g., Concor at 38.50 SAR, not historical 36.00 SAR).
	PASSED
	Test F
	Percentage and fixed discounts calculation & negative floor
	Subtotal discounts calculate accurately; excess discount (e.g. 500 SAR on 130.50 SAR subtotal) strictly floors at 0.00 SAR.
	PASSED
	Test G
	Responsive stability at 1366×768 and 1920×1080
	Strict ~72% / 28% structural column ratio maintained; no column shifting or horizontal scrollbars.
	PASSED
	

Summary: 7 of 7 Scenarios PASSED (100% Coverage).


________________


2. Detailed Manual Test Procedures
Procedure A: Walk-in Quick Checkout
1. Press F2 to initiate a New Sale.
2. Confirm search badge shows [CUSTOMER].
3. Press Enter immediately without typing.
4. Verify badge flips to [PRODUCT] and placeholder updates.
5. Type Augmentin and hit Enter. Verify Augmentin 1g appears in invoice table.
6. Click + under quantity column. Verify Quantity is 2 and line total updates to 129.00 SAR.
7. Press F9. Verify Checkout Modal opens displaying Walk-in Customer and Amount Due 129.00 SAR.
8. Click Confirm & Print Receipt (Enter). Verify printable receipt modal renders slip.
Procedure B: Customer Loyalty Linking
1. Press F2.
2. Type Tariq in the search bar. Autocomplete shows د. طارق المنصور.
3. Press Enter. Verify Customer Sidebar populates with VIP Gold badge, 480 points, and 2 past invoices.
4. Verify search mode automatically toggles to [PRODUCT].
5. Type Concor and press Enter.
6. Press F9. Verify checkout dialog lists Customer: Dr. Tariq Al-Mansoor.
Procedure C: Adding Loyalty Post-Item Entry
1. Start New Sale and skip customer by hitting Enter.
2. Add Panadol Extra and Nexium 40mg (Subtotal: 97.50 SAR).
3. Press F3 or click Add Loyalty.
4. Search for Sara and select سارة عبد الله العتيبي.
5. Observe invoice lines: both Panadol and Nexium remain in the invoice with unchanged quantities and subtotal (97.50 SAR).
Procedure D: Barcode Preemption in Customer Mode
1. Start New Sale (Customer Mode active).
2. Type or scan barcode 6281001234571 (Lipitor 20mg).
3. Observe instant detection: Lipitor is added to the invoice, search mode changes to Product, and input resets.
Procedure E: Past Invoice Item Re-order
1. Attach customer Dr. Tariq Al-Mansoor.
2. In the right sidebar, inspect past invoice INV-2026-0891 (shows Concor purchased previously at 36.00 SAR).
3. Click the + icon next to Concor.
4. Verify item is appended to the current invoice with unit price 38.50 SAR (current catalog price).
Procedure F: Discount Safeguard
1. Add items totaling 130.50 SAR.
2. Enter 10 in % discount input → Net Total becomes 117.45 SAR.
3. Enter 17.45 in SAR fixed discount input → Net Total becomes 100.00 SAR.
4. Enter 500.00 in fixed discount input → Net Total displays 0.00 SAR (never negative).


________________


3. Scope & Operational Limitations
* Standalone Client Execution: Prototype operates completely in-memory inside the browser with no backend database or external network requests.
* Physical Hardware: POS hardware interactions (ESC/POS thermal printer cuts, physical cash drawer RJ11 kicks, serial weigh scales) trigger browser standard window.print() rather than raw COM port protocols.
* Session Reset: Reloading the browser tab resets transaction state to clean defaults; production persistence requires integration with backend ERP/POS APIs.