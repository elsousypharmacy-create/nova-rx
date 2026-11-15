#!/usr/bin/env node
// UX406: generate a VAPID key pair for Web Push (free, no vendor). NEVER prints the private key.
// Writes both keys to OUT_DIR (default: a fresh 0700 temp dir outside the repo) as two 0600 files, so they can be piped into
// Worker secrets without appearing in logs, chat, PRs or the repo:
//   node tools/gen-vapid-keys.mjs [OUT_DIR]
//   wrangler secret put VAPID_PUBLIC_KEY  --env staging < OUT_DIR/VAPID_PUBLIC_KEY   (run from backend/)
//   wrangler secret put VAPID_PRIVATE_KEY --env staging < OUT_DIR/VAPID_PRIVATE_KEY
//   rm -r OUT_DIR
// Formats (what backend/src/inbox-push.js expects): public = base64url 65-byte uncompressed P-256 point, private = base64url 32-byte d.
import { webcrypto as crypto } from 'node:crypto';
import { mkdtempSync, writeFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), 'vapid-'));
if (out === repo || out.startsWith(repo + '/')) { console.error('refusing to write keys inside the repository'); process.exit(1); }
if (!existsSync(out)) mkdirSync(out, { recursive: true, mode: 0o700 });
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = Buffer.from(await crypto.subtle.exportKey('raw', kp.publicKey)).toString('base64url');
const { d } = await crypto.subtle.exportKey('jwk', kp.privateKey);
for (const [name, v] of [['VAPID_PUBLIC_KEY', pub], ['VAPID_PRIVATE_KEY', d]]) {
  const f = join(out, name);
  writeFileSync(f, v, { mode: 0o600 }); chmodSync(f, 0o600);
}
console.log('wrote VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (0600) to', out, '— private key not printed');
