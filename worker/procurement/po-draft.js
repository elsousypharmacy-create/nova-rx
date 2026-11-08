// Purchase order draft builder (Epic #53, task 07, drafts only).
// Supplier-agnostic: no supplier ids are hard-coded anywhere in this module.
// Dependency-free ES module; runs in Cloudflare Workers and Node 22.

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function pickUnmatchedReason(comparison) {
  const rows = comparison?.offers ?? [];
  if (rows.length === 0) return 'no-match';
  if (rows.every((r) => r.reasons?.includes('out_of_stock'))) return 'all-out-of-stock';
  if (rows.every((r) => r.reasons?.includes('stale'))) return 'all-stale';
  return 'needs-review';
}

function makeLine(name, qty, row) {
  const offer = row.offer ?? {};
  const packPrice = row.packPrice ?? offer.netEffectivePrice ?? offer.unitPrice ?? null;
  return {
    name,
    supplierProductId: offer.supplierProductId ?? null,
    productName: offer.productName ?? name,
    qty,
    packPrice,
    lineTotal: packPrice === null ? null : round2(packPrice * qty),
  };
}

function allocationsFor(qty, eligibleRows) {
  const bestRow = eligibleRows[0];
  if (bestRow.offer?.stockStatus !== 'low' || qty <= 1) {
    return [{ row: bestRow, qty }];
  }
  const first = Math.ceil(qty / 2);
  const rest = qty - first;
  const nextRow = eligibleRows.find((r) => r.offer?.supplierId !== bestRow.offer?.supplierId);
  if (!nextRow || rest <= 0) return [{ row: bestRow, qty }];
  return [
    { row: bestRow, qty: first },
    { row: nextRow, qty: rest },
  ];
}

export function buildDrafts(shortages, comparisons, opts = {}) {
  const { now = Date.now() } = opts;
  const bySupplier = new Map();
  const unmatched = [];

  (shortages ?? []).forEach((shortage, i) => {
    const { name, qty } = shortage ?? {};
    const comparison = comparisons?.[i];
    const eligible = (comparison?.offers ?? []).filter((r) => r.eligible);
    if (eligible.length === 0) {
      unmatched.push({ name, qty, reason: pickUnmatchedReason(comparison) });
      return;
    }
    for (const { row, qty: partQty } of allocationsFor(qty, eligible)) {
      const supplierId = row.offer?.supplierId ?? 'unknown';
      if (!bySupplier.has(supplierId)) {
        bySupplier.set(supplierId, {
          id: `${supplierId}-${now}`,
          supplierId,
          status: 'draft',
          lines: [],
          total: 0,
        });
      }
      bySupplier.get(supplierId).lines.push(makeLine(name, partQty, row));
    }
  });

  const drafts = [...bySupplier.values()].map((d) => ({
    ...d,
    total: round2(d.lines.reduce((sum, l) => sum + (l.lineTotal ?? 0), 0)),
  }));

  return { createdAt: now, drafts, unmatched };
}

export function approveDraft(draft, { approvedBy, now = Date.now() } = {}) {
  if (typeof approvedBy !== 'string' || approvedBy.trim() === '') {
    throw new Error('approveDraft: approvedBy must be a non-empty string');
  }
  if (draft?.status !== 'draft') {
    throw new Error(`approveDraft: expected status "draft", got ${JSON.stringify(draft?.status)}`);
  }
  return { ...draft, status: 'approved', approvedBy, approvedAt: now };
}

export function draftToText(draft, { lang = 'ar' } = {}) {
  if (lang !== 'ar') {
    throw new Error(`draftToText: unsupported lang ${JSON.stringify(lang)} (only "ar")`);
  }
  const statusLabel = draft?.status === 'approved' ? 'معتمد' : 'مسودة';
  const lines = [
    `أمر شراء (${statusLabel}) — المورد: ${draft?.supplierId ?? ''}`,
    ...(draft?.lines ?? []).map(
      (l) => `${l.name} × ${l.qty} = ${l.lineTotal === null ? '—' : l.lineTotal.toFixed(2)} ج.م`
    ),
    `الإجمالي: ${(draft?.total ?? 0).toFixed(2)} جنيه مصري (EGP)`,
  ];
  return lines.join('\n');
}
