# WhatsApp bot down since Oct 25 — diagnosis (FIX53)

Date: 2026-11-14. Scope: read-only review of `elsousypharmacy-create/pharmacy` (main @ 6b9c0b5) and NOVA HANDOFF. No Script Properties, WA_TOKEN, sheet, or Meta API was touched (this sandbox has no credentials). No WhatsApp sent. No PR opened in pharmacy (no code bug found).

## Verdict
**Not a code bug in the bot. The gap starts at Meta, before any NOVA change.**
Root cause on record (HANDOFF.md, "WhatsApp — PAUSED by owner", 2026-11-07, verified then via Graph API Explorer): the pharmacy number +20 11 43404023 (phone id 515646411625617, WABA 505759262610446) is `platform_type=ON_PREMISE`, `status=DISCONNECTED`. The On-Premises API was sunset; `POST /{phone}/register` returns code 100 "Register endpoint is not available". A DISCONNECTED number receives nothing, so Meta sends **no webhook** to Apps Script, `doPost` never runs, and nothing is logged. That matches "no messages since Oct 25" and "bot does not reply at all".

## Evidence
1. Timeline: the last logged message (Oct 25) predates every relevant code change. Pharmacy PRs #69 and #70 (NOVA forward, BOT_AUTO_REPLY, novaBridgeConfig) were merged on **2026-11-14**, 20 days after the silence began. The earlier server commits (#36 bridge 11-06, #38 WABA field 11-07, stock feed 11-10) don't touch the webhook path either.
2. Code review of the webhook path (`server/src/05_routing.js` doPost, `21_messaging.js` handleWhatsAppWebhook_/waOne_/waCall_, `24_bot_features.js` holdOn_, `43_nova_wa_forward.js`, `42_nova_whatsapp_bridge.js`):
   - Forward is already safe: `novaWaForward_`, `novaWaForwardIn_`, `novaWaForwardOut_` are each wrapped in try/catch (inner catch also guarded), no-op when `NOVA_WA_BRIDGE_URL`/`NOVA_WA_BRIDGE_TOKEN` are missing or the token is <32 chars, deduped for 6h, use `muteHttpExceptions`. Inbound forward runs in a `finally` AFTER `waOne_` (the reply), so a NOVA failure or slowness cannot block or change the reply.
   - Missing Script Properties cannot crash the handler: `botAutoReplyOff_` returns false (bot ON) on any error or when `BOT_AUTO_REPLY` is unset; only the exact value `'0'` turns auto-reply off.
   - Tests run here, both PASS: `node tools/test-nova-wa-forward.cjs` and `node tools/test-nova-bridge-config.cjs`. `node tools/build-server.js --check` → "OK: server/Code.js matches server/src".
3. Reply-path defaults: `waPhoneId_()` falls back to `1321594684378624`, which is Meta's TEST number (+1 555 673 1935), not the pharmacy number. If `WA_PHONE_ID` is not saved in Script Properties, any reply goes out from the test number. (Per HANDOFF the WABA id was saved on 11-07; the phone id value was not verified here.)
4. NOT verified (needs Ahmed's access): the sheet `11O_CkemBGq3WEsQ2eGVW9ASJ0iNn3UPfHpmj4YMOcCM` log tabs, Apps Script Executions/quota page, WA_TOKEN validity, and the current Meta `platform_type`/`status`. If the number has since been migrated, this diagnosis is stale: check step 1 first.

## One caution about #69 (not a cause of the outage)
If auto-update is on (`autoServerUpdate`, every 15 min), merged `main` goes live without a manual deploy, so #69/#70 may already be running. They are inert unless the two NOVA properties are set. `UrlFetchApp` in Apps Script has no async mode or timeout option, so the forward is "non-blocking" only in the sense that it runs after the reply and cannot throw. The outbound forward inside `waCall_` does run before `waCall_` returns, so a slow NOVA endpoint adds latency to that call (never a failure). Moving it to a time-based trigger queue would remove that; I did not do so because it is not the cause and the brief says PR only for a code bug.

## Steps for Ahmed (in this order)
1. **Check the number state** (Meta Graph API Explorer, WABA 505759262610446): `GET /515646411625617?fields=platform_type,status,name_status,code_verification_status`.
   - If it is still `ON_PREMISE` / `DISCONNECTED`: nothing in code or Apps Script can fix it. Open Meta Direct Support (Business Support Home) and ask to migrate this number from On-Premises to Cloud API, or register a new number on Cloud API. In the support form do NOT choose the test account, do NOT deregister the number, do NOT change its PIN.
   - If it is `CLOUD_API` / `CONNECTED`: go to step 2.
2. In the bot dashboard / Script Properties, set `WA_PHONE_ID` = `515646411625617` and a **permanent** system-user token in `WA_TOKEN` (renew it if it expired; a 60-day user token expiring would also silence the bot). Do not paste the token anywhere outside Script Properties.
3. In Meta App → WhatsApp → Configuration, confirm the webhook callback URL is the CURRENT Apps Script web-app `/exec` URL (use the deployment that is "Execute as me, anyone access") and the `messages` field is subscribed for WABA 505759262610446. If the Apps Script deployment was changed, redeploy via Deploy → Manage deployments → Edit → **New version** (keep the same deployment so the URL does not change).
4. Apps Script → Executions: after a test message from Ahmed's own phone to the pharmacy number, confirm a `doPost` execution appears. Check Quotas if executions fail with "Service invoked too many times".
5. Optional, after the bot works: set `NOVA_WA_BRIDGE_URL` / `NOVA_WA_BRIDGE_TOKEN` (via `novaBridgeConfig` or Script Properties) so NOVA gets live copies. `BOT_AUTO_REPLY` unset = replies ON; set `'0'` only if auto-replies should stay off.
