'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAdminAuth, getDefaultFirestore } from './firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export async function createSessionCookie(idToken: string): Promise<void> {
  const auth = getAdminAuth();
  const expiresIn = 60 * 60 * 24 * 5 * 1000; // 5 days
  const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn });
  const cookieStore = await cookies();
  cookieStore.set('session', sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: expiresIn / 1000,
    path: '/',
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete('session');
}

// Single authoritative claims-builder — always reads from Firebase Auth + Firestore.
// Call this any time Firestore data that affects claims changes (onboarding, backfill, etc.).
export async function syncUserClaims(uid: string): Promise<void> {
  const auth = getAdminAuth();
  const db = getDefaultFirestore();
  const [fbUser, userSnap] = await Promise.all([
    auth.getUser(uid),
    db.collection('users').doc(uid).get(),
  ]);
  const profile = userSnap.exists ? userSnap.data()! : {};
  const claims: Record<string, unknown> = {};
  if ((fbUser.email ?? '').endsWith('@xoompark.co')) claims.role = 'admin';
  if (profile.providerId) claims.providerId = profile.providerId;
  if (profile.operatorId) claims.operatorId = profile.operatorId;
  await auth.setCustomUserClaims(uid, claims);
}

export async function ensureUserProfile(uid: string, data: {
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}): Promise<void> {
  const db = getDefaultFirestore();
  const userRef = db.collection('users').doc(uid);
  const snap = await userRef.get();
  if (!snap.exists) {
    await userRef.set({
      uid,
      email: data.email,
      displayName: data.displayName,
      photoURL: data.photoURL,
      roles: [],
      providerId: null,
      operatorId: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await syncUserClaims(uid);
}

export async function signOutAction(): Promise<void> {
  const cookieStore = await cookies();
  const session = cookieStore.get('session')?.value;
  if (session) {
    try {
      const auth = getAdminAuth();
      const decoded = await auth.verifySessionCookie(session);
      await auth.revokeRefreshTokens(decoded.uid);
    } catch {
      // best-effort revocation
    }
  }
  cookieStore.delete('session');
  redirect('/');
}
