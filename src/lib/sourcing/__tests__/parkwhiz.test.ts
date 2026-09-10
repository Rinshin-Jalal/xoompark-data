// Plain assert-based test, runnable with `node --experimental-strip-types`.
// No network — feeds a fixture shaped exactly like the real
// api.parkwhiz.com/v4/quotes/ response (captured 2026-08-25) through the
// pure parse/map functions in parkwhizParse.ts. Never imports parkwhiz.ts or
// store.ts ('server-only' would throw under plain node).
import assert from 'node:assert/strict';
import { ingestQuotes, mapQuoteToInput } from '../parkwhizParse.ts';
import type { ParkWhizQuote } from '../parkwhizParse.ts';
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

// Real shape (trimmed) — one quote with the full _embedded['pw:location']
// object and a live price. Entrance coordinates are [lat, lng].
const QUOTE: ParkWhizQuote = {
  location_id: '64511',
  start_time: '2026-08-26T10:00:00.000-04:00',
  end_time: '2026-08-26T12:00:00.000-04:00',
  purchase_options: [
    {
      price: { USD: '39.55' },
      start_time: '2026-08-26T10:00:00.000-04:00',
      end_time: '2026-08-26T12:00:00.000-04:00',
    },
  ],
  _embedded: {
    'pw:location': {
      id: '64511',
      name: 'JW Marriott Miami - Valet Kiosk',
      address1: '1109 Brickell Ave.',
      city: 'Miami',
      state: 'FL',
      postal_code: '33131',
      entrances: [{ coordinates: [25.762235108949707, -80.19109940541968] }],
    },
  },
};

test('mapQuoteToInput: maps a full quote, entrance coords are [lat, lng]', () => {
  const input = mapQuoteToInput(QUOTE);
  assert.ok(input);
  assert.equal(input!.source, 'parkwhiz');
  assert.equal(input!.sourceListingId, '64511');
  assert.equal(input!.sourceUrl, 'https://www.parkwhiz.com/locations/64511/');
  assert.equal(input!.name, 'JW Marriott Miami - Valet Kiosk');
  assert.equal(input!.address, '1109 Brickell Ave., Miami, FL 33131');
  assert.equal(input!.lat, 25.762235108949707);
  assert.equal(input!.lng, -80.19109940541968);
  assert.equal(input!.priceText, '$39.55 (2hr)');
  assert.equal(input!.capturedBy, 'scraped');
});

test('mapQuoteToInput: every captured field is self-reported provenance', () => {
  const input = mapQuoteToInput(QUOTE)!;
  for (const field of ['name', 'address', 'lat', 'lng', 'priceText']) {
    assert.equal(input.fieldProvenance![field], 'self-reported', `${field} provenance`);
  }
});

test('mapQuoteToInput: missing location id -> null', () => {
  assert.equal(mapQuoteToInput({ purchase_options: [] }), null);
});

// --- ingestQuotes: dedup by location_id + sweep aggregation ---
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

await test('ingestQuotes: dedups the same location_id hit from multiple grid points', async () => {
  const store = makeFakeStore();
  const dup = { ...QUOTE }; // same location_id, hit from a second grid point
  const other: ParkWhizQuote = {
    location_id: '99999',
    purchase_options: [{ price: { USD: '10.00' }, start_time: '2026-08-26T10:00:00.000-04:00', end_time: '2026-08-26T12:00:00.000-04:00' }],
    _embedded: {
      'pw:location': {
        id: '99999',
        name: 'Other Garage',
        address1: '1 Main St',
        city: 'Miami',
        state: 'FL',
        postal_code: '33101',
        entrances: [{ coordinates: [25.77, -80.19] }],
      },
    },
  };

  const result = await ingestQuotes([QUOTE, dup, other], store.upsert);

  assert.equal(result.ingested, 2); // 64511 (once) + 99999
  assert.equal(result.skipped, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(store.docs.size, 2);
});

console.log('\nall parkwhiz tests passed');