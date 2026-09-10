// Plain assert-based test, runnable with `node --experimental-strip-types`.
// Only imports principal.ts — pure, no Firestore, no server-only.
import assert from 'node:assert/strict';
import { resolveFleetPrincipal, FleetAuthError } from '../principal.ts';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

test('role fleet: accepted, fleet name from operatorId', () => {
  const p = resolveFleetPrincipal({ status: 'ACTIVE', role: 'fleet', operatorId: 'op123' }, 'key1');
  assert.deepEqual(p, { keyId: 'key1', fleet: 'op123' });
});

test('role admin: accepted (admin keys can use the fleet API)', () => {
  const p = resolveFleetPrincipal({ status: 'ACTIVE', role: 'admin' }, 'key1');
  assert.equal(p.fleet, 'key1'); // no operatorId/label -> falls back to keyId
});

test('fleet name fallback chain: operatorId > label > keyId', () => {
  assert.equal(resolveFleetPrincipal({ role: 'fleet', operatorId: 'op', label: 'L' }, 'k').fleet, 'op');
  assert.equal(resolveFleetPrincipal({ role: 'fleet', label: 'L' }, 'k').fleet, 'L');
  assert.equal(resolveFleetPrincipal({ role: 'fleet' }, 'k').fleet, 'k');
  assert.equal(resolveFleetPrincipal({ role: 'fleet', operatorId: '', label: '' }, 'k').fleet, 'k'); // empty strings fall through
});

test('REVOKED keys are rejected with 401 regardless of role', () => {
  for (const role of ['fleet', 'admin', 'booking_agent']) {
    assert.throws(
      () => resolveFleetPrincipal({ status: 'REVOKED', role }, 'k'),
      (e: unknown) => e instanceof FleetAuthError && e.status === 401,
      `expected 401 for REVOKED role=${role}`,
    );
  }
});

test('every other role is rejected with 403', () => {
  for (const role of ['booking_agent', 'operator_admin', 'provider_admin', undefined, '', 'FLEET', 'fleet ']) {
    assert.throws(
      () => resolveFleetPrincipal({ status: 'ACTIVE', role }, 'k'),
      (e: unknown) => e instanceof FleetAuthError && e.status === 403,
      `expected 403 for role=${JSON.stringify(role)}`,
    );
  }
});

test('missing status is treated as active (only REVOKED blocks)', () => {
  assert.doesNotThrow(() => resolveFleetPrincipal({ role: 'fleet' }, 'k'));
});

test('error messages carry the status and a reason', () => {
  try {
    resolveFleetPrincipal({ status: 'ACTIVE', role: 'booking_agent' }, 'k');
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof FleetAuthError);
    assert.ok((e as Error).message.length > 0);
  }
});

console.log('fleet principal: all tests passed');
