import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { classifyLogin } = createRequire(import.meta.url)('../../tools/sessions/aumet-login-signals.cjs');
// The observed FIX45 case: 401 with an unrecognised body must be credentialsRejected.
assert.equal(classifyLogin(401, '{"message":"x"}').credentialsRejected, true);
assert.equal(classifyLogin(401, '').credentialsRejected, true);
assert.equal(classifyLogin(200, '{"ok":1}').credentialsRejected, false);
assert.equal(classifyLogin(401, 'These credentials do not match our records').credentialsRejected, true);
assert.equal(classifyLogin(401, 'logged in on another device').credentialsRejected, false);
assert.equal(classifyLogin(401, 'logged in on another device').otherSession, true);
assert.equal(classifyLogin(401, 'enter captcha').credentialsRejected, false);
assert.equal(classifyLogin(429, '').rateLimited, true);
assert.equal(classifyLogin(429, '').credentialsRejected, false);
const out = JSON.stringify(classifyLogin(401, 'secret@x.com'));
assert.ok(!out.includes('secret'));
const src = fs.readFileSync(new URL('../../tools/sessions/push-sessions.cjs', import.meta.url), 'utf8');
assert.ok(src.includes('classifyLogin(loginStatus, body)'));
console.log('aumet-login-signals ok');
