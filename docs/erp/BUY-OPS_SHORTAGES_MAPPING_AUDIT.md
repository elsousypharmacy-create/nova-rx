# Buy Ops Shortages Mapping Audit & Adapter Design

## 1. Data Contract (`pharmacy/orders.html`)
The shortages procurement adapter processes shortages payload extracted from `pharmacy/orders.html`. The data structure contains two core shortage arrays:
- `DATA.zero`: Zero-stock items requiring urgent procurement.
- `DATA.low`: Low-stock items approaching minimum safety thresholds.

### Field Mappings:
- `co`: Company / Manufacturer / Brand description.
- `n`: Item / Product name.
- `q`: Shortage quantity needed (parsed and normalized using `parsePositiveNumber`).
- `c` / `code`: Unique product code or barcode string.
- `s`: Supplier / Source identifier.
- `v`: Vendor price / value / volume parameter.
- `h`: Warehouse node / location code.
- `mk`: Saved manual mark / preparation flag (`true`/`false`).

## 2. Isolated Shortages Adapter Design (`worker/procurement/shortages-adapter.js`)
The isolated adapter handles normalization, filtering, and procurement draft cart building without side effects:
- **Sanitization & Secret Scrubbing**: All strings and objects are sanitized via `sanitizeShortageText` and scrubbed via `stripSecrets` to prevent credential/token leaks. Supports Eastern Arabic numerals (`٠-٩`) alongside standard Western digits.
- **Deduplication**: `normalizeOrdersPageShortages` merges duplicate items across `zero` and `low` lists by item code/key, summing required quantities.
- **Supplier & Warehouse Filtering**:
  - `auto` mode: Enforces selected supplier and restricts matching strictly to selected Omet warehouses (`selectedOmetWarehouses`).
  - `manual` mode: Respects item-level preparation flags (`it.mk`) while rejecting unselected warehouses.
- **Draft Cart Security & Owner Gate**:
  - Procurement draft carts are generated with state `draft-preview-only`.
  - Cryptographic draft signatures are computed via `computeDraftSignature`.
  - `verifyOwnerConfirmationGate` blocks external modifications to supplier carts without explicit owner confirmation (`ownerConfirmed: true`) and cryptographic signature match, transitioning status to `owner-confirmed-preview-ready`.

## 3. Prohibited Dependencies
- Pure JavaScript module: zero DOM/window coupling (`window`, `document`).
- Uses standard Node.js core modules (`node:crypto`, `node:assert`). No external HTTP or third-party packages allowed.
- No exposed credentials, secrets, or hardcoded API keys.

## 4. Test Results
- Unit test suite: `tests/unit/shortages-adapter.check.mjs`
- Test Status: **PASS**
