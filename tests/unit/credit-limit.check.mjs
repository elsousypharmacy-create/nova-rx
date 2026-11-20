// CREDIT-LIMIT (#116): pure credit-limit check + list badge rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkLimit, badgeStatus } = require('../../app/556-credit-limit.js');

test('checkLimit: no limit always allows', () => {
  const r = checkLimit(500, null, 250);
  assert.deepEqual(r, { ok: true, limit: null, balance: 500, available: null, after: 750 });
});

test('checkLimit: under limit allows and computes available/after', () => {
  const r = checkLimit(40, 100, 35.5);
  assert.deepEqual(r, { ok: true, limit: 100, balance: 40, available: 60, after: 75.5 });
});

test('checkLimit: exact limit allows', () => {
  const r = checkLimit(60, 100, 40);
  assert.equal(r.ok, true);
  assert.equal(r.after, 100);
  assert.equal(r.available, 40);
});

test('checkLimit: within +0.005 tolerance allows, above blocks', () => {
  const over = checkLimit(60, 100, 40.01);
  assert.equal(over.ok, false);
  assert.equal(over.after, 100.01);

  const exactFloat = checkLimit(33.33, 100, 66.67);
  assert.equal(exactFloat.ok, true);
});

test('checkLimit: zero limit blocks any positive extra amount', () => {
  const r1 = checkLimit(0, 0, 0);
  assert.equal(r1.ok, true);

  const r2 = checkLimit(0, 0, 0.01);
  assert.equal(r2.ok, false);
});

test('checkLimit: already over limit reports negative available', () => {
  const r = checkLimit(120, 100, 10);
  assert.equal(r.ok, false);
  assert.equal(r.available, -20);
  assert.equal(r.after, 130);
});

test('badgeStatus: ok / near (>=80%) / over (>100%)', () => {
  assert.equal(badgeStatus(500, null), 'ok');
  assert.equal(badgeStatus(79.99, 100), 'ok');
  assert.equal(badgeStatus(80, 100), 'near');
  assert.equal(badgeStatus(100, 100), 'near');
  assert.equal(badgeStatus(100.01, 100), 'over');
  assert.equal(badgeStatus(0, 0), 'ok');
  assert.equal(badgeStatus(1, 0), 'over');
});