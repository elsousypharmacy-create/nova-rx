import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createRuleSet, createRuleBook } = require('../../drug-rules.js');
const { buildTable, check } = require('../../clinical-warnings.js');

function mem() { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; }
const P = { source: 'TestRef', edition: '2026', date: '2026-01-15' };
const set = () => ({ version: 'v1', substances: [{ name: 'Warfarin', ...P }, { name: 'Aspirin', ...P }],
  interactions: [{ a: 'Warfarin', b: 'Aspirin', severity: 'major', reason: 'bleeding risk', ...P }] });
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('rows without source/edition/date or version are rejected', () => {
  assert.throws(() => createRuleSet({}), { code: 'missing-version' });
  for (const k of ['source', 'edition', 'date']) {
    const s = set(); delete s.interactions[0][k];
    assert.throws(() => createRuleSet(s), { code: 'missing-provenance' });
    const u = set(); delete u.substances[0][k];
    assert.throws(() => createRuleSet(u), { code: 'missing-provenance' });
  }
  const bad = set(); bad.interactions[0].date = '15/01/2026';
  assert.throws(() => createRuleSet(bad), { code: 'missing-provenance' });
  const sev = set(); sev.interactions[0].severity = 'huge';
  assert.throws(() => createRuleSet(sev), { code: 'bad-interaction-row' });
  const dup = set(); dup.interactions.push({ ...dup.interactions[0], a: 'aspirin', b: 'WARFARIN' });
  assert.throws(() => createRuleSet(dup), { code: 'duplicate-interaction' });
});
t('set is frozen and order-free lookup works', () => {
  const rs = createRuleSet(set()), b = createRuleBook(rs, mem());
  assert.throws(() => { 'use strict'; rs.version = 'x'; });
  assert.equal(b.lookup('ASPIRIN', 'warfarin').severity, 'major');
  assert.equal(b.lookup('aspirin', 'ibuprofen'), null);
});
t('correction needs reviewer, reason, provenance; only allowed fields; original untouched', () => {
  const rs = createRuleSet(set()), b = createRuleBook(rs, mem());
  const c = { target: { a: 'warfarin', b: 'aspirin' }, changes: { severity: 'contraindicated' }, reviewer: 'Dr A', reason: 'new label', ...P };
  assert.throws(() => b.correct({ ...c, reviewer: '' }), { code: 'missing-reviewer' });
  assert.throws(() => b.correct({ ...c, reason: ' ' }), { code: 'missing-reason' });
  assert.throws(() => b.correct({ ...c, source: '' }), { code: 'missing-provenance' });
  assert.throws(() => b.correct({ ...c, changes: { source: 'x' } }), { code: 'field-not-correctable' });
  assert.throws(() => b.correct({ ...c, changes: { severity: 'x' } }), { code: 'bad-severity' });
  assert.throws(() => b.correct({ ...c, target: { a: 'x', b: 'y' } }), { code: 'unknown-target' });
  assert.equal(b.corrections().length, 0);
  b.correct(c);
  assert.equal(rs.interactions['aspirin|warfarin'].severity, 'major');
  const e = b.lookup('warfarin', 'aspirin');
  assert.equal(e.severity, 'contraindicated');
  assert.equal(e.corrections[0].reviewer, 'Dr A');
  assert.equal(e.source, 'TestRef');
});
t('corrections persist across reloads, append-only, corrupt log fails closed', () => {
  const s = mem(), rs = createRuleSet(set());
  createRuleBook(rs, s).correct({ target: { name: 'aspirin' }, changes: { note: 'OTC' }, reviewer: 'R', reason: 'x', ...P });
  const b2 = createRuleBook(rs, s);
  assert.equal(b2.effective().substances.aspirin.note, 'OTC');
  b2.correct({ target: { name: 'aspirin' }, changes: { note: 'Rx' }, reviewer: 'R', reason: 'y', ...P });
  assert.deepEqual(b2.corrections().map(x => x.seq), [1, 2]);
  s.setItem('nova.drugrules.corrections', '{bad');
  assert.throws(() => createRuleBook(rs, s).effective(), { code: 'log-corrupt' });
});
t('feeds clinical-warnings with source, edition, date and correction provenance', () => {
  const b = createRuleBook(createRuleSet(set()), mem());
  const run = () => check({ patient: {}, items: [{ id: 1, substances: ['warfarin'] }, { id: 2, substances: ['aspirin'] }] }, buildTable(b.toInteractionTable()));
  assert.match(run()[0].source, /TestRef 2026 \(2026-01-15\)$/);
  b.correct({ target: { a: 'aspirin', b: 'warfarin' }, changes: { severity: 'contraindicated' }, reviewer: 'Dr A', reason: 'r', ...P });
  const w = run()[0];
  assert.equal(w.severity, 'contraindicated'); assert.match(w.source, /corrected by Dr A/);
});
console.log(n + ' tests passed');
