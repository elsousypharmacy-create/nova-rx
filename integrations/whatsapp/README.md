# NOVA Rx WhatsApp inbox — wiring guide (not deployed)

Flow: browser `/whatsapp-inbox.html` → Worker `/api/whatsapp/*` (`secure-bridge.mjs`) →
pharmacy Apps Script `POST {action:"novaWhatsAppBridge", bridgeToken, operation, chatId}` → bot.
No token ever reaches the browser. The bot already implements the Apps Script side
(`server/src/42_nova_whatsapp_bridge.js` in the `pharmacy` repo).

## Needed (owner)
1. Apps Script Script Property `NOVA_WA_BRIDGE_TOKEN`: random, at least 32 characters.
2. The same value in NOVA `/api/settings/secrets` → "NOVA WhatsApp Bridge Token".
3. NOVA `/api/settings/secrets` → "Pharmacy Backend URL": the Apps Script Web App `/exec` URL.
4. Server updated to the version that contains `42_nova_whatsapp_bridge.js`.

## Live Worker glue (the live Worker is not in this repo; do NOT overwrite it with repo files)
The live Worker uses globals, not `env`. Add the module code and one route, keeping every existing route:

```js
if (url.pathname.startsWith('/api/whatsapp/')) {
  event.respondWith(handleWhatsAppApi(event.request, {
    NOVA_SECRETS_KV, NOVA_SECRET_ENCRYPTION_KEY,
    WA_TRUST_ACCESS_HEADER: '1',                 // only if the whole hostname is behind Cloudflare Access
    WA_ALLOWED_EMAILS: 'elsousypharmacy@gmail.com'
  }));
  return;
}
```
Prefer JWT checking (`WA_ACCESS_TEAM_DOMAIN` + `WA_ACCESS_AUD`) when Access is configured.
Replace the placeholder `NOVA_WA_HTML` page with `inbox.html`. Export the live Worker first and keep a rollback copy.

## Notes
- Phone and Meta tokens (`WA_TOKEN`, `WA_PHONE_ID`) are not used here; the bot sends replies itself.
- Replies are blocked by WhatsApp's 24-hour rule when the customer has not written recently; the error text is shown in the page.
- Test: `node tests/unit/whatsapp-bridge.check.mjs`.

## WARNING: the patched Worker copy here is stale
`worker/live/nova-rx-preview.with-whatsapp.js` was built from the live Worker as it was before 2026-11-07T08:55Z. The live Worker now runs the UX batch 1+2 build (`worker/live/nova-rx-preview.with-ux-batch1-2.js`). **Do not deploy `with-whatsapp.js`**: it would bring back the old HTML. Before WhatsApp goes live, re-apply the bridge route (`NOVA_WA_BRIDGE`) and the inbox page onto the CURRENT live Worker, test it, and deploy with `docs/DEPLOY_WORKER.md`. WhatsApp itself is paused: the pharmacy number is on the sunset On-Premises API and must be migrated by Meta first (see `HANDOFF.md`, issue #36).
