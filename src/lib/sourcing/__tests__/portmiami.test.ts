// Plain assert-based test, runnable with `node --experimental-strip-types`.
// No network — feeds a fixture shaped exactly like the real
// miamidade.gov/portmiami/parking-information.page (captured 2026-08-25)
// through the pure parse/map functions in portmiamiParse.ts. Never imports
// portmiami.ts or store.ts ('server-only' would throw under plain node).
import assert from 'node:assert/strict';
import {
  extractPortMiamiFacilities,
  extractPortMiamiRateBlocks,
  findRateBlock,
  ingestPortMiamiFacilities,
  mapFacilityToInput,
} from '../portmiamiParse.ts';
import { buildUpsertDoc, computeDedupeKey, normalizeAddress } from '../types.ts';
import type { SourcedLocationInput, SourcedParkingLocation } from '../types.ts';

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

// Real shape (trimmed) — the "Parking Garage Addresses" <ul> and the
// "Rates & Payment" prose blocks. Includes the tricky cases: "Garage A" vs
// "Garage AA" (prefix bleed), "Garage C" in a grouped heading, and
// "Surface Lot E" with both its own block and a grouped mention.
const FIXTURE_HTML = `<html><body>
<div class="mdc-custom__multi-item__title"><span>Parking Garage Addresses</span></div>
<div class="mdc-custom__multi-item__description"><ul>
<li>Garage AA &ndash; 2200 N Cruise Blvd.</li>
<li>Garage A &ndash; 2000 N Cruise Blvd.</li>
<li>Garage C &ndash; 1648 N Cruise Blvd.</li>
<li>Garage J &ndash; 1122 Caribbean Way</li>
<li>Surface Lot E &ndash; 625 Florida Way</li>
</ul></div>
<h2>Rates &amp; Payment</h2>
<div class="mdc-custom__content__description">
<p><strong>Payment for All Garages and Surface Lots</strong></p>
<ul><li>Cash, Visa, MasterCard.</li></ul>
<p><strong>Garage AA</strong></p>
<ul>
<li>Short term, per vehicle, per space, $20 per day (no overnight)</li>
<li>Long-term (overnight or greater), per vehicle, per space, $35 per day</li>
</ul>
<p><strong>Garage A (Royal Caribbean)</strong></p>
<ul><li>View rates online for parking rate information.</li></ul>
<p><strong>Garages C, D, F, G and Surface Lot E</strong></p>
<ul>
<li>Short term, per vehicle, per space, per day (no overnight) or fraction of $10</li>
<li>Long-term (overnight or greater), per vehicle, per space, per day or a fraction of $25</li>
</ul>
<p><strong>Surface Lot E</strong></p>
<ul><li>$25 per space, per day. If two spaces are utilized, $50 per day</li></ul>
</div>
</body></html>`;

test('extractPortMiamiFacilities: pulls name + address from each li', () => {
  const facilities = extractPortMiamiFacilities(FIXTURE_HTML);
  assert.equal(facilities.length, 5);
  assert.deepEqual(facilities[0], { name: 'Garage AA', address: '2200 N Cruise Blvd.' });
  assert.deepEqual(facilities[4], { name: 'Surface Lot E', address: '625 Florida Way' });
});

test('extractPortMiamiRateBlocks: pulls heading + lines, includes the payment block', () => {
  const blocks = extractPortMiamiRateBlocks(FIXTURE_HTML);
  assert.equal(blocks.length, 5);
  assert.equal(blocks[0].heading, 'Payment for All Garages and Surface Lots');
  assert.equal(blocks[1].heading, 'Garage AA');
  assert.equal(blocks[1].lines.length, 2);
});

test('findRateBlock: exact match wins over grouped mention (Surface Lot E)', () => {
  const blocks = extractPortMiamiRateBlocks(FIXTURE_HTML);
  const block = findRateBlock('Surface Lot E', blocks)!;
  assert.equal(block.heading, 'Surface Lot E');
});

test('findRateBlock: "Garage A" does not bleed into "Garage AA"', () => {
  const blocks = extractPortMiamiRateBlocks(FIXTURE_HTML);
  const block = findRateBlock('Garage A', blocks)!;
  assert.equal(block.heading, 'Garage A (Royal Caribbean)');
});

test('findRateBlock: "Garage C" matches the grouped heading', () => {
  const blocks = extractPortMiamiRateBlocks(FIXTURE_HTML);
  const block = findRateBlock('Garage C', blocks)!;
  assert.equal(block.heading, 'Garages C, D, F, G and Surface Lot E');
});

test('findRateBlock: no matching heading -> undefined', () => {
  const blocks = extractPortMiamiRateBlocks(FIXTURE_HTML);
  assert.equal(findRateBlock('Garage J', blocks), undefined);
});

test('mapFacilityToInput: maps a facility + matched rate block', () => {
  const facilities = extractPortMiamiFacilities(FIXTURE_HTML);
  const blocks = extractPortMiamiRateBlocks(FIXTURE_HTML);
  const input = mapFacilityToInput(facilities[0], findRateBlock(facilities[0].name, blocks), 'https://www.miamidade.gov/portmiami/parking-information.page');
  assert.ok(input);
  assert.equal(input!.source, 'portmiami');
  assert.equal(input!.name, 'Garage AA');
  assert.equal(input!.address, '2200 N Cruise Blvd.');
  assert.equal(input!.sourceListingId, 'garage-aa');
  assert.equal(input!.priceText, 'Short term, per vehicle, per space, $20 per day (no overnight); Long-term (overnight or greater), per vehicle, per space, $35 per day');
  assert.equal(input!.capturedBy, 'scraped');
  assert.equal(input!.fieldProvenance!.address, 'self-reported');
  assert.equal(input!.fieldProvenance!.priceText, 'self-reported');
});

// --- ingestPortMiamiFacilities: sweep aggregation ---
function makeFakeStore() {
  const docs = new Map<string, SourcedParkingLocation>();
  const upsert = async (input: SourcedLocationInput): Promise<SourcedParkingLocation> => {
    const normalizedAddress = input.normalizedAddress ?? (input.address ? normalizeAddress(input.address) : undefined);
    const id = computeDedupeKey({ source: input.source, sourceListingId: input.sourceListingId, normalizedAddress });
    const existing = docs.get(id) ?? null;
    const doc = buildUpsertDoc(existing, input, '2026-08-25T00:00:00.000Z');
    docs.set(id, doc);
    return doc;
  };
  return { docs, upsert };
}

await test('ingestPortMiamiFacilities: maps every facility, rate attached where matched', async () => {
  const store = makeFakeStore();
  const facilities = extractPortMiamiFacilities(FIXTURE_HTML);
  const blocks = extractPortMiamiRateBlocks(FIXTURE_HTML);

  const result = await ingestPortMiamiFacilities('https://www.miamidade.gov/portmiami/parking-information.page', facilities, blocks, store.upsert);

  assert.equal(result.ingested, 5);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(store.docs.size, 5);
  // Garage J has no rate block -> no priceText, but still ingested.
  assert.equal(store.docs.get('portmiami:garage-j')!.priceText, undefined);
});

console.log('\nall portmiami tests passed');