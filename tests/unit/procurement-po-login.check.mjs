// Checks for the PharmaOverseas HTTP login using a scripted fake server.
// Run: node tests/unit/procurement-po-login.check.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loginPharmaOverseas } from '../../worker/procurement/auth/pharmaoverseas-login.js';
import { AuthRequiredError, NotAuthorizedError } from '../../worker/procurement/connector-contract.js';

const API = 'https://api.pharmaemarket.com';

function makeServer({ failLogin = false, noCode = false } = {}) {
  const calls = [];
  let sawCookieOnCsrf = false;
  let sawCookieOnLogin = false;
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const headers = init.headers || {};
    calls.push({ method: init.method || 'GET', path: u.pathname, query: Object.fromEntries(u.searchParams), body: init.body, headers });
    const res = (status, { json, location, cookies } = {}) => {
      const h = new Map();
      if (location) h.set('location', location);
      return {
        status,
        headers: { get: (k) => h.get(k.toLowerCase()) ?? null, getSetCookie: () => cookies || [] },
        json: async () => json,
      };
    };
    if (u.pathname === '/authorizationserver/oauth/authorize' && !u.searchParams.get('continue') && !calls.some((c) => c.path === '/authorizationserver/login')) {
      return res(302, { location: 'https://shop.pharmaemarket.com/pharma/en/EGP/login', cookies: ['JSESSIONID=abc123; Path=/; HttpOnly'] });
    }
    if (u.pathname === '/authorizationserver/csrf') {
      sawCookieOnCsrf = /JSESSIONID=abc123/.test(headers.Cookie || '');
      return res(200, { json: { headerName: 'X-CSRF-TOKEN', parameterName: '_csrf', token: 'csrf-token-value' } });
    }
    if (u.pathname === '/authorizationserver/login') {
      sawCookieOnLogin = /JSESSIONID=abc123/.test(headers.Cookie || '');
      if (failLogin) return res(302, { location: `${API}/authorizationserver/login?error=true` });
      return res(302, { location: `${API}/authorizationserver/oauth/authorize?client_id=mobile_android_public&continue=1&state=x` });
    }
    if (u.pathname === '/authorizationserver/oauth/authorize') {
      const state = calls.find((c) => c.path === '/authorizationserver/oauth/authorize').query.state;
      return res(302, { location: noCode ? 'https://shop.pharmaemarket.com/' : `https://shop.pharmaemarket.com/?code=auth-code&state=${state}` });
    }
    if (u.pathname === '/authorizationserver/oauth/token') {
      return res(200, { json: { access_token: 'tok-secret', refresh_token: 'ref', token_type: 'Bearer', expires_in: 43199 } });
    }
    return res(404);
  };
  return { fetch, calls, flags: () => ({ sawCookieOnCsrf, sawCookieOnLogin }) };
}

// Happy path
{
  const s = makeServer();
  const out = await loginPharmaOverseas({ username: 'u@example.com', password: 'p@ss word', fetch: s.fetch, now: () => 1000 });
  assert.equal(out.accessToken, 'tok-secret');
  assert.equal(out.expiresAt, 1000 + 43199 * 1000);
  const authz = s.calls[0];
  assert.equal(authz.query.client_id, 'mobile_android_public');
  assert.equal(authz.query.code_challenge_method, 'S256');
  assert.equal(authz.query.redirect_uri, 'https://shop.pharmaemarket.com');
  assert.ok(authz.query.code_challenge && authz.query.code_challenge.length >= 43, 'PKCE challenge present');
  const login = s.calls.find((c) => c.path === '/authorizationserver/login');
  const form = new URLSearchParams(login.body);
  assert.equal(form.get('_csrf'), 'csrf-token-value');
  assert.equal(form.get('username'), 'u@example.com');
  assert.equal(form.get('password'), 'p@ss word');
  const token = s.calls.find((c) => c.path === '/authorizationserver/oauth/token');
  const tform = new URLSearchParams(token.body);
  assert.equal(tform.get('grant_type'), 'authorization_code');
  assert.equal(tform.get('code'), 'auth-code');
  assert.ok(tform.get('code_verifier').length >= 43);
  assert.deepEqual(s.flags(), { sawCookieOnCsrf: true, sawCookieOnLogin: true }, 'session cookie is sent on later steps');
}

// Wrong account details -> AuthRequiredError, nothing leaked in the message
{
  const s = makeServer({ failLogin: true });
  await assert.rejects(
    loginPharmaOverseas({ username: 'u@example.com', password: 'sup3rsecret', fetch: s.fetch }),
    (e) => e instanceof AuthRequiredError && !/sup3rsecret|u@example\.com/.test(e.message),
  );
}

// No code returned (verification step or changed flow) -> AuthRequiredError
{
  const s = makeServer({ noCode: true });
  await assert.rejects(loginPharmaOverseas({ username: 'a@b.co', password: 'x', fetch: s.fetch }), AuthRequiredError);
}

// Missing details
await assert.rejects(loginPharmaOverseas({ username: '', password: '' }), AuthRequiredError);

// csrf failure -> NotAuthorizedError
{
  const s = makeServer();
  const broken = async (url, init) => (new URL(url).pathname.endsWith('/csrf')
    ? { status: 403, headers: { get: () => null, getSetCookie: () => [] }, json: async () => ({}) }
    : s.fetch(url, init));
  await assert.rejects(loginPharmaOverseas({ username: 'a@b.co', password: 'x', fetch: broken }), NotAuthorizedError);
}

// Source hygiene
const src = readFileSync(new URL('../../worker/procurement/auth/pharmaoverseas-login.js', import.meta.url), 'utf8');
assert.ok(!/console\./.test(src), 'no logging in the login module');

console.log('procurement-po-login checks passed');
