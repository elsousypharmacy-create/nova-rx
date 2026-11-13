// UX-04 reference load fixture generator (deterministic, local only, no network, no backend).
// Reference profile: up to 10 branches x 3 cashiers, 100k items, 1m movements.
const AR = ['بانادول', 'أسبرين', 'جافيسكون', 'زيرتك', 'كريمة', 'مقوي', 'شراب', 'صابون', 'فيتامين', 'مضاد'];
const EN = ['PANADOL', 'ASPIRIN', 'GAVISCON', 'ZYRTEC', 'CREAM', 'TONIC', 'SYRUP', 'SOAP', 'VITAMIN', 'ANTIBIOTIC'];
export function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

export function generateFixture({ branches = 10, cashiers = 3, items = 100000, movements = 1000000, seed = 81 } = {}) {
  if (branches > 10 || cashiers > 3) throw new Error('reference profile caps at 10 branches x 3 cashiers');
  const r = rng(seed), products = new Array(items);
  for (let i = 0; i < items; i++) {
    const k = i % AR.length, mg = 50 * (1 + (i % 20));
    products[i] = { id: 'P' + i, nameAr: AR[k] + ' ' + mg + ' مجم ' + i, nameEn: EN[k] + ' ' + mg + 'MG ' + i, barcode: String(6221000000000 + i), packSize: 10 + (i % 5) * 6 };
  }
  const kinds = ['sale', 'sale', 'sale', 'receive', 'return', 'adjustment'], mv = new Array(movements);
  for (let i = 0; i < movements; i++) {
    const kind = kinds[(r() * kinds.length) | 0], q = 1 + ((r() * 5) | 0);
    const b = (r() * branches) | 0, c = (r() * cashiers) | 0;
    mv[i] = { seq: i + 1, kind, code: 'P' + ((r() * items) | 0), qty: q, delta: kind === 'sale' ? -q : kind === 'adjustment' ? (r() < 0.5 ? -q : q) : q, branch: 'B' + b, cashier: 'B' + b + '-C' + c, ref: 'R' + i };
  }
  return { branches, cashiers, products, movements: mv };
}
