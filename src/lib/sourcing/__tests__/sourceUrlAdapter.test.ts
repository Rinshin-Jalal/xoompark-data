// Plain assert-based test, runnable with `node --experimental-strip-types`.
// Same style as parkopedia.test.ts/spothero.test.ts.
import assert from 'node:assert/strict';
import { classifySourceUrl } from '../sourceUrlAdapter.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

test('classifySourceUrl: spothero destination page -> spothero-listing', () => {
  assert.equal(
    classifySourceUrl('https://spothero.com/destination/miami/downtown-miami-parking'),
    'spothero-listing',
  );
});

test('classifySourceUrl: spothero facility page -> spothero-facility', () => {
  assert.equal(
    classifySourceUrl('https://spothero.com/facility/92951/100-se-2nd-st-parking'),
    'spothero-facility',
  );
});

test('classifySourceUrl: spothero /search share link with spot-id -> spothero-facility', () => {
  assert.equal(
    classifySourceUrl(
      'https://spothero.com/search?kind=city&id=5&starts=2026-08-27T14:00&ends=2026-08-27T17:00&view=dl&spot-id=92951',
    ),
    'spothero-facility',
  );
});

test('classifySourceUrl: spothero /search with no spot-id -> unknown', () => {
  assert.equal(classifySourceUrl('https://spothero.com/search?kind=city&id=5'), 'unknown');
});

test('classifySourceUrl: parkopedia city listing page -> parkopedia-listing', () => {
  assert.equal(classifySourceUrl('https://en.parkopedia.com/parking/miami_fl/'), 'parkopedia-listing');
});

test('classifySourceUrl: parkopedia www mirror also classifies as listing', () => {
  assert.equal(classifySourceUrl('https://www.parkopedia.com/parking/miami_fl/'), 'parkopedia-listing');
});

test('classifySourceUrl: parkopedia garage detail page -> parkopedia-location', () => {
  assert.equal(
    classifySourceUrl('https://en.parkopedia.com/parking/garage/river_landing_shops_and_residences/33125/miami/'),
    'parkopedia-location',
  );
});

test('classifySourceUrl: parkopedia meter detail page -> parkopedia-location', () => {
  assert.equal(
    classifySourceUrl('https://en.parkopedia.com/parking/meter/1891_northwest_21st_street/33142/miami/'),
    'parkopedia-location',
  );
});

test('classifySourceUrl: parkopedia lot detail page -> parkopedia-location', () => {
  assert.equal(
    classifySourceUrl('https://en.parkopedia.com/parking/lot/1641_nw_13th_court/33125/miami/'),
    'parkopedia-location',
  );
});

test('classifySourceUrl: garbage string -> unknown, no throw', () => {
  assert.equal(classifySourceUrl('not a url at all'), 'unknown');
});

test('classifySourceUrl: unrelated domain -> unknown', () => {
  assert.equal(classifySourceUrl('https://example.com/parking/miami_fl/'), 'unknown');
});

test('classifySourceUrl: spothero URL with neither /destination/ nor /facility/ -> unknown', () => {
  assert.equal(classifySourceUrl('https://spothero.com/miami-parking'), 'unknown');
});

test('classifySourceUrl: parkopedia URL with no recognizable path shape -> unknown', () => {
  assert.equal(classifySourceUrl('https://en.parkopedia.com/about-us/'), 'unknown');
});

test('classifySourceUrl: non-http(s) protocol -> unknown', () => {
  assert.equal(classifySourceUrl('ftp://spothero.com/destination/miami/downtown-miami-parking'), 'unknown');
});

// --- 14 single-sweep sources (commit 8759a32) — hostname-only classification,
// any path on the host matches, no path-shape logic. ---

test('classifySourceUrl: Miami Beach -> miami-beach', () => {
  assert.equal(
    classifySourceUrl('https://www.miamibeachfl.gov/city-hall/parking/parking-garages-lot-locations/parking-garage-rates/'),
    'miami-beach',
  );
});

test('classifySourceUrl: PortMiami (miamidade.gov) -> portmiami', () => {
  assert.equal(
    classifySourceUrl('https://www.miamidade.gov/portmiami/parking-information.page'),
    'portmiami',
  );
});

test('classifySourceUrl: MIA Airport -> mia-airport', () => {
  assert.equal(classifySourceUrl('https://www.miami-airport.com/airport-parking.asp'), 'mia-airport');
});

test('classifySourceUrl: Texas A&M -> tamu', () => {
  assert.equal(classifySourceUrl('https://transport.tamu.edu/Parking/garages.aspx'), 'tamu');
});

test('classifySourceUrl: University of Michigan -> umich', () => {
  assert.equal(
    classifySourceUrl('https://ltp.umich.edu/parking/patient-and-visitor/campus-visitor-parking/'),
    'umich',
  );
});

test('classifySourceUrl: UC Davis Health -> ucdavis', () => {
  assert.equal(classifySourceUrl('https://health.ucdavis.edu/parking/visitor/'), 'ucdavis');
});

test('classifySourceUrl: Georgia Tech -> gatech', () => {
  assert.equal(classifySourceUrl('https://www.pts.gatech.edu/parking/visitor-parking/'), 'gatech');
});

test('classifySourceUrl: Sylvan Parking -> sylvan', () => {
  assert.equal(classifySourceUrl('https://sylvanparking.com/locations-rates.html'), 'sylvan');
});

test('classifySourceUrl: iPark -> ipark', () => {
  assert.equal(classifySourceUrl('https://ipark.com/garage/408-west-57th-parking-corp/'), 'ipark');
});

test('classifySourceUrl: Secure Parking HI -> securehi', () => {
  assert.equal(
    classifySourceUrl('https://www.secureparkinghi.com/parking-location/hawaii-office/'),
    'securehi',
  );
});

test('classifySourceUrl: Palmetto Parking -> palmetto (public domain, not the internal KML host)', () => {
  assert.equal(classifySourceUrl('https://www.palmettoparking.com/find-parking/'), 'palmetto');
});

test('classifySourceUrl: Gacha\'s Parking -> gachas', () => {
  assert.equal(classifySourceUrl('https://gachasparking.com'), 'gachas');
});

test('classifySourceUrl: ParkinGO -> parkingo', () => {
  assert.equal(classifySourceUrl('https://www.parkingo.com/en/parking-airport-rome-fiumicino'), 'parkingo');
});

test('classifySourceUrl: ParkWhiz -> parkwhiz (public domain, not the internal API host)', () => {
  assert.equal(classifySourceUrl('https://www.parkwhiz.com/locations/12345/'), 'parkwhiz');
});

test('classifySourceUrl: an internal-only fetch host (api.parkwhiz.com) does NOT self-classify -> unknown', () => {
  assert.equal(classifySourceUrl('https://api.parkwhiz.com/v4/quotes/'), 'unknown');
});

console.log('\nall sourceUrlAdapter tests passed');
