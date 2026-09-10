// Plain assert-based test, runnable with `node --experimental-strip-types`.
// No network — feeds a fixture shaped exactly like the real ParkinGO
// /en/parking-airport-rome-fiumicino #compare-parkings section (captured
// 2026-08-25) through the pure parse/map functions in parkingoParse.ts.
// Never imports parkingo.ts or store.ts ('server-only' would throw).
import assert from 'node:assert/strict';
import { extractParkingoProducts, ingestParkingoProducts, mapParkingoProductToInput } from '../parkingoParse.ts';
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

// Real shape (trimmed) — two brand-type-element blocks, each with a
// brand-logo img (name), type-icon img (lot type), and three p.h6 texts
// (price / shuttle / distance).
const FIXTURE_HTML = `<html><body>
<div id="compare-parkings">
<div class="brand-type-element d-flex pgo" rel="noopener"> <div class="row infos-wrap">
<div class="col-6 col-lg-3 infos-wrap-column"><img class="brand-logo" src="flmngr/files/landing/GO1-RED-PGO.svg" alt="Parkingo GO1 Logo" width="208" height="45"></div>
<div class="col-6 col-lg-2 infos-wrap-column"><img class="type-icon" src="../imgs/parcheggio-scoperto.svg" alt="OUTDOOR"> <p class="h5 mb-0 fw-semibold">OUTDOOR</p></div>
<div class="col-6 col-lg-2 infos-wrap-column"><p class="mb-0 h6 fw-semibold">from &euro;4.90 per day</p></div>
<div class="col-6 col-lg-2 infos-wrap-column"><p class="mb-0 h6 fw-semibold">4 min shuttle</p></div>
<div class="col-6 col-lg-3 infos-wrap-column"><p class="mb-0 h6 fw-semibold">3 km from FCO</p></div>
</div> </div>
<div class="brand-type-element d-flex fast" rel="noopener"> <div class="row infos-wrap">
<div class="col-6 col-lg-3 infos-wrap-column"><img class="brand-logo" src="flmngr/files/landing/GO3-GIALLO-PGO.svg" alt="Parkingo GO3 Logo" width="208" height="45"></div>
<div class="col-6 col-lg-2 infos-wrap-column"><img class="type-icon" src="../imgs/parcheggio-coperto.svg" alt="COVERED"> <p class="h5 mb-0 fw-semibold">COVERED</p></div>
<div class="col-6 col-lg-2 infos-wrap-column"><p class="mb-0 h6 fw-semibold">from &euro;6.50 per day</p></div>
<div class="col-6 col-lg-2 infos-wrap-column"><p class="mb-0 h6 fw-semibold">5 min shuttle</p></div>
<div class="col-6 col-lg-3 infos-wrap-column"><p class="mb-0 h6 fw-semibold">4 km from FCO</p></div>
</div> </div>
</div>
</body></html>`;

test('extractParkingoProducts: pulls name/lotType/price/shuttle/distance per block', () => {
  const products = extractParkingoProducts(FIXTURE_HTML);
  assert.equal(products.length, 2);
  assert.deepEqual(products[0], {
    name: 'Parkingo GO1',
    lotType: 'OUTDOOR',
    priceText: 'from €4.90 per day',
    shuttleText: '4 min shuttle',
    distanceText: '3 km from FCO',
  });
  assert.equal(products[1].name, 'Parkingo GO3');
  assert.equal(products[1].lotType, 'COVERED');
});

test('extractParkingoProducts: page with no blocks -> []', () => {
  assert.deepEqual(extractParkingoProducts('<html><body>comparison portal, no products</body></html>'), []);
});

test('mapParkingoProductToInput: maps a product, sourceListingId folds in airport slug', () => {
  const [product] = extractParkingoProducts(FIXTURE_HTML);
  const input = mapParkingoProductToInput(product, 'https://www.parkingo.com/en/parking-airport-rome-fiumicino');
  assert.ok(input);
  assert.equal(input!.source, 'parkingo');
  assert.equal(input!.name, 'Parkingo GO1');
  assert.equal(input!.priceText, 'from €4.90 per day');
  assert.equal(input!.sourceUrl, 'https://www.parkingo.com/en/parking-airport-rome-fiumicino#parkingo-go1');
  assert.equal(input!.sourceListingId, 'parking-airport-rome-fiumicino-parkingo-go1');
  assert.equal(input!.capturedBy, 'scraped');
  assert.equal(input!.fieldProvenance!.name, 'self-reported');
  assert.equal(input!.fieldProvenance!.priceText, 'self-reported');
  // lotType/shuttle/distance stay in rawInput only
  assert.equal((input!.rawInput as { lotType?: string }).lotType, 'OUTDOOR');
});

// --- ingestParkingoProducts: sweep aggregation ---
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

await test('ingestParkingoProducts: maps every product', async () => {
  const store = makeFakeStore();
  const products = extractParkingoProducts(FIXTURE_HTML);

  const result = await ingestParkingoProducts('https://www.parkingo.com/en/parking-airport-rome-fiumicino', products, store.upsert);

  assert.equal(result.ingested, 2);
  assert.equal(result.skipped, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(store.docs.size, 2);
});

console.log('\nall parkingo tests passed');