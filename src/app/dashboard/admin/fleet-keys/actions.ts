'use server';

import { revalidatePath } from 'next/cache';
import { randomBytes, createHash } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getDefaultFirestore } from '@/lib/firebaseAdmin';
import { requireAdmin } from '@/lib/requireAdmin';

export interface FleetKeyInput {
  label: string;
}

/**
 * Create a fleet API key (role 'fleet') for the /api/fleet/* endpoints.
 * The label doubles as the fleet identity in feedback records — the fleet
 * auth principal falls back operatorId > label > keyId, and we deliberately
 * leave operatorId unset so a fleet key can never collide with operator
 * tenancy on the v2 booking API.
 */
export async function createFleetKey(input: FleetKeyInput): Promise<{ rawKey: string; keyId: string }> {
  await requireAdmin();

  const label = input.label.trim();
  if (!label) throw new Error('Label is required');
  if (label.length > 100) throw new Error('Label must be at most 100 characters');

  const rawKey = `xpf_${randomBytes(32).toString('hex')}`;
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  const db = getDefaultFirestore();
  const keyRef = db.collection('operatorApiKeys').doc();
  await keyRef.set({
    id: keyRef.id,
    label,
    keyHash,
    status: 'ACTIVE',
    role: 'fleet',
    scopes: [],
    sourceChannel: 'admin-dashboard',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  revalidatePath('/dashboard/admin/fleet-keys');
  return { rawKey, keyId: keyRef.id };
}

export async function revokeFleetKey(keyId: string): Promise<void> {
  const admin = await requireAdmin();
  const db = getDefaultFirestore();
  const ref = db.collection('operatorApiKeys').doc(keyId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Key not found');
  const data = snap.data() as { role?: string };
  // Only fleet keys are manageable here — never touch operator/admin keys
  // from this page.
  if (data.role !== 'fleet') throw new Error('Not a fleet key');
  await ref.update({ status: 'REVOKED', updatedAt: FieldValue.serverTimestamp(), revokedBy: admin.email });
  revalidatePath('/dashboard/admin/fleet-keys');
}
