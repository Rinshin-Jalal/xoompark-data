// Plain assert-based test, runnable with `node --experimental-strip-types`.
import assert from 'node:assert/strict';
import { parseGoogleMapsCoords } from '../googleMapsLink.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

test('parseGoogleMapsCoords: prefers the !3d!4d place pin over the @ viewport center', () => {
  const url =
    'https://www.google.com/maps/place/69+Southwest+10th+Street+Garage/@25.7649604,-80.1971072,17z/data=!3m1!4b1!4m6!3m5!1s0x88d9b684426dc7db:0x5e74b3464e0c46ef!8m2!3d25.7649556!4d-80.1945323!16s%2Fg%2F11f2gs_st_?entry=ttu&g_ep=EgoyMDI2MDgyNS4wIKXMDSoASAFQAw%3D%3D';
  assert.deepEqual(parseGoogleMapsCoords(url), { lat: 25.7649556, lng: -80.1945323 });
});

test('parseGoogleMapsCoords: falls back to @lat,lng when there is no place pin', () => {
  assert.deepEqual(parseGoogleMapsCoords('https://www.google.com/maps/@25.761,-80.191,15z'), {
    lat: 25.761,
    lng: -80.191,
  });
});

test('parseGoogleMapsCoords: falls back to a ?q=lat,lng share link', () => {
  assert.deepEqual(parseGoogleMapsCoords('https://maps.google.com/?q=25.761,-80.191'), {
    lat: 25.761,
    lng: -80.191,
  });
});

test('parseGoogleMapsCoords: not a Maps URL at all -> null', () => {
  assert.equal(parseGoogleMapsCoords('https://spothero.com/facility/123-parking'), null);
});

test('parseGoogleMapsCoords: empty string -> null', () => {
  assert.equal(parseGoogleMapsCoords(''), null);
  assert.equal(parseGoogleMapsCoords('   '), null);
});

console.log('\nall googleMapsLink tests passed');
