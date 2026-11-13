// Lints backend/migrations: NNNN_name.sql numbering without gaps/dupes, additive-only SQL.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DESTRUCTIVE = /\b(DROP\s+(TABLE|COLUMN|INDEX|VIEW|TRIGGER)|TRUNCATE|DELETE\s+FROM)\b/i;

export function lintMigrations(files) {
  // files: [{ name, sql }]
  const errors = [];
  const nums = [];
  for (const f of files) {
    const m = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(f.name);
    if (!m) { errors.push(`${f.name}: bad file name (expected NNNN_name.sql)`); continue; }
    nums.push(Number(m[1]));
    const stripped = f.sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (DESTRUCTIVE.test(stripped)) errors.push(`${f.name}: destructive SQL not allowed`);
  }
  nums.sort((a, b) => a - b);
  nums.forEach((n, i) => {
    if (i > 0 && n === nums[i - 1]) errors.push(`duplicate number ${String(n).padStart(4, '0')}`);
    else if (n !== i + 1) errors.push(`numbering gap: expected ${String(i + 1).padStart(4, '0')}, found ${String(n).padStart(4, '0')}`);
  });
  return errors;
}

export function loadDir(dir) {
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .map((name) => ({ name, sql: readFileSync(new URL(name, dir), 'utf8') }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = new URL('../../backend/migrations/', import.meta.url);
  const errors = lintMigrations(loadDir(dir));
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('migrations OK');
}
