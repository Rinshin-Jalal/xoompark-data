import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearanceFit, parseClearanceCsv } from './clearance.ts';

test('unknown status never reads as passable, even against a 1" requirement', () => {
  assert.equal(clearanceFit({ inches: 200, status: 'unknown' }, 1), 'unverified');
});

test('missing clearance is unverified, not a fit', () => {
  assert.equal(clearanceFit(null, 96), 'unverified');
  assert.equal(clearanceFit(undefined, 96), 'unverified');
});

test('measured clearance at or above the requirement fits', () => {
  assert.equal(clearanceFit({ inches: 96, status: 'measured' }, 96), 'fits');
  assert.equal(clearanceFit({ inches: 100, status: 'signposted' }, 96), 'fits');
});

test('measured clearance below the requirement is too-low, not unverified', () => {
  assert.equal(clearanceFit({ inches: 80, status: 'measured' }, 96), 'too-low');
});

test('a zero or negative inches value is treated as unverified, not a failing height', () => {
  assert.equal(clearanceFit({ inches: 0, status: 'measured' }, 1), 'unverified');
});

test('CSV import skips a header row automatically', () => {
  const { rows, errors } = parseClearanceCsv('afdcId,inches,status,measuredBy,measuredAt\n123,96,measured,Zack,2026-08-01');
  assert.equal(errors.length, 0);
  assert.deepEqual(rows, [{ afdcId: 123, inches: 96, status: 'measured', measuredBy: 'Zack', measuredAt: '2026-08-01' }]);
});

test('CSV import accepts a bare data row with no header', () => {
  const { rows, errors } = parseClearanceCsv('123,96,measured');
  assert.equal(errors.length, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].afdcId, 123);
});

test('CSV import rejects a non-integer inches value instead of guessing a unit', () => {
  const { rows, errors } = parseClearanceCsv('123,8ft,measured');
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].reason, /inches must be a positive integer/);
});

test('CSV import rejects an unrecognized status rather than defaulting it', () => {
  const { rows, errors } = parseClearanceCsv('123,96,estimated');
  assert.equal(rows.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].reason, /status must be one of/);
});

test('CSV import reports one bad row without dropping the good ones', () => {
  const { rows, errors } = parseClearanceCsv('123,96,measured\n456,not-a-number,measured\n789,80,signposted');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.afdcId), [123, 789]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 2);
});

// Run: node --test src/app/dashboard/admin/charging-sites/lib/clearance.test.ts
