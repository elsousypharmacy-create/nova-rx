// PharmaOverseas login over plain HTTP (OAuth 2 authorization code + PKCE),
// the same steps the storefront performs in the browser:
//   1. GET  /authorizationserver/oauth/authorize   -> 302, sets a session cookie
//   2. GET  /authorizationserver/csrf              -> { headerName, parameterName, token }
//   3. POST /authorizationserver/login (form)      -> 302 to authorize (continue)
//   4. GET  authorize (continue)                   -> 302 to the shop with ?code=...
//   5. POST /authorizationserver/oauth/token       -> access token (about 12 h)
// Dependency-free ES module; runs in Cloudflare Workers and Node 22.
// The password and tokens are never logged or put in error messages.
import { AuthRequiredError, NotAuthorizedError, TransientError } from '../connector-contract.js';

const API = 'https://api.pharmaemarket.com';
const CLIENT_ID = 'mobile_android_public';
const REDIRECT_URI = 'https://shop.pharmaemarket.com';
const MAX_HOPS = 6;

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkcePair(cryptoImpl) {
  const raw = new Uint8Array(48);
  cryptoImpl.getRandomValues(raw);
  const verifier = b64url(raw);
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

function randomState(cryptoImpl) {
  const raw = new Uint8Array(12);
  cryptoImpl.getRandomValues(raw);
  return b64url(raw);
}

// Minimal cookie jar: name -> value for the API host.
function createJar() {
  const jar = new Map();
  return {
    absorb(headers) {
      const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
      for (const line of list) {
        const [pair] = line.split(';');
        const i = pair.indexOf('=');
        if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    },
    header() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
}

export async function loginPharmaOverseas({
  username,
  password,
  fetch: fetchImpl = globalThis.fetch,
  crypto: cryptoImpl = globalThis.crypto,
  now = () => Date.now(),
} = {}) {
  if (!username || !password) throw new AuthRequiredError('PharmaOverseas: missing account details');
  const jar = createJar();
  const { verifier, challenge } = await pkcePair(cryptoImpl);
  const state = randomState(cryptoImpl);

  async function hop(url, init = {}) {
    let res;
    try {
      res = await fetchImpl(url, {
        redirect: 'manual',
        ...init,
        headers: { Accept: '*/*', ...(init.headers || {}), ...(jar.header() ? { Cookie: jar.header() } : {}) },
      });
    } catch (err) {
      throw new TransientError(`PharmaOverseas login network error: ${err.message}`);
    }
    jar.absorb(res.headers);
    return res;
  }

  const authorizeUrl = `${API}/authorizationserver/oauth/authorize?` + new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: '',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();

  // 1. start the authorization (sets the session cookie)
  const first = await hop(authorizeUrl);
  if (first.status >= 500) throw new TransientError(`PharmaOverseas returned ${first.status}`);

  // 2. csrf token tied to that session
  const csrfRes = await hop(`${API}/authorizationserver/csrf`, { headers: { Accept: 'application/json' } });
  if (csrfRes.status === 429) throw new TransientError('PharmaOverseas rate limit during login');
  if (csrfRes.status !== 200) throw new NotAuthorizedError(`PharmaOverseas csrf step returned ${csrfRes.status}`);
  let csrf;
  try { csrf = await csrfRes.json(); } catch { csrf = null; }
  if (!csrf || typeof csrf.token !== 'string') throw new NotAuthorizedError('PharmaOverseas csrf reply had no token');
  const fieldName = csrf.parameterName || '_csrf';

  // 3. submit the login form
  const form = new URLSearchParams({ [fieldName]: csrf.token, username, password }).toString();
  let res = await hop(`${API}/authorizationserver/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: REDIRECT_URI, Referer: `${REDIRECT_URI}/` },
    body: form,
  });

  // 4. follow redirects until we reach the shop with ?code=
  let code = null;
  for (let i = 0; i < MAX_HOPS; i += 1) {
    const loc = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !loc) break;
    const next = new URL(loc, API);
    if (next.searchParams.get('error')) throw new AuthRequiredError('PharmaOverseas rejected the login');
    if (next.origin === REDIRECT_URI && next.searchParams.get('code')) {
      if (next.searchParams.get('state') !== state) throw new NotAuthorizedError('PharmaOverseas login state mismatch');
      code = next.searchParams.get('code');
      break;
    }
    if (next.pathname.includes('/login') && next.origin !== API) throw new AuthRequiredError('PharmaOverseas rejected the login');
    res = await hop(next.href);
  }
  if (!code) throw new AuthRequiredError('PharmaOverseas login did not return a code (wrong account details, a verification step, or a changed flow)');

  // 5. exchange the code for the token
  const tokenRes = await hop(`${API}/authorizationserver/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', Origin: REDIRECT_URI },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }).toString(),
  });
  if (tokenRes.status === 429) throw new TransientError('PharmaOverseas rate limit during login');
  if (tokenRes.status !== 200) throw new NotAuthorizedError(`PharmaOverseas token step returned ${tokenRes.status}`);
  let body;
  try { body = await tokenRes.json(); } catch { body = null; }
  if (!body || typeof body.access_token !== 'string') throw new NotAuthorizedError('PharmaOverseas token reply had no access token');
  const expiresIn = Number(body.expires_in);
  return {
    accessToken: body.access_token,
    expiresAt: now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
  };
}
