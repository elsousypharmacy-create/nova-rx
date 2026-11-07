/**
 * NOVA Rx WhatsApp secure bridge (NOT deployed).
 *
 * Talks to the existing pharmacy Apps Script action `novaWhatsAppBridge`
 * (operations: list / get / reply / hold). Never exposes any token to browsers.
 *
 * Secrets: read from `env`, or (live Worker) from the encrypted KV store that
 * /api/settings/secrets writes to:
 *   WA_BACKEND_URL          Apps Script Web App URL (https://script.google.com/macros/s/.../exec)
 *   NOVA_WA_BRIDGE_TOKEN    same value as Script Property NOVA_WA_BRIDGE_TOKEN (>= 32 chars)
 *   env.NOVA_SECRETS_KV + env.NOVA_SECRET_ENCRYPTION_KEY (hex)  -> decrypts the two above
 *   (or plain env.WA_BACKEND_URL / env.WA_BACKEND_TOKEN)
 *
 * Who may call it (fails closed):
 *   A) Cloudflare Access JWT: env.WA_ACCESS_TEAM_DOMAIN + env.WA_ACCESS_AUD, or
 *   B) env.WA_TRUST_ACCESS_HEADER === "1" and Cf-Access-Authenticated-User-Email is in
 *      env.WA_ALLOWED_EMAILS (comma separated). Use B only if the whole hostname is behind
 *      Cloudflare Access, otherwise the header can be forged.
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
async function readSecret(env, name) {
  const plain = { WA_BACKEND_URL: env.WA_BACKEND_URL, NOVA_WA_BRIDGE_TOKEN: env.WA_BACKEND_TOKEN || env.NOVA_WA_BRIDGE_TOKEN };
  if (plain[name]) return String(plain[name]);
  if (!env.NOVA_SECRETS_KV || !env.NOVA_SECRET_ENCRYPTION_KEY || !/^[0-9a-fA-F]{64}$/.test(env.NOVA_SECRET_ENCRYPTION_KEY)) return "";
  const raw = await env.NOVA_SECRETS_KV.get("secret:" + name);
  if (!raw) return "";
  const rec = JSON.parse(raw);
  const key = await crypto.subtle.importKey("raw", new Uint8Array(env.NOVA_SECRET_ENCRYPTION_KEY.match(/.{2}/g).map(x => parseInt(x, 16))), { name: "AES-GCM" }, false, ["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(rec.iv) }, key, new Uint8Array(rec.data))).trim();
}
async function authorize(request, env) {
  if (env.WA_ACCESS_TEAM_DOMAIN && env.WA_ACCESS_AUD) {
    const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!jwt) return false;
    await verifyAccess(jwt, env.WA_ACCESS_TEAM_DOMAIN, env.WA_ACCESS_AUD);
    return true;
  }
  if (env.WA_TRUST_ACCESS_HEADER === "1") {
    const email = (request.headers.get("Cf-Access-Authenticated-User-Email") || "").trim().toLowerCase();
    const allowed = String(env.WA_ALLOWED_EMAILS || "").toLowerCase().split(",").map(x => x.trim()).filter(Boolean);
    return !!email && allowed.includes(email);
  }
  return false;
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
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/whatsapp/")) return json({ok:false,error:"not found"},404);
  if (!((env.WA_ACCESS_TEAM_DOMAIN && env.WA_ACCESS_AUD) || (env.WA_TRUST_ACCESS_HEADER === "1" && env.WA_ALLOWED_EMAILS)))
    return json({ok:false,error:"WhatsApp integration not configured"},503);
  try {
    if (!(await authorize(request, env))) return json({ok:false,error:"login required"},401);
  } catch (_) { return json({ok:false,error:"unauthorized"},401); }
  let backendUrl = "", bridgeToken = "";
  try { backendUrl = await readSecret(env, "WA_BACKEND_URL"); bridgeToken = await readSecret(env, "NOVA_WA_BRIDGE_TOKEN"); }
  catch (_) { return json({ok:false,error:"secrets unreadable"},503); }
  if (!backendUrl || bridgeToken.length < 32) return json({ok:false,error:"WhatsApp integration not configured"},503);
  if (!["GET","POST"].includes(request.method)) return json({ok:false,error:"method not allowed"},405);
  const tail = url.pathname.slice("/api/whatsapp/".length);
  if (!/^chats(?:\/[A-Za-z0-9_.-]{1,100}(?:\/(?:reply|hold))?)?$/.test(tail))
    return json({ok:false,error:"invalid path"},400);
  const isWrite = request.method === "POST";
  if (isWrite && !/^chats\/[A-Za-z0-9_.-]{1,100}\/(?:reply|hold)$/.test(tail))
    return json({ok:false,error:"invalid action"},405);
  if (!isWrite && !/^chats(?:\/[A-Za-z0-9_.-]{1,100})?$/.test(tail))
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
  // Apps Script Web App endpoint. Its ContentService responds with a Google redirect.
  let backend; try { backend = new URL(backendUrl); } catch (_) { return json({ok:false,error:"backend misconfigured"},503); }
  if (backend.hostname !== "script.google.com" || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(backend.pathname))
    return json({ok:false,error:"backend misconfigured"},503);
  const segments = tail.split("/");
  const operation = segments.length === 1 ? "list" : segments.length === 2 ? "get" : segments[2];
  const chatId = segments[1] || "";
  const payload = { action:"novaWhatsAppBridge", bridgeToken, operation, chatId };
  if (isWrite) Object.assign(payload, body);
  try {
    const upstream = await fetch(backend.toString(), {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload),
      redirect:"follow",
      signal:AbortSignal.timeout(12000)
    });
    if (!upstream.ok) return json({ok:false,error:"backend unavailable"},502);
    const result = await upstream.json();
    return json(result);
  } catch (_) { return json({ok:false,error:"connection failed"},502); }
}
