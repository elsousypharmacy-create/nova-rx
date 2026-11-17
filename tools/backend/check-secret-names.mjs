#!/usr/bin/env node
// S1-08: names-only check of the production secrets. Prints ONLY yes/no per secret NAME:
//   - GitHub Actions secrets NOVA_API_PIN / NOVA_INGEST_SECRET exist (from the secret NAME list, values are never readable)
//   - the production Worker nova-rx-api has bindings with those NAMES of type secret_text (Cloudflare API, names only)
// Never prints values, lengths or previews; never sets, rolls or deletes anything. A missing permission prints its NAME and exits 2.
// CLI (CI): CF_API_TOKEN, CF_ACCOUNT_ID, GH_TOKEN (read secrets list), GH_REPO; node tools/backend/check-secret-names.mjs
export const REQUIRED = Object.freeze(['NOVA_API_PIN', 'NOVA_INGEST_SECRET']);
export const WORKER = 'nova-rx-api';
export const WA_PHONE_ID_EXPECTED = '515646411625617';

// Pure: names in -> yes/no table out (no values ever enter this function).
export function summarize(githubNames, workerBindings) {
  const gh = new Set((githubNames || []).map(String));
  const wk = new Set((workerBindings || []).filter((b) => b && b.type === 'secret_text').map((b) => String(b.name)));
  const rows = REQUIRED.map((n) => ({ name: n, github: gh.has(n), worker: wk.has(n) }));
  return { rows, ok: rows.every((r) => r.github && r.worker) };
}

export async function fetchWorkerBindings(fetchFn, { accountId, token, script = WORKER }) {
  const r = await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${script}/settings`, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 403 || r.status === 401) return { error: 'missing Cloudflare permission: Account.Workers Scripts:Read' };
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.success) return { error: 'Cloudflare API error ' + r.status };
  return { bindings: ((j.result && j.result.bindings) || []).map((b) => ({ name: b.name, type: b.type })) }; // names + types only
}

export async function fetchGithubSecretNames(fetchFn, { repo, token }) {
  const r = await fetchFn(`https://api.github.com/repos/${repo}/actions/secrets?per_page=100`, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' } });
  if (r.status === 403 || r.status === 401 || r.status === 404) return { error: 'missing GitHub permission: secrets:read (Actions secrets list)' };
  const j = await r.json().catch(() => ({}));
  return { names: (j.secrets || []).map((s) => s.name) }; // GitHub never returns values
}

export function format(sum) {
  return sum.rows.map((r) => `${r.name}: github=${r.github ? 'yes' : 'NO'} worker(${WORKER})=${r.worker ? 'yes' : 'NO'}`).join('\n') + '\n' + (sum.ok ? 'ALL PRESENT' : 'MISSING (see NO above): run the production deploy (dry_run first, then DEPLOY nova-rx-api production) which sets them by name');
}

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { CF_API_TOKEN, CF_ACCOUNT_ID, GH_TOKEN, GH_REPO } = process.env;
  if (!CF_API_TOKEN || !CF_ACCOUNT_ID || !GH_TOKEN || !GH_REPO) { console.log('MISSING ENV NAME(S): ' + ['CF_API_TOKEN', 'CF_ACCOUNT_ID', 'GH_TOKEN', 'GH_REPO'].filter((k) => !process.env[k]).join(', ')); process.exit(2); }
  const w = await fetchWorkerBindings(fetch, { accountId: CF_ACCOUNT_ID, token: CF_API_TOKEN });
  const g = await fetchGithubSecretNames(fetch, { repo: GH_REPO, token: GH_TOKEN });
  if (w.error || g.error) { console.log([w.error, g.error].filter(Boolean).join('\n')); process.exit(2); }
  const s = summarize(g.names, w.bindings); console.log(format(s)); process.exit(s.ok ? 0 : 1);
}
