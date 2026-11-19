#!/usr/bin/env node
// PERF-06 unit tests for size-ratchet.mjs and lcp-check.mjs (pure local, no network).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { measureRepoSizes, evaluateSizeBudget } from './size-ratchet.mjs';
import { median, evaluateLcpBudget } from './lcp-check.mjs';

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${name}`);
}

function makeTempRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-perf-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return dir;
}

test('measureRepoSizes counts inline JS/CSS and local external assets, ignoring external URLs and JSON scripts', () => {
  const dir = makeTempRepo({
    'index.html': [
      '<!doctype html><html><head>',
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo">',
      '<link rel="stylesheet" href="/app.css?v=2">',
      '<style>body{color:#fff}</style>',
      '</head><body>',
      '<script type="application/json">{"ignored":true}</script>',
      '<script src="util.js?v=1"></script>',
      '<script src="https://cdn.example.com/lib.js"></script>',
      '<script>console.log(1);</script>',
      '</body></html>',
    ].join('\n'),
    'app.css': 'h1{font-size:20px}',
    'util.js': 'window.x=1;',
  });
  try {
    const m = measureRepoSizes(dir);
    assert.equal(m.breakdown.inlineCssBytes, Buffer.byteLength('body{color:#fff}', 'utf8'));
    assert.equal(m.breakdown.inlineJsBytes, Buffer.byteLength('console.log(1);', 'utf8'));
    assert.equal(m.breakdown.externalCssBytes, Buffer.byteLength('h1{font-size:20px}', 'utf8'));
    assert.equal(m.breakdown.externalJsBytes, Buffer.byteLength('window.x=1;', 'utf8'));
    assert.equal(
      m.totalJsCssBytes,
      m.breakdown.inlineCssBytes + m.breakdown.inlineJsBytes + m.breakdown.externalCssBytes + m.breakdown.externalJsBytes
    );
    assert.deepEqual(m.missingAssets, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('PERF-02 split (inline -> external files) keeps totalJsCssBytes within 5% ratchet', () => {
  const bigCss = '.a{color:red}'.repeat(500);
  const bigJs = 'function f(){return 1;}'.repeat(500);
  const beforeDir = makeTempRepo({
    'index.html': `<!doctype html><style>${bigCss}</style><script>${bigJs}</script>`,
  });
  const afterDir = makeTempRepo({
    'index.html': '<!doctype html><link rel="stylesheet" href="assets/app.css"><script src="assets/app.js"></script>',
    'assets/app.css': bigCss,
    'assets/app.js': bigJs,
  });
  try {
    const before = measureRepoSizes(beforeDir);
    const after = measureRepoSizes(afterDir);
    const budget = { maxGrowthPct: 5, size: { indexHtmlBytes: before.indexHtmlBytes, totalJsCssBytes: before.totalJsCssBytes } };
    const evalRes = evaluateSizeBudget(after, budget);
    assert.equal(evalRes.pass, true);
    assert.ok(after.indexHtmlBytes < before.indexHtmlBytes);
    assert.equal(after.totalJsCssBytes, before.totalJsCssBytes);
  } finally {
    fs.rmSync(beforeDir, { recursive: true, force: true });
    fs.rmSync(afterDir, { recursive: true, force: true });
  }
});

test('evaluateSizeBudget allows <= +5% and fails > +5% on index.html or total JS/CSS', () => {
  const budget = { maxGrowthPct: 5, size: { indexHtmlBytes: 100000, totalJsCssBytes: 200000 } };
  const atLimit = evaluateSizeBudget(
    { indexHtmlBytes: 105000, totalJsCssBytes: 210000, breakdown: {}, missingAssets: [] },
    budget
  );
  assert.equal(atLimit.pass, true);

  const indexTooBig = evaluateSizeBudget(
    { indexHtmlBytes: 105001, totalJsCssBytes: 200000, breakdown: {}, missingAssets: [] },
    budget
  );
  assert.equal(indexTooBig.pass, false);
  assert.equal(indexTooBig.checks[0].pass, false);
  assert.equal(indexTooBig.checks[1].pass, true);

  const totalTooBig = evaluateSizeBudget(
    { indexHtmlBytes: 100000, totalJsCssBytes: 210001, breakdown: {}, missingAssets: [] },
    budget
  );
  assert.equal(totalTooBig.pass, false);
  assert.equal(totalTooBig.checks[0].pass, true);
  assert.equal(totalTooBig.checks[1].pass, false);
});

test('median computes odd/even medians and throws on empty', () => {
  assert.equal(median([3000, 1000, 2000]), 2000);
  assert.equal(median([4000, 1000, 2000, 3000]), 2500);
  assert.throws(() => median([]), /empty/);
});

test('evaluateLcpBudget handles warn, ratchet, and enforce modes', () => {
  const base = { budgetMs: 2500, baselineMs: 3600, maxRegressionPct: 15 };

  // Within budget always passes
  assert.equal(evaluateLcpBudget(2400, { ...base, mode: 'warn' }).status, 'PASS');
  assert.equal(evaluateLcpBudget(2500, { ...base, mode: 'enforce' }).status, 'PASS');

  // Above budget in warn mode warns but passes (warning-only ratchet until PERF-02)
  const warnRes = evaluateLcpBudget(3600, { ...base, mode: 'warn' });
  assert.equal(warnRes.status, 'WARN');
  assert.equal(warnRes.pass, true);

  // Above budget in enforce mode fails
  const enforceRes = evaluateLcpBudget(2501, { ...base, mode: 'enforce' });
  assert.equal(enforceRes.status, 'FAIL');
  assert.equal(enforceRes.pass, false);

  // Ratchet mode warns within +15% of baseline, fails beyond +15%
  const ratchetOk = evaluateLcpBudget(4000, { ...base, mode: 'ratchet' });
  assert.equal(ratchetOk.status, 'WARN');
  assert.equal(ratchetOk.pass, true);

  const ratchetFail = evaluateLcpBudget(4200, { ...base, mode: 'ratchet' });
  assert.equal(ratchetFail.status, 'FAIL');
  assert.equal(ratchetFail.pass, false);
});

console.log(`${passed} passed`);
