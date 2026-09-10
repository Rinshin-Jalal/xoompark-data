// Plain assert-based test, runnable with `node --experimental-strip-types`.
// Covers huntAggregatorLinks' verified-vs-fallback selection and that the
// static §4 link lists are well-formed. Not re-verifying liveness here
// (that was done by hand against the real sites — see huntLinks.ts's
// comment) — this just locks in the lookup behavior.
import assert from 'node:assert/strict';
import {
  HUNT_OFFICIAL_LINKS,
  HUNT_UNINGESTED_AGGREGATOR_LINKS,
  huntAggregatorLinks,
} from '../huntLinks.ts';
import { LOCALITIES } from '../locality.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

test('huntAggregatorLinks returns all 5 aggregators from §0.5', () => {
  const links = huntAggregatorLinks('Brickell');
  assert.deepEqual(
    links.map((l) => l.aggregator),
    ['SpotHero', 'Parkopedia', 'Parking.com', 'ParkWhiz', 'BestParking'],
  );
});

test('huntAggregatorLinks: Brickell gets a verified SpotHero + ParkWhiz deep link', () => {
  const links = huntAggregatorLinks('Brickell');
  const spothero = links.find((l) => l.aggregator === 'SpotHero')!;
  const parkwhiz = links.find((l) => l.aggregator === 'ParkWhiz')!;
  assert.equal(spothero.verified, true);
  assert.equal(spothero.url, 'https://spothero.com/destination/miami/brickell-parking');
  assert.equal(parkwhiz.verified, true);
});

test('huntAggregatorLinks: a locality with no verified deep link falls back to the homepage, unverified', () => {
  const links = huntAggregatorLinks('Key Biscayne');
  for (const l of links) {
    assert.equal(l.verified, false, `${l.aggregator} should not claim a verified deep link for Key Biscayne`);
    assert.ok(l.url.startsWith('https://'), `${l.aggregator} fallback must still be a real URL`);
  }
});

test('huntAggregatorLinks: Parking.com and BestParking never claim a verified deep link (none confirmed)', () => {
  for (const locality of LOCALITIES) {
    const links = huntAggregatorLinks(locality);
    assert.equal(links.find((l) => l.aggregator === 'Parking.com')!.verified, false);
    assert.equal(links.find((l) => l.aggregator === 'BestParking')!.verified, false);
  }
});

test('huntAggregatorLinks: every URL for every locality is a well-formed https URL', () => {
  for (const locality of LOCALITIES) {
    for (const l of huntAggregatorLinks(locality)) {
      assert.doesNotThrow(() => new URL(l.url));
      assert.ok(l.url.startsWith('https://'));
    }
  }
});

test('HUNT_OFFICIAL_LINKS and HUNT_UNINGESTED_AGGREGATOR_LINKS are non-empty, well-formed', () => {
  assert.ok(HUNT_OFFICIAL_LINKS.length >= 5);
  assert.ok(HUNT_UNINGESTED_AGGREGATOR_LINKS.length >= 5);
  for (const l of [...HUNT_OFFICIAL_LINKS, ...HUNT_UNINGESTED_AGGREGATOR_LINKS]) {
    assert.doesNotThrow(() => new URL(l.url));
    assert.ok(l.label.length > 0);
  }
});

console.log('\nall huntLinks tests passed');
