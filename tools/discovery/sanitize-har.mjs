#!/usr/bin/env node
// Offline HAR / network-log sanitizer for supplier discovery.
// Strips every captured value; emits an endpoint-level structural summary only.
// Usage: node tools/discovery/sanitize-har.mjs input.har > out.json
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SAMPLE_ALLOWLIST = new Set([
  'price', 'value', 'formattedValue', 'currencyIso', 'stockLevelStatus',
  'totalResults', 'totalPages', 'pageSize', 'currentPage', 'appliedValue',
  'expires_in', 'token_type'
]);

const SECRET_KEY = /auth|token|cookie|session|password|passwd|secret|phone|mobile|email|address|account|user|customer|uid|otp/i;

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const isIdSegment = (s) => /^\d{8,}$/.test(s) || /^[0-9a-f]{16,}$/i.test(s) || isUuid(s);

export function templatePath(pathname) {
  return pathname
    .split('/')
    .map((seg) => (seg && isIdSegment(seg) ? '{id}' : seg))
    .join('/');
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function describeValue(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return v.length ? [describeValue(v[0])] : 'array';
  if (typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = describeValue(val);
    return out;
  }
  return typeof v;
}

function mergeFields(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (!(k in target)) {
      target[k] = v;
      continue;
    }
    const t = target[k];
    if (isPlainObject(t) && isPlainObject(v)) mergeFields(t, v);
    else if (Array.isArray(t) && Array.isArray(v) && isPlainObject(t[0]) && isPlainObject(v[0])) {
      mergeFields(t[0], v[0]);
    }
  }
}

function collectBodyPaths(value, prefix, out) {
  if (Array.isArray(value)) {
    if (value.length) collectBodyPaths(value[0], prefix, out);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [k, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.add(path);
    if (v !== null && typeof v === 'object') collectBodyPaths(v, path, out);
  }
}

function collectSamples(value, samples) {
  if (Array.isArray(value)) {
    for (const item of value) collectSamples(item, samples);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [k, v] of Object.entries(value)) {
    if (SAMPLE_ALLOWLIST.has(k) && (typeof v === 'number' || (typeof v === 'string' && v.length <= 40))) {
      if (!(k in samples)) samples[k] = v;
    }
    if (v !== null && typeof v === 'object') {
      if (SECRET_KEY.test(k) && !SAMPLE_ALLOWLIST.has(k)) continue;
      collectSamples(v, samples);
    }
  }
}

function decodeBody(content) {
  if (!content || typeof content.text !== 'string') return undefined;
  if (content.encoding === 'base64') {
    try {
      return Buffer.from(content.text, 'base64').toString('utf8');
    } catch {
      return undefined;
    }
  }
  return content.text;
}

export function sanitizeHar(har) {
  const entries = har?.log?.entries;
  if (!Array.isArray(entries)) throw new Error('input is not a HAR object (missing log.entries)');

  const groups = new Map();
  for (const entry of entries) {
    const resourceType = entry?._resourceType;
    const mime = String(entry?.response?.content?.mimeType || '').toLowerCase();
    const isJson = mime.includes('json');
    if (resourceType !== 'xhr' && resourceType !== 'fetch' && !isJson) continue;

    let url;
    try {
      url = new URL(entry?.request?.url || '');
    } catch {
      continue;
    }
    const method = String(entry?.request?.method || 'GET').toUpperCase();
    const host = url.host;
    const pathTemplate = templatePath(url.pathname);
    const key = `${method} ${host}${pathTemplate}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        method,
        host,
        pathTemplate,
        queryParamNames: new Set(),
        requestHeaderNames: new Set(),
        requestBodyFieldNames: new Set(),
        statusCodes: new Set(),
        responseFields: {},
        sampleValues: {},
        count: 0
      };
      groups.set(key, group);
    }
    group.count += 1;

    for (const name of url.searchParams.keys()) group.queryParamNames.add(name);
    for (const h of entry?.request?.headers || []) {
      if (h && typeof h.name === 'string') group.requestHeaderNames.add(h.name);
    }

    const postData = entry?.request?.postData;
    if (postData && typeof postData.text === 'string') {
      const postMime = String(postData.mimeType || '').toLowerCase();
      if (postMime.includes('json')) {
        try {
          collectBodyPaths(JSON.parse(postData.text), '', group.requestBodyFieldNames);
        } catch {
          // unparsable JSON body: record nothing
        }
      } else if (postMime.includes('application/x-www-form-urlencoded')) {
        for (const name of new URLSearchParams(postData.text).keys()) group.requestBodyFieldNames.add(name);
      }
    }

    const status = entry?.response?.status;
    if (Number.isFinite(status)) group.statusCodes.add(status);

    const bodyText = decodeBody(entry?.response?.content);
    if (isJson && typeof bodyText === 'string') {
      let parsed;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        parsed = undefined;
      }
      if (parsed !== null && typeof parsed === 'object') {
        mergeFields(group.responseFields, describeValue(parsed));
        collectSamples(parsed, group.sampleValues);
      }
    }
  }

  const endpoints = [...groups.values()]
    .map((g) => ({
      method: g.method,
      host: g.host,
      pathTemplate: g.pathTemplate,
      queryParamNames: [...g.queryParamNames].sort(),
      requestHeaderNames: [...g.requestHeaderNames].sort(),
      requestBodyFieldNames: [...g.requestBodyFieldNames].sort(),
      statusCodes: [...g.statusCodes].sort((a, b) => a - b),
      responseFields: g.responseFields,
      sampleValues: g.sampleValues,
      count: g.count
    }))
    .sort((a, b) =>
      `${a.host}${a.pathTemplate} ${a.method}`.localeCompare(`${b.host}${b.pathTemplate} ${b.method}`)
    );

  return { format: 'nova-rx-discovery/1', endpointCount: endpoints.length, endpoints };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const input = process.argv[2];
  if (!input) {
    console.error('usage: node tools/discovery/sanitize-har.mjs input.har > out.json');
    process.exit(2);
  }
  const raw = input === '-' ? readFileSync(0, 'utf8') : readFileSync(input, 'utf8');
  const out = sanitizeHar(JSON.parse(raw));
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}
