// Plain assert-based test, runnable with `node --experimental-strip-types`.
// No network — exercises the pure derivation in types.ts. Never imports
// store.ts or servicesEnrich.ts ('server-only' would throw under plain node
// outside a react-server condition) — same split as geoContext.test.ts.
import assert from 'node:assert/strict';
import { deriveServicesResources, SERVICE_NEAR_M, STAGING_MIN_CAPACITY, WASH_NEAR_M } from '../types.ts';
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

// Minimal doc-shaped input — deriveServicesResources only reads these keys.
type DeriveInput = Parameters<typeof deriveServicesResources>[0];
const base: DeriveInput = {};

test('every lot gets parking_stall, nothing guessed', () => {
  const { services, resources } = deriveServicesResources(base);
  assert.deepEqual(services, []);
  assert.deepEqual(resources, ['parking_stall']);
});

test('on-site DC fast ports => charging + ev_connector', () => {
  const { services, resources } = deriveServicesResources({ evContext: { onSiteDcFastPorts: 4, checkedAt: 'x' } });
  assert.deepEqual(services, ['charging']);
  assert.deepEqual(resources, ['parking_stall', 'ev_connector']);
});

test('on-site Level 2 ports also count as charging (overnight fleet charging)', () => {
  const { services, resources } = deriveServicesResources({ evContext: { onSiteDcFastPorts: null, onSiteLevel2Ports: 8, checkedAt: 'x' } });
  assert.deepEqual(services, ['charging']);
  assert.deepEqual(resources, ['parking_stall', 'ev_connector']);
});

test('null (checked, none) or 0 ports => no charging', () => {
  for (const ev of [{ onSiteDcFastPorts: null, onSiteLevel2Ports: null }, { onSiteDcFastPorts: 0, onSiteLevel2Ports: 0 }]) {
    const { services, resources } = deriveServicesResources({ evContext: { ...ev, checkedAt: 'x' } });
    assert.deepEqual(services, []);
    assert.deepEqual(resources, ['parking_stall']);
  }
});

test('car wash within WASH_NEAR_M => wash + wash_bay; beyond or absent => no', () => {
  const near = deriveServicesResources({ amenityContext: { nearestCarWashM: WASH_NEAR_M, checkedAt: 'x' } });
  assert.deepEqual(near.services, ['wash']);
  assert.deepEqual(near.resources, ['parking_stall', 'wash_bay']);
  const far = deriveServicesResources({ amenityContext: { nearestCarWashM: WASH_NEAR_M + 1, checkedAt: 'x' } });
  assert.deepEqual(far.services, []);
  const none = deriveServicesResources({ amenityContext: { nearestCarWashM: null, checkedAt: 'x' } });
  assert.deepEqual(none.services, []);
});

test('car repair within SERVICE_NEAR_M => service + service_bay', () => {
  const near = deriveServicesResources({ amenityContext: { nearestCarServiceM: 50, checkedAt: 'x' } });
  assert.deepEqual(near.services, ['service']);
  assert.deepEqual(near.resources, ['parking_stall', 'service_bay']);
  const far = deriveServicesResources({ amenityContext: { nearestCarServiceM: SERVICE_NEAR_M + 1, checkedAt: 'x' } });
  assert.deepEqual(far.services, []);
});

test('staging heuristic: capacity + 24/7 + is_fenced', () => {
  const loc: DeriveInput = { stall_count: STAGING_MIN_CAPACITY, is_24_7: true, is_fenced: true };
  assert.deepEqual(deriveServicesResources(loc).services, ['staging']);
});

test('staging: hours_text "Open 24/7" counts as 24/7', () => {
  const loc: DeriveInput = { stall_count: 200, hours_text: 'Open 24/7', is_fenced: true };
  assert.deepEqual(deriveServicesResources(loc).services, ['staging']);
});

test('staging: below capacity threshold => no', () => {
  const loc: DeriveInput = { stall_count: STAGING_MIN_CAPACITY - 1, is_24_7: true, is_fenced: true };
  assert.deepEqual(deriveServicesResources(loc).services, []);
});

test('staging: not is_fenced => no (never guessed from silence)', () => {
  const loc: DeriveInput = { stall_count: 500, is_24_7: true, is_fenced: null };
  assert.deepEqual(deriveServicesResources(loc).services, []);
});

test('staging: not 24/7 => no', () => {
  const loc: DeriveInput = { stall_count: 500, is_24_7: false, is_fenced: true };
  assert.deepEqual(deriveServicesResources(loc).services, []);
});

test('capacity falls through capacity_text then pitstopContext.capacity', () => {
  const viaText: DeriveInput = { capacity_text: '2,000 spaces', is_24_7: true, is_fenced: true };
  assert.deepEqual(deriveServicesResources(viaText).services, ['staging']);
  const viaPitstop: DeriveInput = { pitstopContext: { capacity: 150, checkedAt: 'x' }, is_24_7: true, is_fenced: true };
  assert.deepEqual(deriveServicesResources(viaPitstop).services, ['staging']);
});

test('charging + staging stack', () => {
  const loc: DeriveInput = {
    evContext: { onSiteDcFastPorts: 2, checkedAt: 'x' },
    stall_count: 300,
    is_24_7: true,
    is_fenced: true,
  };
  const { services, resources } = deriveServicesResources(loc);
  assert.deepEqual(services, ['charging', 'staging']);
  assert.deepEqual(resources, ['parking_stall', 'ev_connector']);
});

test('accepts full SourcedParkingLocation docs (type-level smoke)', () => {
  const doc = { ...base } as Pick<SourcedParkingLocation, 'evContext' | 'amenityContext' | 'pitstopContext' | 'stall_count' | 'capacity_text' | 'is_24_7' | 'hours_text' | 'is_fenced'>;
  assert.deepEqual(deriveServicesResources(doc).resources, ['parking_stall']);
});

console.log('all deriveServices tests passed');
