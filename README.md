NOVA Rx — Desktop POS Prototype (Task 001)
Overview
NOVA Rx is a high-density, keyboard-first desktop pharmacy Point of Sale (POS) prototype built for high-throughput pharmacy environments. It is delivered as a single, zero-dependency, self-contained index.html file with vanilla HTML5, CSS3, and modern ES6 JavaScript.
Core Architecture & Layout
* Strict 72% / 28% Structural Split:
   * Left (~72%): Main invoice workspace, unified search engine, line items grid, discount calculations, and payment controls.
   * Right (~28%): Persistent customer profile, loyalty status, active promotional offers, and searchable purchase history.
   * Column Invariance: Columns utilize locked flex bases (flex: 0 0 72% and flex: 0 0 28%) with internal scrolling. Columns never shift, resize, or reflow upon customer selection or item addition.
* Unified Single Search Input Workflow:
   * Initializes in Customer Search Mode on New Sale.
   * Pressing Enter on a blank customer search skips customer attachment and immediately toggles the same input into Product Search / Barcode Scan Mode.
   * Scanning/typing a valid product barcode (e.g. 6281001234567) while Customer Search is active immediately adds the product to the invoice and switches mode to Product Scan.
   * Customers can be added, changed, or detached at any time via Add Loyalty (F3) without mutating existing invoice lines or quantities.
* Customer Sidebar & Historical Re-ordering:
   * Empty state displays clear status: Walk-in Customer.
   * When attached, displays customer name, phone, visit count, tier badge, and loyalty points.
   * Active offers highlighted with subtle green accents.
   * Full past invoice history with itemized breakdown and date/branch info.
   * Add from History (+): Historical items are added to the current transaction at their current demo price, rather than their historical transaction price.
* Financial & Discount Calculations:
   * High-precision calculation supporting both percentage (%) and fixed (SAR) discounts.
   * VAT breakdown (15% inclusive standard).
   * Strict zero floor: under no circumstances does the Net Total drop below 0.00 SAR.
* Checkout & Receipt:
   * Complete checkout dialog with payment methods (Cash, Mada/Card, Split).
   * Cash received quick buttons and real-time change calculation.
   * Formatted printable receipt slip with transaction metadata.


________________


Keyboard Shortcuts Reference
Shortcut
	Context
	Action
	Enter
	Search Bar (Blank in Customer Mode)
	Skip customer attachment; switch to Product Scan Mode
	Enter
	Search Bar (With Query / Dropdown)
	Select focused suggestion / Add item to invoice
	Enter
	Barcode Scanner (Any Mode)
	Directly add scanned medicine to current invoice
	↑ / ↓
	Autocomplete Dropdown
	Navigate candidate suggestions
	Esc
	Dropdowns / Modals / Inputs
	Close open dialogs or dismiss suggestions
	F2
	Global
	New Sale: Reset invoice, reset customer, focus search
	F3
	Global
	Add Loyalty: Switch search to customer mode preserving invoice
	F4
	Global
	Clear Invoice: Empty current line items
	F9
	Global
	Checkout / Pay: Trigger payment dialog / Confirm sale
	?
	Global
	Open Keyboard Shortcuts & Help Manual modal
	

________________


Demo Dataset
* Medicines Catalog: 12 diverse pharmaceutical products across Chronic, Antibiotics, Analgesics, ENT, GI, and Vitamins with bilingual Arabic/English names, generic compounds, barcodes, and current SAR pricing.
* Customer Database: 4 detailed patient profiles with phone numbers, loyalty tiers (VIP Gold, Silver, Bronze), visit frequencies, active promotional benefits, and complete historical invoice logs.