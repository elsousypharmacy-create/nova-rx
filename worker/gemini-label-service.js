/**
 * NOVA Rx — Gemini medication-label service.
 * Cloudflare Worker-compatible and dependency-free.
 *
 * Safety contract:
 * - Discover text-generation models dynamically; never require a hardcoded model.
 * - Cache discovery briefly to avoid listing models on every request.
 * - Reject truncated, malformed, or incomplete responses.
 * - Preserve incomplete drafts for pharmacist review; never fabricate dosage data.
 * - Send GEMINI_API_KEY only in the x-goog-api-key header and never log it.
 */

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL_CACHE_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_MAX_MODELS = 4;
const RETRYABLE_HTTP = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const UNSUITABLE_MODEL_PATTERN = /(embed|embedding|aqa|image|imagen|veo|video|tts|speech|audio|live|native|robot|computer-use|code-execution|search-grounding)/i;

let sharedModelCache = {
  key: '',
  expiresAt: 0,
  models: []
};

export class GeminiServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GeminiServiceError';
    this.code = code;
    this.details = sanitizeDetails(details);
  }
}

export class IncompleteMedicationInstructionError extends GeminiServiceError {
  constructor(message, details = {}) {
    super('INCOMPLETE_INSTRUCTIONS', message, details);
    this.name = 'IncompleteMedicationInstructionError';
  }
}

function sanitizeDetails(value) {
  if (value == null) return {};
  try {
    return JSON.parse(JSON.stringify(value, (key, item) => {
      if (/api[-_]?key|authorization|token|secret/i.test(key)) return '[redacted]';
      if (typeof item === 'string' && item.length > 1200) return item.slice(0, 1200) + '…';
      return item;
    }));
  } catch (_) {
    return { note: 'unserializable details omitted' };
  }
}

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders
    }
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function modelId(model) {
  return String(model && model.name || '').replace(/^models\//, '');
}

function modelDisplayName(model) {
  return String(model && (model.displayName || model.name) || '').toLowerCase();
}

function supportsGenerateContent(model) {
  const actions = model && (model.supportedActions || model.supportedGenerationMethods || model.supportedMethods);
  return Array.isArray(actions) && actions.some(action => String(action).toLowerCase() === 'generatecontent');
}

function scoreTextModel(model) {
  const id = modelId(model).toLowerCase();
  const display = modelDisplayName(model);
  const combined = `${id} ${display}`;
  if (!id || UNSUITABLE_MODEL_PATTERN.test(combined)) return -1;

  let score = 0;
  if (/flash-lite/.test(combined)) score += 90;
  if (/flash/.test(combined)) score += 75;
  if (/gemini/.test(combined)) score += 35;
  if (/stable|ga|latest/.test(combined)) score += 18;
  if (/preview|experimental|beta/.test(combined)) score -= 12;
  if (/pro/.test(combined)) score -= 8;
  if (/lite/.test(combined)) score += 8;

  const outputLimit = Number(model.outputTokenLimit || model.output_token_limit || 0);
  if (outputLimit >= 8192) score += 10;
  else if (outputLimit >= 4096) score += 6;

  const inputLimit = Number(model.inputTokenLimit || model.input_token_limit || 0);
  if (inputLimit >= 100000) score += 3;
  return score;
}

function comparableModel(model) {
  return {
    name: model.name,
    displayName: model.displayName || '',
    score: scoreTextModel(model),
    inputTokenLimit: Number(model.inputTokenLimit || model.input_token_limit || 0),
    outputTokenLimit: Number(model.outputTokenLimit || model.output_token_limit || 0)
  };
}

export function filterTextGenerationModels(models) {
  return (Array.isArray(models) ? models : [])
    .filter(model => model && supportsGenerateContent(model))
    .map(comparableModel)
    .filter(model => model.score >= 0)
    .sort((a, b) => b.score - a.score || b.outputTokenLimit - a.outputTokenLimit || a.name.localeCompare(b.name));
}

function cacheKey(apiKey, overrideModels) {
  return `${String(apiKey || '').slice(-8)}:${Array.isArray(overrideModels) ? overrideModels.join(',') : 'discover'}`;
}

export async function listTextGenerationModels({
  apiKey,
  fetchImpl = fetch,
  cacheTtlMs = DEFAULT_MODEL_CACHE_MS,
  forceRefresh = false,
  preferredModels = [],
  now = Date.now
} = {}) {
  if (!apiKey) throw new GeminiServiceError('GEMINI_KEY_MISSING', 'GEMINI_API_KEY binding is missing.');

  const explicit = filterTextGenerationModels((Array.isArray(preferredModels) ? preferredModels : [])
    .map(name => ({ name: String(name).replace(/^models\//, 'models/'), supportedActions: ['generateContent'] })));
  if (explicit.length) return explicit;

  const key = cacheKey(apiKey, preferredModels);
  if (!forceRefresh && sharedModelCache.key === key && sharedModelCache.expiresAt > now() && sharedModelCache.models.length) {
    return sharedModelCache.models;
  }

  let response;
  try {
    response = await fetchImpl(`${GEMINI_BASE_URL}/models?pageSize=100`, {
      method: 'GET',
      headers: { 'x-goog-api-key': apiKey }
    });
  } catch (error) {
    throw new GeminiServiceError('MODEL_DISCOVERY_NETWORK', 'Could not reach the Gemini Models API.', { cause: String(error && error.message || error) });
  }

  const payload = await safeJson(response);
  if (!response.ok) {
    throw new GeminiServiceError('MODEL_DISCOVERY_HTTP', `Gemini model discovery failed with HTTP ${response.status}.`, {
      status: response.status,
      error: payload && payload.error ? { code: payload.error.code, status: payload.error.status, message: payload.error.message } : undefined
    });
  }

  const models = filterTextGenerationModels(payload.models || []);
  if (!models.length) {
    throw new GeminiServiceError('NO_TEXT_MODELS', 'The Gemini Models API returned no suitable generateContent text models.', {
      returnedModels: Array.isArray(payload.models) ? payload.models.length : 0
    });
  }

  sharedModelCache = {
    key,
    expiresAt: now() + Math.max(1000, Number(cacheTtlMs) || DEFAULT_MODEL_CACHE_MS),
    models
  };
  return models;
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch (_) { return { rawText: text.slice(0, 1500) }; }
}

function endpointForModel(modelName) {
  const clean = String(modelName || '').replace(/^models\//, '');
  return `${GEMINI_BASE_URL}/models/${encodeURIComponent(clean)}:generateContent`;
}

function buildGenerateContentBody({ prompt, maxOutputTokens, temperature, responseSchema, strictJson }) {
  const generationConfig = {
    temperature,
    candidateCount: 1,
    maxOutputTokens
  };
  if (strictJson) generationConfig.responseMimeType = 'application/json';
  if (strictJson && responseSchema) generationConfig.responseSchema = responseSchema;
  return {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig
  };
}

function extractCandidateText(payload) {
  const candidate = payload && Array.isArray(payload.candidates) ? payload.candidates[0] : null;
  const parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const text = parts.map(part => typeof part.text === 'string' ? part.text : '').filter(Boolean).join('\n').trim();
  return { candidate, text };
}

export function parseJsonFromModelText(text) {
  const source = String(text || '').trim();
  if (!source) throw new GeminiServiceError('EMPTY_MODEL_RESPONSE', 'Gemini returned an empty text response.');

  const withoutFence = source
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const candidates = [withoutFence];
  const firstObject = withoutFence.indexOf('{');
  const lastObject = withoutFence.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) candidates.push(withoutFence.slice(firstObject, lastObject + 1));
  const firstArray = withoutFence.indexOf('[');
  const lastArray = withoutFence.lastIndexOf(']');
  if (firstArray >= 0 && lastArray > firstArray) candidates.push(withoutFence.slice(firstArray, lastArray + 1));

  for (const candidate of candidates) {
    try { return JSON.parse(candidate); }
    catch (_) { /* try the next shape */ }
  }
  throw new GeminiServiceError('MODEL_JSON_PARSE_FAILED', 'Gemini returned non-JSON or malformed JSON output.', {
    preview: source.slice(0, 400)
  });
}

function isTransientHttp(status) {
  return RETRYABLE_HTTP.has(Number(status));
}

function responseErrorDetails(payload) {
  const error = payload && payload.error;
  if (!error) return {};
  return { code: error.code, status: error.status, message: error.message };
}

async function requestModel({ model, body, apiKey, fetchImpl, timeoutMs }) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetchImpl(endpointForModel(model.name), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined
    });
    const payload = await safeJson(response);
    return { response, payload };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function generateJsonWithDiscoveredModel({
  apiKey,
  prompt,
  responseSchema,
  fetchImpl = fetch,
  cacheTtlMs,
  forceRefreshModels = false,
  preferredModels = [],
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
  temperature = 0.1,
  maxModels = DEFAULT_MAX_MODELS,
  retriesPerModel = 1,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new GeminiServiceError('PROMPT_MISSING', 'A non-empty prompt is required.');
  }

  const models = await listTextGenerationModels({
    apiKey,
    fetchImpl,
    cacheTtlMs,
    forceRefresh: forceRefreshModels,
    preferredModels
  });
  const selected = models.slice(0, Math.max(1, Number(maxModels) || DEFAULT_MAX_MODELS));
  const attempts = [];
  let lastError = null;

  for (const model of selected) {
    let strictJson = true;
    for (let attempt = 0; attempt <= Math.max(0, Number(retriesPerModel) || 0); attempt += 1) {
      const started = Date.now();
      const body = buildGenerateContentBody({ prompt, maxOutputTokens, temperature, responseSchema, strictJson });
      try {
        const { response, payload } = await requestModel({ model, body, apiKey, fetchImpl, timeoutMs });
        const elapsedMs = Date.now() - started;
        attempts.push({ model: model.name, status: response.status, strictJson, elapsedMs });

        if (!response.ok) {
          const details = responseErrorDetails(payload);
          const error = new GeminiServiceError('GEMINI_HTTP_ERROR', `Gemini ${model.name} returned HTTP ${response.status}.`, {
            model: model.name,
            status: response.status,
            ...details
          });
          if (response.status === 400 && strictJson) {
            strictJson = false;
            attempt -= 1;
            lastError = error;
            continue;
          }
          if (isTransientHttp(response.status) && attempt < retriesPerModel) {
            lastError = error;
            await sleep(Math.min(2500, 350 * (attempt + 1)));
            continue;
          }
          throw error;
        }

        const { candidate, text } = extractCandidateText(payload);
        const finishReason = String(candidate && candidate.finishReason || '').toUpperCase();
        if (finishReason && finishReason !== 'STOP' && finishReason !== 'FINISH_REASON_UNSPECIFIED') {
          throw new GeminiServiceError('GEMINI_TRUNCATED_RESPONSE', `Gemini stopped before a complete response (${finishReason}).`, {
            model: model.name,
            finishReason,
            maxOutputTokens
          });
        }
        if (!text) {
          throw new GeminiServiceError('EMPTY_MODEL_RESPONSE', 'Gemini returned no candidate text.', {
            model: model.name,
            finishReason: finishReason || null
          });
        }

        const data = parseJsonFromModelText(text);
        return {
          data,
          model: model.name,
          rawText: text,
          finishReason: finishReason || 'STOP',
          attempts
        };
      } catch (error) {
        const wrapped = error && error.name === 'AbortError'
          ? new GeminiServiceError('GEMINI_TIMEOUT', `Gemini ${model.name} timed out after ${timeoutMs}ms.`, { model: model.name, timeoutMs })
          : error;
        lastError = wrapped;
        if (attempt < retriesPerModel && wrapped instanceof GeminiServiceError &&
          ['GEMINI_TIMEOUT', 'GEMINI_TRUNCATED_RESPONSE', 'EMPTY_MODEL_RESPONSE', 'MODEL_JSON_PARSE_FAILED'].includes(wrapped.code)) {
          await sleep(Math.min(2000, 300 * (attempt + 1)));
          continue;
        }
        break;
      }
    }
  }

  if (lastError instanceof GeminiServiceError) {
    lastError.details = sanitizeDetails({ ...lastError.details, attempts });
    throw lastError;
  }
  throw new GeminiServiceError('GEMINI_GENERATION_FAILED', 'Gemini generation failed without a detailed error.', { attempts });
}

export const MEDICATION_INSTRUCTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['medicationName', 'complete', 'reviewRequired', 'dose', 'frequency', 'duration', 'instructions', 'warnings', 'missingInformation'],
  properties: {
    medicationName: { type: 'string' },
    complete: { type: 'boolean' },
    reviewRequired: { type: 'boolean' },
    dose: { type: ['string', 'null'] },
    frequency: { type: ['string', 'null'] },
    duration: { type: ['string', 'null'] },
    instructions: { type: ['string', 'null'] },
    warnings: { type: 'array', items: { type: 'string' } },
    missingInformation: { type: 'array', items: { type: 'string' } }
  }
};

function cleanString(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function cleanStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(cleanString).filter(Boolean).slice(0, 12);
}

export function normalizeMedicationInstruction(value, { medicationName = '' } = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const normalized = {
    medicationName: cleanString(input.medicationName) || cleanString(medicationName) || 'دواء غير مسمى',
    complete: input.complete === true,
    reviewRequired: true,
    dose: cleanString(input.dose),
    frequency: cleanString(input.frequency),
    duration: cleanString(input.duration),
    instructions: cleanString(input.instructions),
    warnings: cleanStringArray(input.warnings),
    missingInformation: cleanStringArray(input.missingInformation)
  };

  const missing = [];
  for (const key of ['dose', 'frequency', 'duration', 'instructions']) {
    if (!normalized[key]) missing.push(key);
  }
  normalized.missingInformation = [...new Set([...normalized.missingInformation, ...missing])];
  if (missing.length) normalized.complete = false;
  return normalized;
}

export function assertCompleteMedicationInstruction(value, context = {}) {
  const normalized = normalizeMedicationInstruction(value, context);
  if (!normalized.complete || normalized.reviewRequired && normalized.missingInformation.length) {
    throw new IncompleteMedicationInstructionError('Gemini returned incomplete medication instructions; preserve the draft for pharmacist review.', {
      medicationName: normalized.medicationName,
      missingInformation: normalized.missingInformation,
      draft: normalized
    });
  }
  return normalized;
}

export function buildMedicationInstructionPrompt({ medication = {}, patient = {}, locale = 'ar-EG' } = {}) {
  const medicationName = cleanString(medication.name || medication.medicationName || medication.title);
  if (!medicationName) throw new GeminiServiceError('MEDICATION_NAME_MISSING', 'Medication name is required before AI label generation.');

  const facts = {
    medication: {
      name: medicationName,
      strength: cleanString(medication.strength),
      form: cleanString(medication.form),
      prescribedDose: cleanString(medication.prescribedDose || medication.dose),
      prescribedFrequency: cleanString(medication.prescribedFrequency || medication.frequency),
      prescribedDuration: cleanString(medication.prescribedDuration || medication.duration)
    },
    patient: {
      age: cleanString(patient.age),
      weightKg: cleanString(patient.weightKg || patient.weight),
      pregnancy: patient.pregnancy === true ? 'yes' : patient.pregnancy === false ? 'no' : 'unknown',
      breastfeeding: patient.breastfeeding === true ? 'yes' : patient.breastfeeding === false ? 'no' : 'unknown'
    }
  };

  return `أنت مساعد صيدلي داخل نظام NOVA Rx. مهمتك تجهيز مسودة استيكر دواء للمراجعة البشرية فقط.

قواعد إلزامية:
- استخدم فقط الحقائق الموجودة في JSON التالي، ولا تخمّن جرعة أو تكرارًا أو مدة غير مذكورة.
- إذا كانت الجرعة أو التكرار أو المدة أو التعليمات غير كافية، اجعل complete=false واذكر الحقول الناقصة في missingInformation.
- reviewRequired يجب أن يكون true دائمًا؛ الاعتماد النهائي للصيدلي فقط.
- اكتب بالعربية الواضحة المختصرة المناسبة للاستيكر.
- warnings تكون عامة ومرتبطة بالبيانات المتاحة فقط، مثل الحمل أو الرضاعة أو الأطفال، دون ادعاء تشخيصي.
- أعد JSON صالحًا فقط مطابقًا للمخطط المطلوب، بدون Markdown أو شرح خارج JSON.

الحقائق المتاحة:
${JSON.stringify(facts, null, 2)}

اللغة المطلوبة: ${locale}`;
}

export async function generateMedicationInstruction(input, options = {}) {
  const prompt = buildMedicationInstructionPrompt(input || {});
  const result = await generateJsonWithDiscoveredModel({
    ...options,
    prompt,
    responseSchema: options.responseSchema || MEDICATION_INSTRUCTION_SCHEMA
  });
  const instruction = normalizeMedicationInstruction(result.data, {
    medicationName: input && (input.medication?.name || input.medication?.medicationName || input.medicationName)
  });
  return {
    instruction,
    complete: instruction.complete && instruction.missingInformation.length === 0,
    reviewRequired: true,
    meta: {
      model: result.model,
      finishReason: result.finishReason,
      attempts: result.attempts
    }
  };
}

export async function handleMedicationLabelRequest(request, env = {}, options = {}) {
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, code: 'METHOD_NOT_ALLOWED', error: 'Use POST.' }, 405, { allow: 'POST' });
  }
  let body;
  try { body = await request.json(); }
  catch (_) { return jsonResponse({ ok: false, code: 'INVALID_JSON', error: 'Request body must be valid JSON.' }, 400); }

  const apiKey = options.apiKey || env.GEMINI_API_KEY;
  if (!apiKey) return jsonResponse({ ok: false, code: 'GEMINI_KEY_MISSING', error: 'Gemini API key binding is not configured.' }, 500);

  try {
    const result = await generateMedicationInstruction({
      medication: body.medication || body,
      patient: body.patient || {},
      locale: body.locale || 'ar-EG'
    }, {
      ...options,
      apiKey,
      fetchImpl: options.fetchImpl || fetch
    });
    return jsonResponse({ ok: result.complete, ...result });
  } catch (error) {
    if (error instanceof IncompleteMedicationInstructionError) {
      return jsonResponse({ ok: false, code: error.code, error: error.message, draft: error.details.draft || null }, 200);
    }
    if (error instanceof GeminiServiceError) {
      const status = error.code === 'GEMINI_KEY_MISSING' ? 500 : error.code === 'MEDICATION_NAME_MISSING' ? 400 : 502;
      return jsonResponse({ ok: false, code: error.code, error: error.message, details: error.details }, status);
    }
    return jsonResponse({ ok: false, code: 'UNEXPECTED_AI_ERROR', error: 'Unexpected AI label generation error.' }, 500);
  }
}

export const __testing = {
  scoreTextModel,
  endpointForModel,
  buildGenerateContentBody,
  extractCandidateText,
  resetModelCache() {
    sharedModelCache = { key: '', expiresAt: 0, models: [] };
  }
};
