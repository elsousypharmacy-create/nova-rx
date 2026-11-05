import assert from 'node:assert/strict';
import {
  __testing,
  assertCompleteMedicationInstruction,
  filterTextGenerationModels,
  generateJsonWithDiscoveredModel,
  listTextGenerationModels,
  normalizeMedicationInstruction,
  parseJsonFromModelText,
  IncompleteMedicationInstructionError
} from '../../worker/gemini-label-service.js';
import {
  LABEL_SIZE_PRESETS,
  buildStickerPageCss,
  buildStickerPreviewStyle,
  createStickerPrintSettingsStore,
  normalizeStickerPrintSettings,
  resolveStickerDimensions
} from '../../worker/sticker-print-settings.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function modelPayload(models) {
  return jsonResponse({ models });
}

const models = [
  { name: 'models/gemini-embedding-001', supportedActions: ['generateContent'], outputTokenLimit: 8192 },
  { name: 'models/gemini-3.5-flash-lite', supportedActions: ['generateContent'], outputTokenLimit: 8192, inputTokenLimit: 1000000 },
  { name: 'models/gemini-3.8-flash', supportedActions: ['generateContent'], outputTokenLimit: 8192, inputTokenLimit: 1000000 },
  { name: 'models/gemini-vision-image', supportedActions: ['generateContent'], outputTokenLimit: 8192 }
];

async function testModelDiscoveryAndCache() {
  __testing.resetModelCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return modelPayload(models);
  };
  const first = await listTextGenerationModels({ apiKey: 'test-key-12345678', fetchImpl, cacheTtlMs: 60000 });
  const second = await listTextGenerationModels({ apiKey: 'test-key-12345678', fetchImpl, cacheTtlMs: 60000 });
  assert.equal(calls, 1, 'model discovery must be cached');
  assert.deepEqual(second, first);
  assert.equal(first[0].name, 'models/gemini-3.5-flash-lite');
  assert(!first.some(model => /embed|image/i.test(model.name)), 'unsuitable media/embedding models are excluded');
}

async function testStrictJsonFallbackAndParsing() {
  __testing.resetModelCache();
  const postBodies = [];
  let posts = 0;
  const fetchImpl = async (url, init = {}) => {
    if (String(url).endsWith('/models?pageSize=100')) return modelPayload(models);
    posts += 1;
    postBodies.push(JSON.parse(init.body));
    if (posts === 1) return jsonResponse({ error: { code: 400, message: 'responseMimeType unsupported' } }, 400);
    return jsonResponse({
      candidates: [{
        finishReason: 'STOP',
        content: { parts: [{ text: '```json\n{"ok":true,"count":2}\n```' }] }
      }]
    });
  };

  const result = await generateJsonWithDiscoveredModel({
    apiKey: 'test-key-12345678',
    fetchImpl,
    prompt: 'Return JSON only',
    responseSchema: { type: 'object' },
    retriesPerModel: 0
  });
  assert.deepEqual(result.data, { ok: true, count: 2 });
  assert.equal(posts, 2, '400 on strict JSON config retries without schema/mime');
  assert.equal(postBodies[0].generationConfig.responseMimeType, 'application/json');
  assert.equal(postBodies[1].generationConfig.responseMimeType, undefined);
  assert.equal(result.attempts.length, 2);
}

async function testTruncatedResponseIsRejected() {
  __testing.resetModelCache();
  const fetchImpl = async (url) => {
    if (String(url).endsWith('/models?pageSize=100')) return modelPayload([models[1]]);
    return jsonResponse({
      candidates: [{
        finishReason: 'MAX_TOKENS',
        content: { parts: [{ text: '{"dose":"1 tablet"' }] }
      }]
    });
  };

  await assert.rejects(
    generateJsonWithDiscoveredModel({
      apiKey: 'test-key-12345678',
      fetchImpl,
      prompt: 'Return JSON only',
      retriesPerModel: 0
    }),
    error => error.code === 'GEMINI_TRUNCATED_RESPONSE' && error.details.finishReason === 'MAX_TOKENS'
  );
}

async function testInstructionValidationNeverAcceptsIncompleteDraft() {
  const draft = normalizeMedicationInstruction({
    medicationName: 'Glucophage 500mg',
    complete: true,
    reviewRequired: false,
    dose: 'قرص واحد',
    frequency: '',
    duration: null,
    instructions: 'بعد الأكل',
    warnings: ['راجع الصيدلي'],
    missingInformation: []
  });
  assert.equal(draft.complete, false);
  assert(draft.missingInformation.includes('frequency'));
  assert(draft.missingInformation.includes('duration'));
  assert.throws(() => assertCompleteMedicationInstruction(draft), IncompleteMedicationInstructionError);

  const complete = assertCompleteMedicationInstruction({
    medicationName: 'Glucophage 500mg',
    complete: true,
    reviewRequired: true,
    dose: 'قرص واحد',
    frequency: 'مرتين يوميًا',
    duration: 'حسب الوصفة',
    instructions: 'بعد الأكل',
    warnings: [],
    missingInformation: []
  });
  assert.equal(complete.complete, true);
  assert.equal(complete.reviewRequired, true);
}

async function testPrintSettings() {
  assert.equal(LABEL_SIZE_PRESETS.length, 8);
  assert.deepEqual(
    LABEL_SIZE_PRESETS.map(p => p.id),
    ['50x30', '40x30', '40x25', '50x25', '58x40', '60x40', '70x50', '100x50']
  );

  const normalized = normalizeStickerPrintSettings({
    presetId: 'custom',
    customWidthMm: '57.5',
    customHeightMm: '39.5',
    paperLayout: 'split',
    style: 'compact',
    marginMm: 99,
    orientation: 'landscape',
    copies: 100
  });
  assert.deepEqual(normalized, {
    presetId: 'custom',
    customWidthMm: 57.5,
    customHeightMm: 39.5,
    paperLayout: 'split',
    style: 'compact',
    marginMm: 10,
    orientation: 'landscape',
    copies: 50
  });
  assert.deepEqual(resolveStickerDimensions(normalized).widthMm, 57.5);
  assert.match(buildStickerPageCss(normalized), /@page\{size:57\.5mm 39\.5mm;margin:10mm\}/);
  assert.equal(buildStickerPreviewStyle(normalized).width, '57.5mm');

  const memory = new Map();
  const storage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: key => memory.delete(key)
  };
  const store = createStickerPrintSettingsStore(storage, 'test-settings');
  const saved = store.save({ presetId: '100x50', paperLayout: 'split', style: 'compact', marginMm: 1.5, orientation: 'auto', copies: 2 });
  assert.equal(saved.persisted, true);
  assert.deepEqual(store.load(), saved.settings);
  const stored = JSON.parse(memory.get('test-settings'));
  assert(!('patient' in stored) && !('apiKey' in stored), 'only printer preferences are persisted');
}

function testJsonParser() {
  assert.deepEqual(parseJsonFromModelText('prefix {"a":1} suffix'), { a: 1 });
  assert.deepEqual(parseJsonFromModelText('[1,2]'), [1, 2]);
}

function testModelScoring() {
  const ranked = filterTextGenerationModels(models);
  assert(ranked[0].score >= ranked[1].score);
  assert(!ranked.some(model => /embedding|image/.test(model.name)));
}

await testModelDiscoveryAndCache();
await testStrictJsonFallbackAndParsing();
await testTruncatedResponseIsRejected();
await testInstructionValidationNeverAcceptsIncompleteDraft();
await testPrintSettings();
testJsonParser();
testModelScoring();

console.log('✓ gemini-label-service and sticker-print-settings checks passed');
