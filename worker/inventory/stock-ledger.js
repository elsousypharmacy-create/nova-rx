// INV-01 stock ledger core (+ FEFO and expiry rules from INV-02). Pure and in memory: no I/O, no storage choice, not wired.
// Rules: every change is an append-only, frozen movement; balances are always DERIVED from movements (there is no setter);
// a sale takes the earliest expiry first, never uses expired stock, and is all-or-nothing; a return can never exceed what the
// invoice sold from that lot; an adjustment needs a reason and a different approver and can never push a lot below zero;
// the same idempotency key with the same payload replays the first result, with a different payload it is refused.
// Quantities are whole base units (CAT-02), money is integer cents. Real concurrency needs the storage decision (FND-02).

const MAX_QTY = 1e9;
const MAX_COST = 1e12;
const ID = /^[A-Za-z0-9_.-]{1,64}$/;
const LOT = /^[A-Za-z0-9_./-]{1,40}$/;
const REF_TYPE = /^[a-z][a-z_]{1,30}$/;
const REF_ID = /^[A-Za-z0-9_./-]{1,64}$/;
const KEY = /^[A-Za-z0-9_.:-]{8,100}$/;
const TYPES = new Set(['receive', 'sale', 'sale_return', 'adjust']);
const fail = (error, extra = {}) => ({ ok: false, error, ...extra });
const isInt = (v, min, max) => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const isPlain = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function validDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const addDays = (s, days) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}
const lotKey = (itemId, lotNo) => `${itemId}\u0000${lotNo}`;

function validRef(ref) { return isPlain(ref) && typeof ref.type === 'string' && REF_TYPE.test(ref.type) && typeof ref.id === 'string' && REF_ID.test(ref.id); }

// Replays movements into lot balances. Used by the ledger and by the standalone checker.
function replay(movements) {
  const lots = new Map();
  for (const m of movements) {
    const k = lotKey(m.itemId, m.lotNo);
    let lot = lots.get(k);
    if (!lot) { lot = { itemId: m.itemId, lotNo: m.lotNo, expiry: m.expiry, unitCostCents: m.unitCostCents, onHand: 0 }; lots.set(k, lot); }
    lot.onHand += m.qty;
  }
  return lots;
}
function soldByRef(movements, refId, itemId, lotNo) {
  let sold = 0, returned = 0;
  for (const m of movements) {
    if (m.ref.id !== refId || m.itemId !== itemId || m.lotNo !== lotNo) continue;
    if (m.type === 'sale') sold += -m.qty; else if (m.type === 'sale_return') returned += m.qty;
  }
  return { sold, returned };
}

// Standalone invariant checker (also used on copies in tests): -> {ok:true, movements} | {ok:false, errors:[...]}
export function verifyMovements(movements) {
  if (!Array.isArray(movements)) return { ok: false, errors: ['movements-invalid'] };
  const errors = []; const add = e => { if (errors.length < 50) errors.push(e); };
  const lots = new Map(); const sold = new Map(); const returned = new Map();
  movements.forEach((m, i) => {
    if (!isPlain(m) || !TYPES.has(m.type) || !Number.isSafeInteger(m.qty) || typeof m.itemId !== 'string' || typeof m.lotNo !== 'string' || !isPlain(m.ref) || typeof m.ref.id !== 'string') { add(`entry-invalid@${i}`); return; }
    if (m.seq !== i + 1) add(`seq-gap@${i}`);
    const signOk = m.type === 'receive' || m.type === 'sale_return' ? m.qty > 0 : m.type === 'sale' ? m.qty < 0 : m.qty !== 0;
    if (!signOk) add(`bad-sign@${m.seq}`);
    const k = lotKey(m.itemId, m.lotNo); let lot = lots.get(k);
    if (!lot) { lot = { expiry: m.expiry, unitCostCents: m.unitCostCents, onHand: 0 }; lots.set(k, lot); }
    else if (lot.expiry !== m.expiry) add(`lot-conflict@${m.seq}`);
    else if (lot.unitCostCents !== m.unitCostCents) add(m.type === 'receive' ? `lot-conflict@${m.seq}` : `cost-mismatch@${m.seq}`);
    lot.onHand += m.qty;
    if (lot.onHand < 0) add(`negative-lot@${m.seq}`);
    const rk = `${m.ref.id}\u0000${k}`;
    if (m.type === 'sale') sold.set(rk, (sold.get(rk) || 0) - m.qty);
    if (m.type === 'sale_return') { returned.set(rk, (returned.get(rk) || 0) + m.qty); if (returned.get(rk) > (sold.get(rk) || 0)) add(`return-exceeds-sold@${m.seq}`); }
  });
  return errors.length ? { ok: false, errors } : { ok: true, movements: movements.length };
}

export function createStockLedger({ now = () => new Date() } = {}) {
  const log = [];                 // frozen movements, append only
  const keys = new Map();         // idempotencyKey -> { fingerprint, result }
  const today = () => now().toISOString().slice(0, 10);
  const isExpired = lot => lot.expiry < today();

  const lotsOf = itemId => [...replay(log).values()].filter(l => l.itemId === itemId).sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : a.lotNo < b.lotNo ? -1 : 1));

  function commit(pending) {
    const at = now().toISOString();
    for (const p of pending) { const m = Object.freeze({ ...p, ref: Object.freeze({ ...p.ref }), seq: log.length + 1, at }); log.push(m); }
  }
  // validates the common envelope; returns an error result or null
  function envelope(p, { needsKey = true } = {}) {
    if (needsKey && !(typeof p.idempotencyKey === 'string' && KEY.test(p.idempotencyKey))) return fail('idempotencyKey-invalid');
    if (typeof p.actor !== 'string' || !ID.test(p.actor)) return fail('actor-invalid');
    if (!validRef(p.ref)) return fail('ref-invalid');
    return null;
  }
  // idempotent execution: replay, conflict or run; only successes are remembered
  function once(op, p, run) {
    const fingerprint = stable({ op, ...p, idempotencyKey: undefined });
    const seen = keys.get(p.idempotencyKey);
    if (seen) return seen.fingerprint === fingerprint ? { ...seen.result, replayed: true } : fail('idempotency-conflict');
    const result = run();
    if (result.ok) keys.set(p.idempotencyKey, { fingerprint, result });
    return result;
  }

  return {
    receive(p = {}) {
      const e = envelope(p); if (e) return e;
      if (typeof p.itemId !== 'string' || !ID.test(p.itemId)) return fail('itemId-invalid');
      if (typeof p.lotNo !== 'string' || !LOT.test(p.lotNo)) return fail('lotNo-invalid');
      if (!validDate(p.expiry)) return fail('expiry-invalid');
      if (!isInt(p.qty, 1, MAX_QTY)) return fail('quantity-invalid');
      if (!isInt(p.unitCostCents, 0, MAX_COST)) return fail('cost-invalid');
      if (p.expiry < today()) return fail('already-expired');
      return once('receive', p, () => {
        const lot = replay(log).get(lotKey(p.itemId, p.lotNo));
        if (lot && (lot.expiry !== p.expiry || lot.unitCostCents !== p.unitCostCents)) return fail('lot-conflict');
        commit([{ type: 'receive', itemId: p.itemId, lotNo: p.lotNo, expiry: p.expiry, qty: p.qty, unitCostCents: p.unitCostCents, ref: p.ref, actor: p.actor, idempotencyKey: p.idempotencyKey }]);
        return { ok: true, lotNo: p.lotNo, qty: p.qty };
      });
    },

    sell(p = {}) {
      const e = envelope(p); if (e) return e;
      if (typeof p.itemId !== 'string' || !ID.test(p.itemId)) return fail('itemId-invalid');
      if (!isInt(p.qty, 1, MAX_QTY)) return fail('quantity-invalid');
      return once('sell', p, () => {
        const lots = lotsOf(p.itemId).filter(l => l.onHand > 0);
        const usable = lots.filter(l => !isExpired(l));
        const available = usable.reduce((s, l) => s + l.onHand, 0);
        if (p.qty > available) return fail('insufficient-stock', { available, expiredOnHand: lots.filter(isExpired).reduce((s, l) => s + l.onHand, 0) });
        let need = p.qty; const allocations = []; const pending = [];
        for (const l of usable) {
          if (need === 0) break;
          const take = Math.min(need, l.onHand); need -= take;
          allocations.push({ lotNo: l.lotNo, qty: take, unitCostCents: l.unitCostCents, expiry: l.expiry });
          pending.push({ type: 'sale', itemId: p.itemId, lotNo: l.lotNo, expiry: l.expiry, qty: -take, unitCostCents: l.unitCostCents, ref: p.ref, actor: p.actor, idempotencyKey: p.idempotencyKey });
        }
        commit(pending);
        return { ok: true, allocations, cogsCents: allocations.reduce((s, a) => s + a.qty * a.unitCostCents, 0) };
      });
    },

    returnSale(p = {}) {
      const e = envelope(p); if (e) return e;
      if (!Array.isArray(p.lines) || p.lines.length === 0) return fail('lines-empty');
      for (const line of p.lines) {
        if (!isPlain(line) || typeof line.itemId !== 'string' || !ID.test(line.itemId) || typeof line.lotNo !== 'string' || !LOT.test(line.lotNo)) return fail('lines-invalid');
        if (!isInt(line.qty, 1, MAX_QTY)) return fail('quantity-invalid');
      }
      if (typeof p.reason !== 'string' || p.reason.trim().length < 3) return fail('reason-required');
      return once('returnSale', p, () => {
        const lots = replay(log); const running = new Map(); const pending = [];
        for (const line of p.lines) {
          const k = lotKey(line.itemId, line.lotNo); const lot = lots.get(k);
          const { sold, returned } = soldByRef(log, p.ref.id, line.itemId, line.lotNo);
          const already = returned + (running.get(k) || 0);
          if (!lot || line.qty + already > sold) return fail('return-exceeds-sold');
          running.set(k, (running.get(k) || 0) + line.qty);
          pending.push({ type: 'sale_return', itemId: line.itemId, lotNo: line.lotNo, expiry: lot.expiry, qty: line.qty, unitCostCents: lot.unitCostCents, ref: p.ref, actor: p.actor, reason: p.reason.trim(), idempotencyKey: p.idempotencyKey });
        }
        commit(pending);
        return { ok: true, returned: pending.length };
      });
    },

    adjust(p = {}) {
      const e = envelope(p); if (e) return e;
      if (typeof p.itemId !== 'string' || !ID.test(p.itemId)) return fail('itemId-invalid');
      if (typeof p.lotNo !== 'string' || !LOT.test(p.lotNo)) return fail('lotNo-invalid');
      if (!isInt(p.delta, -MAX_QTY, MAX_QTY) || p.delta === 0) return fail('quantity-invalid');
      if (typeof p.reason !== 'string' || p.reason.trim().length < 5) return fail('reason-required');
      if (typeof p.approvedBy !== 'string' || !ID.test(p.approvedBy) || p.approvedBy === p.actor) return fail('approver-required');
      return once('adjust', p, () => {
        const lot = replay(log).get(lotKey(p.itemId, p.lotNo));
        if (!lot) return fail('lot-unknown');
        if (lot.onHand + p.delta < 0) return fail('would-go-negative', { onHand: lot.onHand });
        commit([{ type: 'adjust', itemId: p.itemId, lotNo: p.lotNo, expiry: lot.expiry, qty: p.delta, unitCostCents: lot.unitCostCents, ref: p.ref, actor: p.actor, reason: p.reason.trim(), approvedBy: p.approvedBy, idempotencyKey: p.idempotencyKey }]);
        return { ok: true, onHand: lot.onHand + p.delta };
      });
    },

    balance(itemId) {
      const lots = lotsOf(itemId).map(l => ({ lotNo: l.lotNo, expiry: l.expiry, onHand: l.onHand, expired: isExpired(l) }));
      const onHand = lots.reduce((s, l) => s + l.onHand, 0);
      const expired = lots.filter(l => l.expired).reduce((s, l) => s + l.onHand, 0);
      return { onHand, available: onHand - expired, expired, lots };
    },

    // Items below their minimum (expired stock does not count), with an order suggestion up to the target.
    shortages(policy) {
      if (!isPlain(policy)) return fail('policy-invalid');
      const out = [];
      for (const [itemId, rule] of Object.entries(policy)) {
        if (!ID.test(itemId) || !isPlain(rule) || !isInt(rule.min, 0, MAX_QTY) || !isInt(rule.target, 0, MAX_QTY) || rule.target < rule.min) return fail('policy-invalid');
      }
      for (const itemId of Object.keys(policy).sort()) {
        const { min, target } = policy[itemId]; const available = this.balance(itemId).available;
        if (available < min) out.push({ itemId, available, min, target, suggestedOrder: target - available });
      }
      return { ok: true, items: out };
    },

    // Lots with stock that expire within `days` (not yet expired), earliest first.
    expiring(days) {
      if (!Number.isInteger(days) || days < 0) return [];
      const limit = addDays(today(), days);
      return [...replay(log).values()].filter(l => l.onHand > 0 && !isExpired(l) && l.expiry <= limit)
        .sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : a.lotNo < b.lotNo ? -1 : 1))
        .map(l => ({ itemId: l.itemId, lotNo: l.lotNo, expiry: l.expiry, onHand: l.onHand }));
    },

    // Cost of goods of one invoice: lots sold minus lots returned, at each lot's cost.
    cogs(invoiceId) {
      let total = 0;
      for (const m of log) if (m.ref.id === invoiceId && (m.type === 'sale' || m.type === 'sale_return')) total += -m.qty * m.unitCostCents;
      return total;
    },

    movements: () => Object.freeze([...log]),
    verify: () => verifyMovements(log),
  };
}
