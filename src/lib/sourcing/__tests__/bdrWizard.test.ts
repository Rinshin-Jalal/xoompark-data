// Plain assert-based test, runnable with `node --experimental-strip-types`.
// Covers the BDR wizard's pure logic: per-field capture/confirm derivation,
// step-advance sequencing, and summary counting. Same Firestore-free split
// as the rest of __tests__ — only imports bdrWizard.ts (which only imports
// bdrView.ts and types.ts).
import assert from 'node:assert/strict';
import {
  type FieldStatus,
  nextOpenStepIndex,
  summarizeWizard,
  WIZARD_FIELD_KEYS,
  wizardFieldState,
  type WizardStatus,
} from '../bdrWizard.ts';
import type { SourcedParkingLocation } from '../types.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

let seq = 0;
function makeLocation(overrides: Partial<SourcedParkingLocation> = {}): SourcedParkingLocation {
  seq++;
  return {
    id: `loc-${seq}`,
    name: `Lot ${seq}`,
    source: 'spothero',
    sourceUrl: 'https://example.com',
    evidence: [],
    fieldProvenance: {},
    capturedBy: 'scraped',
    status: 'draft',
    rawInput: null,
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
    ...overrides,
  };
}

// --- WIZARD_FIELD_KEYS ------------------------------------------------------

test('WIZARD_FIELD_KEYS: matches bdrView.ts kill-order exactly', () => {
  assert.deepEqual(WIZARD_FIELD_KEYS, [
    'capacity',
    'open247',
    'fenced',
    'lit',
    'ingressEgress',
    'clearance',
    'ratesHours',
  ]);
});

// --- wizardFieldState --------------------------------------------------------

test('wizardFieldState: empty field is neither captured nor confirmable', () => {
  const loc = makeLocation();
  const s = wizardFieldState(loc, 'capacity');
  assert.equal(s.captured, false);
  assert.equal(s.scrapedValue, null);
});

test('wizardFieldState: scraped-but-unverified value is confirmable, not captured', () => {
  const loc = makeLocation({ stallsTotal: 200 });
  const s = wizardFieldState(loc, 'capacity');
  assert.equal(s.captured, false);
  assert.equal(s.scrapedValue, '200');
});

test('wizardFieldState: verified value is captured, no confirm prompt', () => {
  const loc = makeLocation({ stallsTotal: 200, fieldProvenance: { stallsTotal: 'verified' } });
  const s = wizardFieldState(loc, 'capacity');
  assert.equal(s.captured, true);
  assert.equal(s.scrapedValue, null);
});

test('wizardFieldState: tri-state fields render Yes/No/Can\'t tell for confirm', () => {
  assert.equal(wizardFieldState(makeLocation({ access247: true }), 'open247').scrapedValue, 'Yes');
  assert.equal(wizardFieldState(makeLocation({ fenced: false }), 'fenced').scrapedValue, 'No');
  assert.equal(wizardFieldState(makeLocation({ lit: null }), 'lit').scrapedValue, "Can't tell");
});

test('wizardFieldState: verified tri-state (including null/"can\'t tell") is captured', () => {
  const loc = makeLocation({ lit: null, fieldProvenance: { lit: 'verified' } });
  const s = wizardFieldState(loc, 'lit');
  assert.equal(s.captured, true);
  assert.equal(s.scrapedValue, null);
});

test('wizardFieldState: ratesHours needs BOTH priceText and hoursText verified to count captured', () => {
  const bothScraped = makeLocation({ priceText: '$10/day', hoursText: '24/7' });
  const rh1 = wizardFieldState(bothScraped, 'ratesHours');
  assert.equal(rh1.captured, false);
  assert.equal(rh1.scrapedValue, '$10/day · 24/7');

  const priceVerifiedOnly = makeLocation({
    priceText: '$10/day',
    hoursText: '24/7',
    fieldProvenance: { priceText: 'verified' },
  });
  const rh2 = wizardFieldState(priceVerifiedOnly, 'ratesHours');
  assert.equal(rh2.captured, false);
  // Only the still-unverified part (hours) is offered for confirm.
  assert.equal(rh2.scrapedValue, '24/7');

  const bothVerified = makeLocation({
    priceText: '$10/day',
    hoursText: '24/7',
    fieldProvenance: { priceText: 'verified', hoursText: 'verified' },
  });
  const rh3 = wizardFieldState(bothVerified, 'ratesHours');
  assert.equal(rh3.captured, true);
  assert.equal(rh3.scrapedValue, null);
});

test('wizardFieldState: ingressEgress/clearance text fields follow the same captured/confirm split', () => {
  const scraped = makeLocation({ ingressEgress: 'one-way in, separate exit', clearanceText: "6'8\"" });
  assert.equal(wizardFieldState(scraped, 'ingressEgress').scrapedValue, 'one-way in, separate exit');
  assert.equal(wizardFieldState(scraped, 'clearance').scrapedValue, "6'8\"");

  const verified = makeLocation({
    ingressEgress: 'one-way in, separate exit',
    clearanceText: "6'8\"",
    fieldProvenance: { ingressEgress: 'verified', clearanceText: 'verified' },
  });
  assert.equal(wizardFieldState(verified, 'ingressEgress').captured, true);
  assert.equal(wizardFieldState(verified, 'clearance').captured, true);
});

// --- nextOpenStepIndex -------------------------------------------------------

function statusesFrom(statuses: FieldStatus[]): WizardStatus[] {
  return statuses.map((status, i) => ({ key: `f${i}`, status }));
}

test('nextOpenStepIndex: finds the next unresolved step after fromIndex', () => {
  const statuses = statusesFrom(['captured', 'unresolved', 'unresolved', 'captured']);
  assert.equal(nextOpenStepIndex(statuses, 0), 1);
  assert.equal(nextOpenStepIndex(statuses, 2), 2);
});

test('nextOpenStepIndex: wraps around once to find an earlier open step', () => {
  const statuses = statusesFrom(['unresolved', 'captured', 'captured', 'captured']);
  // Nothing open at/after index 2 except by wrapping back to 0.
  assert.equal(nextOpenStepIndex(statuses, 2), 0);
});

test('nextOpenStepIndex: -1 when every step is captured or skipped', () => {
  const statuses = statusesFrom(['captured', 'skipped', 'captured']);
  assert.equal(nextOpenStepIndex(statuses, 0), -1);
});

test('nextOpenStepIndex: skipped counts as resolved, same as captured', () => {
  const statuses = statusesFrom(['skipped', 'skipped', 'unresolved']);
  assert.equal(nextOpenStepIndex(statuses, 0), 2);
});

test('nextOpenStepIndex: wrong stays open, same as unresolved — still needs a manual save or skip', () => {
  const statuses = statusesFrom(['captured', 'wrong', 'skipped']);
  assert.equal(nextOpenStepIndex(statuses, 0), 1);
});

// --- summarizeWizard ----------------------------------------------------------

test('summarizeWizard: tallies captured/skipped/unknown honestly', () => {
  const statuses = statusesFrom(['captured', 'captured', 'skipped', 'unresolved']);
  assert.deepEqual(summarizeWizard(statuses), { captured: 2, skipped: 1, unknown: 1 });
});

test('summarizeWizard: all-resolved queue has zero unknown', () => {
  const statuses = statusesFrom(['captured', 'skipped', 'captured', 'skipped']);
  assert.deepEqual(summarizeWizard(statuses), { captured: 2, skipped: 2, unknown: 0 });
});

test('summarizeWizard: wrong folds into unknown, same as unresolved', () => {
  const statuses = statusesFrom(['captured', 'wrong', 'unresolved']);
  assert.deepEqual(summarizeWizard(statuses), { captured: 1, skipped: 0, unknown: 2 });
});

console.log('\nall bdrWizard tests passed');
