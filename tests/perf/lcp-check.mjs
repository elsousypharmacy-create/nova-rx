#!/usr/bin/env node
// PERF-06: Mobile LCP performance budget check via Playwright + CDP throttling.
// Opens / at 390x844 with Fast 3G network (1.6 Mbps down, 150 ms RTT) and 4x CPU throttle.
// All external and non-GET requests are blocked; only local fake/static fixtures are served.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_BUDGET = path.join(__dirname, 'budget.json');

export function median(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Cannot compute median of empty array');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function evaluateLcpBudget(measuredMs, lcpConfig) {
  const budgetMs = Number(lcpConfig.budgetMs ?? 2500);
  const baselineMs = Number(lcpConfig.baselineMs ?? budgetMs);
  const mode = String(lcpConfig.mode || 'warn').toLowerCase();
  const maxRegressionPct = Number(lcpConfig.maxRegressionPct ?? 15);
  const ratchetLimitMs = Math.round(baselineMs * (1 + maxRegressionPct / 100));

  const withinBudget = measuredMs <= budgetMs;
  const deltaFromBaselineMs = Math.round(measuredMs - baselineMs);
  const deltaFromBaselinePct = baselineMs > 0
    ? Number(((deltaFromBaselineMs / baselineMs) * 100).toFixed(1))
    : 0;

  let status = 'PASS';
  let pass = true;
  let message = `LCP ${measuredMs} ms <= budget ${budgetMs} ms`;

  if (!withinBudget) {
    if (mode === 'enforce') {
      status = 'FAIL';
      pass = false;
      message = `LCP ${measuredMs} ms exceeded enforced budget ${budgetMs} ms (baseline ${baselineMs} ms)`;
    } else if (mode === 'ratchet') {
      if (measuredMs > ratchetLimitMs) {
        status = 'FAIL';
        pass = false;
        message = `LCP ${measuredMs} ms exceeded ratchet limit ${ratchetLimitMs} ms (+${maxRegressionPct}% over baseline ${baselineMs} ms; target ${budgetMs} ms)`;
      } else {
        status = 'WARN';
        pass = true;
        message = `LCP ${measuredMs} ms is above target ${budgetMs} ms (within ratchet ${ratchetLimitMs} ms of baseline ${baselineMs} ms)`;
      }
    } else {
      // 'warn' mode: warning-only ratchet until PERF-02 brings LCP under budget
      status = 'WARN';
      pass = true;
      message = `LCP ${measuredMs} ms is above ${budgetMs} ms target (warning-only mode until PERF-02 lands; baseline ${baselineMs} ms)`;
    }
  }

  return {
    mode,
    budgetMs,
    baselineMs,
    ratchetLimitMs,
    measuredMs,
    withinBudget,
    deltaFromBaselineMs,
    deltaFromBaselinePct,
    status,
    pass,
    message,
  };
}

async function measureOnce(browser, baseUrl, lcpConfig, emergencySnapshot, shotPath) {
  const origin = new URL(baseUrl).origin;
  const ctx = await browser.newContext({
    viewport: lcpConfig.viewport || { width: 390, height: 844 },
    locale: 'ar-EG',
    timezoneId: 'Africa/Cairo',
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block',
  });

  const blockedNonGet = [];
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (method !== 'GET' && method !== 'HEAD') {
      blockedNonGet.push(`${method} ${url}`);
      return route.abort();
    }
    if (url.startsWith(origin) && new URL(url).pathname === '/emergency/stock.json') {
      if (emergencySnapshot !== null) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: emergencySnapshot,
        });
      }
    }
    if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) {
      return route.continue();
    }
    return route.abort();
  });

  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.addInitScript(() => {
    window.__perfMetrics = { lcpMs: null, lcpElement: null, lcpSize: 0, fcpMs: null };
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__perfMetrics.lcpMs = Math.round(entry.startTime);
          window.__perfMetrics.lcpSize = entry.size || 0;
          const el = entry.element;
          if (el) {
            const tag = el.tagName ? el.tagName.toLowerCase() : '';
            const id = el.id ? `#${el.id}` : '';
            const cls = typeof el.className === 'string' && el.className.trim()
              ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
              : '';
            window.__perfMetrics.lcpElement = `${tag}${id}${cls}`;
          }
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-contentful-paint' && window.__perfMetrics.fcpMs === null) {
            window.__perfMetrics.fcpMs = Math.round(entry.startTime);
          }
        }
      }).observe({ type: 'paint', buffered: true });
    } catch {}
  });

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: lcpConfig.network?.latencyMs ?? 150,
    downloadThroughput: lcpConfig.network?.downloadBps ?? 200000,
    uploadThroughput: lcpConfig.network?.uploadBps ?? 93750,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', {
    rate: lcpConfig.cpuThrottleRate ?? 4,
  });

  await page.goto(baseUrl, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1500);

  if (shotPath) {
    fs.mkdirSync(path.dirname(shotPath), { recursive: true });
    await page.screenshot({ path: shotPath });
  }

  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      lcpMs: window.__perfMetrics?.lcpMs ?? null,
      lcpElement: window.__perfMetrics?.lcpElement ?? null,
      lcpSize: window.__perfMetrics?.lcpSize ?? 0,
      fcpMs: window.__perfMetrics?.fcpMs ?? null,
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadMs: nav ? Math.round(nav.loadEventEnd) : null,
      title: document.title,
    };
  });

  await ctx.close();
  return { ...metrics, blockedNonGet, pageErrors };
}

async function main() {
  const { chromium } = await import(process.env.PW_MODULE || '@playwright/test');
  const budgetPath = process.env.PERF_BUDGET_PATH || DEFAULT_BUDGET;
  const rootDir = process.env.PERF_REPO_ROOT || DEFAULT_ROOT;
  const baseUrl = process.env.NOVA_URL || 'http://127.0.0.1:8765/';
  const shotsDir = process.env.NOVA_SHOTS || '';
  const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
  const lcpConfig = budget.lcp;
  const runs = Number(process.env.PERF_LCP_RUNS || lcpConfig.runs || 3);

  const snapPath = path.join(rootDir, 'data', 'emergency-stock.json');
  const emergencySnapshot = fs.existsSync(snapPath) ? fs.readFileSync(snapPath, 'utf8') : null;

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || process.env.CHROME_BIN || undefined,
    args: ['--no-sandbox'],
  });

  const samples = [];
  try {
    for (let i = 1; i <= runs; i++) {
      const shotPath = i === 1 && shotsDir ? path.join(shotsDir, 'lcp-mobile-390.png') : null;
      const sample = await measureOnce(browser, baseUrl, lcpConfig, emergencySnapshot, shotPath);
      samples.push(sample);
      console.log(
        `Run ${i}/${runs}: LCP=${sample.lcpMs} ms (el=${sample.lcpElement || 'n/a'}), ` +
        `FCP=${sample.fcpMs} ms, DCL=${sample.domContentLoadedMs} ms, Load=${sample.loadMs} ms`
      );
    }
  } finally {
    await browser.close();
  }

  const validLcp = samples.map((s) => s.lcpMs).filter((v) => typeof v === 'number' && v > 0);
  if (validLcp.length === 0) {
    console.error('FAIL: No LCP entries recorded across runs.');
    process.exit(1);
  }

  const medianLcpMs = median(validLcp);
  const evaluation = evaluateLcpBudget(medianLcpMs, lcpConfig);
  const report = {
    url: baseUrl,
    viewport: lcpConfig.viewport,
    network: lcpConfig.network,
    cpuThrottleRate: lcpConfig.cpuThrottleRate,
    runs: samples,
    medianLcpMs,
    evaluation,
  };

  console.log('=== PERF-06 LCP Budget ===');
  console.log(`[${evaluation.status}] ${evaluation.message}`);
  if (evaluation.withinBudget && evaluation.mode === 'warn') {
    console.log('TIP: LCP is now within budget; tighten tests/perf/budget.json lcp.mode to "enforce".');
  }
  if (process.env.GITHUB_ACTIONS === 'true') {
    if (evaluation.status === 'WARN') {
      console.log(`::warning title=Perf budget LCP (warning-only)::${evaluation.message}`);
    } else if (evaluation.status === 'FAIL') {
      console.log(`::error title=Perf budget LCP exceeded::${evaluation.message}`);
    }
  }

  if (process.env.PERF_REPORT_PATH) {
    fs.mkdirSync(path.dirname(process.env.PERF_REPORT_PATH), { recursive: true });
    fs.writeFileSync(process.env.PERF_REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  }

  if (!evaluation.pass) {
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
