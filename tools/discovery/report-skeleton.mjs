#!/usr/bin/env node
// Markdown discovery-report skeleton from a sanitized HAR summary.
// Usage: node tools/discovery/report-skeleton.mjs out.json "Supplier"
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const LOGIN_PATH = /login|signin|auth|oauth|token/i;
const CART_PATH = /cart|basket/i;
const PAGINATION_KEYS = ['totalResults', 'totalPages', 'pageSize', 'currentPage'];
const PAGINATION_PARAMS = /^(page|currentPage|pageSize|offset|limit|skip|top)$/i;
const PRICE_KEYS = ['price', 'value', 'formattedValue', 'currencyIso', 'appliedValue'];
const STOCK_KEYS = ['stockLevelStatus'];

function fieldLines(fields, indent = '') {
  const lines = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      lines.push(`${indent}- ${k}: object`);
      lines.push(...fieldLines(v, indent + '  '));
    } else if (Array.isArray(v)) {
      const inner = v[0];
      if (inner !== null && typeof inner === 'object') {
        lines.push(`${indent}- ${k}: array of object`);
        if (typeof inner === 'object' && !Array.isArray(inner)) lines.push(...fieldLines(inner, indent + '  '));
      } else {
        lines.push(`${indent}- ${k}: array of ${inner}`);
      }
    } else {
      lines.push(`${indent}- ${k}: ${v}`);
    }
  }
  return lines;
}

const endpointLabel = (e) => `${e.method} ${e.host}${e.pathTemplate}`;

export function renderReport(data, supplier) {
  const endpoints = data.endpoints || [];
  const totalCalls = endpoints.reduce((n, e) => n + e.count, 0);
  const lines = [];

  lines.push(`# Supplier discovery report — ${supplier}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Source: offline sanitized capture (\`${data.format || 'unknown'}\`); all header, cookie, query, and body values stripped.`);
  lines.push(`- Endpoints observed: ${endpoints.length} (total calls: ${totalCalls}).`);
  lines.push('- Every endpoint below is marked `Observed` — seen in the capture, not confirmed as a stable, documented API.');
  lines.push('');

  lines.push('## Endpoints');
  lines.push('');
  lines.push('| Status | Method | Endpoint | Calls | Status codes | Query params |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const e of endpoints) {
    lines.push(
      `| Observed | ${e.method} | \`${e.host}${e.pathTemplate}\` | ${e.count} | ${e.statusCodes.join(', ') || '—'} | ${e.queryParamNames.join(', ') || '—'} |`
    );
  }
  if (!endpoints.length) lines.push('| — | — | — | — | — | — |');
  lines.push('');

  lines.push('## Login flow');
  lines.push('');
  const loginEndpoints = endpoints.filter(
    (e) => LOGIN_PATH.test(e.pathTemplate) || e.requestBodyFieldNames.some((f) => /(^|\.)password$/.test(f))
  );
  if (loginEndpoints.length) {
    for (const e of loginEndpoints) {
      lines.push(`- \`${endpointLabel(e)}\` — request body fields: ${e.requestBodyFieldNames.join(', ') || '—'}.`);
    }
    lines.push('- Credential values are intentionally absent from this report; only field names were kept.');
  } else {
    lines.push('No login endpoint observed.');
  }
  lines.push('');

  lines.push('## Response field map');
  lines.push('');
  for (const e of endpoints) {
    lines.push(`### \`${endpointLabel(e)}\``);
    lines.push('');
    const tree = fieldLines(e.responseFields || {});
    lines.push(...(tree.length ? tree : ['- (no JSON response body observed)']));
    lines.push('');
  }

  lines.push('## Pagination');
  lines.push('');
  const paginated = endpoints.filter(
    (e) =>
      PAGINATION_KEYS.some((k) => k in (e.sampleValues || {})) ||
      (e.queryParamNames || []).some((q) => PAGINATION_PARAMS.test(q))
  );
  if (paginated.length) {
    for (const e of paginated) {
      const hints = [
        ...PAGINATION_KEYS.filter((k) => k in (e.sampleValues || {})).map((k) => `${k}=${e.sampleValues[k]}`),
        ...(e.queryParamNames || []).filter((q) => PAGINATION_PARAMS.test(q)).map((q) => `?${q}=`)
      ];
      lines.push(`- \`${endpointLabel(e)}\` — ${hints.join(', ')}`);
    }
  } else {
    lines.push('No pagination signals observed.');
  }
  lines.push('');

  lines.push('## Price fields');
  lines.push('');
  const priced = endpoints.filter((e) => PRICE_KEYS.some((k) => k in (e.sampleValues || {})));
  if (priced.length) {
    for (const e of priced) {
      const found = PRICE_KEYS.filter((k) => k in e.sampleValues).map((k) => `${k}=${e.sampleValues[k]}`);
      lines.push(`- \`${endpointLabel(e)}\` — ${found.join(', ')}`);
    }
  } else {
    lines.push('No price fields observed.');
  }
  lines.push('');

  lines.push('## Stock fields');
  lines.push('');
  const stocked = endpoints.filter((e) => STOCK_KEYS.some((k) => k in (e.sampleValues || {})));
  if (stocked.length) {
    for (const e of stocked) {
      const found = STOCK_KEYS.filter((k) => k in e.sampleValues).map((k) => `${k}=${e.sampleValues[k]}`);
      lines.push(`- \`${endpointLabel(e)}\` — ${found.join(', ')}`);
    }
  } else {
    lines.push('No stock fields observed.');
  }
  lines.push('');

  lines.push('## Cart');
  lines.push('');
  const carts = endpoints.filter((e) => CART_PATH.test(e.pathTemplate));
  if (carts.length) {
    for (const e of carts) lines.push(`- \`${endpointLabel(e)}\` — ${e.count} call(s), status ${e.statusCodes.join(', ')}`);
  } else {
    lines.push('No cart endpoint observed.');
  }
  lines.push('');

  lines.push('## Open questions');
  lines.push('');
  lines.push('- Which login variant (form vs JSON body) does the live site actually use, and are extra hidden fields required?');
  lines.push('- What does each `{id}` path parameter represent (product code, internal id), and what is its exact format?');
  lines.push('- What are the real pagination parameter names, defaults, and maximum page size?');
  lines.push('- Which observed price field is the sell price versus list/discount price?');
  lines.push('- Which stock status values exist beyond those observed in the capture?');
  lines.push('');

  return lines.join('\n');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const [, , input, supplier] = process.argv;
  if (!input || !supplier) {
    console.error('usage: node tools/discovery/report-skeleton.mjs out.json "Supplier"');
    process.exit(2);
  }
  const data = JSON.parse(readFileSync(input, 'utf8'));
  process.stdout.write(renderReport(data, supplier) + '\n');
}
