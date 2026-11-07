// Runs a Worker artifact in a vm sandbox with a fake Gemini and checks the AI routes end to end.
// Usage: node tests/unit/worker-gemini-route.check.mjs worker/live/<artifact>.js
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const file = process.argv[2];
assert(file, 'pass the Worker artifact path');
const handlers = {};
const gemini = { posts: [], prompt: '' };
const jsonRes = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const sandbox = {
  addEventListener: (t, h) => { handlers[t] = h; },
  GEMINI_API_KEY: 'test-key-12345678',
  fetch: async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith('/models?pageSize=100')) return jsonRes({ models: [{ name: 'models/gemini-3.8-flash', supportedActions: ['generateContent'], outputTokenLimit: 8192 }] });
    if (u.includes(':generateContent')) {
      const body = JSON.parse(init.body);
      gemini.posts.push(body);
      gemini.prompt = body.contents[0].parts[0].text;
      const batch = gemini.prompt.includes('"medications"');
      const payload = batch
        ? { items: [{ index: 0, dose: 'قرص', frequency: 'مرتين يوميًا', duration: '٥ أيام', instructions: 'بعد الأكل', warnings: ['حساسية بنسلين: تحذير'] }, { index: 1, dose: 'قرصين', frequency: 'كل ٨ ساعات', duration: '٣ أيام', instructions: 'عند اللزوم', warnings: [] }], interactions: ['تداخل تجريبي'] }
        : { complete: true, reviewRequired: true, dose: 'قرص', frequency: 'مرتين', duration: '٥ أيام', instructions: 'بعد الأكل', warnings: [], missingInformation: [] };
      return jsonRes({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(payload) }] } }] });
    }
    return new Response('passthrough');
  },
  Response, Request, URL, crypto, TextEncoder, TextDecoder, AbortSignal, AbortController, atob, btoa, Uint8Array, JSON, console, setTimeout, clearTimeout, Date, Math, Promise, Map, Set, Array, Object, String, Number, Error, RegExp
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: 'worker.js' });
assert.equal(typeof handlers.fetch, 'function');

async function hit(path, init = {}) {
  let p; const request = new Request('https://x.test' + path, init);
  handlers.fetch({ request, respondWith: r => { p = r; }, waitUntil() {} });
  return p ? await p : null;
}

// batch: one request for several medicines, with the patient's condition
let r = await hit('/api/ai/medication-labels', { method: 'POST', body: JSON.stringify({
  medications: [{ name: 'Augmentin 1g' }, { name: 'Panadol Extra' }],
  patient: { age: 30, pregnancy: false, breastfeeding: false, condition: 'التهاب حلق وحساسية بنسلين' }, locale: 'ar-EG' }) });
assert.equal(r.status, 200);
let d = await r.json();
assert(d.ok && d.items.length === 2 && d.items[0].warnings[0].includes('بنسلين') && d.interactions.length === 1);
assert.equal(gemini.posts.length, 1, 'one Gemini call for two medicines');
assert(gemini.prompt.includes('حساسية بنسلين'), 'condition reaches Gemini');
assert.equal(gemini.posts[0].generationConfig.thinkingConfig.thinkingBudget, 0, 'thinking is off for speed');

// single route still works and now also forwards the condition
r = await hit('/api/ai/medication-label', { method: 'POST', body: JSON.stringify({ medication: { name: 'Augmentin 1g' }, patient: { age: 30, condition: 'ضغط' } }) });
assert.equal(r.status, 200);
d = await r.json();
assert(d.ok && d.instruction.dose === 'قرص');
assert(gemini.prompt.includes('"condition": "ضغط"'));

// validation and methods
r = await hit('/api/ai/medication-labels', { method: 'POST', body: JSON.stringify({ medications: [] }) });
assert.equal(r.status, 400);
r = await hit('/api/ai/medication-labels');
assert.equal(r.status, 405);

// the rest of the Worker is untouched
r = await hit('/'); assert.equal(r.status, 200);
assert((await r.text()).includes('NOVA Rx'));
r = await hit('/api/settings/secrets'); assert.equal(r.status, 403);
r = await hit('/nope'); assert.equal(r.status, 404);

console.log('worker-gemini-route.check: PASS (' + file + ')');
