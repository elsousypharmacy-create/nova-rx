#!/usr/bin/env node
// PERF-06: Size ratchet for index.html bytes and total JS/CSS bytes loaded by index.html.
// Counts inline <style> and JS <script> blocks inside index.html plus local external
// <script src="..."> and <link rel="stylesheet" href="..."> files so splitting inline
// JS/CSS into external files (PERF-02) does not false-fail the total JS/CSS ratchet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_BUDGET = path.join(__dirname, 'budget.json');

const NON_JS_SCRIPT_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'importmap',
  'speculationrules',
  'text/template',
  'text/html',
]);

function isExternalUrl(ref) {
  return /^(?:https?:)?\/\//i.test(ref) || /^(?:data|blob|javascript):/i.test(ref);
}

function normalizeLocalRef(ref) {
  const clean = ref.split('#')[0].split('?')[0].trim();
  if (!clean) return null;
  return clean.replace(/^\/+/, '');
}

export function measureRepoSizes(rootDir = DEFAULT_ROOT) {
  const indexPath = path.join(rootDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(`index.html not found at ${indexPath}`);
  }
  const indexBuf = fs.readFileSync(indexPath);
  const indexHtmlBytes = indexBuf.byteLength;
  const html = indexBuf.toString('utf8');

  let inlineCssBytes = 0;
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    inlineCssBytes += Buffer.byteLength(m[1], 'utf8');
  }

  let inlineJsBytes = 0;
  const localJsFiles = new Set();
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] || '';
    const body = m[2] || '';
    const srcMatch = attrs.match(/\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    if (srcMatch) {
      const src = srcMatch[1] || srcMatch[2] || srcMatch[3] || '';
      if (!isExternalUrl(src)) {
        const rel = normalizeLocalRef(src);
        if (rel) localJsFiles.add(rel);
      }
      continue;
    }
    const typeMatch = attrs.match(/\btype\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    const scriptType = (typeMatch ? (typeMatch[1] || typeMatch[2] || typeMatch[3] || '') : '').toLowerCase().trim();
    if (scriptType && NON_JS_SCRIPT_TYPES.has(scriptType)) continue;
    inlineJsBytes += Buffer.byteLength(body, 'utf8');
  }

  const localCssFiles = new Set();
  for (const m of html.matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = m[1] || '';
    if (!/\brel\s*=\s*(?:"[^"]*\bstylesheet\b[^"]*"|'[^']*\bstylesheet\b[^']*'|stylesheet\b)/i.test(attrs)) {
      continue;
    }
    const hrefMatch = attrs.match(/\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || '';
    if (!isExternalUrl(href)) {
      const rel = normalizeLocalRef(href);
      if (rel) localCssFiles.add(rel);
    }
  }

  let externalJsBytes = 0;
  const missingAssets = [];
  const externalAssets = [];
  for (const rel of [...localJsFiles].sort()) {
    const abs = path.resolve(rootDir, rel);
    if (!abs.startsWith(rootDir) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      missingAssets.push(rel);
      continue;
    }
    const bytes = fs.statSync(abs).size;
    externalJsBytes += bytes;
    externalAssets.push({ path: rel, kind: 'js', bytes });
  }

  let externalCssBytes = 0;
  for (const rel of [...localCssFiles].sort()) {
    const abs = path.resolve(rootDir, rel);
    if (!abs.startsWith(rootDir) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      missingAssets.push(rel);
      continue;
    }
    const bytes = fs.statSync(abs).size;
    externalCssBytes += bytes;
    externalAssets.push({ path: rel, kind: 'css', bytes });
  }

  const totalJsCssBytes = inlineJsBytes + inlineCssBytes + externalJsBytes + externalCssBytes;

  return {
    indexHtmlBytes,
    totalJsCssBytes,
    breakdown: {
      inlineJsBytes,
      inlineCssBytes,
      externalJsBytes,
      externalCssBytes,
    },
    externalAssets,
    missingAssets,
  };
}

export function evaluateSizeBudget(measured, budgetConfig) {
  const maxGrowthPct = Number(budgetConfig.maxGrowthPct ?? 5);
  const multiplier = 1 + maxGrowthPct / 100;
  const targets = [
    {
      key: 'indexHtmlBytes',
      label: 'index.html',
      measured: measured.indexHtmlBytes,
      baseline: budgetConfig.size.indexHtmlBytes,
    },
    {
      key: 'totalJsCssBytes',
      label: 'total JS/CSS (inline + referenced local)',
      measured: measured.totalJsCssBytes,
      baseline: budgetConfig.size.totalJsCssBytes,
    },
  ];

  const checks = targets.map((t) => {
    const limit = Math.floor(t.baseline * multiplier);
    const deltaBytes = t.measured - t.baseline;
    const deltaPct = t.baseline > 0 ? (deltaBytes / t.baseline) * 100 : 0;
    const pass = t.measured <= limit;
    return {
      key: t.key,
      label: t.label,
      baselineBytes: t.baseline,
      measuredBytes: t.measured,
      limitBytes: limit,
      deltaBytes,
      deltaPct: Number(deltaPct.toFixed(2)),
      pass,
    };
  });

  return {
    maxGrowthPct,
    pass: checks.every((c) => c.pass),
    checks,
    breakdown: measured.breakdown,
    missingAssets: measured.missingAssets,
  };
}

function fmtKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB (${bytes.toLocaleString('en-US')} B)`;
}

function main() {
  const budgetPath = process.env.PERF_BUDGET_PATH || DEFAULT_BUDGET;
  const rootDir = process.env.PERF_REPO_ROOT || DEFAULT_ROOT;
  const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
  const measured = measureRepoSizes(rootDir);
  const result = evaluateSizeBudget(measured, budget);

  console.log('=== PERF-06 Size Ratchet ===');
  for (const c of result.checks) {
    const sign = c.deltaBytes >= 0 ? '+' : '';
    const status = c.pass ? 'PASS' : 'FAIL';
    console.log(
      `[${status}] ${c.label}: ${fmtKb(c.measuredBytes)} vs baseline ${fmtKb(c.baselineBytes)} ` +
      `(${sign}${c.deltaPct}%, max +${result.maxGrowthPct}% = ${fmtKb(c.limitBytes)})`
    );
    if (!c.pass && process.env.GITHUB_ACTIONS === 'true') {
      console.log(
        `::error title=Perf size ratchet exceeded (${c.key})::${c.label} grew to ${c.measuredBytes} B ` +
        `(${sign}${c.deltaPct}% over baseline ${c.baselineBytes} B; limit ${c.limitBytes} B)`
      );
    }
  }
  console.log(
    `Breakdown: inlineJS=${fmtKb(result.breakdown.inlineJsBytes)}, ` +
    `inlineCSS=${fmtKb(result.breakdown.inlineCssBytes)}, ` +
    `extJS=${fmtKb(result.breakdown.externalJsBytes)}, ` +
    `extCSS=${fmtKb(result.breakdown.externalCssBytes)}`
  );
  if (result.missingAssets.length) {
    console.log(`Note: referenced local assets not found on disk: ${result.missingAssets.join(', ')}`);
  }

  if (process.env.PERF_REPORT_PATH) {
    fs.mkdirSync(path.dirname(process.env.PERF_REPORT_PATH), { recursive: true });
    fs.writeFileSync(process.env.PERF_REPORT_PATH, JSON.stringify(result, null, 2) + '\n');
  }

  if (!result.pass) {
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
