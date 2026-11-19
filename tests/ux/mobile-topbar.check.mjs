import { readAppHtml } from '../lib/app-html.mjs'; // PERF-02: index.html + split app/ files
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readAppHtml(new URL('../../index.html', import.meta.url), 'utf8');
const m = html.match(/@media \(max-width:600px\)\{\s*\.top-header\{[^}]*flex-wrap:wrap[^}]*\}[\s\S]*?\n\}/);
assert.ok(m, 'max-width:600px rule wrapping .top-header exists');
const b = m[0];
assert.match(b, /\.top-header\{[^}]*height:auto/, 'topbar height auto');
assert.match(b, /\.header-actions[^{]*\{[^}]*flex-wrap:wrap/, 'actions wrap');
assert.match(b, /\.nova-sale-number\{/, 'invoice chip constrained');
assert.match(html, /id="mainSearchInput"/, 'search input present');
assert.match(html, /<html[^>]*dir="rtl"/, 'rtl preserved');
console.log('ok mobile-topbar');
