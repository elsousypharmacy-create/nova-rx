import assert from 'node:assert/strict';
import { getVersionInfo, compareVersions, VERSION } from '../../backend/src/version.js';
import { lintMigrations, loadDir } from '../../tools/backend/check-migrations.mjs';
import { checkDeploy } from '../../tools/backend/stale-artifact-guard.mjs';

assert.deepEqual(getVersionInfo({ BUILD_SHA: 'abc', NOVA_ENV: 'staging' }), { version: VERSION, sha: 'abc', env: 'staging' });
assert.equal(getVersionInfo().sha, 'dev');
assert.equal(compareVersions('0.1.0', '0.1.1'), -1);
assert.equal(compareVersions('1.0', '1.0.0'), 0);
assert.equal(compareVersions('0.10.0', '0.9.9'), 1);

assert.deepEqual(lintMigrations(loadDir(new URL('../../backend/migrations/', import.meta.url))), []);
assert.match(lintMigrations([{ name: '0001_a.sql', sql: '' }, { name: '0003_b.sql', sql: '' }])[0], /gap/);
assert.match(lintMigrations([{ name: '0001_a.sql', sql: '' }, { name: '0001_b.sql', sql: '' }])[0], /duplicate/);
assert.match(lintMigrations([{ name: '0001_a.sql', sql: 'DROP TABLE x;' }])[0], /destructive/);
assert.match(lintMigrations([{ name: '0001_a.sql', sql: 'delete  from x;' }])[0], /destructive/);
assert.deepEqual(lintMigrations([{ name: '0001_a.sql', sql: '-- DROP TABLE x\nCREATE TABLE y(a);' }]), []);
assert.match(lintMigrations([{ name: 'bad.sql', sql: '' }])[0], /bad file name/);

assert.equal(checkDeploy('0.1.0', {}).ok, true);
assert.equal(checkDeploy('0.1.0', { live: { version: '0.2.0' } }).ok, false);
assert.equal(checkDeploy('0.2.0', { live: { version: '0.2.0' } }).ok, true);
assert.equal(checkDeploy('0.3.0', { live: { version: '0.2.0' } }).ok, true);
console.log('backend-release OK');
