# Integration API + signed webhooks (N111, INT-02)

Flag `NOVA_INTEGRATION=1` (default OFF: routes return 404 `INTEGRATION_DISABLED`, nothing else is touched).
Signing secret: Worker binding `NOVA_INGEST_SECRET` (name only; value set by the owner).

## API keys
Created server-side by `createApiKey` (migration `0012_integration_api.sql`); only the SHA-256 hash is stored, plaintext shown once.
Scopes: `products:read`, `sales:read`, `inventory:read`, `webhooks:receive`. Send `X-Api-Key: nvk_...` (or Bearer).
Sandbox tenant `sandbox`: `createSandboxKey` issues keys bound to it, never to real tenant data.

## Signature
`X-Nova-Timestamp` (unix s, ±300 s), `X-Nova-Nonce` (single use per key), `X-Nova-Signature: v1=hex(HMAC-SHA256(secret, "<ts>.<nonce>.<raw body>"))`.

## Routes
- `GET /api/v1/integration/ping` — validates the key.
- `POST /api/v1/integration/webhook` — signed inbound; errors: `API_KEY_INVALID`, `API_SCOPE_FORBIDDEN`, `SIGNATURE_INVALID`, `TIMESTAMP_STALE`, `REPLAY_DETECTED` (all with Arabic message + requestId).

## Example connector (Node)
```js
const body = JSON.stringify({ event: 'order.created', data: { id: 1 } });
const ts = Math.floor(Date.now() / 1000).toString(), nonce = crypto.randomUUID();
const sig = 'v1=' + createHmac('sha256', SECRET).update(`${ts}.${nonce}.${body}`).digest('hex');
await fetch(BASE + '/api/v1/integration/webhook', { method: 'POST', body, headers: {
  'X-Api-Key': KEY, 'X-Nova-Timestamp': ts, 'X-Nova-Nonce': nonce, 'X-Nova-Signature': sig } });
```
Outbound: `deliverWebhook` (HTTPS only, transport injected; tests use a mock, no live calls).
