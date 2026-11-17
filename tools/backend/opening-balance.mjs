#!/usr/bin/env node
// Opening stock for the server: turns a products file into idempotent 'stock_receipt' sync ops (the same op the purchases page sends),
// so the server has real stock BEFORE synced sales arrive (otherwise they wait with SYNC_STOCK_CONFLICT).
//   Input  (JSON array or CSV with header): code,qty,cost[,lot,expiry,name]   qty = BASE units (tablets for packaged items, else boxes), cost = per base unit in pounds
//   Keys   open:<code>:<lot>  -> running it twice never adds the stock twice (the server answers "duplicate").
// Usage:
//   node tools/backend/opening-balance.mjs products.csv                    DRY RUN: validates, prints counts only (default)
//   node tools/backend/opening-balance.mjs products.csv --out ops.json     also writes the ops file
//   NOVA_URL=https://... NOVA_TOKEN=... node tools/backend/opening-balance.mjs products.csv --push   sends them (owner session token from the environment; never printed)
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const LOT_RE = /^[A-Za-z0-9_\-.]{1,40}$/;

export function parseRows(text, isCsv) {
  if (!isCsv) { const j = JSON.parse(text); return Array.isArray(j) ? j : []; }
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((l) => { const c = l.split(','); const o = {}; head.forEach((h, i) => { o[h] = (c[i] || '').trim(); }); return o; });
}

/* -> { ops, issues, totals }. A bad row never produces an op; nothing is guessed. */
export function buildOps(rows) {
  const ops = [], issues = [], seen = new Set(); let units = 0;
  rows.forEach((r, i) => {
    const row = i + 2, code = String(r.code == null ? '' : r.code).trim(), qty = Number(r.qty), cost = Number(r.cost == null || r.cost === '' ? 0 : r.cost);
    const lot = String(r.lot || 'OPEN').trim(), expiry = String(r.expiry || '').trim();
    const bad = (m) => issues.push({ row, code, message: m });
    if (!code || code.length > 100) return bad('code missing or too long');
    if (!Number.isSafeInteger(qty) || qty <= 0) return bad('qty must be a positive whole number (base units)');
    if (!Number.isFinite(cost) || cost < 0) return bad('cost must be a number >= 0');
    if (!LOT_RE.test(lot)) return bad('lot has invalid characters');
    if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return bad('expiry must be YYYY-MM-DD');
    const key = 'open:' + code.replace(/[^A-Za-z0-9_\-.]/g, '_') + ':' + lot;
    if (key.length > 128) return bad('key too long');
    if (seen.has(key)) return bad('duplicate code+lot in the file');
    seen.add(key);
    units += qty;
    const line = { code, qty, price: Math.round(cost * 100) / 100, lot, expiry, unit: 'box', perBox: 1 };
    if (r.name) line.name = String(r.name);
    ops.push({ key, kind: 'ledger', entity: 'stock_receipt', payload: { id: key, op: 'receipt', poId: 'OPENING', ref: 'OPENING', lines: [line] } });
  });
  return { ops, issues, totals: { products: ops.length, units, rejected: issues.length } };
}

async function push(ops, url, token) {
  const out = { applied: 0, duplicate: 0, failed: [] };
  for (let i = 0; i < ops.length; i += 50) {
    const res = await fetch(url.replace(/\/$/, '') + '/api/v1/sync/push', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: ops.slice(i, i + 50) }) });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !Array.isArray(j.results)) { out.failed.push({ batch: i / 50, status: res.status }); continue; }
    j.results.forEach((r, k) => { if (r.status === 'applied' && r.duplicate) out.duplicate++; else if (r.status === 'applied') out.applied++; else out.failed.push({ key: ops[i + k].key, code: r.code || r.status }); });
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), file = args.find((a) => !a.startsWith('--'));
  if (!file) { console.error('usage: node tools/backend/opening-balance.mjs products.csv|products.json [--out ops.json] [--push]'); process.exit(2); }
  const { ops, issues, totals } = buildOps(parseRows(readFileSync(file, 'utf8'), /\.csv$/i.test(file)));
  console.log(JSON.stringify({ mode: args.includes('--push') ? 'push' : 'dry-run', ...totals }));
  issues.slice(0, 20).forEach((x) => console.log(`row ${x.row} (${x.code || '-'}): ${x.message}`));
  const oi = args.indexOf('--out'); if (oi >= 0 && args[oi + 1]) { writeFileSync(args[oi + 1], JSON.stringify(ops, null, 1)); console.log('wrote ' + args[oi + 1]); }
  if (args.includes('--push')) {
    if (issues.length) { console.error('fix the rejected rows first (nothing was sent)'); process.exit(1); }
    if (!process.env.NOVA_URL || !process.env.NOVA_TOKEN) { console.error('set NOVA_URL and NOVA_TOKEN in the environment (owner session token)'); process.exit(1); }
    const r = await push(ops, process.env.NOVA_URL, process.env.NOVA_TOKEN);
    console.log(JSON.stringify({ applied: r.applied, duplicate: r.duplicate, failed: r.failed.length })); r.failed.slice(0, 10).forEach((f) => console.log('failed', JSON.stringify(f)));
    process.exit(r.failed.length ? 1 : 0);
  }
}
