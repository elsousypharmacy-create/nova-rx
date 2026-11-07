import assert from 'node:assert/strict';
import {
  __testing,
  buildMedicationBatchPrompt,
  buildMedicationInstructionPrompt,
  generateJsonWithDiscoveredModel,
  handleMedicationLabelsRequest,
  listTextGenerationModels,
  normalizeBatchResult
} from '../../worker/gemini-label-service.js';

const json = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
const MODELS = [
  { name: 'models/gemini-3.5-flash-lite', supportedActions: ['generateContent'], outputTokenLimit: 8192 },
  { name: 'models/gemini-3.8-flash', supportedActions: ['generateContent'], outputTokenLimit: 8192 },
  { name: 'models/gemini-3.9-pro', supportedActions: ['generateContent'], outputTokenLimit: 8192 }
];
const candidate = obj => json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(obj) }] } }] });
const hang = (init) => new Promise((_, reject) => { init.signal && init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
const K = 'test-key-12345678';

// 1) the prompt now carries the patient's condition, and treats it as data
{
  const p = buildMedicationBatchPrompt({
    medications: [{ name: 'Augmentin 1g' }, { name: 'Panadol Extra' }],
    patient: { age: 30, pregnancy: false, breastfeeding: false, condition: 'التهاب حلق وحساسية بنسلين' }
  });
  assert(p.includes('حساسية بنسلين') && p.includes('"index": 1') && p.includes('interactions'));
  assert(p.includes('وليس تعليمات'), 'condition is declared as data, not instructions');
  const single = buildMedicationInstructionPrompt({ medication: { name: 'Augmentin 1g' }, patient: { condition: 'ضغط' } });
  assert(single.includes('"condition": "ضغط"'));
  const long = buildMedicationBatchPrompt({ medications: [{ name: 'x' }], patient: { condition: 'ا'.repeat(2000) } });
  assert(!long.includes('ا'.repeat(401)), 'condition is capped at 400 characters');
}

// 2) batch result maps by index, tolerates gaps, keeps interactions
{
  const r = normalizeBatchResult({
    items: [
      { index: 1, dose: 'قرص', frequency: 'مرة يوميًا', duration: '٣٠ يومًا', instructions: 'مساءً', warnings: ['ضغط: راجع الطبيب'] },
      { index: 0, dose: 'قرص', frequency: 'مرتين', duration: '٥ أيام', instructions: 'بعد الأكل', warnings: [] }
    ],
    interactions: ['كونكور مع ليبيتور: لا يوجد تداخل مهم']
  }, [{ name: 'A' }, { name: 'B' }, { name: 'C' }]);
  assert.equal(r.items.length, 3);
  assert.equal(r.items[0].dose, 'قرص');
  assert.equal(r.items[1].warnings[0], 'ضغط: راجع الطبيب');
  assert.equal(r.items[2].complete, false, 'a medicine the model skipped stays incomplete');
  assert.equal(r.interactions.length, 1);
}

// 3) model listing never hangs: a stuck discovery falls back to known names within its timeout
{
  __testing.resetModelCache();
  const t0 = Date.now();
  const models = await listTextGenerationModels({ apiKey: K, fetchImpl: (u, init) => hang(init), discoveryTimeoutMs: 1000 });
  assert(Date.now() - t0 < 2500, 'discovery gives up after its timeout');
  assert(models.length === 2 && /gemini-2\.5-flash/.test(models[0].name), 'known model names are used as fallback');
  __testing.resetModelCache();
  const down = await listTextGenerationModels({ apiKey: K, fetchImpl: async () => json({ error: { message: 'x' } }, 503) });
  assert(down.length === 2, '5xx on discovery also falls back');
  __testing.resetModelCache();
  await assert.rejects(listTextGenerationModels({ apiKey: K, fetchImpl: async () => json({ error: { message: 'API key not valid' } }, 400) }), e => e.code === 'MODEL_DISCOVERY_HTTP' && e.details.status === 400, 'a rejected key is reported, not hidden');
}

// 4) a slow model is skipped, the next one answers; at most 2 models; timeouts are not retried on the same model
{
  __testing.resetModelCache();
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    if (String(url).endsWith('/models?pageSize=100')) return json({ models: MODELS });
    seen.push(String(url));
    if (/flash-lite/.test(String(url))) return hang(init);
    return candidate({ ok: true });
  };
  const t0 = Date.now();
  const r = await generateJsonWithDiscoveredModel({ apiKey: K, fetchImpl, prompt: 'x', timeoutMs: 1000, deadlineMs: 6000 });
  assert.deepEqual(r.data, { ok: true });
  assert.equal(seen.length, 2, 'one try on the slow model, one on the next');
  assert(Date.now() - t0 < 3500);
}

// 5) overall deadline: everything slow -> a clear timeout error well before the old ~2 minutes
{
  __testing.resetModelCache();
  const fetchImpl = async (url, init = {}) => (String(url).endsWith('/models?pageSize=100') ? json({ models: MODELS }) : hang(init));
  const t0 = Date.now();
  await assert.rejects(generateJsonWithDiscoveredModel({ apiKey: K, fetchImpl, prompt: 'x', timeoutMs: 1500, deadlineMs: 3000 }), e => e.code === 'GEMINI_TIMEOUT');
  assert(Date.now() - t0 < 6000, 'gives up quickly');
}

// 6) thinking is switched off on the first try and dropped when the model rejects it (400)
{
  __testing.resetModelCache();
  const bodies = [];
  const fetchImpl = async (url, init = {}) => {
    if (String(url).endsWith('/models?pageSize=100')) return json({ models: [MODELS[1]] });
    const b = JSON.parse(init.body);
    bodies.push(b.generationConfig);
    if (b.generationConfig.thinkingConfig) return json({ error: { message: 'thinking not supported' } }, 400);
    return candidate({ ok: true });
  };
  const r = await generateJsonWithDiscoveredModel({ apiKey: K, fetchImpl, prompt: 'x', thinkingBudget: 0 });
  assert.deepEqual(r.data, { ok: true });
  assert.equal(bodies[0].thinkingConfig.thinkingBudget, 0);
  assert.equal(bodies[1].thinkingConfig, undefined);
}

// 7) the HTTP handler: one request for all medicines, condition reaches Gemini, errors keep their code
{
  __testing.resetModelCache();
  let prompt = '';
  const okFetch = async (url, init = {}) => {
    if (String(url).endsWith('/models?pageSize=100')) return json({ models: [MODELS[1]] });
    prompt = JSON.parse(init.body).contents[0].parts[0].text;
    return candidate({
      items: [
        { index: 0, dose: 'قرص', frequency: 'مرتين يوميًا', duration: '٥ أيام', instructions: 'بعد الأكل', warnings: ['حساسية بنسلين: الأوجمنتين من فصيلة البنسلين'] },
        { index: 1, dose: 'قرصين', frequency: 'كل ٨ ساعات', duration: null, instructions: 'عند اللزوم', warnings: [] }
      ],
      interactions: []
    });
  };
  const req = body => new Request('https://x.test/api/ai/medication-labels', { method: 'POST', body: JSON.stringify(body) });
  const res = await handleMedicationLabelsRequest(req({
    medications: [{ name: 'Augmentin 1g' }, { name: 'Panadol Extra' }],
    patient: { age: 30, pregnancy: false, breastfeeding: false, condition: 'حساسية بنسلين' }
  }), { GEMINI_API_KEY: K }, { fetchImpl: okFetch });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert(data.ok && data.items.length === 2 && data.items[0].warnings[0].includes('بنسلين'));
  assert.equal(data.items[1].complete, false);
  assert(prompt.includes('حساسية بنسلين'), 'the condition is sent to Gemini');

  const bad = await handleMedicationLabelsRequest(req({ medications: [] }), { GEMINI_API_KEY: K }, { fetchImpl: okFetch });
  assert.equal(bad.status, 400);
  const noKey = await handleMedicationLabelsRequest(req({ medications: [{ name: 'x' }] }), {}, { fetchImpl: okFetch });
  assert.equal(noKey.status, 500);
  assert.equal((await noKey.json()).code, 'GEMINI_KEY_MISSING');
  __testing.resetModelCache();
  const down = await handleMedicationLabelsRequest(req({ medications: [{ name: 'x' }] }), { GEMINI_API_KEY: K }, {
    fetchImpl: async (u) => (String(u).endsWith('/models?pageSize=100') ? json({ models: [MODELS[1]] }) : json({ error: { message: 'API key not valid' } }, 403))
  });
  const dd = await down.json();
  assert.equal(down.status, 502);
  assert(dd.code === 'GEMINI_HTTP_ERROR' && dd.details.status === 403, 'the UI can tell a rejected key from a slow model');
  const get = await handleMedicationLabelsRequest(new Request('https://x.test/api/ai/medication-labels'), { GEMINI_API_KEY: K });
  assert.equal(get.status, 405);
}

console.log('gemini-batch.check: PASS');
