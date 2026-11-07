import fs from 'node:fs';

function fail(reason) {
  console.error(`poc0-manifest.check: FAIL - ${reason}`);
  process.exit(1);
}

let raw;
try {
  raw = fs.readFileSync('manifest.webmanifest', 'utf8');
} catch (err) {
  fail(`cannot read manifest.webmanifest: ${err.message}`);
}

let manifest;
try {
  manifest = JSON.parse(raw);
} catch (err) {
  fail(`invalid JSON: ${err.message}`);
}

if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
  fail('manifest.name must be a non-empty string');
}
if (typeof manifest.start_url !== 'string') {
  fail('manifest.start_url must be a string');
}
if (typeof manifest.display !== 'string') {
  fail('manifest.display must be a string');
}
if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
  fail('manifest.icons must be a non-empty array');
}
for (const icon of manifest.icons) {
  if (!icon || typeof icon.src !== 'string' || icon.src === '') {
    fail('every icon must have a src');
  }
}

console.log('poc0-manifest.check: PASS');
process.exit(0);
