// Task 1: the emergency sales page and its script must be served by the preview Worker (they were 404).
// Static check on tools/build-preview-refresh.mjs: every local file emergency-sales.html loads has a route, and the route's repo file exists.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const tool = fs.readFileSync('tools/build-preview-refresh.mjs', 'utf8');
const html = fs.readFileSync('emergency-sales.html', 'utf8');
const block = tool.slice(tool.indexOf('const EXTRA_ROUTES'), tool.indexOf('};', tool.indexOf('const EXTRA_ROUTES')));
const routes = [...block.matchAll(/'(\/[^']*)':\s*\['([^']+)'/g)].map(m => [m[1], m[2]]);
for (const r of ['/emergency-sales.html', '/emergency-sales', '/emergency-core.js']) assert.ok(routes.some(x => x[0] === r), 'route ' + r);
for (const [route, file] of routes) assert.ok(fs.existsSync(file), route + ' -> ' + file + ' exists');
const local = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]).filter(s => !/^https?:/.test(s));
assert.ok(local.length > 0);
for (const s of local) assert.ok(routes.some(x => x[0] === '/' + s.replace(/^\//, '')), 'page script ' + s + ' has a preview route');
assert.ok(routes.find(x => x[0] === '/emergency-sales.html')[1] === 'emergency-sales.html');
console.log('preview-emergency-routes passed');
