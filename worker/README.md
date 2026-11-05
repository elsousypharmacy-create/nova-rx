# NOVA Rx Worker integration notes

## Scope

`worker/gemini-label-service.js` is a dependency-free drop-in service for the live Cloudflare Worker. It is intentionally separate from `index.html` because the deployed Worker currently contains newer sticker UI and Gemini code than GitHub.

Do **not** deploy the GitHub `index.html` over the live Worker. Export or edit the live Worker, merge this service into it, preserve the existing HTML/CSS/JS, then deploy with rollback available.

## Required integration

1. Preserve the existing Worker frontend and all current sticker code, including the approved NOVA Labels layout.
2. Preserve the `GEMINI_API_KEY` secret binding. Do not log or return its value.
3. Import or paste `worker/gemini-label-service.js` into the Worker bundle.
4. Route the medication-label endpoint to:

```js
import { handleMedicationLabelRequest } from './worker/gemini-label-service.js';

if (url.pathname === '/api/ai/medication-label') {
  return handleMedicationLabelRequest(request, env);
}
```

If the live route name differs, keep the live route name and call the same handler.

5. Do not list Gemini models on every request. The service caches discovery for 10 minutes per Worker isolate and filters for text models supporting `generateContent`.
6. Do not accept incomplete AI output as approved. Incomplete drafts must remain `reviewRequired: true`, with missing fields shown to the pharmacist.
7. Keep the purchase-invoice AI route unchanged unless it shares the same model-selection failure; if it does, reuse the same discovery/generation helper without changing purchase UX.

## Why this fixes the observed failure mode

The reported “Gemini returned incomplete instructions; please retry” can be produced by several different failure shapes:

- model discovery selecting an unsuitable media/embedding model;
- a model stopping with `MAX_TOKENS` or another non-STOP finish reason;
- strict JSON schema/MIME support varying by model;
- malformed or fenced JSON being treated as a valid answer;
- low output-token limits or retries against the same bad model;
- model listing on every request, adding latency and another failure point.

The service addresses these with cached dynamic discovery, text-model filtering, strict-then-compatible JSON requests, bounded retries across models, finish-reason checks, robust JSON parsing, and explicit completeness validation.

## Print settings helper

`worker/sticker-print-settings.js` contains the approved label-size presets, custom dimensions, single/split paper, full/compact styles, margins, orientation, copies, local persistence, preview geometry, and `@page` CSS generation. It stores only printer preferences and must not receive patient data or API secrets.

Wire it to the existing live sticker UI during Worker merge; do not replace the live sticker UI with the older GitHub panel.
