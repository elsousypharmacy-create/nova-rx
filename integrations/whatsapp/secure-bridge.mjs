/**
 * NOVA Rx WhatsApp secure bridge (NOT deployed).
 *
 * Bindings required:
 *   WA_ACCESS_TEAM_DOMAIN: e.g. https://team.cloudflareaccess.com
 *   WA_ACCESS_AUD: Cloudflare Access application audience
 *   WA_BACKEND_URL: private HTTPS endpoint implementing the contract below
 *   WA_BACKEND_TOKEN: server-side secret accepted by the pharmacy backend
 *
 * This module intentionally fails closed until all bindings exist.
 * Never expose WA_BACKEND_TOKEN or the existing Meta WA_TOKEN to browsers.
 */
const encoder = new TextEncoder();
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
function b64url(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")), c => c.charCodeAt(0));
}
function parseJwt(jwt) {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw Error("invalid jwt");
  const header = JSON.parse(new TextDecoder().decode(b64url(parts[0])));
  const claims = JSON.parse(new TextDecoder().decode(b64url(parts[1])));
  return { parts, header, claims };
}
async function verifyAccess(jwt, domain, audience) {
  const { parts, header, claims } = parseJwt(jwt);
  const issuer = new URL(domain).origin;
  if (header.alg !== "RS256" || !header.kid || claims.iss !== issuer ||
      !Array.isArray(claims.aud) || !claims.aud.includes(audience) ||
      typeof claims.exp !== "number" || claims.exp <= Date.now() / 1000 ||
      typeof claims.nbf === "number" && claims.nbf > Date.now() / 1000) throw Error("invalid access token");
  const response = await fetch(issuer + "/cdn-cgi/access/certs", { cf: { cacheTtl: 300 } });
  if (!response.ok) throw Error("access key fetch failed");
  const jwks = await response.json();
  const jwk = jwks.keys?.find(k => k.kid === header.kid && k.kty === "RSA");
  if (!jwk) throw Error("unknown signing key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]), encoder.encode(parts[0] + "." + parts[1]));
  if (!ok) throw Error("bad signature");
  if (!claims.email || !claims.sub) throw Error("missing identity");
  return { email: claims.email, sub: claims.sub };
}
/**
 * Pharmacy backend contract:
 * GET /chats?channel=whatsapp -> {ok:true,chats:[...]}
 * GET /chats/{id}          -> {ok:true,msgs:[...]}
 * POST /chats/{id}/reply   -> {ok:true} body {text}
 * POST /chats/{id}/hold    -> {ok:true} body {hold:boolean}
 * The backend MUST independently authorize the identity, enforce WA channel,
 * verify chat ownership and WhatsApp 24-hour messaging rules, and audit writes.
 */
export async function handleWhatsAppApi(request, env) {
  const origin = new URL(request.url).origin;
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/whatsapp/")) return json({ok:false,error:"not found"},404);
  if (!env.WA_ACCESS_TEAM_DOMAIN || !env.WA_ACCESS_AUD || !env.WA_BACKEND_URL || !env.WA_BACKEND_TOKEN)
    return json({ok:false,error:"WhatsApp integration not configured"},503);
  let user;
  try {
    const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!jwt) return json({ok:false,error:"login required"},401);
    user = await verifyAccess(jwt, env.WA_ACCESS_TEAM_DOMAIN, env.WA_ACCESS_AUD);
  } catch (_) { return json({ok:false,error:"unauthorized"},401); }
  if (!["GET","POST"].includes(request.method)) return json({ok:false,error:"method not allowed"},405);
  const tail = url.pathname.slice("/api/whatsapp/".length);
  if (!/^chats(?:\/[A-Za-z0-9_-]{1,100}(?:\/(?:reply|hold))?)?$/.test(tail))
    return json({ok:false,error:"invalid path"},400);
  const isWrite = request.method === "POST";
  if (isWrite && !/^chats\/[A-Za-z0-9_-]{1,100}\/(?:reply|hold)$/.test(tail))
    return json({ok:false,error:"invalid action"},405);
  if (!isWrite && !/^chats(?:\/[A-Za-z0-9_-]{1,100})?$/.test(tail))
    return json({ok:false,error:"invalid action"},405);
  let body;
  if (isWrite) {
    const raw = await request.text();
    if (raw.length > 4096) return json({ok:false,error:"payload too large"},413);
    try { body = JSON.parse(raw); } catch (_) { return json({ok:false,error:"invalid JSON"},400); }
    if (tail.endsWith("/reply") && (typeof body.text !== "string" || !body.text.trim() || body.text.length > 4000))
      return json({ok:false,error:"invalid message"},400);
    if (tail.endsWith("/hold") && typeof body.hold !== "boolean")
      return json({ok:false,error:"invalid hold value"},400);
  }
  const backend = new URL(env.WA_BACKEND_URL);
  if (backend.protocol !== "https:") return json({ok:false,error:"backend misconfigured"},503);
  backend.pathname = backend.pathname.replace(/\/$/,"") + "/" + tail;
  if (!isWrite) backend.searchParams.set("channel","whatsapp");
  try {
    const upstream = await fetch(backend.toString(), {
      method: request.method,
      headers: {
        "Authorization": "Bearer " + env.WA_BACKEND_TOKEN,
        "Content-Type": "application/json",
        "X-Nova-User": user.email,
        "X-Nova-Subject": user.sub
      },
      body: isWrite ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(12000)
    });
    if (!upstream.ok) return json({ok:false,error:"backend unavailable"},upstream.status === 401 || upstream.status === 403 ? 403 : 502);
    const payload = await upstream.json();
    return json(payload);
  } catch (_) { return json({ok:false,error:"connection failed"},502); }
}
