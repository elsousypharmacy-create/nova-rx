// SEC-01 test helper: a FAKE staff session in a fake KV, exactly the record shape auth/auth.js issueSession() writes
// (KV key 'sess:' + sha256(access token)). Fake data only; no network, no real account, no secret.
import { sha256Hex } from '../../../backend/src/auth/auth.js';

let seq = 0;
export async function staffBearer(kv, { user = 'cashier.test', role = 'cashier', ttlS = 3600, revoked = false } = {}) {
  const token = ('t' + (++seq)).padEnd(48, '0') + 'abcdef0123456789'.slice(0, 16);
  const now = Math.floor(Date.now() / 1000);
  const sess = { user, role, deviceId: 'dev-test', trusted: false, created: now, expires: now + ttlS, refreshExpires: now + ttlS, reauthAt: now, refreshHash: 'x', revoked };
  await kv.put('sess:' + (await sha256Hex(token)), JSON.stringify(sess));
  return { token, headers: { Authorization: 'Bearer ' + token } };
}
