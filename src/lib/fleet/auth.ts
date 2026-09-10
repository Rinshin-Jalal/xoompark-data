import 'server-only';
import { createHash } from 'crypto';
import { getDefaultFirestore } from '../firebaseAdmin.ts';
import { resolveFleetPrincipal, FleetAuthError, type FleetPrincipal, type FleetAccount } from './principal.ts';

export { FleetAuthError };
export type { FleetPrincipal };

/**
 * X-API-Key auth for the fleet-facing API (/api/fleet/*). Same keyHash
 * scheme as the operator v2 API (functions/src/booking/auth.ts) — a fleet
 * key is just an operatorApiKeys doc with role 'fleet'.
 * // ponytail: mint fleet keys by inserting an operatorApiKeys doc with
 * // role:'fleet' (Firestore console); add a dashboard mint flow when there
 * // is more than one fleet customer.
 */
export async function requireFleetKey(request: Request): Promise<FleetPrincipal> {
  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) throw new FleetAuthError(401, 'Missing X-API-Key header');

  const keyHash = createHash('sha256').update(apiKey).digest('hex');
  const db = getDefaultFirestore();
  const snap = await db.collection('operatorApiKeys').where('keyHash', '==', keyHash).limit(1).get();
  if (snap.empty) throw new FleetAuthError(401, 'Invalid API key');

  const principal = resolveFleetPrincipal(snap.docs[0].data() as FleetAccount, snap.docs[0].id);

  // Fire-and-forget lastUsedAt, same as the operator API.
  db.collection('operatorApiKeys').doc(snap.docs[0].id).update({ lastUsedAt: new Date().toISOString() }).catch(() => {});

  return principal;
}
