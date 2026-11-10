// Aumet search rows and cart items identify a warehouse as the distributor id plus a 4-digit suffix
// (live data: the row id 385960002 belongs to the warehouse the account lists as 38596). Comparing the
// raw row id with the listed id never matches, which hid every real Aumet offer behind the warehouse
// selection. Resolve a row id against the REAL warehouse list instead of guessing: an id that is
// already listed stays as it is; otherwise an id of 6 or more digits whose first digits (the last
// 4 removed) are listed becomes that listed id; anything else is returned unchanged.
export function resolveSellerId(raw, knownIds) {
  if (raw === undefined || raw === null) return null;
  const id = String(raw);
  const known = new Set((knownIds || []).map(String));
  if (known.has(id)) return id;
  if (/^\d{6,}$/.test(id) && known.has(id.slice(0, -4))) return id.slice(0, -4);
  return id;
}
