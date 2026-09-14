'use server';

import { revalidatePath } from 'next/cache';
import { getAdminAuth, getDefaultFirestore } from '@/lib/firebaseAdmin';
import { requireAdmin } from '@/lib/requireAdmin';
import { syncUserClaims } from '@/lib/authActions';
import type { Role } from '@/lib/outreach/roles';

// ── Admin-only user management ────────────────────────────────────────────
// Users are created by an admin (no public sign-up). Each user gets a role
// that gates what they see.

export async function createUser(email: string, roles: Role[]): Promise<{ message: string }> {
  await requireAdmin();
  const auth = getAdminAuth();
  const db = getDefaultFirestore();

  const trimmed = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) throw new Error('Enter a valid email');
  if (roles.length === 0) throw new Error('Pick at least one role');

  // Temp password — user resets on first sign-in.
  const tempPassword = Math.random().toString(36).slice(2, 10) + 'Aa1!';

  let uid: string;
  try {
    const user = await auth.createUser({ email: trimmed, password: tempPassword });
    uid = user.uid;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create user';
    if (/already exists/i.test(msg)) throw new Error('A user with that email already exists');
    throw new Error(msg);
  }

  await db.collection('users').doc(uid).set({
    uid,
    email: trimmed,
    displayName: trimmed.split('@')[0],
    photoURL: null,
    roles,
    providerId: null,
    operatorId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  await syncUserClaims(uid);
  revalidatePath('/', 'layout');
  return { message: `Created ${trimmed} as ${roles.join(', ')}. Temp password: ${tempPassword}` };
}

export async function setUserRoles(uid: string, roles: Role[]): Promise<void> {
  await requireAdmin();
  const db = getDefaultFirestore();
  await db.collection('users').doc(uid).update({ roles, updatedAt: new Date().toISOString() });
  await syncUserClaims(uid);
  revalidatePath('/', 'layout');
}

export async function listUsers(): Promise<{ uid: string; email: string; roles: string[] }[]> {
  await requireAdmin();
  const db = getDefaultFirestore();
  const snap = await db.collection('users').get();
  return snap.docs.map((d) => {
    const data = d.data();
    return { uid: d.id, email: data.email ?? '', roles: Array.isArray(data.roles) ? data.roles : ['bdr'] };
  });
}