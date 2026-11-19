import { readAppHtml } from '../lib/app-html.mjs'; // PERF-02: index.html + split app/ files
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readAppHtml(new URL('../../index.html', import.meta.url), 'utf8');
const m = html.match(/<script>[^<]*serviceWorker[^<]*<\/script>/);
assert.ok(m, 'sw registration script present');
const s = m[0];
assert.match(s, /fetch\(\s*swUrl\s*,\s*\{\s*method:\s*'HEAD'/, 'HEAD probe present');
assert.match(s, /\.ok\b/, 'checks response ok');
assert.match(s, /\.catch\(function\(\)\{\}\)/, 'silent catch');
assert.ok(s.indexOf('fetch(') < s.indexOf('.register('), 'probe precedes register');
assert.equal((html.match(/serviceWorker\.register\(/g) || []).length, 1, 'single register call');
assert.doesNotMatch(s, /load',\s*\(\)\s*=>\s*navigator\.serviceWorker\.register/, 'not unconditional');
console.log('ok sw-register-guard');
