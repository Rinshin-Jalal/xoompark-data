// Pure decision logic for fleet API-key auth. Deliberately Firestore- and
// 'server-only'-free (auth.ts keeps the I/O) so the trust-boundary rules are
// testable with plain `node --experimental-strip-types`.
export interface FleetAccount {
  status?: string;
  role?: string;
  operatorId?: string;
  label?: string;
}

export interface FleetPrincipal {
  keyId: string;
  fleet: string;
}

export class FleetAuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Decide the fleet principal from a fetched operatorApiKeys doc. Throws
 * FleetAuthError (with HTTP status) on any rejection — the caller maps it
 * to a response. Accepts role 'fleet' (dedicated fleet key) or 'admin'.
 */
export function resolveFleetPrincipal(account: FleetAccount, keyId: string): FleetPrincipal {
  if (account.status === 'REVOKED') throw new FleetAuthError(401, 'API key has been revoked');
  if (account.role !== 'fleet' && account.role !== 'admin') {
    throw new FleetAuthError(403, 'This API key is not authorized for the fleet API');
  }
  // `||` not `??` — an empty operatorId/label is missing data, not a fleet
  // name; fall through to the key id.
  return { keyId, fleet: account.operatorId || account.label || keyId };
}
