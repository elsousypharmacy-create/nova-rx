#!/usr/bin/env node
// Local secret scan of committed files. No dependencies, no network.
// Prints file:line and rule name only, never the matched value.
// Allow a line with the marker `secret-scan:allow`; allow paths in ALLOW_PATHS.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

export const RULES = [
  ['private-key-block', /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ['aws-access-key-id', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['anthropic-or-openai-key', /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}\b/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ['slack-webhook-url', /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9\/]{20,}/],
  ['discord-webhook-url', /https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{20,}/],
  ['telegram-bot-token', /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['url-with-password', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@\/'"]+:[^\s:@\/'"]{6,}@[^\s'"]+/i],
  ['hardcoded-secret-assignment',
    /\b(?:api[_-]?key|secret|token|password|passwd|auth)[A-Za-z_-]*["']?\s*[:=]\s*["'][A-Za-z0-9+\/_=-]{24,}["']/i],
];

const ALLOW_PATHS = [/^tests\/fixtures\//, /^package-lock\.json$/, /^node_modules\//, /^tests\/unit\/secret-scan\.check\.mjs$/, /^tests\/unit\/security-audit-log\.check\.mjs$/];
const ALLOW_MARKER = 'secret-scan:allow';
const MAX_BYTES = 2 * 1024 * 1024;

export function scanText(text) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    if (line.length > 20000 || line.includes(ALLOW_MARKER)) return;
    for (const [rule, re] of RULES) if (re.test(line)) hits.push({ line: i + 1, rule });
  });
  return hits;
}

export function isAllowedPath(p) { return ALLOW_PATHS.some((re) => re.test(p)); }

function main() {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean);
  let scanned = 0;
  const findings = [];
  for (const f of files) {
    if (isAllowedPath(f)) continue;
    let buf;
    try { if (statSync(f).size > MAX_BYTES) continue; buf = readFileSync(f); } catch { continue; }
    if (buf.includes(0)) continue; // binary
    scanned++;
    for (const h of scanText(buf.toString('utf8'))) findings.push(`${f}:${h.line} ${h.rule}`);
  }
  if (findings.length) {
    console.error(`secret-scan: ${findings.length} possible secret(s) (values not shown):`);
    for (const x of findings) console.error('  ' + x);
    console.error(`Remove the value, or for a deliberate fake add "${ALLOW_MARKER}" on that line.`);
    process.exit(1);
  }
  console.log(`secret-scan: OK (${scanned} files scanned)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
